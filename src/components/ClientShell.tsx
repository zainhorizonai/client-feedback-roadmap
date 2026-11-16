import { useMemo } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Building2, Plus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ClientProjectProvider, useClientProject } from '../lib/clientProject'
import { useReports, useReportsSync } from '../lib/store'
import { useRoadmap, useRoadmapSync } from '../lib/roadmap'
import { buildEntries, countEntries } from '../lib/entries'
import { ProfileMenu } from './ProfileMenu'
import { buttonClass } from './ui'
import { Toasts } from '../lib/toast'

function Header() {
  const { user } = useAuth()
  const { projects, selectedId, select } = useClientProject()
  const reports = useReports()
  const items = useRoadmap()
  // Pending work per project, so the switcher shows where things are waiting.
  const pending = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, countEntries(buildEntries(reports, items, p.id))])), [projects, reports, items])
  const here = pending[selectedId]
  const link = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-11 items-center gap-2 rounded-control px-3 font-semibold no-underline md:min-h-9 ${isActive ? 'bg-action text-on-action' : 'text-ink hover:bg-subtle/60'}`

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 md:px-8">
        <Link to="/reports" aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-logo.svg" alt="" className="h-9 w-auto" /></Link>
        {projects.length > 1 ? (
          <div className="flex items-center gap-2">
            <Building2 className="hidden h-4 w-4 text-muted sm:block" aria-hidden="true" />
            <span className="hidden text-sm text-muted md:inline" aria-hidden="true">Project</span>
            <select className="input !w-auto !min-h-9 font-semibold" aria-label="Switch project" value={selectedId} onChange={(e) => select(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{pending[p.id]?.pending ? ` (${pending[p.id].pending} pending)` : ''}</option>)}
            </select>
          </div>
        ) : (
          <p className="rounded-control bg-canvas px-2.5 py-1 text-sm font-semibold" aria-label="Project">{user?.clientName}</p>
        )}
        <nav className="order-last flex w-full gap-1 md:order-none md:w-auto" aria-label="Main">
          <NavLink to="/reports" className={link}>
            My items
            {here && here.pending > 0 && <span className="rounded-full bg-surface px-1.5 text-sm font-semibold text-ink ring-1 ring-line" aria-label={`${here.pending} pending`}>{here.pending}</span>}
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/reports/new" className={buttonClass('primary')}><Plus className="h-4 w-4" aria-hidden="true" />New</Link>
          <ProfileMenu projects={projects} selectedId={selectedId} onSelect={select} pending={Object.fromEntries(projects.map((p) => [p.id, pending[p.id]?.pending ?? 0]))} />
        </div>
      </div>
    </header>
  )
}

export function ClientShell() {
  useReportsSync()
  useRoadmapSync()
  return (
    <ClientProjectProvider>
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8"><Outlet /></main>
        <Toasts />
      </div>
    </ClientProjectProvider>
  )
}
