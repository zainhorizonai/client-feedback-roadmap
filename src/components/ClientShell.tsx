import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ListChecks, Plus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ClientProjectProvider, useClientProject } from '../lib/clientProject'
import { useReports, useReportsSync } from '../lib/store'
import { useRoadmap, useRoadmapSync } from '../lib/roadmap'
import { buildEntries, countEntries } from '../lib/entries'
import { AppShell, type NavItem } from './AppShell'
import { buttonClass } from './ui'

function Frame() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { projects, selectedId, select } = useClientProject()
  const reports = useReports()
  const items = useRoadmap()
  // Pending work per project, so the switcher shows where things are waiting.
  const pending = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, countEntries(buildEntries(reports, items, p.id))])), [projects, reports, items])
  const nav: NavItem[] = [{ to: '/reports', label: 'My items', icon: ListChecks, badge: pending[selectedId]?.pending }]

  const switcher = projects.length > 1 ? (
    <select className="input !min-h-9 w-full !py-1.5 font-medium" aria-label="Switch project" value={selectedId} onChange={(e) => select(e.target.value)}>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{pending[p.id]?.pending ? ` (${pending[p.id].pending} pending)` : ''}</option>)}
    </select>
  ) : (
    <p className="flex min-h-9 items-center rounded-control border border-line px-3 text-sm font-medium" aria-label="Project">{user?.clientName}</p>
  )

  return (
    <AppShell
      home="/reports"
      nav={nav}
      switcherLabel="Project"
      switcher={switcher}
      // On the new-item page itself there is only one main button: the one that sends it.
      action={pathname === '/reports/new' ? undefined : <Link to="/reports/new" className={buttonClass('primary', 'w-full')}><Plus className="h-4 w-4" aria-hidden="true" />New</Link>}
    />
  )
}

export function ClientShell() {
  useReportsSync()
  useRoadmapSync()
  return <ClientProjectProvider><Frame /></ClientProjectProvider>
}
