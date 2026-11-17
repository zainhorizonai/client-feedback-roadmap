import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ChevronUp, LogOut, UserRound, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Avatar } from './Avatar'
import { Toasts } from '../lib/toast'

export interface NavItem { to: string; label: string; short?: string; icon: LucideIcon; badge?: number; badgeLabel?: string }

/**
 * The one frame for clients and admins: logo, project switcher, the main action, the modules, and the person at the
 * bottom. Each role passes in its own modules and switcher, so the layout is the same and only the modules differ.
 */
/** One quiet row for the person: their name opens a small menu with Account and Sign out. */
function AccountMenu({ name, email, onSignOut }: { name: string; email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    items()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus() }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const list = items(); const i = list.indexOf(document.activeElement as HTMLElement)
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
      }
    }
    const onDown = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open])

  const item = 'flex min-h-10 w-full items-center gap-2 rounded-control px-3 text-left font-semibold no-underline text-forest hover:bg-forest/10'
  return (
    <div className="relative">
      {open && (
        <div ref={menu} id={id} role="menu" aria-label="Account" className="anim-pop-sm absolute inset-x-0 bottom-full mb-2 rounded-card bg-cream p-1.5 shadow-seam-2">
          <p className="truncate px-3 pb-1 pt-1.5 text-sm text-forest/70">{email}</p>
          <Link to="/account" role="menuitem" onClick={() => setOpen(false)} className={item}><UserRound className="h-4 w-4" aria-hidden="true" />Account</Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut() }} className={item}><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
        </div>
      )}
      <button ref={button} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} className="flex min-h-12 w-full items-center gap-3 rounded-control px-2 text-left hover:bg-cream/10">
        <Avatar name={name} tone="light" />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <ChevronUp className={`h-4 w-4 shrink-0 text-cream/70 transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden="true" />
      </button>
    </div>
  )
}

export function AppShell({ home, nav, switcher, switcherLabel, action }: { home: string; nav: NavItem[]; switcher: ReactNode; switcherLabel: string; action?: ReactNode }) {
  const { user, signOut } = useAuth()
  if (!user) return null

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-10 shrink-0 items-center gap-3 rounded-control px-3 font-semibold no-underline transition-colors ${isActive ? 'bg-cream text-forest' : 'text-cream hover:bg-cream/10'}`
  const badge = (n?: number, what = 'pending', active = false) => (n ? <span className={`ml-auto rounded-full px-1.5 text-sm font-semibold ${active ? 'bg-forest text-cream' : 'bg-cream text-forest'}`} aria-label={`${n} ${what}`}>{n}</span> : null)

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
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={link}>{({ isActive }) => (<><n.icon className="h-4 w-4 shrink-0" aria-hidden="true" />{n.label}{badge(n.badge, n.badgeLabel, isActive)}</>)}</NavLink>)}
        </nav>
        <div className="mt-auto border-t border-cream/20 pt-4"><AccountMenu name={user.name} email={user.email} onSignOut={signOut} /></div>
      </aside>

      <header className="on-dark bg-forest text-cream lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link to={home} aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-mark-reverse.svg" alt="" className="h-9 w-9" /></Link>
          <div className="min-w-0 flex-1">{switcher}</div>
          <button onClick={signOut} aria-label="Sign out" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control hover:bg-cream/10"><LogOut className="h-5 w-5" aria-hidden="true" /></button>
        </div>
        <nav className="flex items-center gap-1 overflow-x-auto px-3 pb-3" aria-label="Workspace">
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={link}>{({ isActive }) => (<>{n.short ?? n.label}{badge(n.badge, n.badgeLabel, isActive)}</>)}</NavLink>)}
          <NavLink to="/account" className={link}>Account</NavLink>
          {action && <span className="ml-auto shrink-0 pl-2">{action}</span>}
        </nav>
      </header>

      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8"><div className="mx-auto max-w-7xl"><Outlet /></div></main>
      <Toasts />
    </div>
  )
}
