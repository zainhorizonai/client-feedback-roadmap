export type Role = 'client' | 'admin'

export const STATUSES = ['New', 'Triaging', 'In progress', 'Ready to verify', 'Resolved'] as const
export type Status = (typeof STATUSES)[number]

export const SEVERITIES = ['Low', 'Medium', 'High', 'Blocker'] as const
export type Severity = (typeof SEVERITIES)[number]

export interface User {
  id: string
  email: string
  name: string
  role: Role
  clientId: string | null
  clientName: string | null
}

export interface ClientOrg {
  id: string
  name: string
  users: { id: string; email: string; name: string }[]
}

export interface HistoryEntry {
  at: string
  by: 'client' | 'admin' | 'system'
  kind: 'created' | 'status' | 'reply' | 'comment' | 'confirm'
  text: string
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
  /** Internal notes. The server only sends this to admins. */
  notes?: string
  /** Resolution video link, shown to the client */
  resolutionUrl: string
  hasVideo: boolean
  resolvedAt?: string
  history: HistoryEntry[]
}
