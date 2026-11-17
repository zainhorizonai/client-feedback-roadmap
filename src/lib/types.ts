export type Role = 'client' | 'admin'

export const STATUSES = ['New', 'Triaging', 'In progress', 'Needs client input', 'Ready to verify', 'Resolved'] as const
export type Status = (typeof STATUSES)[number]

/** What a client sees. The team keeps the finer statuses; clients get plain words. */
export const CLIENT_STATUS: Record<Status, string> = {
  New: 'Received', Triaging: 'Reviewing', 'In progress': 'In progress', 'Needs client input': 'Needs you', 'Ready to verify': 'Ready to verify', Resolved: 'Done',
}

export const SEVERITIES = ['Low', 'Medium', 'High', 'Blocker'] as const
export type Severity = (typeof SEVERITIES)[number]

export const KINDS = ['Bug', 'UAT finding', 'Feature request', 'Question'] as const
export type Kind = (typeof KINDS)[number]

export const ROADMAP_STATES = ['Under review', 'Planned', 'In progress', 'Done'] as const
export type RoadmapState = (typeof ROADMAP_STATES)[number]

/** Bugs and UAT findings have a severity. Requests and questions do not. */
export const hasSeverity = (k: Kind) => k === 'Bug' || k === 'UAT finding'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  /** First project. Admins have none. */
  clientId: string | null
  clientName: string | null
  /** Every project this person belongs to. A client can be invited into several. */
  projects: { id: string; name: string }[]
  /** How this person wants email: as things happen, or one summary a day. */
  notify: 'instant' | 'digest'
}

/** A client organisation. In the product it is called a project. */
export interface ClientOrg {
  id: string
  name: string
  /** Admin only: how much is in the project. */
  reportCount?: number
  openCount?: number
  itemCount?: number
  users: { id: string; email: string; name: string; hasPassword?: boolean; invitedAt?: string }[]
}

export interface HistoryEntry {
  at: string
  by: 'client' | 'admin' | 'system'
  kind: 'created' | 'status' | 'reply' | 'comment' | 'confirm' | 'outcome' | 'edit'
  text: string
  from?: string
  to?: string
}

export interface Report {
  id: string
  createdAt: string
  clientId: string
  clientName: string
  reporterName: string
  reporterEmail: string
  title: string
  description: string
  pageUrl: string
  severity: Severity
  status: Status
  kind: Kind
  /** Internal notes. The server only sends this to admins. */
  notes?: string
  /** Roadmap work this report is linked to. Admin only. */
  roadmapItems?: { id: string; title: string; state: RoadmapState }[]
  /** Who on the team owns it. Admin only. */
  assignee?: { id: string; name: string } | null
  /** Browser details and, when the page snippet is installed, console and network logs. Admin only. */
  context?: import('./environment').PageContext | null
  resolutionUrl: string
  hasVideo: boolean
  resolvedAt?: string
  history: HistoryEntry[]
}

/** What a client may see of a roadmap item. Admins also get the fields marked admin. */
export interface RoadmapItem {
  id: string
  clientId: string
  title: string
  description: string
  state: RoadmapState
  targetWindow: string
  clientUpdate: string
  updatedAt: string
  /** Who moved the card last, and when. Clients can move cards on their own roadmap. */
  lastMove?: { by: 'client' | 'admin'; at: string; text: string }
  /** Client: number of their own linked reports, and their ids so a card can lead to the conversation. */
  linkedCount?: number
  reportIds?: string[]
  /** Admin only. */
  clientName?: string
  published?: boolean
  createdAt?: string
  reports?: { id: string; title: string; status: Status; kind: Kind }[]
}
