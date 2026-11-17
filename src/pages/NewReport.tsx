import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bug, ClipboardCheck, HelpCircle, Lightbulb, type LucideIcon } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useClientProject } from '../lib/clientProject'
import { ApiError } from '../lib/api'
import { createReport, useReports } from '../lib/store'
import { similarTo } from '../lib/similar'
import { clearDraft, clearDraftVideo, loadDraft, loadDraftVideo, saveDraft, saveDraftVideo } from '../lib/draft'
import { hasSeverity, type Kind } from '../lib/types'
import { Recorder } from '../components/Recorder'
import { Button, Field } from '../components/ui'
import { notify } from '../lib/toast'

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
  const { maxVideoMb, user } = useAuth()
  const userId = user?.id ?? ''
  const reports = useReports()
  // What they had typed last time, if they left before sending. Read once.
  const saved = useRef(loadDraft(userId)).current
  const [restored, setRestored] = useState(!!saved)
  const [retry, setRetry] = useState(0)
  const { projects, selectedId } = useClientProject()
  const [projectId, setProjectId] = useState(saved && projects.some((p) => p.id === saved.projectId) ? saved.projectId : selectedId)
  const [params] = useSearchParams()
  const [kind, setKind] = useState<Kind>(OPTIONS.find((o) => o.param === params.get('type'))?.kind ?? (saved?.kind as Kind | undefined) ?? 'Bug')
  const [video, setVideo] = useState<Blob | null>(null)
  const [title, setTitle] = useState(saved?.title ?? '')
  const [description, setDescription] = useState(saved?.description ?? '')
  const [pageUrl, setPageUrl] = useState(saved?.pageUrl ?? '')
  // Clients say whether this is stopping their work. The team sets the real severity when they triage.
  const [blocking, setBlocking] = useState(saved?.blocking ?? false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [titleError, setTitleError] = useState('')
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const copy = COPY[kind]

  // Keep what they type, and the video, so a refresh or a closed tab loses nothing.
  useEffect(() => {
    const t = setTimeout(() => saveDraft(userId, { kind, projectId, title, description, pageUrl, blocking }), 400)
    return () => clearTimeout(t)
  }, [userId, kind, projectId, title, description, pageUrl, blocking])
  useEffect(() => { if (saved) loadDraftVideo(userId).then((b) => b && setVideo((v) => v ?? b)) }, [userId, saved])
  const firstVideo = useRef(true)
  useEffect(() => {
    if (firstVideo.current) { firstVideo.current = false; if (!video) return }
    if (video) saveDraftVideo(userId, video); else clearDraftVideo(userId)
  }, [userId, video])
  function startFresh() {
    clearDraft(userId); clearDraftVideo(userId)
    setTitle(''); setDescription(''); setPageUrl(''); setBlocking(false); setVideo(null); setRestored(false)
  }
  // A gentle hint when something very like this is already open. It never stops them sending.
  const similar = title.trim().length >= 8 ? similarTo(title, reports, projectId) : []
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
    setRetry(0)
    setError('')
    try {
      const r = await createReport({ clientId: projectId, title: title.trim(), description: description.trim(), pageUrl: pageUrl.trim(), severity: hasSeverity(kind) && blocking ? 'High' : 'Medium', kind }, video, setProgress, setRetry)
      clearDraft(userId); clearDraftVideo(userId)
      // Straight to the item, over the list, so they can see it and add to it.
      notify(onRoadmap ? `Added to your roadmap as ${r.id}.` : `Sent as ${r.id}. We will update you here and by email.`)
      nav(`/reports/${r.id}`)
    } catch (err) {
      // Everything they typed, and the video, stay in place so Retry is one click.
      setError(err instanceof ApiError ? err.message : 'It did not send. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
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

      {restored && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-3">
          <p>We kept your unfinished {saved?.kind ? saved.kind.toLowerCase() : 'report'} from last time.</p>
          <Button variant="tertiary" onClick={startFresh}>Start fresh</Button>
        </div>
      )}

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
          {similar.length > 0 && (
            <div role="status" className="rounded-card border border-[var(--seam-warning-fg)]/30 bg-[var(--seam-warning-bg)] p-3">
              <p className="font-semibold text-[var(--seam-warning-fg)]">Something like this is already open</p>
              <p className="text-sm">You can add to it instead of sending a new one. Your draft stays here.</p>
              <ul className="mt-2 space-y-1">
                {similar.map((r) => <li key={r.id}><Link to={`/reports/${r.id}`} className="font-semibold"><span className="font-mono text-sm">{r.id}</span> {r.title}</Link></li>)}
              </ul>
            </div>
          )}
          <Field label={copy.detail}>
            <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Page or link" hint="Optional. Where did this happen?">
            <input className="input" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://…" />
          </Field>
          {hasSeverity(kind) && (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-card border border-line bg-surface p-3">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--seam-terracotta)]" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
              <span><span className="font-semibold">This is stopping us from working</span><span className="block text-sm text-muted">Tick it if we should look at this first.</span></span>
            </label>
          )}
        </section>

        {!videoFirst && videoSection}

        {busy && video && (
          <div role="progressbar" aria-label="Uploading video" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-action transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {busy && retry > 0 && <p role="status" className="text-sm text-muted">Your connection dropped. Trying again ({retry} of 3)…</p>}
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
