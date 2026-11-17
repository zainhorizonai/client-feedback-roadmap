import { useEffect, useSyncExternalStore } from 'react'
import { api, ApiError, uploadVideo, type UploadFlow, type UploadMode } from './api'
import { notify } from './toast'
import type { Kind, Report, Severity, Status } from './types'

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
  /** Which project, for people who belong to more than one. */
  clientId?: string
  title: string
  description: string
  pageUrl: string
  severity: Severity
  kind: Kind
  /** Browser details, and logs from the page when the snippet is installed. */
  context?: import('./environment').PageContext
}

/** The video is optional. Without one the report is complete as soon as it is created. */
export async function createReport(input: NewReportInput, video: Blob | null, onProgress: (f: number) => void, onRetry?: (attempt: number) => void): Promise<Report> {
  const { report, upload } = await api.post<{ report: Report; upload?: { mode: UploadMode; flow?: UploadFlow } }>('/api/reports', { ...input, withVideo: !!video })
  if (!video || !upload) {
    upsert(report)
    return report
  }
  try {
    const done = await uploadVideo(report.id, video, upload.mode, upload.flow, onProgress, onRetry)
    upsert(done)
    return done
  } catch (e) {
    await api.del(`/api/reports/${report.id}`).catch(() => {}) // discard the unfinished draft
    throw e
  }
}

type Editable = Partial<Pick<Report, 'title' | 'description' | 'pageUrl' | 'severity' | 'notes' | 'resolutionUrl' | 'kind'>>

/** Gives a report to someone on the team, or to nobody (empty id). */
export function assign(id: string, assigneeId: string, name: string) {
  optimistic(id, { assignee: assigneeId ? { id: assigneeId, name } : null })
  return act(() => api.patch(`/api/reports/${id}`, { assigneeId }), assigneeId ? `Assigned to ${name}.` : 'Unassigned.')
}

/** Triage in one step: set the status and take ownership. */
export function startTriage(id: string, status: Status, me: { id: string; name: string }, keepOwner: boolean) {
  optimistic(id, { status, ...(keepOwner ? {} : { assignee: me }) })
  return act(() => api.patch(`/api/reports/${id}`, { status, ...(keepOwner ? {} : { assigneeId: me.id }) }), `Status set to ${status}.`)
}

/** Changes several reports at once. Empty fields are left alone. */
export async function bulkUpdate(ids: string[], changes: { status?: Status; severity?: Severity; assigneeId?: string }): Promise<boolean> {
  try {
    const { updated } = await api.post<{ updated: number }>('/api/admin/reports/bulk', { ids, ...changes })
    notify(updated === 0 ? 'Nothing needed changing.' : `Updated ${updated} ${updated === 1 ? 'report' : 'reports'}.`)
    await refreshReports()
    return true
  } catch (e) {
    notify(message(e), 'error')
    return false
  }
}

function optimistic(id: string, patch: Partial<Report>) {
  set({ ...state, reports: state.reports.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
}

export function updateFields(id: string, patch: Editable) {
  optimistic(id, patch)
  return act(() => api.patch(`/api/reports/${id}`, patch))
}

// Triaging is internal, so no email goes out for it.
export function setStatus(id: string, status: Status) {
  optimistic(id, { status })
  return act(() => api.patch(`/api/reports/${id}`, { status }), status === 'New' || status === 'Triaging' ? `Status set to ${status}.` : `Status set to ${status}. The client has been emailed.`)
}

/** A reply can move the status in the same step, so the client sees the change and gets one email. */
export const addReply = (id: string, text: string, status?: Status) =>
  act(() => api.post(`/api/reports/${id}/replies`, { text, status }), 'Reply sent. The client has been emailed.')

export const addClientComment = (id: string, text: string) =>
  act(() => api.post(`/api/reports/${id}/comments`, { text }), 'Comment sent.')

/** Approve anything as done. A fix that was waiting to be verified is recorded as verified. */
export const approveReport = (id: string, note = '') =>
  act(() => api.post(`/api/reports/${id}/approve`, { note }), 'Thanks. Marked as done.')

/** Fixed = approve. Still broken sends it back to the team with a note. */
export const clientConfirm = (id: string, fixed: boolean, note: string) =>
  fixed ? approveReport(id, note) : act(() => api.post(`/api/reports/${id}/confirm`, { fixed: false, note }), 'Thanks. We will take another look.')

/** A client adding to their own ticket after sending it. The team is told. */
export const updateDetails = (id: string, patch: { title?: string; description?: string; pageUrl?: string }) =>
  act(() => api.patch(`/api/reports/${id}/details`, patch), 'Saved. The team has been told.')

/** Bring back something that was marked done. It returns to the team's inbox. */
export const reopenReport = (id: string, note = '') =>
  act(() => api.post(`/api/reports/${id}/reopen`, { note }), 'Reopened. The team has been told.')
