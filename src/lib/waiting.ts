import type { Report } from './types'

/** Whole days since anything last happened on a report. */
export function idleDays(r: Pick<Report, 'createdAt' | 'history'>, nowMs = Date.now()): number {
  const last = r.history.length ? r.history[r.history.length - 1].at : r.createdAt
  return Math.max(0, Math.floor((nowMs - new Date(last).getTime()) / 864e5))
}

/** "Waiting 3 days" for work that is stuck on someone. Empty when it is fresh or finished. */
export function waitingText(r: Report): string {
  if (r.status === 'Resolved') return ''
  const d = idleDays(r)
  return d >= 1 ? `Waiting ${d} ${d === 1 ? 'day' : 'days'}` : ''
}
