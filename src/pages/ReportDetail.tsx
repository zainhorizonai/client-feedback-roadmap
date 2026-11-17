import { useState } from 'react'
import { Clock, CheckCircle2, ExternalLink, MessageCircleQuestion, Pencil, RotateCcw, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { addClientComment, approveReport, clientConfirm, reopenReport, updateDetails, useReports, useReportsLoaded } from '../lib/store'
import { moveItem, useRoadmap } from '../lib/roadmap'
import { hasSeverity, ROADMAP_STATES, type RoadmapState } from '../lib/types'
import { Conversation, History } from '../components/Activity'
import { videoStamp } from '../lib/environment'
import { Block, Button, Field, fmtDateTime, KindTag, Modal, ModalSplit, Mono, SeverityBadge, StageBadge, ClientStatusBadge, VideoEvidence } from '../components/ui'

/** A client's view of one item: a large dialog over their list, like a task view. */
export function ReportDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth()
  const report = useReports().find((r) => r.id === id && !!user?.projects.some((p) => p.id === r.clientId))
  const items = useRoadmap()
  const loaded = useReportsLoaded()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [deciding, setDeciding] = useState<'fixed' | 'broken' | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveNote, setApproveNote] = useState('')
  const [askApprove, setAskApprove] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', description: '', pageUrl: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [titleError, setTitleError] = useState('')
  const [askReopen, setAskReopen] = useState(false)
  const [reopenNote, setReopenNote] = useState('')
  const [reopening, setReopening] = useState(false)


  if (!report && !loaded) {
    return <Modal title="Loading" onClose={onClose}><div className="py-8 text-center text-muted" role="status">Loading…</div></Modal>
  }
  if (!report) {
    return (
      <Modal title="We could not find that report" onClose={onClose}>
        <p className="text-muted">It may belong to another project, or the link may be wrong.</p>
        <Button variant="secondary" className="mt-4" onClick={onClose}>Back to my items</Button>
      </Modal>
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

  function startEdit() {
    setDraft({ title: report!.title, description: report!.description, pageUrl: report!.pageUrl })
    setTitleError('')
    setEditing(true)
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.title.trim()) { setTitleError('A ticket needs a title.'); return }
    setSavingEdit(true)
    if (await updateDetails(report!.id, { title: draft.title.trim(), description: draft.description.trim(), pageUrl: draft.pageUrl.trim() })) setEditing(false)
    setSavingEdit(false)
  }
  async function reopen() {
    setReopening(true)
    if (await reopenReport(report!.id, reopenNote)) { setAskReopen(false); setReopenNote('') }
    setReopening(false)
  }

  async function approve() {
    setApproving(true)
    if (await approveReport(report!.id, approveNote)) { setAskApprove(false); setApproveNote('') }
    setApproving(false)
  }

  // The roadmap card this request lives on, if it has one. Its stage can be changed from here.
  const card = items.find((i) => (i.reportIds ?? []).includes(report.id))
  const verify = report.status === 'Ready to verify'
  const needsInput = report.status === 'Needs client input'

  const main = (
    <>
      {editing && (
        <form onSubmit={saveEdit} noValidate aria-labelledby="edit-h" className="mb-6 space-y-4 rounded-card border border-line bg-canvas/60 p-4">
          <h3 id="edit-h" className="font-semibold">Edit details</h3>
          <Field label="Title" required error={titleError}><input className="input" maxLength={120} value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setTitleError('') }} autoFocus /></Field>
          <Field label="Description" hint="Add anything that helps: steps to repeat it, what you expected, who it affects."><textarea className="input" rows={5} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <Field label="Page or link"><input className="input" value={draft.pageUrl} placeholder="https://…" onChange={(e) => setDraft({ ...draft, pageUrl: e.target.value })} /></Field>
          <div className="flex gap-2"><Button type="submit" pending={savingEdit}>Save</Button><Button variant="tertiary" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      )}

      {report.hasVideo && <VideoEvidence src={`/api/reports/${report.id}/video`} title={`Your video for ${report.title}`} />}

      <Block title="Details">
        {report.description ? <p className="whitespace-pre-wrap break-words">{report.description}</p> : <p className="text-muted">No description yet. Use Edit details to add one.</p>}
        {report.pageUrl && <p className="mt-2 break-all text-sm text-muted">{report.pageUrl}</p>}
      </Block>

      {report.resolutionUrl && (
        <Block title="From the team" hint="A short video showing the fix.">
          <a href={report.resolutionUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 font-semibold">Watch the resolution video<ExternalLink className="h-4 w-4" aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span></a>
        </Block>
      )}

      <Block title="Notes and replies">
        <Conversation history={report.history} viewer="client" />
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); if (message.trim()) send() }}>
          <Field label="Add a note" hint="The team sees every note."><textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {report.hasVideo && <Button variant="tertiary" onClick={() => { const t = videoStamp(); if (t) setMessage((m) => `${m}${m && !m.endsWith(' ') && !m.endsWith('\n') ? ' ' : ''}${t} `) }}><Clock className="h-4 w-4" aria-hidden="true" />Add video time</Button>}
            <Button type="submit" pending={sending} disabled={!message.trim()}>Add note</Button>
          </div>
        </form>
      </Block>

      <Block title="History"><History history={report.history} /></Block>
    </>
  )

  const side = (
    <>
      <p className="flex flex-wrap items-center gap-2"><ClientStatusBadge status={report.status} /><KindTag kind={report.kind} />{hasSeverity(report.kind) && <SeverityBadge severity={report.severity} />}{card && <StageBadge stage={card.state} />}</p>

      {verify && (
        <section aria-labelledby="verify-h" className="mt-5 rounded-card border border-[var(--seam-verify-fg)]/30 bg-[var(--seam-verify-bg)] p-4">
          <h3 id="verify-h" className="font-semibold text-[var(--seam-verify-fg)]">The fix is ready</h3>
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
        <section aria-labelledby="needs-h" className="mt-5 flex gap-3 rounded-card border border-[var(--seam-warning-fg)]/30 bg-[var(--seam-warning-bg)] p-4">
          <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-[var(--seam-warning-fg)]" aria-hidden="true" />
          <div>
            <h3 id="needs-h" className="font-semibold text-[var(--seam-warning-fg)]">We need something from you</h3>
            <p className="mt-1">Read our last message and reply so we can carry on.</p>
          </div>
        </section>
      )}

      {report.status === 'Resolved' && (
        <Block title="This is done" hint="If it is not right after all, or it came back, you can reopen it. It goes back to the team.">
          {askReopen ? (
            <div>
              <Field label="What is wrong?" hint="Optional, but it helps."><textarea className="input" rows={3} value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} autoFocus /></Field>
              <div className="mt-2 flex gap-2"><Button onClick={reopen} pending={reopening}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reopen</Button><Button variant="tertiary" onClick={() => setAskReopen(false)}>Cancel</Button></div>
            </div>
          ) : <Button variant="secondary" onClick={() => setAskReopen(true)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Reopen</Button>}
        </Block>
      )}

      {!verify && report.status !== 'Resolved' && (
        <Block title="Is this done?" hint="If you are happy with it, or you no longer need it, you can approve it as done.">
          {askApprove ? (
            <div>
              <Field label="Add a note" hint="Optional."><textarea className="input" rows={2} value={approveNote} onChange={(e) => setApproveNote(e.target.value)} autoFocus /></Field>
              <div className="mt-2 flex gap-2"><Button onClick={approve} pending={approving}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve as done</Button><Button variant="tertiary" onClick={() => setAskApprove(false)}>Cancel</Button></div>
            </div>
          ) : <Button variant="secondary" onClick={() => setAskApprove(true)}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve as done</Button>}
        </Block>
      )}

      {card && (
        <Block title="On your roadmap" hint="Move it to where you think it belongs. The team is told.">
          <Field label="Stage"><select className="input" value={card.state} onChange={(e) => moveItem(card.id, e.target.value as RoadmapState)}>{ROADMAP_STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          {card.lastMove && <p className="mt-2 text-sm text-muted">{card.lastMove.text}, by {card.lastMove.by === 'client' ? 'you' : 'the team'} · <Mono>{fmtDateTime(card.lastMove.at)}</Mono></p>}
        </Block>
      )}
    </>
  )

  return (
    <Modal
      size="xl"
      title={report.title}
      onClose={onClose}
      eyebrow={<><Mono>{report.id}</Mono><span aria-hidden="true">·</span><span>Submitted <Mono>{fmtDateTime(report.createdAt)}</Mono></span></>}
      actions={!editing ? <Button variant="secondary" onClick={startEdit}><Pencil className="h-4 w-4" aria-hidden="true" />Edit details</Button> : undefined}
    >
      <ModalSplit main={main} side={side} />
    </Modal>
  )
}
