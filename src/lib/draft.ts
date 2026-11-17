// An unfinished report survives a refresh, a closed tab or a crash. Text lives in localStorage; the video (which can
// be large) lives in IndexedDB. Everything here fails quietly: a draft is a convenience, never a requirement.

export interface Draft { kind: string; projectId: string; title: string; description: string; pageUrl: string; blocking: boolean }

const key = (userId: string) => `seam.draft.${userId}`
const MAX_VIDEO = 300 * 1024 * 1024

export function loadDraft(userId: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(key(userId)) ?? 'null') as Draft | null
    return d && typeof d === 'object' ? d : null
  } catch { return null }
}
export function saveDraft(userId: string, d: Draft) {
  try {
    if (!d.title && !d.description && !d.pageUrl) localStorage.removeItem(key(userId))
    else localStorage.setItem(key(userId), JSON.stringify(d))
  } catch { /* ignore */ }
}
export function clearDraft(userId: string) {
  try { localStorage.removeItem(key(userId)) } catch { /* ignore */ }
}

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('seam-drafts', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('videos')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await db()
  if (!d) return undefined
  return new Promise((resolve) => {
    try {
      const r = f(d.transaction('videos', mode).objectStore('videos'))
      r.onsuccess = () => { resolve(r.result); d.close() }
      r.onerror = () => { resolve(undefined); d.close() }
    } catch { resolve(undefined); d.close() }
  })
}

export async function saveDraftVideo(userId: string, blob: Blob) {
  if (blob.size > MAX_VIDEO) return
  await tx('readwrite', (s) => s.put(blob, userId))
}
export async function loadDraftVideo(userId: string): Promise<Blob | null> {
  const b = await tx<Blob>('readonly', (s) => s.get(userId))
  return b instanceof Blob ? b : null
}
export async function clearDraftVideo(userId: string) {
  await tx('readwrite', (s) => s.delete(userId))
}
