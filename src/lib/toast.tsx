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
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  }, 5000)
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l) },
    () => toasts,
  )
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} className={`flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.kind === 'error' ? 'bg-red-700' : 'bg-slate-900'}`}>
          {t.kind === 'error' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
