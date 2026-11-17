// Dates the way people say them: "Just now", "Today, 3:42 PM", "Yesterday", "Mon", "14 Nov". The exact time is always
// available on hover. Day boundaries are the person's own, not UTC.

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function day(d: Date, now: Date): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 864e5)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A day: "Today", "Yesterday", "Tuesday", "14 Nov", "14 Nov 2025". */
export function relativeDate(iso: string, now = new Date()): string {
  return day(new Date(iso), now)
}

/** A moment: "Just now", "12 min ago", "Today, 3:42 PM", "Yesterday, 3:42 PM", "Tuesday, 3:42 PM", "14 Nov, 3:42 PM". */
export function relativeDateTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const ms = now.getTime() - d.getTime()
  if (ms < 60_000 && ms > -300_000) return 'Just now'
  if (ms >= 60_000 && ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`
  const label = day(d, now)
  // From another year the date alone says enough: a time of day that long ago is noise.
  return d.getFullYear() === now.getFullYear() ? `${label}, ${time(d)}` : label
}

/** The full, exact time, for a tooltip. */
export const exactDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
