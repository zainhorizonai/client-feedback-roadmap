import type { Kind, Report, RoadmapItem, RoadmapState, Status } from './types'

/** Every kind of thing a client sees in one list. */
export interface Entry {
  key: string
  type: 'fix' | 'item'
  /** Reference shown in monospace. */
  ref: string
  title: string
  tag: Kind | 'Roadmap item'
  projectId: string
  createdAt: string
  /** Where this sits on the roadmap board. Bugs are placed by their status and cannot be dragged. */
  stage: RoadmapState
  /** Real status of a fix. Items show their stage instead. */
  status?: Status
  pending: boolean
  waiting: boolean
  done: boolean
  /** The report to open, if there is one. */
  reportId?: string
  item?: RoadmapItem
  moved?: RoadmapItem['lastMove']
}

const WAITING: Status[] = ['Needs client input', 'Ready to verify']

/** A fix is placed on the board by where it is in its life. */
export function stageForStatus(s: Status): RoadmapState {
  if (s === 'Resolved') return 'Done'
  if (s === 'In progress' || s === 'Ready to verify') return 'In progress'
  return 'Under review'
}

const isRequest = (k: Kind) => k === 'Feature request' || k === 'Question'

/**
 * One list for a project: bugs and UAT findings as fixes, and the roadmap (features, questions and planned work) as items.
 * A feature or question that already has a roadmap card is shown only as that card, so nothing appears twice.
 */
export function buildEntries(reports: Report[], items: RoadmapItem[], projectId: string): Entry[] {
  const inProject = (id: string) => id === projectId
  const rs = reports.filter((r) => inProject(r.clientId))
  const its = items.filter((i) => inProject(i.clientId))
  const byId = new Map(rs.map((r) => [r.id, r]))
  const covered = new Set(its.flatMap((i) => i.reportIds ?? []))

  const out: Entry[] = []
  for (const r of rs) {
    if (isRequest(r.kind) && covered.has(r.id)) continue
    out.push({
      key: `r:${r.id}`, type: 'fix', ref: r.id, title: r.title, tag: r.kind, projectId: r.clientId, createdAt: r.createdAt,
      stage: stageForStatus(r.status), status: r.status,
      pending: r.status !== 'Resolved', waiting: WAITING.includes(r.status), done: r.status === 'Resolved', reportId: r.id,
    })
  }
  for (const i of its) {
    const linked = (i.reportIds ?? []).map((id) => byId.get(id)).filter((x): x is Report => !!x)
    const first = linked[0]
    out.push({
      key: `i:${i.id}`, type: 'item', ref: first ? first.id : i.id, title: i.title,
      tag: first && linked.length === 1 ? first.kind : 'Roadmap item', projectId: i.clientId, createdAt: first?.createdAt ?? i.updatedAt,
      stage: i.state,
      pending: i.state !== 'Done', waiting: linked.some((l) => WAITING.includes(l.status)), done: i.state === 'Done',
      reportId: first?.id, item: i, moved: i.lastMove,
    })
  }
  return out
}

export interface Counts { pending: number; waiting: number; done: number }
export const countEntries = (e: Entry[]): Counts => ({ pending: e.filter((x) => x.pending).length, waiting: e.filter((x) => x.waiting).length, done: e.filter((x) => x.done).length })
