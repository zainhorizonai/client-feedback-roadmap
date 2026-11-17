import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCheck, MessageCircleQuestion, Search as SearchIcon } from 'lucide-react'
import { useProject } from '../lib/project'
import { setStatus, updateFields, useReports, useReportsLoaded } from '../lib/store'
import { hasSeverity, SEVERITIES, type Report, type Severity } from '../lib/types'
import { ReportModal } from '../components/ReportModal'
import { Button, EmptyState, fmtDateTime, KindTag, Mono, PageHeader, SeverityBadge, Skeleton } from '../components/ui'

type Sort = 'newest' | 'oldest' | 'severity'
const RANK: Record<Severity, number> = { Blocker: 0, High: 1, Medium: 2, Low: 3 }

/** The triage queue: new submissions waiting for a first decision. It shows the same records as the Tracker. */
export function AdminInbox() {
  const { matches, label, selectedIds } = useProject()
  const reports = useReports()
  const loaded = useReportsLoaded()
  const [params, setParams] = useSearchParams()
  const [sort, setSort] = useState<Sort>('newest')
  const [busy, setBusy] = useState<string | null>(null)

  const queue = useMemo(() => {
    const rows = reports.filter((r) => r.status === 'New' && matches(r.clientId))
    return [...rows].sort((a, b) =>
      sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt)
      : sort === 'severity' ? RANK[a.severity] - RANK[b.severity] || b.createdAt.localeCompare(a.createdAt)
      : b.createdAt.localeCompare(a.createdAt))
  }, [reports, matches, selectedIds, sort])
  const open = reports.find((r) => r.id === params.get('report')) ?? null

  async function triage(r: Report, status: 'Triaging' | 'Needs client input') {
    setBusy(r.id + status)
    await setStatus(r.id, status)
    setBusy(null)
  }

  return (
    <>
      <PageHeader
        eyebrow={label}
        title="Inbox"
        subtitle={loaded ? `${queue.length} new ${queue.length === 1 ? 'report' : 'reports'} waiting for triage` : undefined}
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold">Sort by</span>
            <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="severity">Severity, highest first</option>
            </select>
          </label>
        }
      />

      {!loaded ? <Skeleton /> : queue.length === 0 ? (
        <EmptyState icon={<CheckCheck className="h-9 w-9" />} title="Inbox clear">
          No new reports in {label.toLowerCase() === 'all projects' ? 'any project' : label}. Everything else is in the Tracker.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {queue.map((r) => (
            <li
              key={r.id}
              className="cursor-pointer rounded-card border border-line bg-surface p-4 hover:border-control"
              onClick={(e) => { if (!(e.target as HTMLElement).closest('select, button, a, input, textarea, label')) setParams({ report: r.id }, { replace: true }) }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    <Mono>{r.id}</Mono><span aria-hidden="true">·</span><span>{r.clientName}</span><span aria-hidden="true">·</span><span>{r.reporterName}</span><span aria-hidden="true">·</span><Mono>{fmtDateTime(r.createdAt)}</Mono>
                  </p>
                  <button type="button" onClick={() => setParams({ report: r.id }, { replace: true })} className="mt-1 text-left font-semibold hover:underline">{r.title}</button>
                  {r.description && <p className="mt-1 line-clamp-2 break-words text-muted">{r.description}</p>}
                  <p className="mt-2 flex flex-wrap items-center gap-2"><KindTag kind={r.kind} />{hasSeverity(r.kind) && <SeverityBadge severity={r.severity} />}{r.hasVideo && <span className="text-sm text-muted">Has video</span>}</p>
                </div>
                <div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
                  {hasSeverity(r.kind) && (
                    <label className="text-sm">
                      <span className="sr-only">Severity for {r.id}</span>
                      <select className="input !w-auto" value={r.severity} onChange={(e) => updateFields(r.id, { severity: e.target.value as Severity })}>
                        {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                  )}
                  <Button onClick={() => triage(r, 'Triaging')} pending={busy === r.id + 'Triaging'}><SearchIcon className="h-4 w-4" aria-hidden="true" />Start triage</Button>
                  <Button variant="secondary" onClick={() => triage(r, 'Needs client input')} pending={busy === r.id + 'Needs client input'}><MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />Ask for input</Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <ReportModal report={open} onClose={() => setParams({}, { replace: true })} />}
    </>
  )
}
