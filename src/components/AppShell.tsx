import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronDown, LogOut, Menu, UserRound, X, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Avatar } from './Avatar'
import { Toasts } from '../lib/toast'

export interface NavItem { to: string; label: string; short?: string; icon: LucideIcon; badge?: number; badgeLabel?: string }

/** The avatar at the right of the bar: the person's name and email, Account and Sign out. */
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

  const item = 'flex min-h-9 w-full items-center gap-2 rounded-control px-3 text-left font-medium no-underline text-ink hover:bg-subtle'
  return (
    <div className="relative">
      <button ref={button} type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`${name}, account menu`} className="flex min-h-9 items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-subtle md:pr-2.5">
        <Avatar name={name} />
        <span className="hidden max-w-[9rem] truncate text-sm font-medium md:inline" aria-hidden="true">{name}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-muted md:block" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label="Account" className="anim-pop-sm absolute right-0 top-full z-40 mt-2 w-64 rounded-panel border border-line bg-surface p-1.5 shadow-float">
          <div className="px-3 pb-2 pt-1.5"><p className="truncate font-medium">{name}</p><p className="truncate text-sm text-muted">{email}</p></div>
          <div className="border-t border-line pt-1.5">
            <Link to="/account" role="menuitem" onClick={() => setOpen(false)} className={item}><UserRound className="h-4 w-4" aria-hidden="true" />Account</Link>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut() }} className={item}><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The one frame for clients and admins: a sticky bar with the logo, the project switcher, the modules, the main action
 * and the person. Each role passes in its own modules and switcher, so the layout is the same and only the modules
 * differ. Below 1024px the modules move into a menu.
 */
export function AppShell({ home, nav, switcher, switcherLabel, action }: { home: string; nav: NavItem[]; switcher: ReactNode; switcherLabel: string; action?: ReactNode }) {
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => setMenuOpen(false), [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])
  if (!user) return null

  const link = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-9 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-medium no-underline transition-colors ${isActive ? 'bg-[var(--seam-primary-tint)] text-primary' : 'text-ink hover:bg-subtle'}`
  const count = (n?: number, what = 'pending') => (n ? <span className="rounded-full bg-primary px-1.5 text-xs font-medium text-white" aria-label={`${n} ${what}`}>{n}</span> : null)

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[80rem] items-center gap-3 px-4 md:px-6">
          <Link to={home} aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-logo.svg" alt="" className="h-7 w-auto" /></Link>
          <div className="hidden w-56 shrink-0 lg:block"><span className="sr-only">{switcherLabel}</span>{switcher}</div>
          <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Workspace">
            {nav.map((n) => <NavLink key={n.to} to={n.to} className={link}>{({ isActive }) => (<>{n.short ? <><span className="xl:hidden">{n.short}</span><span className="hidden xl:inline">{n.label}</span></> : n.label}{count(n.badge, n.badgeLabel)}{isActive && <span className="sr-only"> (current page)</span>}</>)}</NavLink>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {action && <div className="hidden sm:block">{action}</div>}
            <AccountMenu name={user.name} email={user.email} onSignOut={signOut} />
            <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-controls="mobile-menu" aria-label={menuOpen ? 'Close menu' : 'Open menu'} className="flex h-9 w-9 items-center justify-center rounded-control hover:bg-subtle lg:hidden">
              {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>
      {menuOpen && (
        <div id="mobile-menu" className="anim-fade fixed inset-x-0 bottom-0 top-14 z-30 overflow-y-auto border-t border-line bg-surface p-4 lg:hidden">
          <div className="mb-4"><p className="caps mb-1.5">{switcherLabel}</p>{switcher}</div>
          <nav className="space-y-1" aria-label="Workspace menu">
            {nav.map((n) => <NavLink key={n.to} to={n.to} className={(s) => `${link(s)} !flex w-full !min-h-11`}>{({ isActive }) => (<><n.icon className="h-4 w-4" aria-hidden="true" />{n.label}<span className="ml-auto">{count(n.badge, n.badgeLabel)}</span>{isActive && <span className="sr-only"> (current page)</span>}</>)}</NavLink>)}
          </nav>
          {action && <div className="mt-4 sm:hidden [&>*]:w-full">{action}</div>}
        </div>
      )}

      <main className="mx-auto w-full max-w-[80rem] min-w-0 px-4 py-8 md:px-6 md:py-10 lg:py-12"><Outlet /></main>
      <Toasts />
    </div>
  )
}
