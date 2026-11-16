import { Link, NavLink, Outlet } from 'react-router-dom'
import { Bug, LogOut } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useReportsSync } from '../lib/store'
import { Toasts } from '../lib/toast'

export function AppShell() {
  const { user, signOut } = useAuth()
  useReportsSync()
  if (!user) return null
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900'}`

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white"><Bug className="h-4 w-4" /></span>
            Feedback Portal
          </Link>
          <nav className="flex gap-1">
            {user.role === 'admin' ? (
              <>
                <NavLink to="/admin" className={link}>Tracker</NavLink>
                <NavLink to="/admin/clients" className={link}>Clients</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/reports" end className={link}>My reports</NavLink>
                <NavLink to="/reports/new" className={link}>New report</NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{user.name}</div>
              <div className="text-xs text-slate-500">{user.role === 'admin' ? 'Admin' : user.clientName}</div>
            </div>
            <button onClick={signOut} title="Sign out" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
      <Toasts />
    </div>
  )
}
