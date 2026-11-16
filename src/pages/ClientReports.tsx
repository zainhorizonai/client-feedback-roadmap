import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Search } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useReports, useReportsLoaded } from '../lib/store'
import { KINDS, STATUSES } from '../lib/types'
import { Button, ButtonLink, EmptyState, fmtDate, KindTag, Mono, PageHeader, Skeleton, StatusBadge } from '../components/ui'

export function ClientReports() {
  const { user } = useAuth()
  const all = useReports()
  const loaded = useReportsLoaded()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('')

  const mine = useMemo(() => all.filter((r) => r.clientId === user?.clientId), [all, user?.clientId])
  const needle = q.trim().toLowerCase()
  const rows = mine.filter((r) => (!status || r.status === status) && (!kind || r.kind === kind) && (!needle || `${r.id} ${r.title} ${r.description}`.toLowerCase().includes(needle)))
  const filtered = !!(q || status || kind)
  const open = mine.filter((r) => r.status !== 'Resolved').length
  const waiting = mine.filter((r) => r.status === 'Needs client input' || r.status === 'Ready to verify').length

  return (
    <>
      <PageHeader
        eyebrow={user?.clientName}
        title="My reports"
        subtitle={mine.length ? `${mine.length} in total, ${open} open${waiting ? `, ${waiting} waiting for you` : ''}` : undefined}
        actions={<ButtonLink to="/reports/new">New report</ButtonLink>}
      />

      {!loaded ? <Skeleton /> : mine.length === 0 ? (
        <EmptyState icon={<Inbox className="h-9 w-9" />} title="No reports yet" action={<ButtonLink to="/reports/new">New report</ButtonLink>}>
          Report a bug, share an idea or ask a question. A video helps, and you can always send text only.
        </EmptyState>
      ) : (
        <>
          {mine.length > 4 && (
            <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input className="input pl-9" type="search" aria-label="Search reports" placeholder="Search reports" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="input sm:w-auto" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <select className="input sm:w-auto" aria-label="Filter by type" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All types</option>
                {KINDS.map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState title="No reports match these filters" action={<Button variant="secondary" onClick={() => { setQ(''); setStatus(''); setKind('') }}>Clear filters</Button>} />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link to={`/reports/${r.id}`} className="flex flex-col gap-2 px-4 py-4 no-underline hover:bg-canvas sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                        <Mono>{r.id}</Mono><span aria-hidden="true">·</span><span>Submitted <Mono>{fmtDate(r.createdAt)}</Mono></span><KindTag kind={r.kind} />
                      </p>
                      <p className="mt-1 break-words font-semibold">{r.title}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {filtered && rows.length > 0 && <p className="mt-2 text-sm text-muted">{rows.length} of {mine.length} shown.</p>}
        </>
      )}
    </>
  )
}
