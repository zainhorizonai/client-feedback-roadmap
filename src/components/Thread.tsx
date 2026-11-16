import { fmtDateTime } from './ui'
import type { HistoryEntry } from '../lib/types'

const who = { client: 'Client', admin: 'Team', system: 'System' } as const

export function Thread({ history }: { history: HistoryEntry[] }) {
  return (
    <ol className="space-y-3">
      {[...history].reverse().map((h, i) => {
        const bubble = h.kind === 'reply' || h.kind === 'comment'
        return (
          <li key={i} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${h.by === 'admin' ? 'bg-brand-500' : 'bg-slate-300'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500">{who[h.by]} · {fmtDateTime(h.at)}</div>
              {bubble ? (
                <p className={`mt-1 whitespace-pre-wrap rounded-lg px-3 py-2 ${h.by === 'admin' ? 'bg-brand-50 text-slate-800' : 'bg-slate-100 text-slate-800'}`}>{h.text}</p>
              ) : (
                <p className="text-slate-700">{h.text}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
