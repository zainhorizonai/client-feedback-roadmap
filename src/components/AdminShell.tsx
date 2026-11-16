import { Link, NavLink, Outlet } from 'react-router-dom'
import { Inbox, LogOut, Map, Rows3, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useProject } from '../lib/project'
import { useReportsSync } from '../lib/store'
import { useRoadmapSync } from '../lib/roadmap'
import { Toasts } from '../lib/toast'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox },
  { to: '/admin/tracker', label: 'Tracker', icon: Rows3 },
  { to: '/admin/roadmap', label: 'Roadmap', icon: Map },
]

function ProjectSelect({ id }: { id: string }) {
  const { projects, selectedId, select } = useProject()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cream/70">Project</label>
      <select
        id={id}
        value={selectedId}
        onChange={(e) => select(e.target.value)}
        className="min-h-11 w-full rounded-control border border-cream/40 bg-forest px-2 text-cream md:min-h-9"
      >
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

export function AdminShell() {
  const { user, signOut } = useAuth()
  useReportsSync()
  useRoadmapSync()
  if (!user) return null

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center gap-3 rounded-control px-3 font-semibold no-underline md:min-h-10 ${isActive ? 'bg-action text-on-action' : 'text-cream hover:bg-cream/10'}`

  return (
    <div className="min-h-screen lg:pl-sidebar">
      {/* Desktop: fixed sidebar. Below 1024px the same links sit in a compact top bar. */}
      <aside className="on-dark fixed inset-y-0 left-0 hidden w-sidebar flex-col bg-forest px-4 py-5 text-cream lg:flex" aria-label="Main">
        <Link to="/admin/inbox" aria-label="SEAM home" className="mb-6 block px-1">
          <img src="/brand/seam-logo-reverse.svg" alt="" className="h-9 w-auto" />
        </Link>
        <ProjectSelect id="project-desktop" />
        <nav className="mt-5 space-y-1" aria-label="Workspace">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={link}><n.icon className="h-4 w-4" aria-hidden="true" />{n.label}</NavLink>)}
        </nav>
        <nav className="mt-6 space-y-1 border-t border-cream/20 pt-4" aria-label="Manage">
          <NavLink to="/admin/clients" className={link}><Users className="h-4 w-4" aria-hidden="true" />Projects and people</NavLink>
          <NavLink to="/account" className={link}><UserRound className="h-4 w-4" aria-hidden="true" />Account</NavLink>
        </nav>
        <div className="mt-auto border-t border-cream/20 pt-4">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-cream/70">{user.email}</p>
          <button onClick={signOut} className="mt-2 flex min-h-9 items-center gap-2 rounded-control px-1 text-cream/90 hover:text-white"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
        </div>
      </aside>

      <header className="on-dark bg-forest text-cream lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to="/admin/inbox" aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-mark-reverse.svg" alt="" className="h-9 w-9" /></Link>
          <div className="min-w-0 flex-1"><ProjectSelect id="project-compact" /></div>
          <button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control hover:bg-cream/10"><LogOut className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3" aria-label="Workspace">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={link}>{n.label}</NavLink>)}
          <NavLink to="/admin/clients" className={link}>People</NavLink>
          <NavLink to="/account" className={link}>Account</NavLink>
        </nav>
      </header>

      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8"><Outlet /></main>
      <Toasts />
    </div>
  )
}
