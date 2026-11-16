import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from './config.js'

// Video storage has two drivers behind one interface:
//  - blob  (Vercel Blob): the browser uploads straight to Blob, so large files never pass through a
//          function. Blobs are private. Playback redirects to a short-lived signed URL.
//  - local (disk): the API streams the upload to disk. Used for local dev and tests.

const EXT: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
}

export const normalizeMime = (raw: string | undefined) => (raw ?? '').split(';')[0].trim().toLowerCase()
export const isAllowedMime = (mime: string) => mime in EXT
export const extFor = (mime: string) => EXT[mime]
export const blobPrefix = (reportId: string) => `reports/${reportId}/`

export class TooLargeError extends Error {}

export interface Stored { size: number; mime: string }

export interface Storage {
  mode: 'server' | 'blob'
  /** blob mode: which client upload protocol the browser must use. */
  uploadFlow?: 'token' | 'presigned'
  /** server mode: stream the request body to storage. Returns the stored path. */
  save?(reportId: string, mime: string, body: ReadableStream<Uint8Array>): Promise<{ path: string; size: number }>
  /** blob mode: issue a client upload token for a report. Rejects anything outside that report's folder. */
  clientUpload?(request: Request, body: unknown, reportId: string): Promise<unknown>
  /** blob mode: confirm an uploaded blob exists and is acceptable. Null when it does not. */
  inspect?(pathname: string): Promise<Stored | null>
  /** Responds with the video, honouring Range where the driver serves bytes itself. */
  serve(storedPath: string, mime: string, range: string | undefined): Promise<Response>
}

// ---------- local disk ----------

function localStorageDriver(): Storage {
  const dir = path.join(config.dataDir, 'videos')
  fs.mkdirSync(dir, { recursive: true })
  return {
    mode: 'server',

    async save(reportId, mime, body) {
      const file = `${reportId}.${EXT[mime]}`
      const dest = path.join(dir, file)
      let size = 0
      const limiter = new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length
          if (size > config.maxVideoBytes) cb(new TooLargeError('Video too large'))
          else cb(null, chunk)
        },
      })
      try {
        await pipeline(Readable.fromWeb(body as never), limiter, fs.createWriteStream(dest))
      } catch (e) {
        fs.rmSync(dest, { force: true })
        throw e
      }
      if (size === 0) {
        fs.rmSync(dest, { force: true })
        throw new Error('Empty upload')
      }
      return { path: file, size }
    },

    async serve(file, mime, rangeHeader) {
      const full = path.join(dir, path.basename(file))
      if (!fs.existsSync(full)) return new Response('Not found', { status: 404 })
      const size = fs.statSync(full).size
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      }
      const m = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/)
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : size - Number(m[2])
        let end = m[1] && m[2] ? Number(m[2]) : size - 1
        start = Math.max(0, start)
        end = Math.min(end, size - 1)
        if (start > end || start >= size) {
          return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
        }
        return new Response(Readable.toWeb(fs.createReadStream(full, { start, end })) as ReadableStream, {
          status: 206,
          headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
        })
      }
      return new Response(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(size) },
      })
    },
  }
}

// ---------- Vercel Blob ----------

// Two ways a Blob store can be connected, both supported:
//  - token:     BLOB_READ_WRITE_TOKEN is set. Browser uses upload() with a client token.
//  - presigned: only BLOB_STORE_ID (+ BLOB_WEBHOOK_PUBLIC_KEY) is set and the platform authenticates with
//               OIDC. Browser uses uploadPresigned() with a signed URL. Newer stores work this way.

function blobDriver(): Storage {
  const SIGNED_URL_TTL_MS = 5 * 60 * 1000
  const usesToken = !!config.blobToken
  // Credentials passed to every server-side Blob call. With OIDC the SDK finds the identity itself.
  const auth = usesToken ? { token: config.blobToken } : { storeId: config.blobStoreId }

  const checkPath = (pathname: string, reportId: string) => {
    const ext = pathname.split('.').pop() ?? ''
    if (!pathname.startsWith(blobPrefix(reportId)) || pathname.includes('..') || !Object.values(EXT).includes(ext)) {
      throw new Error('Invalid upload path')
    }
  }

  return {
    mode: 'blob',
    uploadFlow: usesToken ? 'token' : 'presigned',

    async clientUpload(request, body, reportId) {
      // No onUploadCompleted in either flow: the browser tells us when it is done (POST .../video/complete)
      // and we verify the blob ourselves, so no unauthenticated webhook is exposed.
      if (usesToken) {
        const { handleUpload } = await import('@vercel/blob/client')
        return handleUpload({
          token: config.blobToken,
          request,
          body: body as Parameters<typeof handleUpload>[0]['body'],
          onBeforeGenerateToken: async (pathname) => {
            checkPath(pathname, reportId)
            return { allowedContentTypes: Object.keys(EXT), maximumSizeInBytes: config.maxVideoBytes, addRandomSuffix: true, allowOverwrite: false }
          },
        })
      }
      const { handleUploadPresigned } = await import('@vercel/blob/client')
      const { issueSignedToken } = await import('@vercel/blob')
      return handleUploadPresigned({
        request,
        webhookPublicKey: config.blobWebhookKey || undefined,
        body: body as Parameters<typeof handleUploadPresigned>[0]['body'],
        getSignedToken: async (pathname) => {
          checkPath(pathname, reportId)
          const validUntil = Date.now() + 60 * 60 * 1000
          const token = await issueSignedToken({
            ...auth,
            pathname,
            operations: ['put'],
            validUntil,
            allowedContentTypes: Object.keys(EXT),
            maximumSizeInBytes: config.maxVideoBytes,
          })
          return {
            token,
            urlOptions: { validUntil, allowedContentTypes: Object.keys(EXT), maximumSizeInBytes: config.maxVideoBytes, addRandomSuffix: true, allowOverwrite: false },
          }
        },
      })
    },

    async inspect(pathname) {
      const { head } = await import('@vercel/blob')
      try {
        const h = await head(pathname, auth)
        return { size: h.size, mime: normalizeMime(h.contentType) }
      } catch {
        return null
      }
    },

    async serve(pathname) {
      // The blob is private. After the API has checked the session, hand the browser a signed link that
      // expires in minutes. The CDN then serves the bytes, including Range requests for seeking.
      const { issueSignedToken, presignUrl } = await import('@vercel/blob')
      const validUntil = Date.now() + SIGNED_URL_TTL_MS
      const token = await issueSignedToken({ ...auth, pathname, operations: ['get'], validUntil })
      const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname, validUntil, access: 'private' })
      return new Response(null, { status: 302, headers: { Location: presignedUrl, 'Cache-Control': 'private, no-store' } })
    },
  }
}

let current: Storage | null = null

export function getStorage(): Storage {
  if (!current) {
    if (config.blobToken || config.blobStoreId) current = blobDriver()
    else if (config.onVercel) throw new Error('No Blob store is connected. Add a Blob store to this Vercel project.')
    else current = localStorageDriver()
  }
  return current
}

/** Tests swap in a fake driver. */
export function setStorageForTests(s: Storage | null) {
  current = s
}
