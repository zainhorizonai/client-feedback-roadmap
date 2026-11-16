import { useState } from 'react'
import { Eye, EyeOff, Link2 } from 'lucide-react'
import type { RoadmapItem, RoadmapState } from '../lib/types'

interface Props {
  items: RoadmapItem[]
  states: readonly RoadmapState[]
  mode: 'client' | 'admin'
  onOpen?: (item: RoadmapItem) => void
  onMove?: (item: RoadmapItem, state: RoadmapState) => void
  /** Admins with all projects selected also see which project each card belongs to. */
  showProject?: boolean
}

/**
 * Four columns on a wide screen, grouped sections on a phone (no sideways scrolling).
 * Admins can drag a card between columns, or use the menu on the card, which does the same thing.
 */
export function RoadmapBoard({ items, states, mode, onOpen, onMove, showProject }: Props) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<RoadmapState | null>(null)

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {states.map((state) => {
        const col = items.filter((i) => i.state === state)
        return (
          <section
            key={state}
            aria-labelledby={`col-${state}`}
            onDragOver={mode === 'admin' ? (e) => { e.preventDefault(); setOver(state) } : undefined}
            onDragLeave={mode === 'admin' ? () => setOver((o) => (o === state ? null : o)) : undefined}
            onDrop={mode === 'admin' ? (e) => {
              e.preventDefault()
              const item = items.find((i) => i.id === dragging)
              setOver(null); setDragging(null)
              if (item && item.state !== state) onMove?.(item, state)
            } : undefined}
            className={`rounded-card p-3 ${over === state ? 'bg-subtle ring-2 ring-action' : 'bg-subtle/50'}`}
          >
            <h2 id={`col-${state}`} className="mb-3 flex items-center justify-between px-1 font-semibold">
              {state}
              <span className="rounded-full bg-surface px-2 py-0.5 text-sm font-medium text-muted" aria-label={`${col.length} items`}>{col.length}</span>
            </h2>
            <ul className="space-y-2">
              {col.length === 0 && <li className="px-1 py-6 text-center text-sm text-muted">Nothing here</li>}
              {col.map((item) => (
                <li
                  key={item.id}
                  draggable={mode === 'admin'}
                  onDragStart={() => setDragging(item.id)}
                  onDragEnd={() => { setDragging(null); setOver(null) }}
                  className={`rounded-control border border-line bg-surface p-3 ${mode === 'admin' ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === item.id ? 'opacity-50' : ''}`}
                >
                  {mode === 'admin' && showProject && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{item.clientName}</p>}
                  {mode === 'admin' ? (
                    <button type="button" onClick={() => onOpen?.(item)} className="block w-full text-left font-semibold hover:underline">{item.title}</button>
                  ) : (
                    <h3 className="font-semibold">{item.title}</h3>
                  )}
                  {item.description && <p className="mt-1 line-clamp-3 text-sm text-muted">{item.description}</p>}
                  {item.targetWindow && <p className="mt-2 text-sm"><span className="text-muted">Target: </span>{item.targetWindow}</p>}
                  {item.clientUpdate && (
                    <p className="mt-2 rounded-control bg-canvas px-2 py-1.5 text-sm"><span className="font-semibold">Update: </span>{item.clientUpdate}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                    <span className="flex items-center gap-1">
                      {(mode === 'admin' ? item.reports?.length : item.linkedCount) ? (
                        <><Link2 className="h-3.5 w-3.5" aria-hidden="true" />{mode === 'admin' ? item.reports!.length : item.linkedCount} linked {(mode === 'admin' ? item.reports!.length : item.linkedCount) === 1 ? 'report' : 'reports'}</>
                      ) : null}
                    </span>
                    {mode === 'admin' && (
                      <span className={`flex items-center gap-1 font-semibold ${item.published ? 'text-[var(--seam-success-fg)]' : ''}`}>
                        {item.published ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
                        {item.published ? 'Published' : 'Draft'}
                      </span>
                    )}
                  </div>
                  {mode === 'admin' && (
                    <label className="mt-2 block text-sm">
                      <span className="sr-only">Move {item.title} to</span>
                      <select className="input" value={item.state} onChange={(e) => onMove?.(item, e.target.value as RoadmapState)}>
                        {states.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
