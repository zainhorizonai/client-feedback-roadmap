import { ArrowRight, CheckCircle2, Circle, RotateCcw } from 'lucide-react'
import type { HistoryEntry } from '../lib/types'
import { fmtDateTime, Mono } from './ui'

/** The shared conversation between the client and the team. Internal notes never appear here. */
export function Conversation({ history, viewer }: { history: HistoryEntry[]; viewer: 'client' | 'admin' }) {
  const messages = history.filter((h) => h.kind === 'reply' || h.kind === 'comment')
  if (messages.length === 0) return <p className="text-muted">No messages yet.</p>
  return (
    <ol className="space-y-3">
      {messages.map((m, i) => {
        const mine = m.by === viewer
        const who = m.by === 'admin' ? (viewer === 'admin' ? 'You' : 'SEAM team') : viewer === 'client' ? 'You' : 'Client'
        return (
          <li key={i} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[92%] rounded-card px-3 py-2 ${m.by === 'admin' ? 'bg-forest text-cream' : 'border border-line bg-surface'}`}>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
            </div>
            <p className="mt-1 text-xs text-muted">{who} · <Mono>{fmtDateTime(m.at)}</Mono></p>
          </li>
        )
      })}
    </ol>
  )
}

/** Chronological record of what happened to a report: who changed what, and when. */
export function History({ history }: { history: HistoryEntry[] }) {
  const events = history.filter((h) => h.kind !== 'reply' && h.kind !== 'comment')
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {events.map((e, i) => {
        const outcome = e.kind === 'outcome'
        const failed = outcome && e.text.startsWith('Still broken')
        const Icon = failed ? RotateCcw : outcome ? CheckCircle2 : Circle
        return (
          <li key={i} className="relative">
            <span className={`absolute -left-[1.6rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-canvas ${failed ? 'text-[var(--seam-error-fg)]' : outcome ? 'text-[var(--seam-success-fg)]' : 'text-muted'}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            {e.kind === 'status' && e.from && e.to ? (
              <p className="flex flex-wrap items-center gap-1.5">
                <span>{e.from}</span><ArrowRight className="h-3.5 w-3.5 text-muted" aria-label="to" /><span className="font-semibold">{e.to}</span>
              </p>
            ) : (
              <p className={outcome ? 'font-semibold' : ''}>{e.text}</p>
            )}
            <p className="text-xs text-muted">{e.by === 'admin' ? 'SEAM team' : e.by === 'client' ? 'Client' : 'System'} · <Mono>{fmtDateTime(e.at)}</Mono></p>
          </li>
        )
      })}
    </ol>
  )
}
