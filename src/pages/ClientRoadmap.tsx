import { Link } from 'react-router-dom'
import { Lightbulb } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useReports, useReportsLoaded } from '../lib/store'
import { ROADMAP_STAGES } from '../lib/types'
import { btnPrimary, fmtDate, KindChip, StatusBadge } from '../components/ui'

export function ClientRoadmap() {
  const { user } = useAuth()
  const loaded = useReportsLoaded()
  const items = useReports().filter((r) => r.clientId === user?.clientId && r.roadmapStage)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Roadmap</h1>
          <p className="text-sm text-slate-600">What we are reviewing, planning and building for you.</p>
        </div>
        <Link to="/reports/new?type=feature" className={btnPrimary}><Lightbulb className="h-4 w-4" /> Request a feature</Link>
      </div>

      {!loaded ? (
        <p className="py-16 text-center text-slate-500">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ROADMAP_STAGES.map((stage) => {
            const col = items.filter((r) => r.roadmapStage === stage)
            return (
              <section key={stage} className="rounded-xl bg-slate-100 p-3">
                <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-slate-700">
                  {stage} <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">{col.length}</span>
                </h2>
                <ul className="space-y-2">
                  {col.length === 0 && <li className="px-1 py-4 text-center text-xs text-slate-400">Nothing here yet</li>}
                  {col.map((r) => (
                    <li key={r.id}>
                      <Link to={`/reports/${r.id}`} className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-brand-500">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono">{r.id}</span><KindChip kind={r.kind} />
                        </div>
                        <p className="mt-1.5 text-sm font-medium">{r.title}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{fmtDate(r.createdAt)}</span><StatusBadge status={r.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
