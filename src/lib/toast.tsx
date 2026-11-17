import { useSyncExternalStore } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

interface Toast { id: number; text: string; kind: 'info' | 'error' }
let toasts: Toast[] = []
let next = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function notify(text: string, kind: Toast['kind'] = 'info') {
  const id = next++
  toasts = [...toasts, { id, text, kind }]
  emit()
  // Errors stay longer so they can be read.
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, kind === 'error' ? 9000 : 5000)
}

/** A polite live region: saves, exports and upload errors are announced to screen readers. */
export function Toasts() {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => toasts)
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-end gap-2 md:inset-x-auto md:right-4 md:bottom-4">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : undefined}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-card px-4 py-3 text-sm shadow-lg md:w-auto ${t.kind === 'error' ? 'bg-[#7f1d1d] text-white' : 'bg-white text-[#0c0e0f]'}`}
        >
          {t.kind === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
