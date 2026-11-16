import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ExternalLink, MessageCircleQuestion, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { addClientComment, clientConfirm, useReports, useReportsLoaded } from '../lib/store'
import { hasSeverity } from '../lib/types'
import { Conversation, History } from '../components/Activity'
import { Button, ButtonLink, Field, fmtDateTime, KindTag, Mono, SeverityBadge, Skeleton, StatusBadge, VideoEvidence } from '../components/ui'

export function ReportDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const report = useReports().find((r) => r.id === id && r.clientId === user?.clientId)
  const loaded = useReportsLoaded()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [deciding, setDeciding] = useState<'fixed' | 'broken' | null>(null)

  if (!report && !loaded) return <Skeleton rows={4} />
  if (!report) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-semibold">We could not find that report</h1>
        <p className="mt-2 text-muted">It may belong to another project, or the link may be wrong.</p>
        <ButtonLink to="/reports" variant="secondary" className="mt-4">Back to my reports</ButtonLink>
      </div>
    )
  }

  async function send() {
    setSending(true)
    if (await addClientComment(report!.id, message)) setMessage('')
    setSending(false)
  }
  async function decide(fixed: boolean) {
    setDeciding(fixed ? 'fixed' : 'broken')
    if (await clientConfirm(report!.id, fixed, note)) { setAsking(false); setNote('') }
    setDeciding(null)
  }

  const verify = report.status === 'Ready to verify'
  const needsInput = report.status === 'Needs client input'

  return (
    <div>
      <Link to="/reports" className="mb-4 inline-flex min-h-9 items-center gap-1 text-muted"><ArrowLeft className="h-4 w-4" aria-hidden="true" />My reports</Link>
      <header className="mb-6">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><Mono>{report.id}</Mono><span aria-hidden="true">·</span><span>Submitted <Mono>{fmtDateTime(report.createdAt)}</Mono></span></p>
        <h1 className="mt-1 break-words font-semibold">{report.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={report.status} /><KindTag kind={report.kind} />{hasSeverity(report.kind) && <SeverityBadge severity={report.severity} />}</p>
      </header>

      {verify && (
        <section aria-labelledby="verify-h" className="mb-6 rounded-card border border-[var(--seam-verify-fg)]/30 bg-[var(--seam-verify-bg)] p-4">
          <h2 id="verify-h" className="font-semibold text-[var(--seam-verify-fg)]">The fix is ready</h2>
          <p className="mt-1">Try it again and tell us if it works.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => decide(true)} pending={deciding === 'fixed'} disabled={deciding === 'broken'}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Confirm fixed</Button>
            <Button variant="secondary" onClick={() => setAsking(true)} disabled={!!deciding} aria-expanded={asking}><XCircle className="h-4 w-4" aria-hidden="true" />Still broken</Button>
          </div>
          {asking && (
            <div className="mt-4">
              <Field label="What is still going wrong?" hint="A short note helps us fix it faster.">
                <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </Field>
              <div className="mt-2 flex gap-2">
                <Button onClick={() => decide(false)} pending={deciding === 'broken'}>Send note</Button>
                <Button variant="tertiary" onClick={() => { setAsking(false); setNote('') }}>Cancel</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {needsInput && (
        <section aria-labelledby="needs-h" className="mb-6 flex gap-3 rounded-card border border-[var(--seam-warning-fg)]/30 bg-[var(--seam-warning-bg)] p-4">
          <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-[var(--seam-warning-fg)]" aria-hidden="true" />
          <div>
            <h2 id="needs-h" className="font-semibold text-[var(--seam-warning-fg)]">We need something from you</h2>
            <p className="mt-1">Read our last message below and reply so we can carry on.</p>
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {report.hasVideo && <section aria-labelledby="orig-h"><h2 id="orig-h" className="mb-2 font-semibold">Your video</h2><VideoEvidence src={`/api/reports/${report.id}/video`} title={`Your video for ${report.title}`} /></section>}
          {report.description && <section aria-labelledby="desc-h"><h2 id="desc-h" className="mb-2 font-semibold">Details</h2><p className="whitespace-pre-wrap break-words">{report.description}</p>{report.pageUrl && <p className="mt-2 break-all text-sm text-muted">{report.pageUrl}</p>}</section>}
          {report.resolutionUrl && (
            <section aria-labelledby="res-h" className="rounded-card border border-line bg-surface p-4">
              <h2 id="res-h" className="font-semibold">From the team</h2>
              <p className="mt-1 text-muted">A short video showing the fix.</p>
              <a href={report.resolutionUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-9 items-center gap-1 font-semibold">Watch the resolution video<ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
            </section>
          )}
          <section aria-labelledby="hist-h"><h2 id="hist-h" className="mb-3 font-semibold">History</h2><History history={report.history} /></section>
        </div>

        <section aria-labelledby="conv-h" className="lg:col-span-2">
          <h2 id="conv-h" className="mb-3 font-semibold">Conversation</h2>
          <Conversation history={report.history} viewer="client" />
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (message.trim()) send() }}>
            <Field label="Add a message"><textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
            <div className="mt-2 flex justify-end"><Button type="submit" pending={sending} disabled={!message.trim()}>Send message</Button></div>
          </form>
        </section>
      </div>
    </div>
  )
}
