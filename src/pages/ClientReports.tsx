import { Link } from 'react-router-dom'
import { ChevronRight, Plus, Video } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useReports, useReportsLoaded } from '../lib/store'
import { btnPrimary, fmtDate, SeverityChip, StatusBadge } from '../components/ui'

export function ClientReports() {
  const { user } = useAuth()
  const all = useReports()
  const loaded = useReportsLoaded()
  const reports = all.filter((r) => r.clientId === user?.clientId)
  const open = reports.filter((r) => r.status !== 'Resolved').length

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My reports</h1>
          <p className="text-sm text-slate-600">{reports.length} total, {open} open</p>
        </div>
        <Link to="/reports/new" className={btnPrimary}><Plus className="h-4 w-4" /> New report</Link>
      </div>

      {!loaded ? (
        <p className="py-16 text-center text-slate-500">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Video className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 font-medium">No reports yet</h2>
          <p className="mt-1 text-sm text-slate-600">Record your screen to show us a bug or UAT issue.</p>
          <Link to="/reports/new" className={`${btnPrimary} mt-4`}>Record a report</Link>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {reports.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-slate-50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{r.id}</span><span>·</span><span>{fmtDate(r.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate font-medium">{r.title}</p>
                </div>
                <div className="hidden sm:block"><SeverityChip severity={r.severity} /></div>
                <StatusBadge status={r.status} />
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
