import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { ROADMAP_STATES, type RoadmapState } from '../lib/types'
import type { Entry } from '../lib/entries'
import { ClientStatusBadge, When, KindTag, Mono, StageBadge } from './ui'

interface Props {
  entries: Entry[]
  onMove: (entry: Entry, stage: RoadmapState) => void
  onOpenItem: (entry: Entry) => void
}

/**
 * The roadmap-stage view. Roadmap cards can be dragged between columns, or moved with the menu on the card
 * (the same action, for keyboards and touch). Bugs and UAT findings sit in a column by their status. They
 * move when the team works on them, so they are not draggable.
 */
export function ItemsBoard({ entries, onMove, onOpenItem }: Props) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<RoadmapState | null>(null)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {ROADMAP_STATES.map((stage) => {
        const col = entries.filter((e) => e.stage === stage)
        return (
          <section
            key={stage}
            aria-labelledby={`stage-${stage}`}
            onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(stage) } }}
            onDragLeave={() => setOver((o) => (o === stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault()
              const entry = entries.find((x) => x.key === dragging)
              setOver(null); setDragging(null)
              if (entry?.item && entry.stage !== stage) onMove(entry, stage)
            }}
            className={`rounded-card p-3 ${over === stage ? 'bg-subtle ring-2 ring-forest' : 'bg-subtle/50'}`}
          >
            <h2 id={`stage-${stage}`} className="mb-3 flex items-center justify-between px-1 font-semibold">
              {stage}
              <span className="rounded-full bg-surface px-2 py-0.5 text-sm font-medium text-muted" aria-label={`${col.length} items`}>{col.length}</span>
            </h2>
            <ul className="space-y-2">
              {col.length === 0 && <li className="px-1 py-6 text-center text-sm text-muted">Nothing here</li>}
              {col.map((e) => {
                const movable = !!e.item
                const title = e.type === 'fix' || e.reportId
                  ? <Link to={`/reports/${e.reportId}`} className="font-semibold text-ink hover:underline">{e.title}</Link>
                  : <button type="button" onClick={() => onOpenItem(e)} className="text-left font-semibold hover:underline">{e.title}</button>
                return (
                  <li
                    key={e.key}
                    draggable={movable}
                    onDragStart={movable ? () => setDragging(e.key) : undefined}
                    onDragEnd={() => { setDragging(null); setOver(null) }}
                    className={`rounded-control border border-line bg-surface p-3 ${movable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === e.key ? 'opacity-50' : ''}`}
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted"><Mono>{e.ref}</Mono><KindTag kind={e.tag === 'Roadmap item' ? 'Feature request' : e.tag} />{e.tag === 'Roadmap item' && <span className="sr-only">Roadmap item</span>}</p>
                    <div className="break-words">{title}</div>
                    {e.item?.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{e.item.description}</p>}
                    {e.item?.targetWindow && <p className="mt-1 text-sm"><span className="text-muted">Target: </span>{e.item.targetWindow}</p>}
                    {e.item?.clientUpdate && <p className="mt-2 rounded-control bg-canvas px-2 py-1.5 text-sm"><span className="font-semibold">Update: </span>{e.item.clientUpdate}</p>}
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {e.status ? <ClientStatusBadge status={e.status} /> : <StageBadge stage={e.stage} />}
                      {e.waiting && <span className="badge badge-warning">Waiting for you</span>}
                    </div>
                    {(e.item?.linkedCount ?? 0) > 1 && <p className="mt-2 flex items-center gap-1 text-sm text-muted"><Link2 className="h-3.5 w-3.5" aria-hidden="true" />{e.item!.linkedCount} linked reports</p>}
                    {e.moved && <p className="mt-2 text-xs text-muted">Moved by {e.moved.by === 'client' ? 'you' : 'the team'} · <When iso={e.moved.at} date /></p>}
                    {movable && (
                      <label className="mt-2 block text-sm">
                        <span className="sr-only">Move {e.title} to</span>
                        <select className="input" value={e.stage} onChange={(ev) => onMove(e, ev.target.value as RoadmapState)}>
                          {ROADMAP_STATES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </label>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
