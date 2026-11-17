import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { moveItem } from '../lib/roadmap'
import { approveReport, useReports } from '../lib/store'
import { ROADMAP_STATES, type RoadmapItem, type RoadmapState } from '../lib/types'
import { Button, Drawer, Field, fmtDateTime, Mono, StageBadge, StatusBadge } from './ui'

/** A roadmap card that has no conversation of its own: its details, where it is, and who moved it. */
export function ItemDrawer({ item, onClose }: { item: RoadmapItem; onClose: () => void }) {
  const reports = useReports()
  const linked = (item.reportIds ?? []).map((id) => reports.find((r) => r.id === id)).filter((r) => !!r)
  const single = linked.length === 1 ? linked[0] : null
  const [approving, setApproving] = useState(false)

  return (
    <Drawer title={item.title} onClose={onClose}>
      <p className="mb-4 flex flex-wrap items-center gap-2"><StageBadge stage={item.state} />{item.targetWindow && <span className="text-sm text-muted">Target <strong className="text-ink">{item.targetWindow}</strong></span>}</p>
      {item.description && <p className="whitespace-pre-wrap break-words">{item.description}</p>}
      {item.clientUpdate && <p className="mt-4 rounded-card bg-canvas p-3"><span className="font-semibold">Update from the team: </span>{item.clientUpdate}</p>}

      <div className="mt-5">
        <Field label="Stage" hint="Move this card to where you think it belongs. The team is told.">
          <select className="input" value={item.state} onChange={(e) => moveItem(item.id, e.target.value as RoadmapState)}>
            {ROADMAP_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        {item.lastMove && <p className="mt-2 text-sm text-muted">{item.lastMove.text}, by {item.lastMove.by === 'client' ? 'you' : 'the team'} · <Mono>{fmtDateTime(item.lastMove.at)}</Mono></p>}
      </div>

      {linked.length > 0 && (
        <section className="mt-6" aria-labelledby="linked-h">
          <h3 id="linked-h" className="mb-2 font-semibold">Related reports</h3>
          <ul className="space-y-1.5">
            {linked.map((r) => (
              <li key={r!.id}>
                <Link to={`/reports/${r!.id}`} className="flex items-center justify-between gap-2 rounded-control border border-line px-3 py-2 no-underline hover:bg-subtle">
                  <span className="min-w-0 truncate"><Mono className="text-sm text-muted">{r!.id}</Mono> {r!.title}</span><StatusBadge status={r!.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {single && single.status !== 'Resolved' && (
        <div className="mt-6 border-t border-line pt-4">
          <Button onClick={async () => { setApproving(true); await approveReport(single.id); setApproving(false) }} pending={approving}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve as done</Button>
        </div>
      )}
    </Drawer>
  )
}
