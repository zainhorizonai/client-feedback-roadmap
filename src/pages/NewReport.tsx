import { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bug, CheckCircle2, ClipboardCheck, HelpCircle, Lightbulb, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useClientProject } from '../lib/clientProject'
import { ApiError } from '../lib/api'
import { createReport } from '../lib/store'
import { hasSeverity, SEVERITIES, type Kind, type Severity } from '../lib/types'
import { Recorder } from '../components/Recorder'
import { Button, ButtonLink, Field, Mono, SeamDivider } from '../components/ui'

const OPTIONS: { kind: Kind; icon: LucideIcon; hint: string; param: string }[] = [
  { kind: 'Bug', icon: Bug, hint: 'Something is broken', param: 'bug' },
  { kind: 'UAT finding', icon: ClipboardCheck, hint: 'Found while testing', param: 'uat' },
  { kind: 'Feature request', icon: Lightbulb, hint: 'An idea or change', param: 'feature' },
  { kind: 'Question', icon: HelpCircle, hint: 'Something to ask us', param: 'question' },
]

const COPY: Record<Kind, { title: string; placeholder: string; detail: string; videoTitle: string; videoHint: string }> = {
  Bug: { title: 'Report a bug', placeholder: 'For example: Save button does nothing', detail: 'What did you expect to happen?', videoTitle: 'Show us the problem', videoHint: 'A short recording is the fastest way for us to see it. Show your screen, your camera or both, and talk us through it.' },
  'UAT finding': { title: 'Report a UAT finding', placeholder: 'For example: Total is wrong on the invoice screen', detail: 'What did you expect to happen?', videoTitle: 'Show us what you found', videoHint: 'A short recording helps us repeat the test. Show your screen, your camera or both.' },
  'Feature request': { title: 'Request a feature', placeholder: 'For example: Export reports to CSV', detail: 'What would this help you do?', videoTitle: 'Show us what you mean (optional)', videoHint: 'Only if it helps. Text alone is fine.' },
  Question: { title: 'Ask a question', placeholder: 'For example: How do I add a new user?', detail: 'Tell us more', videoTitle: 'Show us (optional)', videoHint: 'Only if it helps. Text alone is fine.' },
}

export function NewReport() {
  const nav = useNavigate()
  const { maxVideoMb } = useAuth()
  const { projects, selectedId } = useClientProject()
  const [projectId, setProjectId] = useState(selectedId)
  const [params] = useSearchParams()
  const [kind, setKind] = useState<Kind>(OPTIONS.find((o) => o.param === params.get('type'))?.kind ?? 'Bug')
  const [video, setVideo] = useState<Blob | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [doneId, setDoneId] = useState<string | null>(null)
  const [titleError, setTitleError] = useState('')
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const copy = COPY[kind]
  // Ideas and questions go on the client's roadmap. Bugs and UAT findings go to the fix list.
  const onRoadmap = kind === 'Feature request' || kind === 'Question'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return // never send twice
    if (!title.trim()) {
      setTitleError('Enter a title so we know what this is about.')
      titleRef.current?.focus()
      return
    }
    setBusy(true)
    setProgress(0)
    setError('')
    try {
      const r = await createReport({ clientId: projectId, title: title.trim(), description: description.trim(), pageUrl: pageUrl.trim(), severity: hasSeverity(kind) ? severity : 'Medium', kind }, video, setProgress)
      setDoneId(r.id)
    } catch (err) {
      // Everything they typed, and the video, stay in place so Retry is one click.
      setError(err instanceof ApiError ? err.message : 'It did not send. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (doneId) {
    return (
      <div className="mx-auto max-w-md pt-6">
        <div className="overflow-hidden rounded-card border border-line bg-surface text-center">
          <SeamDivider />
          <div className="p-6" role="status">
            <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--seam-success-fg)]" aria-hidden="true" />
            <h1 className="mt-3 font-semibold">{onRoadmap ? 'Added to your roadmap' : 'Report received'}</h1>
            <p className="mt-2 text-muted">Your reference is <Mono className="font-semibold text-ink">{doneId}</Mono>. {onRoadmap ? 'You can follow it and move it between stages on your roadmap.' : 'We will update you here and by email.'}</p>
            <div className="mt-5 flex flex-col items-center gap-2">
              <Button onClick={() => nav(`/reports/${doneId}`)}>View</Button>
              <ButtonLink to="/reports" variant="tertiary">Back to my items</ButtonLink>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const videoFirst = kind === 'Bug' || kind === 'UAT finding'
  const videoSection = (
    <section aria-labelledby="video-h">
      <h2 id="video-h" className="font-semibold">{copy.videoTitle}</h2>
      <p className="mb-3 mt-1 text-muted">{copy.videoHint}</p>
      <Recorder blob={video} onChange={setVideo} maxMb={maxVideoMb} />
    </section>
  )

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/reports" className="mb-4 inline-flex min-h-9 items-center gap-1 text-muted"><ArrowLeft className="h-4 w-4" aria-hidden="true" />My items</Link>
      <h1 className="font-semibold">{copy.title}</h1>

      <form onSubmit={submit} noValidate className="mt-6 space-y-8">
        <fieldset>
          <legend className="mb-2 font-semibold">What are you sending us?</legend>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {OPTIONS.map((o) => (
              <label key={o.kind} className={`relative flex cursor-pointer flex-col rounded-card border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${kind === o.kind ? 'border-action bg-surface ring-2 ring-action' : 'border-line bg-surface hover:border-control'}`}>
                <input type="radio" name="kind" value={o.kind} checked={kind === o.kind} onChange={() => setKind(o.kind)} className="sr-only" />
                <o.icon className={`h-5 w-5 ${kind === o.kind ? 'text-action' : 'text-muted'}`} aria-hidden="true" />
                <span className="mt-2 font-semibold">{o.kind}</span>
                <span className="text-sm text-muted">{o.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {projects.length > 1 && (
          <section className="rounded-card border border-line bg-surface p-4">
            <Field label="Project" hint="Which of your projects is this for?" required>
              <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </section>
        )}

        {videoFirst && videoSection}

        <section aria-labelledby="details-h" className="space-y-4">
          <h2 id="details-h" className="font-semibold">Details</h2>
          <Field label="Title" required error={titleError}>
            <input ref={titleRef} className="input" maxLength={120} value={title} aria-invalid={!!titleError} placeholder={copy.placeholder} onChange={(e) => { setTitle(e.target.value); if (titleError) setTitleError('') }} />
          </Field>
          <Field label={copy.detail}>
            <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className={`grid gap-4 ${hasSeverity(kind) ? 'sm:grid-cols-2' : ''}`}>
            <Field label="Page or link" hint="Optional. Where did this happen?">
              <input className="input" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://…" />
            </Field>
            {hasSeverity(kind) && (
              <Field label="Severity" hint="How much does it get in your way?">
                <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
                  {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            )}
          </div>
        </section>

        {!videoFirst && videoSection}

        {busy && video && (
          <div role="progressbar" aria-label="Uploading video" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-action transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-card bg-[var(--seam-error-bg)] p-3 text-[var(--seam-error-fg)]">
            <p className="font-semibold">It did not send</p>
            <p>{error} Your details and video are still here. Press Try again to send it.</p>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
          <Button type="submit" pending={busy}>{busy ? (video ? `Uploading ${Math.round(progress * 100)}%` : 'Sending') : error ? 'Try again' : 'Send'}</Button>
        </div>
      </form>
    </div>
  )
}
