import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox, Search } from 'lucide-react'
import { useClientProject } from '../lib/clientProject'
import { moveItem, useRoadmap, useRoadmapLoaded } from '../lib/roadmap'
import { useReports, useReportsLoaded } from '../lib/store'
import { buildEntries, countEntries, type Entry } from '../lib/entries'
import { ROADMAP_STATES, STATUSES, type RoadmapState } from '../lib/types'
import { ItemsBoard } from '../components/ItemsBoard'
import { ItemDrawer } from '../components/ItemDrawer'
import { Button, EmptyState, fmtDate, KindTag, Mono, PageHeader, Skeleton, StageBadge, StatusBadge } from '../components/ui'

type View = 'list' | 'board'
type Type = 'all' | 'fixes' | 'roadmap'
type Show = 'all' | 'pending' | 'waiting' | 'done'

const TYPES: { id: Type; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'fixes', label: 'UAT/Bugs' }, { id: 'roadmap', label: 'Roadmap' }]

/**
 * One place for everything a client has sent or follows. Switch between a list and the roadmap board,
 * narrow it to bugs or to the roadmap, and filter by what is pending, waiting for them, or done.
 */
export function ClientHome() {
  const { selectedId, projects } = useClientProject()
  const project = projects.find((p) => p.id === selectedId)
  const reports = useReports()
  const items = useRoadmap()
  // Both hooks must always run, so read them separately before combining.
  const reportsLoaded = useReportsLoaded()
  const roadmapLoaded = useRoadmapLoaded()
  const loaded = reportsLoaded && roadmapLoaded
  // Filters live in ordinary state, which queues rapid changes correctly. The URL is only read once, so links
  // such as /reports?view=board open the right view.
  const [params] = useSearchParams()
  const [f, setF] = useState(() => ({
    view: (params.get('view') === 'board' ? 'board' : 'list') as View,
    type: (['fixes', 'roadmap'].includes(params.get('type') ?? '') ? params.get('type') : 'all') as Type,
    show: (['pending', 'waiting', 'done'].includes(params.get('show') ?? '') ? params.get('show') : 'all') as Show,
    status: params.get('status') ?? '',
    q: params.get('q') ?? '',
  }))
  const [openItem, setOpenItem] = useState<string | null>(null)
  const { view, type, show, status, q } = f
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))

  const all = useMemo(() => buildEntries(reports, items, selectedId), [reports, items, selectedId])
  const counts = countEntries(all)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all
      .filter((e) => type === 'all' || (type === 'fixes') === (e.type === 'fix'))
      .filter((e) => show === 'all' || (show === 'pending' && e.pending) || (show === 'waiting' && e.waiting) || (show === 'done' && e.done))
      .filter((e) => !status || (status.startsWith('s:') ? e.status === status.slice(2) : e.stage === status.slice(2)))
      .filter((e) => !needle || `${e.ref} ${e.title}`.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [all, type, show, status, q])

  const filtered = type !== 'all' || show !== 'all' || !!status || !!q
  const clear = () => set({ type: 'all', show: 'all', status: '', q: '' })
  const drawerEntry = all.find((e) => e.item?.id === openItem)

  const tile = (id: Show, label: string, n: number, hint: string) => (
    <button
      type="button"
      onClick={() => set({ show: show === id ? 'all' : id })}
      aria-pressed={show === id}
      className={`rounded-card border p-4 text-left ${show === id ? 'border-action bg-surface ring-2 ring-action' : 'border-line bg-surface hover:border-control'}`}
    >
      <span className="block text-3xl font-semibold tabular-nums" aria-label={loaded ? `${n}` : 'loading'}>{loaded ? n : '–'}</span>
      <span className="block font-semibold">{label}</span>
      <span className="block text-sm text-muted">{hint}</span>
    </button>
  )

  const segment = <T extends string>(label: string, value: T, options: { id: T; label: string }[], on: (v: T) => void) => (
    <div role="group" aria-label={label} className="inline-flex rounded-control border border-control bg-surface p-0.5">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => on(o.id)} aria-pressed={value === o.id} className={`min-h-10 rounded-full px-3 font-semibold md:min-h-8 ${value === o.id ? 'bg-white text-black' : 'text-ink hover:bg-subtle'}`}>{o.label}</button>
      ))}
    </div>
  )

  return (
    <>
      <PageHeader eyebrow={project?.name} title="My items" subtitle="UAT/Bugs, feature requests and questions, all in one place." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3" role="group" aria-label="Quick filters">
        {tile('pending', 'Pending', counts.pending, 'Not done yet')}
        {tile('waiting', 'Waiting for you', counts.waiting, 'Needs your reply or a check')}
        {tile('done', 'Done', counts.done, 'Finished or approved')}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {segment<View>('View', view, [{ id: 'list', label: 'List' }, { id: 'board', label: 'Card' }], (v) => set({ view: v }))}
        {segment<Type>('Show', type, TYPES, (v) => set({ type: v }))}
        <select className="input !w-auto" aria-label="Filter by status" value={status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          <optgroup label="Fix status">{STATUSES.map((s) => <option key={s} value={`s:${s}`}>{s}</option>)}</optgroup>
          <optgroup label="Roadmap stage">{ROADMAP_STATES.map((s) => <option key={s} value={`r:${s}`}>{s}</option>)}</optgroup>
        </select>
        <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input className="input pl-9" type="search" aria-label="Search" placeholder="Search" value={q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        {filtered && <Button variant="tertiary" onClick={clear}>Clear filters</Button>}
      </div>

      {!loaded ? <Skeleton rows={6} /> : all.length === 0 ? (
        <EmptyState icon={<Inbox className="h-9 w-9" />} title="Nothing here yet">
          Press New to send a bug, an idea or a question. Ideas and questions go on your roadmap. A video helps, and you can always send text only.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No items match these filters" action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
      ) : view === 'board' ? (
        <ItemsBoard entries={rows} onMove={(e: Entry, stage: RoadmapState) => e.item && moveItem(e.item.id, stage)} onOpenItem={(e) => setOpenItem(e.item?.id ?? null)} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {rows.map((e) => {
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    <Mono>{e.ref}</Mono><span aria-hidden="true">·</span><Mono>{fmtDate(e.createdAt)}</Mono><KindTag kind={e.tag === 'Roadmap item' ? 'Feature request' : e.tag} />
                    {e.tag === 'Roadmap item' && <span>Roadmap item</span>}
                  </p>
                  <p className="mt-1 break-words font-semibold">{e.title}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {e.waiting && <span className="badge badge-warning">Waiting for you</span>}
                  {e.status ? <StatusBadge status={e.status} /> : <StageBadge stage={e.stage} />}
                </div>
              </>
            )
            return (
              <li key={e.key}>
                {e.reportId
                  ? <Link to={`/reports/${e.reportId}`} className="flex flex-col gap-2 px-4 py-4 no-underline hover:bg-subtle sm:flex-row sm:items-center sm:gap-4">{body}</Link>
                  : <button type="button" onClick={() => setOpenItem(e.item?.id ?? null)} className="flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-subtle sm:flex-row sm:items-center sm:gap-4">{body}</button>}
              </li>
            )
          })}
        </ul>
      )}
      {filtered && rows.length > 0 && <p className="mt-2 text-sm text-muted">{rows.length} of {all.length} shown.</p>}
      {drawerEntry?.item && <ItemDrawer item={drawerEntry.item} onClose={() => setOpenItem(null)} />}
    </>
  )
}
