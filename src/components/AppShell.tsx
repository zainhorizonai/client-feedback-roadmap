import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { LogOut, UserRound, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Avatar } from './Avatar'
import { Toasts } from '../lib/toast'

export interface NavItem { to: string; label: string; short?: string; icon: LucideIcon; badge?: number; badgeLabel?: string }

/**
 * The one frame for clients and admins: logo, project switcher, the main action, the modules, and the person at the
 * bottom. Each role passes in its own modules and switcher, so the layout is the same and only the modules differ.
 */
export function AppShell({ home, nav, switcher, switcherLabel, action }: { home: string; nav: NavItem[]; switcher: ReactNode; switcherLabel: string; action?: ReactNode }) {
  const { user, signOut } = useAuth()
  if (!user) return null

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 shrink-0 items-center gap-3 rounded-control px-3 font-semibold no-underline md:min-h-10 ${isActive ? 'bg-action text-on-action' : 'text-cream hover:bg-cream/10'}`
  const badge = (n?: number, what = 'pending') => (n ? <span className="ml-auto rounded-full bg-cream px-1.5 text-sm font-semibold text-forest" aria-label={`${n} ${what}`}>{n}</span> : null)

  return (
    <div className="min-h-screen lg:pl-sidebar">
      {/* Desktop: fixed sidebar. Below 1024px the same things sit in a compact top bar. */}
      <aside className="on-dark fixed inset-y-0 left-0 hidden w-sidebar flex-col bg-forest px-4 py-5 text-cream lg:flex" aria-label="Main">
        <Link to={home} aria-label="SEAM home" className="mb-6 block px-1"><img src="/brand/seam-logo-reverse.svg" alt="" className="h-9 w-auto" /></Link>
        <div>
          <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-cream/70">{switcherLabel}</p>
          {switcher}
        </div>
        {action && <div className="mt-4">{action}</div>}
        <nav className="mt-5 space-y-1" aria-label="Workspace">
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={link}><n.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{n.label}{badge(n.badge, n.badgeLabel)}</NavLink>)}
        </nav>
        <div className="mt-auto border-t border-cream/20 pt-4">
          <NavLink to="/account" className={link}><UserRound className="h-4 w-4" aria-hidden="true" />Account</NavLink>
          <div className="mt-3 flex items-center gap-3 px-1">
            <Avatar name={user.name} tone="light" />
            <div className="min-w-0"><p className="truncate font-semibold">{user.name}</p><p className="truncate text-sm text-cream/70">{user.email}</p></div>
          </div>
          <button onClick={signOut} className="mt-2 flex min-h-9 items-center gap-2 rounded-control px-1 text-cream/90 hover:text-white"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
        </div>
      </aside>

      <header className="on-dark bg-forest text-cream lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to={home} aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-mark-reverse.svg" alt="" className="h-9 w-9" /></Link>
          <div className="min-w-0 flex-1">{switcher}</div>
          <button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control hover:bg-cream/10"><LogOut className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-3" aria-label="Workspace">
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={link}>{n.short ?? n.label}{badge(n.badge, n.badgeLabel)}</NavLink>)}
          <NavLink to="/account" className={link}>Account</NavLink>
          {action && <span className="ml-auto shrink-0 pl-2">{action}</span>}
        </nav>
      </header>

      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8"><div className="mx-auto max-w-7xl"><Outlet /></div></main>
      <Toasts />
    </div>
  )
}
