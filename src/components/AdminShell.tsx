import { Link, NavLink, Outlet } from 'react-router-dom'
import { Inbox, LogOut, Map, Rows3, UserRound, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { ProjectFilter } from './ProjectFilter'
import { useReportsSync } from '../lib/store'
import { useRoadmapSync } from '../lib/roadmap'
import { Toasts } from '../lib/toast'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/admin/inbox', label: 'Inbox', icon: Inbox },
  { to: '/admin/tracker', label: 'Tracker', icon: Rows3 },
  { to: '/admin/roadmap', label: 'Roadmap', icon: Map },
  { to: '/admin/clients', label: 'Projects and people', icon: Users },
]

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
}

export function AdminShell() {
  const { user, signOut } = useAuth()
  useReportsSync()
  useRoadmapSync()
  if (!user) return null

  const rail = ({ isActive }: { isActive: boolean }) =>
    `rail-item relative flex h-11 w-11 items-center justify-center rounded-2xl no-underline ${isActive ? 'bg-white text-black' : 'text-cream hover:bg-white/15'}`
  const top = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-11 shrink-0 items-center rounded-full px-4 font-semibold no-underline ${isActive ? 'bg-white text-black' : 'text-cream hover:bg-white/15'}`

  return (
    <div className="min-h-screen p-0 lg:p-4">
      <div className="flex min-h-screen overflow-hidden bg-black lg:min-h-[calc(100vh-2rem)] lg:rounded-[2rem]">
        {/* Desktop: slim icon rail. Names show as tooltips and stay available to screen readers. */}
        <aside className="on-dark hidden w-sidebar shrink-0 flex-col items-center py-5 lg:flex" aria-label="Main">
          <Link to="/admin/inbox" aria-label="SEAM home" className="mb-6 block"><img src="/brand/seam-mark-reverse.svg" alt="" className="h-10 w-10" /></Link>
          <nav className="flex flex-col items-center gap-2" aria-label="Workspace">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={rail} aria-label={n.label}>
                <n.icon className="h-5 w-5" aria-hidden="true" /><span className="rail-tip" aria-hidden="true">{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col items-center gap-2">
            <NavLink to="/account" className={rail} aria-label="Account">
              <UserRound className="h-5 w-5" aria-hidden="true" /><span className="rail-tip" aria-hidden="true">{user.name} · Account</span>
            </NavLink>
            <button onClick={signOut} aria-label="Sign out" className="rail-item relative flex h-11 w-11 items-center justify-center rounded-2xl text-cream hover:bg-white/15">
              <LogOut className="h-5 w-5" aria-hidden="true" /><span className="rail-tip" aria-hidden="true">Sign out</span>
            </button>
            <span aria-hidden="true" className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#ff4d8d,#8b5cf6,#38bdf8,#facc15,#ff4d8d)] text-xs font-semibold text-black">{initials(user.name)}</span>
          </div>
        </aside>

        <div className="pane flex min-w-0 flex-1 flex-col lg:rounded-[1.75rem] lg:border lg:border-white/10">
          {/* Below 1024px the same destinations sit in a compact bar. */}
          <header className="on-dark bg-black lg:hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <Link to="/admin/inbox" aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-mark-reverse.svg" alt="" className="h-9 w-9" /></Link>
              <div className="min-w-0 flex-1"><ProjectFilter tone="dark" /></div>
              <button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream hover:bg-white/15"><LogOut className="h-5 w-5" aria-hidden="true" /></button>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3" aria-label="Workspace">
              {NAV.slice(0, 3).map((n) => <NavLink key={n.to} to={n.to} className={top}>{n.label}</NavLink>)}
              <NavLink to="/admin/clients" className={top}>People</NavLink>
              <NavLink to="/account" className={top}>Account</NavLink>
            </nav>
          </header>
          <div className="hidden items-center gap-3 px-8 pt-6 lg:flex">
            <div className="w-64"><ProjectFilter /></div>
          </div>
          <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-6"><Outlet /></main>
        </div>
      </div>
      <Toasts />
    </div>
  )
}
