import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { addItemForClient, setRoadmapStage, useReports, useReportsLoaded } from '../lib/store'
import { notify } from '../lib/toast'
import { KINDS, ROADMAP_STAGES, type ClientOrg, type Kind, type RoadmapStage } from '../lib/types'
import { ReportPanel } from '../components/ReportPanel'
import { btnPrimary, btnSecondary, fmtDate, inputCls, KindChip } from '../components/ui'

export function AdminRoadmap() {
  const reports = useReports()
  const loaded = useReportsLoaded()
  const [params, setParams] = useSearchParams()
  const openId = params.get('report')
  const [clients, setClients] = useState<ClientOrg[]>([])
  const [clientFilter, setClientFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ clientId: string; title: string; description: string; kind: Kind; stage: RoadmapStage }>({ clientId: '', title: '', description: '', kind: 'Feature request', stage: 'Planned' })
  const [busy, setBusy] = useState(false)

  const loadClients = useCallback(async () => {
    try { setClients((await api.get<{ clients: ClientOrg[] }>('/api/admin/clients')).clients) }
    catch (e) { notify(e instanceof ApiError ? e.message : 'Could not load clients', 'error') }
  }, [])
  useEffect(() => { loadClients() }, [loadClients])

  const items = useMemo(() => reports.filter((r) => r.roadmapStage && (!clientFilter || r.clientId === clientFilter)), [reports, clientFilter])
  const open = reports.find((r) => r.id === openId) ?? null

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const ok = await addItemForClient({ clientId: form.clientId, title: form.title.trim(), description: form.description.trim(), kind: form.kind, roadmapStage: form.stage })
    setBusy(false)
    if (ok) { setForm({ ...form, title: '', description: '' }); setAdding(false) }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Roadmap</h1>
          <p className="text-sm text-slate-600">What each client sees. Move a card, or add something new for a client.</p>
        </div>
        <div className="flex gap-2">
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={`${inputCls.replace('w-full', 'w-auto')}`}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className={btnPrimary} onClick={() => { setAdding((a) => !a); setForm((f) => ({ ...f, clientId: f.clientId || clientFilter || clients[0]?.id || '' })) }}>
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      </div>

      {adding && (
        <form onSubmit={add} className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Client</span>
            <select required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={inputCls}>
              <option value="" disabled>Choose a client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Title</span>
            <input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Mobile app" className={inputCls} />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Description <span className="font-normal text-slate-500">(optional)</span></span>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Type</span>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} className={inputCls}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Stage</span>
            <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as RoadmapStage })} className={inputCls}>
              {ROADMAP_STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <p className="text-xs text-slate-500">The client's people are emailed when you add it.</p>
            <div className="flex gap-2">
              <button type="button" className={btnSecondary} onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" disabled={busy || !form.clientId || !form.title.trim()} className={btnPrimary}>{busy ? 'Adding…' : 'Add to roadmap'}</button>
            </div>
          </div>
        </form>
      )}

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
                  {col.length === 0 && <li className="px-1 py-4 text-center text-xs text-slate-400">Nothing here</li>}
                  {col.map((r) => (
                    <li key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono">{r.id}</span><KindChip kind={r.kind} /><span>{r.clientName}</span>
                      </div>
                      <button onClick={() => setParams({ report: r.id }, { replace: true })} className="mt-1.5 text-left text-sm font-medium hover:text-brand-700">{r.title}</button>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-slate-400">{fmtDate(r.createdAt)}</span>
                        <select
                          value={r.roadmapStage}
                          onChange={(e) => setRoadmapStage(r.id, e.target.value === '' ? null : (e.target.value as RoadmapStage))}
                          aria-label={`Move ${r.title}`}
                          className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                        >
                          {ROADMAP_STAGES.map((s) => <option key={s}>{s}</option>)}
                          <option value="">Remove from roadmap</option>
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
      {open && <ReportPanel report={open} onClose={() => setParams({}, { replace: true })} />}
    </div>
  )
}
