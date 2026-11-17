/** What this browser looks like, sent with a report so the team can reproduce it. No personal data. */
export function captureEnvironment(): Record<string, string> {
  const ua = navigator.userAgent
  let m: RegExpExecArray | null
  const browser = (m = /Edg\/(\d+)/.exec(ua)) ? `Edge ${m[1]}` : (m = /OPR\/(\d+)/.exec(ua)) ? `Opera ${m[1]}` : (m = /Chrome\/(\d+)/.exec(ua)) ? `Chrome ${m[1]}` : (m = /Firefox\/(\d+)/.exec(ua)) ? `Firefox ${m[1]}` : (m = /Version\/(\d+).*Safari/.exec(ua)) ? `Safari ${m[1]}` : 'Unknown'
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown'
  let timezone = ''
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* ignore */ }
  return {
    browser, os,
    device: /Mobi|Android|iPhone/.test(ua) ? 'Phone' : /iPad|Tablet/.test(ua) ? 'Tablet' : 'Desktop',
    viewport: `${innerWidth}x${innerHeight}`,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language || '',
    timezone,
    pixelRatio: String(devicePixelRatio || 1),
  }
}

export interface PageContext {
  source?: 'form' | 'widget'
  page?: string
  env?: Record<string, string>
  logs?: { t: string; level: string; msg: string }[]
  network?: { t: string; method: string; url: string; status: number; ms: number }[]
}

/** Seconds into the video in the open dialog, as [m:ss], so a note can point at the exact moment. */
export function videoStamp(): string | null {
  const v = document.querySelector<HTMLVideoElement>('[role="dialog"] video')
  if (!v || !Number.isFinite(v.currentTime)) return null
  const s = Math.floor(v.currentTime)
  return `[${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}]`
}
export const seekVideo = (seconds: number) => window.dispatchEvent(new CustomEvent('seam:seek', { detail: seconds }))
