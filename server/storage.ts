import fs from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from './config'

// Local-disk video storage. To move to S3 or R2, replace saveVideo and serveVideo; routes stay the same.
const dir = path.join(config.dataDir, 'videos')
fs.mkdirSync(dir, { recursive: true })

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

export class TooLargeError extends Error {}

/** Streams the request body to disk without buffering it in memory. Returns the stored file name and size. */
export async function saveVideo(reportId: string, mime: string, body: ReadableStream<Uint8Array>) {
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
  return { file, size }
}

/** Serves a stored video with HTTP Range support so the player can seek. */
export function serveVideo(file: string, mime: string, rangeHeader: string | undefined): Response {
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
}
