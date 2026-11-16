import { useEffect, useSyncExternalStore } from 'react'
import { api, ApiError, uploadVideo } from './api'
import { notify } from './toast'
import type { Report, Severity, Status } from './types'

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
}

export async function createReport(input: NewReportInput, video: Blob, onProgress: (f: number) => void): Promise<Report> {
  const { report } = await api.post<{ report: Report }>('/api/reports', input)
  try {
    const done = await uploadVideo(report.id, video, onProgress)
    upsert(done)
    return done
  } catch (e) {
    await api.del(`/api/reports/${report.id}`).catch(() => {}) // discard the unfinished draft
    throw e
  }
}

type Editable = Partial<Pick<Report, 'title' | 'description' | 'pageUrl' | 'severity' | 'notes' | 'resolutionUrl'>>

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
