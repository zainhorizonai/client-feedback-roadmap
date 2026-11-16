import type { Report } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status}). The server did not respond correctly, please try again.`)
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

export type UploadMode = 'server' | 'blob'

const EXT: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
}

/**
 * Uploads the video and finishes the report. Two paths, chosen by the server:
 *  - blob:   the browser uploads straight to Vercel Blob, then tells the API it is done.
 *  - server: the browser PUTs the file to the API (local development).
 */
export async function uploadVideo(reportId: string, blob: Blob, mode: UploadMode, onProgress: (fraction: number) => void): Promise<Report> {
  const mime = (blob.type || '').split(';')[0] || 'video/webm'
  if (!EXT[mime]) throw new ApiError(415, 'Unsupported video type. Use WebM, MP4 or MOV.')
  return mode === 'blob' ? uploadToBlob(reportId, blob, mime, onProgress) : uploadToServer(reportId, blob, mime, onProgress)
}

async function uploadToBlob(reportId: string, blob: Blob, mime: string, onProgress: (f: number) => void): Promise<Report> {
  // Loaded on demand so the Blob client is only downloaded when it is needed.
  const { upload } = await import('@vercel/blob/client')
  let pathname: string
  try {
    const res = await upload(`reports/${reportId}/video.${EXT[mime]}`, blob, {
      access: 'private',
      handleUploadUrl: `/api/reports/${reportId}/blob-token`,
      contentType: mime,
      multipart: blob.size > 20 * 1024 * 1024,
      onUploadProgress: (p) => onProgress(p.percentage / 100),
    })
    pathname = res.pathname
  } catch {
    throw new ApiError(0, 'Upload failed. Check your connection and try again.')
  }
  const { report } = await api.post<{ report: Report }>(`/api/reports/${reportId}/video/complete`, { pathname })
  return report
}

function uploadToServer(reportId: string, blob: Blob, mime: string, onProgress: (f: number) => void): Promise<Report> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/reports/${reportId}/video`)
    xhr.setRequestHeader('Content-Type', mime)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'))
    xhr.onload = () => {
      let data: { error?: string; report?: Report } = {}
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.report) resolve(data.report)
      else reject(new ApiError(xhr.status, data.error ?? 'Upload failed'))
    }
    xhr.send(blob)
  })
}
