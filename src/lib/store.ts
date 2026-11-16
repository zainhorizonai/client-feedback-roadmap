import { useEffect, useSyncExternalStore } from 'react'
import { api, ApiError, uploadVideo, type UploadFlow, type UploadMode } from './api'
import { notify } from './toast'
import type { Kind, Report, RoadmapStage, Severity, Status } from './types'

interface State { reports: Report[]; loaded: boolean }
let state: State = { reports: [], loaded: false }
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useReports = () => useSyncExternalStore(subscribe, () => state).reports
export const useReportsLoaded = () => useSyncExternalStore(subscribe, () => state).loaded

export function resetStore() {
  set({ reports: [], loaded: false })
}

export async function refreshReports() {
  try {
    const { reports } = await api.get<{ reports: Report[] }>('/api/reports')
    set({ reports, loaded: true })
  } catch (e) {
    if (!state.loaded) set({ ...state, loaded: true })
    if (!(e instanceof ApiError && e.status === 401)) console.error(e)
  }
}

/** Keeps the list fresh: loads on mount, every 20s, and when the tab regains focus. */
export function useReportsSync() {
  useEffect(() => {
    refreshReports()
    const t = setInterval(refreshReports, 20_000)
    const onVisible = () => document.visibilityState === 'visible' && refreshReports()
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
}

function upsert(report: Report) {
  const exists = state.reports.some((r) => r.id === report.id)
  set({
    ...state,
    reports: exists ? state.reports.map((r) => (r.id === report.id ? report : r)) : [report, ...state.reports],
  })
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong')

/** Runs a server call, merges the returned report, and shows an error toast on failure. */
async function act(call: () => Promise<{ report: Report }>, okText?: string): Promise<boolean> {
  try {
    upsert((await call()).report)
    if (okText) notify(okText)
    return true
  } catch (e) {
    notify(message(e), 'error')
    refreshReports()
    return false
  }
}

export interface NewReportInput {
  title: string
  description: string
  pageUrl: string
  severity: Severity
  kind: Kind
}

/** The video is optional. Without one the report is complete as soon as it is created. */
export async function createReport(input: NewReportInput, video: Blob | null, onProgress: (f: number) => void): Promise<Report> {
  const { report, upload } = await api.post<{ report: Report; upload?: { mode: UploadMode; flow?: UploadFlow } }>('/api/reports', { ...input, withVideo: !!video })
  if (!video || !upload) {
    upsert(report)
    return report
  }
  try {
    const done = await uploadVideo(report.id, video, upload.mode, upload.flow, onProgress)
    upsert(done)
    return done
  } catch (e) {
    await api.del(`/api/reports/${report.id}`).catch(() => {}) // discard the unfinished draft
    throw e
  }
}

type Editable = Partial<Pick<Report, 'title' | 'description' | 'pageUrl' | 'severity' | 'notes' | 'resolutionUrl' | 'kind'>>

function optimistic(id: string, patch: Partial<Report>) {
  set({ ...state, reports: state.reports.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
}

export function updateFields(id: string, patch: Editable) {
  optimistic(id, patch)
  return act(() => api.patch(`/api/reports/${id}`, patch))
}

export function setStatus(id: string, status: Status) {
  optimistic(id, { status })
  return act(() => api.patch(`/api/reports/${id}`, { status }), `Status set to "${status}". The client has been emailed.`)
}

export const addReply = (id: string, text: string) =>
  act(() => api.post(`/api/reports/${id}/replies`, { text }), 'Reply sent. The client has been emailed.')

export const addClientComment = (id: string, text: string) =>
  act(() => api.post(`/api/reports/${id}/comments`, { text }), 'Comment sent.')

export const clientConfirm = (id: string, fixed: boolean, note: string) =>
  act(() => api.post(`/api/reports/${id}/confirm`, { fixed, note }), fixed ? 'Thanks for confirming.' : 'Thanks. We will take another look.')

export function setRoadmapStage(id: string, stage: RoadmapStage | null) {
  optimistic(id, { roadmapStage: stage ?? undefined })
  return act(() => api.patch(`/api/reports/${id}`, { roadmapStage: stage }), stage ? `Moved to "${stage}". The client has been emailed.` : 'Removed from the roadmap.')
}

/** Admin: add an item (roadmap or future work) on behalf of a client. */
export async function addItemForClient(input: { clientId: string; title: string; description: string; kind: Kind; roadmapStage: RoadmapStage | null }): Promise<boolean> {
  return act(() => api.post('/api/admin/items', input), 'Added. The client has been emailed.')
}
