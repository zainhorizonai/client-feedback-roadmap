import { Inbox, Map, Rows3, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ProjectFilter } from './ProjectFilter'
import { AppShell, type NavItem } from './AppShell'
import { useReportsSync } from '../lib/store'
import { useRoadmapSync } from '../lib/roadmap'

const NAV: NavItem[] = [
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox },
  { to: '/admin/tracker', label: 'Tracker', icon: Rows3 },
  { to: '/admin/roadmap', label: 'Roadmap', icon: Map },
  { to: '/admin/clients', label: 'Projects and people', short: 'People', icon: Users },
]

export function AdminShell() {
  const { user } = useAuth()
  useReportsSync()
  useRoadmapSync()
  if (!user) return null
  return <AppShell home="/admin/inbox" nav={NAV} switcherLabel="Projects" switcher={<ProjectFilter tone="dark" />} />
}
