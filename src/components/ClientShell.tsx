import { Link, NavLink, Outlet } from 'react-router-dom'
import { LogOut, Plus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useReportsSync } from '../lib/store'
import { useRoadmapSync } from '../lib/roadmap'
import { buttonClass } from './ui'
import { Toasts } from '../lib/toast'

export function ClientShell() {
  const { user, signOut } = useAuth()
  useReportsSync()
  useRoadmapSync()
  if (!user) return null
  const link = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-11 items-center rounded-control px-3 font-semibold no-underline md:min-h-9 ${isActive ? 'bg-action text-on-action' : 'text-ink hover:bg-subtle/60'}`

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-8">
          <Link to="/reports" aria-label="SEAM home" className="shrink-0"><img src="/brand/seam-logo.svg" alt="" className="h-9 w-auto" /></Link>
          <p className="rounded-control bg-canvas px-2.5 py-1 text-sm font-semibold" aria-label="Project">{user.clientName}</p>
          <nav className="order-last flex w-full gap-1 md:order-none md:w-auto" aria-label="Main">
            <NavLink to="/reports" end className={link}>My reports</NavLink>
            <NavLink to="/roadmap" className={link}>Roadmap</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/reports/new" className={buttonClass('primary')}><Plus className="h-4 w-4" aria-hidden="true" />New report</Link>
            <button onClick={signOut} aria-label={`Sign out ${user.name}`} title="Sign out" className="flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-canvas hover:text-ink md:h-9 md:w-9"><LogOut className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8"><Outlet /></main>
      <Toasts />
    </div>
  )
}
