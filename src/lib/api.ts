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
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Request failed')
  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
}

/** Uploads a video with progress. Uses XHR because fetch cannot report upload progress. */
export function uploadVideo(reportId: string, blob: Blob, onProgress: (fraction: number) => void): Promise<Report> {
  return new Promise((resolve, reject) => {
    const type = (blob.type || '').split(';')[0] || 'video/webm'
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/reports/${reportId}/video`)
    xhr.setRequestHeader('Content-Type', type)
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
