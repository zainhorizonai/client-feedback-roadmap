import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Eye, Map, Plus, Trash2 } from 'lucide-react'
import { useProject } from '../lib/project'
import { useReports } from '../lib/store'
import { createItem, deleteItem, updateItem, useRoadmap, useRoadmapLoaded } from '../lib/roadmap'
import { ROADMAP_STATES, type RoadmapItem, type RoadmapState } from '../lib/types'
import { RoadmapBoard } from '../components/RoadmapBoard'
import { ReportDrawer } from '../components/ReportDrawer'
import { Button, Drawer, EmptyState, Field, Mono, PageHeader, Skeleton, StatusBadge } from '../components/ui'

interface Draft { clientId: string; title: string; description: string; state: RoadmapState; targetWindow: string; clientUpdate: string; published: boolean; reportIds: string[] }
const blank = (clientId: string): Draft => ({ clientId, title: '', description: '', state: 'Under review', targetWindow: '', clientUpdate: '', published: false, reportIds: [] })
const fromItem = (i: RoadmapItem): Draft => ({ clientId: i.clientId, title: i.title, description: i.description, state: i.state, targetWindow: i.targetWindow, clientUpdate: i.clientUpdate, published: !!i.published, reportIds: (i.reports ?? []).map((r) => r.id) })

export function AdminRoadmap() {
  const { projects, matches, label, single, selectedIds } = useProject()
  const all = useRoadmap()
  const loaded = useRoadmapLoaded()
  const reports = useReports()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<{ item: RoadmapItem | null } | null>(null)
  const [preview, setPreview] = useState(false)

  const items = useMemo(() => all.filter((i) => matches(i.clientId)), [all, matches, selectedIds])
  const openReport = reports.find((r) => r.id === params.get('report')) ?? null
  // Client preview only makes sense for one project, and shows exactly what its people see.
  useEffect(() => { if (!single) setPreview(false) }, [single])
  const previewItems = items.filter((i) => i.published)

  return (
    <>
      <PageHeader
        eyebrow={label}
        title="Roadmap"
        subtitle="Plan work for clients. Nothing is visible to them until you publish it."
        actions={
          <>
            <Button variant="secondary" onClick={() => setPreview((p) => !p)} disabled={!single} aria-pressed={preview} title={single ? undefined : 'Choose one project to preview what its client sees'}>
              <Eye className="h-4 w-4" aria-hidden="true" />{preview ? 'Back to editing' : 'Client preview'}
            </Button>
            <Button onClick={() => setEditing({ item: null })}><Plus className="h-4 w-4" aria-hidden="true" />Add roadmap item</Button>
          </>
        }
      />

      {preview && single && (
        <p className="mb-4 rounded-card border border-line bg-surface px-4 py-3" role="status">
          This is what <strong>{single.name}</strong> sees: published items only, with no private notes or reporter details. {previewItems.length} of {items.length} items are published.
        </p>
      )}

      {!loaded ? <Skeleton /> : items.length === 0 ? (
        <EmptyState icon={<Map className="h-9 w-9" />} title="No roadmap items yet" action={<Button onClick={() => setEditing({ item: null })}><Plus className="h-4 w-4" aria-hidden="true" />Add roadmap item</Button>}>
          Create an item, link the reports it covers, and publish it when you are ready for the client to see it.
        </EmptyState>
      ) : preview ? (
        <RoadmapBoard items={previewItems} states={ROADMAP_STATES} mode="client" />
      ) : (
        <RoadmapBoard
          items={items}
          states={ROADMAP_STATES}
          mode="admin"
          showProject={!single}
          onOpen={(item) => setEditing({ item })}
          onMove={(item, state) => updateItem(item.id, { state }, `${item.title} moved to ${state}.`)}
        />
      )}

      {editing && <ItemEditor item={editing.item} defaultClientId={single?.id ?? projects.find((p) => matches(p.id))?.id ?? ''} onClose={() => setEditing(null)} onOpenReport={(id) => setParams({ report: id }, { replace: true })} />}
      {openReport && <ReportDrawer report={openReport} onClose={() => setParams({}, { replace: true })} />}
    </>
  )
}

