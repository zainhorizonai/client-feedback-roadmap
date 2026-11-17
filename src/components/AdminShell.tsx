import { Inbox, Map, Rows3, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ProjectFilter } from './ProjectFilter'
import { AppShell, type NavItem } from './AppShell'
import { useReports, useReportsSync } from '../lib/store'
import { useProject } from '../lib/project'
import { useRoadmapSync } from '../lib/roadmap'

const NAV = (waiting: number): NavItem[] => [
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox, badge: waiting, badgeLabel: 'new' },
  { to: '/admin/tracker', label: 'Tracker', icon: Rows3 },
  { to: '/admin/roadmap', label: 'Roadmap', icon: Map },
  { to: '/admin/clients', label: 'Projects and people', short: 'People', icon: Users },
]

export function AdminShell() {
  const { user } = useAuth()
  useReportsSync()
  useRoadmapSync()
  const reports = useReports()
  const { matches } = useProject()
  // New reports in the projects being shown, so the Inbox says how much is waiting.
  const waiting = reports.filter((r) => r.status === 'New' && matches(r.clientId)).length
  if (!user) return null
  return <AppShell home="/admin/inbox" nav={NAV(waiting)} switcherLabel="Projects" switcher={<ProjectFilter tone="dark" />} />
}
