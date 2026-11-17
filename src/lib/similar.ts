import type { Report } from './types'

const STOP = new Set(['the', 'and', 'for', 'with', 'not', 'cannot', 'cant', 'can', 'does', 'doesnt', 'dont', 'this', 'that', 'when', 'from', 'are', 'was', 'has', 'have', 'its', 'into', 'out', 'all', 'but', 'you', 'your', 'our', 'any'])
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w)))

/** Open items in the same project whose titles share most of their words. A hint only, never a block. */
export function similarTo(title: string, reports: Report[], clientId: string, exceptId?: string): Report[] {
  const a = words(title)
  if (a.size < 2) return []
  return reports
    .filter((r) => r.clientId === clientId && r.id !== exceptId && r.status !== 'Resolved')
    .map((r) => {
      const b = words(r.title)
      let common = 0
      for (const w of a) if (b.has(w)) common++
      return { r, common, score: common / Math.min(a.size, b.size) }
    })
    .filter((x) => x.common >= 2 && x.score >= 0.6)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => x.r)
}
