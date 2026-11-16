import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Inbox, Plus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useReports, useReportsLoaded } from '../lib/store'
import { hasSeverity } from '../lib/types'
import { btnPrimary, fmtDate, KindChip, SeverityChip, StatusBadge } from '../components/ui'

type Tab = 'all' | 'issues' | 'requests'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'issues', label: 'Bugs and UAT' },
  { id: 'requests', label: 'Requests and questions' },
]

export function ClientReports() {
  const { user } = useAuth()
  const all = useReports()
  const loaded = useReportsLoaded()
  const [tab, setTab] = useState<Tab>('all')
  const mine = all.filter((r) => r.clientId === user?.clientId)
  const reports = mine.filter((r) => tab === 'all' || (tab === 'issues') === hasSeverity(r.kind))
  const open = mine.filter((r) => r.status !== 'Resolved').length

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My items</h1>
          <p className="text-sm text-slate-600">{mine.length} total, {open} open</p>
        </div>
        <Link to="/reports/new" className={btnPrimary}><Plus className="h-4 w-4" /> New</Link>
      </div>

      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1.5 font-medium ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <p className="py-16 text-center text-slate-500">Loading…</p>
      ) : reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <Inbox className="mx-auto h-10 w-10 text-slate-300" />
          <h2 className="mt-3 font-medium">{mine.length === 0 ? 'Nothing here yet' : 'Nothing in this view'}</h2>
          <p className="mt-1 text-sm text-slate-600">Report a bug, share an idea or ask a question. A video helps but is optional.</p>
          <Link to="/reports/new" className={`${btnPrimary} mt-4`}>Send something</Link>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {reports.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-slate-50 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{r.id}</span><span>·</span><span>{fmtDate(r.createdAt)}</span>
                    <KindChip kind={r.kind} />
                  </div>
                  <p className="mt-1 truncate font-medium">{r.title}</p>
                </div>
                {hasSeverity(r.kind) && <div className="hidden sm:block"><SeverityChip severity={r.severity} /></div>}
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
