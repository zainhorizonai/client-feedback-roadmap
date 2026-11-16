export type Role = 'client' | 'admin'

export const STATUSES = ['New', 'Triaging', 'In progress', 'Needs client input', 'Ready to verify', 'Resolved'] as const
export type Status = (typeof STATUSES)[number]

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
  clientId: string | null
  clientName: string | null
}

/** A client organisation. In the product it is called a project. */
export interface ClientOrg {
  id: string
  name: string
  users: { id: string; email: string; name: string }[]
}

export interface HistoryEntry {
  at: string
  by: 'client' | 'admin' | 'system'
  kind: 'created' | 'status' | 'reply' | 'comment' | 'confirm' | 'outcome'
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
  /** Client: number of their own linked reports. */
  linkedCount?: number
  /** Admin only. */
  clientName?: string
  published?: boolean
  createdAt?: string
  reports?: { id: string; title: string; status: Status; kind: Kind }[]
}
