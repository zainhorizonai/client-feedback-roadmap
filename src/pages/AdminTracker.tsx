import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Play, Search } from 'lucide-react'
import { setStatus, updateFields, useReports } from '../lib/store'
import { SEVERITIES, STATUSES, type Report, type Severity, type Status } from '../lib/types'
import { EditableText } from '../components/EditableText'
import { ReportPanel } from '../components/ReportPanel'
import { btnSecondary, fmtDate, inputCls } from '../components/ui'

const STATUS_ROW: Record<Status, string> = {
  New: 'border-l-blue-500',
  Triaging: 'border-l-violet-500',
  'In progress': 'border-l-amber-500',
  'Ready to verify': 'border-l-cyan-500',
  Resolved: 'border-l-emerald-500',
}

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`
}

function exportCsv(rows: Report[]) {
  const head = ['ID', 'Date', 'Client', 'Reporter', 'Title', 'Description', 'Page URL', 'Severity', 'Status', 'Notes', 'Resolution video', 'Resolved date']
  const body = rows.map((r) => [r.id, r.createdAt, r.clientName, r.reporterName, r.title, r.description, r.pageUrl, r.severity, r.status, r.notes ?? '', r.resolutionUrl, r.resolvedAt ?? ''].map(csvCell).join(','))
  const url = URL.createObjectURL(new Blob([[head.map(csvCell).join(','), ...body].join('\n')], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const filterCls = inputCls.replace('w-full', 'w-auto')
const th = 'sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600'
const td = 'border-b border-slate-100 px-1 py-1 align-middle'
const cellSelect = 'w-full cursor-pointer rounded border-0 bg-transparent px-1 py-1 text-sm hover:bg-slate-100 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100'

export function AdminTracker() {
  const reports = useReports()
  const [q, setQ] = useState('')
  const [client, setClient] = useState('')
  const [status, setStatusFilter] = useState('')
  const [severity, setSeverityFilter] = useState('')
  const [params, setParams] = useSearchParams()
  const openId = params.get('report')
  const setOpenId = (id: string | null) => setParams(id ? { report: id } : {}, { replace: true })

  const clients = useMemo(() => [...new Set(reports.map((r) => r.clientName))].sort(), [reports])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return reports
      .filter((r) => (!client || r.clientName === client) && (!status || r.status === status) && (!severity || r.severity === severity))
      .filter((r) => !needle || [r.id, r.title, r.description, r.reporterName, r.clientName, r.notes ?? ''].some((f) => f.toLowerCase().includes(needle)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [reports, q, client, status, severity])

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>
    reports.forEach((r) => c[r.status]++)
    return c
  }, [reports])

  const open = reports.find((r) => r.id === openId) ?? null

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tracker</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatusFilter(status === s ? '' : s)} className={`hover:text-slate-900 ${status === s ? 'font-semibold text-slate-900' : ''}`}>
                {s} <span className="tabular-nums text-slate-400">{counts[s]}</span>
              </button>
            ))}
          </div>
        </div>
        <button className={btnSecondary} onClick={() => exportCsv(rows)}><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports…" className={`${inputCls} pl-9`} />
        </div>
        <select value={client} onChange={(e) => setClient(e.target.value)} className={`${filterCls}`}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatusFilter(e.target.value)} className={`${filterCls}`}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={severity} onChange={(e) => setSeverityFilter(e.target.value)} className={`${filterCls}`}>
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1200px] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-24" /><col className="w-28" /><col className="w-32" /><col className="w-32" />
            <col className="w-64" /><col className="w-56" /><col className="w-16" /><col className="w-28" />
            <col className="w-36" /><col className="w-52" /><col className="w-28" />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>ID</th><th className={th}>Date</th><th className={th}>Client</th><th className={th}>Reporter</th>
              <th className={th}>Title</th><th className={th}>Page / URL</th><th className={th}>Video</th><th className={th}>Severity</th>
              <th className={th}>Status</th><th className={th}>Notes</th><th className={th}>Resolved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-l-4 hover:bg-slate-50/70 ${STATUS_ROW[r.status]} ${openId === r.id ? 'bg-brand-50/50' : ''}`}>
                <td className={`${td} px-2 font-mono text-xs text-slate-600`}>{r.id}</td>
                <td className={`${td} px-2 text-slate-600`}>{fmtDate(r.createdAt)}</td>
                <td className={`${td} px-2`}>{r.clientName}</td>
                <td className={`${td} px-2 text-slate-600`}>{r.reporterName}</td>
                <td className={td}><EditableText value={r.title} onSave={(v) => updateFields(r.id, { title: v })} className="font-medium" /></td>
                <td className={td}><EditableText value={r.pageUrl} onSave={(v) => updateFields(r.id, { pageUrl: v })} /></td>
                <td className={`${td} text-center`}>
                  <button onClick={() => setOpenId(r.id)} title="Open video and details" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 hover:bg-brand-100">
                    <Play className="h-4 w-4 fill-current" />
                  </button>
                </td>
                <td className={td}>
                  <select value={r.severity} onChange={(e) => updateFields(r.id, { severity: e.target.value as Severity })} className={cellSelect}>
                    {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className={td}>
                  <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value as Status)} className={`${cellSelect} font-medium`}>
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className={td}><EditableText value={r.notes ?? ''} onSave={(v) => updateFields(r.id, { notes: v })} placeholder="Add note" /></td>
                <td className={`${td} px-2 text-slate-600`}>{r.resolvedAt ? fmtDate(r.resolvedAt) : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="py-16 text-center text-slate-500">No reports match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">{rows.length} of {reports.length} reports. Click a title, URL or note to edit it in place.</p>

      {open && <ReportPanel report={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
