import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bug, CheckCircle2, ClipboardCheck, HelpCircle, Lightbulb, type LucideIcon } from 'lucide-react'
import { ApiError } from '../lib/api'
import { createReport } from '../lib/store'
import { hasSeverity, SEVERITIES, type Kind, type Severity } from '../lib/types'
import { Recorder } from '../components/Recorder'
import { btnPrimary, btnSecondary, inputCls } from '../components/ui'

const KIND_OPTIONS: { kind: Kind; icon: LucideIcon; label: string; hint: string; param: string }[] = [
  { kind: 'Bug', icon: Bug, label: 'Bug', hint: 'Something is broken', param: 'bug' },
  { kind: 'UAT finding', icon: ClipboardCheck, label: 'UAT finding', hint: 'Found while testing', param: 'uat' },
  { kind: 'Feature request', icon: Lightbulb, label: 'Feature request', hint: 'An idea or change', param: 'feature' },
  { kind: 'Question', icon: HelpCircle, label: 'Question', hint: 'Something to ask us', param: 'question' },
]

const COPY: Record<Kind, { title: string; titlePlaceholder: string; detail: string; video: string }> = {
  Bug: { title: 'Report a bug', titlePlaceholder: 'e.g. Save button does nothing', detail: 'What did you expect to happen?', video: 'Show us the problem (recommended)' },
  'UAT finding': { title: 'Report a UAT finding', titlePlaceholder: 'e.g. Total is wrong on the invoice screen', detail: 'What did you expect to happen?', video: 'Show us what you found (recommended)' },
  'Feature request': { title: 'Request a feature', titlePlaceholder: 'e.g. Export reports to CSV', detail: 'What would this help you do?', video: 'Show us what you mean (optional)' },
  Question: { title: 'Ask a question', titlePlaceholder: 'e.g. How do I add a new user?', detail: 'Tell us more', video: 'Show us (optional)' },
}

export function NewReport() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const initial = KIND_OPTIONS.find((o) => o.param === params.get('type'))?.kind ?? 'Bug'
  const [kind, setKind] = useState<Kind>(initial)
  const [video, setVideo] = useState<Blob | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [doneId, setDoneId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const copy = COPY[kind]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setProgress(0)
    setError('')
    try {
      const r = await createReport({ title: title.trim(), description: description.trim(), pageUrl: pageUrl.trim(), severity: hasSeverity(kind) ? severity : 'Medium', kind }, video, setProgress)
      setDoneId(r.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (doneId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-4 text-2xl font-semibold">Sent</h1>
        <p className="mt-2 text-slate-600">
          Thanks. Your {kind.toLowerCase()} is <span className="font-mono font-medium">{doneId}</span>. We have been emailed and will update you here and by email.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button className={btnPrimary} onClick={() => nav(`/reports/${doneId}`)}>View it</button>
          <Link to="/reports" className={btnSecondary}>All my items</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link to="/reports" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> My items</Link>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">What are you sending us?</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KIND_OPTIONS.map((o) => (
              <button
                key={o.kind}
                type="button"
                onClick={() => setKind(o.kind)}
                aria-pressed={kind === o.kind}
                className={`rounded-xl border p-3 text-left transition ${kind === o.kind ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                <o.icon className={`h-5 w-5 ${kind === o.kind ? 'text-brand-600' : 'text-slate-400'}`} />
                <div className="mt-1.5 text-sm font-medium">{o.label}</div>
                <div className="text-xs text-slate-500">{o.hint}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Details</h2>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Title <span className="text-red-500">*</span></span>
            <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={copy.titlePlaceholder} className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">{copy.detail}</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </label>
          <div className={`grid gap-4 ${hasSeverity(kind) ? 'sm:grid-cols-2' : ''}`}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Page or feature <span className="font-normal text-slate-500">(optional)</span></span>
              <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://… or feature name" className={inputCls} />
            </label>
            {hasSeverity(kind) && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Severity</span>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className={inputCls}>
                  {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{copy.video}</h2>
          <Recorder blob={video} onChange={setVideo} />
          {!video && <p className="mt-2 text-xs text-slate-500">You can skip this and send it without a video.</p>}
        </section>

        {busy && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-end">
          <button type="submit" disabled={!title.trim() || busy} className={btnPrimary}>
            {busy ? (video ? `Uploading ${Math.round(progress * 100)}%` : 'Sending…') : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