function ItemEditor({ item, defaultClientId, onClose, onOpenReport }: { item: RoadmapItem | null; defaultClientId: string; onClose: () => void; onOpenReport: (id: string) => void }) {
  const { projects } = useProject()
  const reports = useReports()
  const [d, setD] = useState<Draft>(item ? fromItem(item) : blank(defaultClientId))
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [filter, setFilter] = useState('')

  const candidates = reports.filter((r) => r.clientId === d.clientId && (!filter.trim() || `${r.id} ${r.title}`.toLowerCase().includes(filter.trim().toLowerCase())))
  const toggle = (id: string) => setD((x) => ({ ...x, reportIds: x.reportIds.includes(id) ? x.reportIds.filter((r) => r !== id) : [...x.reportIds, id] }))

  async function save() {
    if (!d.title.trim()) { setTitleError('Enter a title for this item.'); return }
    setSaving(true)
    const body = { title: d.title.trim(), description: d.description.trim(), state: d.state, targetWindow: d.targetWindow.trim(), clientUpdate: d.clientUpdate.trim(), published: d.published, reportIds: d.reportIds }
    const ok = item ? await updateItem(item.id, body, 'Roadmap item saved.') : await createItem({ ...body, clientId: d.clientId })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Drawer title={item ? item.title : 'Add roadmap item'} onClose={onClose}>
      <div className="space-y-4">
        {!item && (
          <Field label="Project" required>
            <select className="input" value={d.clientId} onChange={(e) => setD({ ...d, clientId: e.target.value, reportIds: [] })}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Title" required error={titleError}>
          <input className="input" maxLength={120} value={d.title} aria-invalid={!!titleError} onChange={(e) => { setD({ ...d, title: e.target.value }); setTitleError('') }} placeholder="For example: Checkout reliability" />
        </Field>
        <Field label="Public description" hint="The client reads this. Do not include private notes.">
          <textarea className="input" rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State">
            <select className="input" value={d.state} onChange={(e) => setD({ ...d, state: e.target.value as RoadmapState })}>
              {ROADMAP_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Target window" hint="Optional">
            <input className="input" value={d.targetWindow} maxLength={60} onChange={(e) => setD({ ...d, targetWindow: e.target.value })} placeholder="Q1 2027" />
          </Field>
        </div>
        <Field label="Client update" hint="A short note shown on the card once published.">
          <textarea className="input" rows={2} value={d.clientUpdate} onChange={(e) => setD({ ...d, clientUpdate: e.target.value })} />
        </Field>

        <fieldset className="rounded-card border border-line p-3">
          <legend className="px-1 font-semibold">Linked reports</legend>
          <p className="mb-2 text-sm text-muted">Reports keep their own status, evidence and retest history. Moving this item to Done does not resolve them.</p>
          <input className="input" type="search" aria-label="Search reports to link" placeholder="Search reports in this project" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
            {candidates.length === 0 && <li className="py-3 text-center text-sm text-muted">No reports to show.</li>}
            {candidates.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-control px-1 py-1 hover:bg-subtle">
                <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={d.reportIds.includes(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-[var(--seam-terracotta)]" />
                  <Mono className="shrink-0 text-sm">{r.id}</Mono><span className="truncate">{r.title}</span>
                </label>
                <StatusBadge status={r.status} />
                {item && <button type="button" className="text-sm underline" onClick={() => onOpenReport(r.id)}>Open</button>}
              </li>
            ))}
          </ul>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line bg-subtle/40 p-3">
          <input type="checkbox" checked={d.published} onChange={(e) => setD({ ...d, published: e.target.checked })} className="mt-1 h-4 w-4 accent-[var(--seam-terracotta)]" />
          <span>
            <span className="block font-semibold">Publish to the client</span>
            <span className="block text-sm text-muted">{d.published ? 'The client can see this item now. They will not see linked reports, reporter names or notes.' : 'Keep this as a draft. Only your team can see it.'}</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          {item ? (
            confirmDelete ? (
              <span className="flex items-center gap-2"><Button variant="danger" onClick={async () => { if (await deleteItem(item.id)) onClose() }}>Delete item</Button><Button variant="tertiary" onClick={() => setConfirmDelete(false)}>Keep</Button></span>
            ) : <Button variant="tertiary" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden="true" />Delete</Button>
          ) : <span />}
          <span className="flex gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} pending={saving}>Save item</Button></span>
        </div>
      </div>
    </Drawer>
  )
}
