import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Columns3, Download, Play, Save, Search, Trash2 } from 'lucide-react'
import { useProject } from '../lib/project'
import { setStatus, updateFields, useReports, useReportsLoaded } from '../lib/store'
import { hasSeverity, KINDS, SEVERITIES, STATUSES, type Report, type Severity, type Status } from '../lib/types'
import { EditableCell } from '../components/EditableCell'
import { ReportModal } from '../components/ReportModal'
import { ProjectChips } from '../components/ProjectFilter'
import { Button, EmptyState, fmtDate, Mono, PageHeader, Skeleton, StatTile, StatusBadge } from '../components/ui'
import { notify } from '../lib/toast'

type SortKey = 'id' | 'createdAt' | 'title' | 'severity' | 'status'
interface Filters { q: string; kind: string; status: string; severity: string; days: string }
const NO_FILTERS: Filters = { q: '', kind: '', status: '', severity: '', days: '' }
const SEV_RANK: Record<Severity, number> = { Blocker: 0, High: 1, Medium: 2, Low: 3 }

interface ColumnDef { key: string; label: string; sort?: SortKey }
const COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'ID', sort: 'id' },
  { key: 'createdAt', label: 'Submitted', sort: 'createdAt' },
  { key: 'project', label: 'Project' },
  { key: 'reporter', label: 'Reporter' },
  { key: 'kind', label: 'Type' },
  { key: 'title', label: 'Title', sort: 'title' },
  { key: 'description', label: 'Description' },
  { key: 'video', label: 'Video' },
  { key: 'pageUrl', label: 'Page / URL' },
  { key: 'severity', label: 'Severity', sort: 'severity' },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'resolution', label: 'Resolution video' },
  { key: 'resolvedAt', label: 'Resolved date' },
]
// Only the essentials show by default. The rest are one click away under Columns.
const DEFAULT_COLUMNS = ['id', 'title', 'project', 'severity', 'status']
const COLS_KEY = 'seam.tracker.columns.v2'
const VIEWS_KEY = 'seam.tracker.views'

interface SavedView { name: string; filters: Filters; sort: SortKey; dir: 'asc' | 'desc'; columns: string[] }

function loadJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback } catch { return fallback }
}
const saveJson = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ } }

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`

export function AdminTracker() {
  const { matches, label, selectedIds, isAll } = useProject()
  const reports = useReports()
  const loaded = useReportsLoaded()
  const [params, setParams] = useSearchParams()

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [sort, setSort] = useState<SortKey>('createdAt')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [columns, setColumns] = useState<string[]>(() => loadJson<string[] | null>(COLS_KEY, null) ?? DEFAULT_COLUMNS)
  const [views, setViews] = useState<SavedView[]>(() => loadJson(VIEWS_KEY, []))
  const [showColumns, setShowColumns] = useState(false)
  const [viewName, setViewName] = useState('')
  const [savingView, setSavingView] = useState(false)

  useEffect(() => saveJson(COLS_KEY, columns), [columns])
  useEffect(() => saveJson(VIEWS_KEY, views), [views])

  const f = (patch: Partial<Filters>) => setFilters((x) => ({ ...x, ...patch }))
  const active = Object.values(filters).some(Boolean)
  const visible = (key: string) => columns.includes(key)

  const rows = useMemo(() => {
    const needle = filters.q.trim().toLowerCase()
    const since = filters.days ? Date.now() - Number(filters.days) * 864e5 : 0
    const list = reports.filter((r) =>
      matches(r.clientId) &&
      (!filters.kind || r.kind === filters.kind) && (!filters.status || r.status === filters.status) && (!filters.severity || r.severity === filters.severity) &&
      (!since || new Date(r.createdAt).getTime() >= since) &&
      (!needle || [r.id, r.title, r.description, r.reporterName, r.clientName, r.pageUrl].some((v) => v.toLowerCase().includes(needle))))
    const sign = dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sort) {
        case 'id': return sign * a.id.localeCompare(b.id, undefined, { numeric: true })
        case 'title': return sign * a.title.localeCompare(b.title)
        case 'severity': return sign * (SEV_RANK[a.severity] - SEV_RANK[b.severity])
        case 'status': return sign * (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status))
        default: return sign * a.createdAt.localeCompare(b.createdAt)
      }
    })
  }, [reports, matches, selectedIds, filters, sort, dir])

  const open = reports.find((r) => r.id === params.get('report')) ?? null
  const openReport = (id: string) => setParams({ report: id }, { replace: true })

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir(key === 'createdAt' ? 'desc' : 'asc') }
  }

  function applyView(name: string) {
    const v = views.find((x) => x.name === name)
    if (!v) return
    setFilters(v.filters); setSort(v.sort); setDir(v.dir); setColumns(v.columns)
  }
  function saveView() {
    const name = viewName.trim()
    if (!name) return
    setViews((vs) => [...vs.filter((v) => v.name !== name), { name, filters, sort, dir, columns }])
    setViewName(''); setSavingView(false)
    notify(`Saved view "${name}".`)
  }

  // The export is exactly what is on screen. Internal notes and private links are never included.
  function exportCsv() {
    const defs = COLUMNS.filter((c) => visible(c.key) && c.key !== 'video' && c.key !== 'resolution')
    const value = (r: Report, key: string) =>
      ({ id: r.id, createdAt: r.createdAt, project: r.clientName, reporter: r.reporterName, kind: r.kind, title: r.title, description: r.description, pageUrl: r.pageUrl, severity: hasSeverity(r.kind) ? r.severity : '', status: r.status, resolvedAt: r.resolvedAt ?? '' } as Record<string, string>)[key] ?? ''
    const csv = [defs.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => defs.map((c) => csvCell(value(r, c.key))).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `seam-reports-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    notify(`Exported ${rows.length} ${rows.length === 1 ? 'report' : 'reports'}.`)
  }

  const th = 'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-subtle px-2 py-2 text-left text-sm font-semibold'
  const td = 'border-b border-line px-1 py-1 align-middle'
  const chip = 'input !w-auto'

  return (
    <>
      <PageHeader
        eyebrow={label}
        title="Tracker"
        subtitle={loaded ? `${rows.length} of ${reports.filter((r) => matches(r.clientId)).length} reports${isAll ? ' in all projects' : ` in ${label}`}` : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowColumns((s) => !s)} aria-expanded={showColumns}><Columns3 className="h-4 w-4" aria-hidden="true" />Columns</Button>
            <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Export current view</Button>
          </>
        }
      />

      <ProjectChips />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="group" aria-label="Quick filters">
        {([['New', 'New', 'Waiting for triage'], ['In progress', 'In progress', 'Being worked on'], ['Needs client input', 'Waiting on client', 'We asked them something'], ['Ready to verify', 'Ready to verify', 'Fixed, awaiting the client']] as const).map(([status, name, hint]) => (
          <StatTile key={status} label={name} hint={hint} value={loaded ? reports.filter((r) => matches(r.clientId) && r.status === status).length : '–'} active={filters.status === status} onClick={() => f({ status: filters.status === status ? '' : status })} />
        ))}
      </div>

      {showColumns && (
        <fieldset className="mb-4 rounded-card border border-line bg-surface p-4">
          <legend className="px-1 font-semibold">Visible columns</legend>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
            {COLUMNS.map((c) => (
              <label key={c.key} className="flex min-h-9 cursor-pointer items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-[var(--seam-terracotta)]" checked={visible(c.key)} disabled={c.key === 'id' || c.key === 'title'}
                  onChange={() => setColumns((cs) => (cs.includes(c.key) ? cs.filter((k) => k !== c.key) : [...cs, c.key]))} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input className="input pl-9" type="search" aria-label="Search reports" placeholder="Search reports" value={filters.q} onChange={(e) => f({ q: e.target.value })} />
        </div>
        <select className={chip} aria-label="Filter by type" value={filters.kind} onChange={(e) => f({ kind: e.target.value })}><option value="">All types</option>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <select className={chip} aria-label="Filter by status" value={filters.status} onChange={(e) => f({ status: e.target.value })}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select className={chip} aria-label="Filter by severity" value={filters.severity} onChange={(e) => f({ severity: e.target.value })}><option value="">All severities</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
        <select className={chip} aria-label="Filter by date" value={filters.days} onChange={(e) => f({ days: e.target.value })}><option value="">Any date</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
        {active && <Button variant="tertiary" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {views.length > 0 && (
          <label className="flex items-center gap-2"><span className="font-semibold">Saved views</span>
            <select className="input !w-auto" value="" onChange={(e) => applyView(e.target.value)}>
              <option value="">Choose a view…</option>{views.map((v) => <option key={v.name}>{v.name}</option>)}
            </select>
          </label>
        )}
        {savingView ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveView() }}>
            <input className="input !w-48" aria-label="View name" placeholder="Name this view" autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} />
            <Button type="submit" disabled={!viewName.trim()}>Save</Button><Button variant="tertiary" onClick={() => setSavingView(false)}>Cancel</Button>
          </form>
        ) : <Button variant="tertiary" onClick={() => setSavingView(true)}><Save className="h-4 w-4" aria-hidden="true" />Save current view</Button>}
        {views.length > 0 && <Button variant="tertiary" onClick={() => { const n = prompt('Delete which saved view? Type its name.'); if (n) setViews((vs) => vs.filter((v) => v.name !== n)) }}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete a view</Button>}
      </div>

      {!loaded ? <Skeleton rows={8} /> : rows.length === 0 ? (
        active
          ? <EmptyState title="No reports match these filters" action={<Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button>} />
          : <EmptyState title={isAll ? 'No reports yet' : `No reports in ${label} yet`}>Reports sent by clients appear here as soon as they are submitted.</EmptyState>
      ) : (
        // The table scrolls inside this box, so the page itself never scrolls sideways.
        <div className="max-h-[calc(100vh-17rem)] min-h-64 overflow-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {COLUMNS.filter((c) => visible(c.key)).map((c) => (
                  <th key={c.key} scope="col" aria-sort={c.sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={`${th} ${c.key === 'id' ? 'left-0 z-20' : ''}`}>
                    {c.sort ? (
                      <button type="button" onClick={() => toggleSort(c.sort!)} className="inline-flex items-center gap-1 font-semibold hover:underline">
                        {c.label}{sort === c.sort && (dir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />)}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="h-12 cursor-pointer hover:bg-canvas/60"
                  // Clicking anywhere on the row opens the ticket, except on a control inside it (status, severity, links).
                  onClick={(e) => { if (!(e.target as HTMLElement).closest('select, button, a, input, textarea, label')) openReport(r.id) }}
                >
                  {visible('id') && <th scope="row" className={`${td} sticky left-0 z-[5] bg-surface px-2 text-left font-normal`}><Mono>{r.id}</Mono></th>}
                  {visible('createdAt') && <td className={`${td} whitespace-nowrap px-2`}><Mono>{fmtDate(r.createdAt)}</Mono></td>}
                  {visible('project') && <td className={`${td} whitespace-nowrap px-2`}>{r.clientName}</td>}
                  {visible('reporter') && <td className={`${td} whitespace-nowrap px-2 text-muted`}>{r.reporterName}</td>}
                  {visible('kind') && <td className={`${td} whitespace-nowrap px-2`}>{r.kind}</td>}
                  {visible('title') && (
                    <td className={`${td} min-w-[16rem] max-w-xl px-2`}>
                      <button type="button" onClick={() => openReport(r.id)} className="block w-full truncate text-left font-semibold hover:underline" title={r.title}>{r.title}</button>
                    </td>
                  )}
                  {visible('description') && <td className={`${td} min-w-[16rem] max-w-md`}><EditableCell multiline value={r.description} label={`description of ${r.id}`} onSave={(v) => updateFields(r.id, { description: v })} /></td>}
                  {visible('video') && (
                    <td className={`${td} px-2`}>
                      {r.hasVideo ? <button type="button" onClick={() => openReport(r.id)} aria-label={`Play video for ${r.id}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-subtle hover:bg-sand"><Play className="h-4 w-4 fill-current" aria-hidden="true" /></button> : <span className="text-muted">None</span>}
                    </td>
                  )}
                  {visible('pageUrl') && <td className={`${td} min-w-[12rem] max-w-xs`}><EditableCell value={r.pageUrl} label={`page of ${r.id}`} onSave={(v) => updateFields(r.id, { pageUrl: v })} /></td>}
                  {visible('severity') && (
                    <td className={`${td} px-1`}>
                      {hasSeverity(r.kind) ? (
                        <select className="input !min-h-9 !w-28" aria-label={`Severity of ${r.id}`} value={r.severity} onChange={(e) => updateFields(r.id, { severity: e.target.value as Severity })}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
                      ) : <span className="px-2 text-muted" aria-label="No severity">—</span>}
                    </td>
                  )}
                  {visible('status') && (
                    <td className={`${td} px-1`}>
                      <div className="flex items-center gap-2">
                        <select className="input !min-h-9 !w-40" aria-label={`Status of ${r.id}`} value={r.status} onChange={(e) => setStatus(r.id, e.target.value as Status)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                        <span className="hidden 2xl:inline"><StatusBadge status={r.status} /></span>
                      </div>
                    </td>
                  )}
                  {visible('resolution') && <td className={`${td} px-2`}>{r.resolutionUrl ? <a href={r.resolutionUrl} target="_blank" rel="noreferrer" className="font-semibold">Watch<span className="sr-only"> resolution video for {r.id} (opens in a new tab)</span></a> : <span className="text-muted">None</span>}</td>}
                  {visible('resolvedAt') && <td className={`${td} whitespace-nowrap px-2`}>{r.resolvedAt ? <Mono>{fmtDate(r.resolvedAt)}</Mono> : <span className="text-muted">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReportModal report={open} onClose={() => setParams({}, { replace: true })} />}
    </>
  )
}
