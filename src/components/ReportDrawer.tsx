import { useEffect, useState } from 'react'
import { Link2, Lock, Send } from 'lucide-react'
import { addReply, setStatus, updateFields } from '../lib/store'
import { updateItem, useRoadmap } from '../lib/roadmap'
import { hasSeverity, KINDS, SEVERITIES, STATUSES, type Kind, type Report, type Severity, type Status } from '../lib/types'
import { Conversation, History } from './Activity'
import { Button, Drawer, Field, fmtDateTime, KindTag, Mono, SeverityBadge, StatusBadge, VideoEvidence } from './ui'

/** The one report detail used from the Inbox, the Tracker and the Roadmap. */
export function ReportDrawer({ report, onClose }: { report: Report; onClose: () => void }) {
  return (
    <Drawer title={report.title} onClose={onClose}>
      <ReportBody report={report} />
    </Drawer>
  )
}

function Section({ title, children, tone = 'plain' }: { title: string; children: React.ReactNode; tone?: 'plain' | 'private' }) {
  return (
    <section className={`mt-7 ${tone === 'private' ? 'rounded-card border border-dashed border-control bg-subtle/50 p-4' : ''}`}>
      <h3 className="mb-2 flex items-center gap-2 font-semibold">{tone === 'private' && <Lock className="h-4 w-4" aria-hidden="true" />}{title}</h3>
      {children}
    </section>
  )
}

function ReportBody({ report }: { report: Report }) {
  const items = useRoadmap()
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [notes, setNotes] = useState(report.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [resolution, setResolution] = useState(report.resolutionUrl)
  const [savingRes, setSavingRes] = useState(false)
  const [linking, setLinking] = useState('')

  // Switching to another report resets the drafts. Edits to the same report keep them.
  useEffect(() => { setNotes(report.notes ?? ''); setResolution(report.resolutionUrl); setReply('') }, [report.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const linked = report.roadmapItems ?? []
  const linkable = items.filter((i) => i.clientId === report.clientId && !linked.some((l) => l.id === i.id))

  async function send() {
    setSending(true)
    if (await addReply(report.id, reply)) setReply('')
    setSending(false)
  }
  async function saveNotes() { setSavingNotes(true); await updateFields(report.id, { notes }); setSavingNotes(false) }
  async function saveResolution() { setSavingRes(true); await updateFields(report.id, { resolutionUrl: resolution.trim() }); setSavingRes(false) }
  async function link(itemId: string) {
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    setLinking(itemId)
    await updateItem(itemId, { reportIds: [...(item.reports ?? []).map((r) => r.id), report.id] }, `Linked to ${item.title}.`)
    setLinking('')
  }

  return (
    <div className="-mt-1">
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Mono>{report.id}</Mono><span aria-hidden="true">·</span><span>{report.clientName}</span><span aria-hidden="true">·</span>
        <span>{report.reporterName}</span><span aria-hidden="true">·</span><Mono>{fmtDateTime(report.createdAt)}</Mono>
      </p>

      <VideoEvidence src={report.hasVideo ? `/api/reports/${report.id}/video` : null} title={`Video for ${report.title}`} />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Status">
          <select className="input" value={report.status} onChange={(e) => setStatus(report.id, e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select className="input" value={report.kind} onChange={(e) => updateFields(report.id, { kind: e.target.value as Kind })}>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </Field>
        {hasSeverity(report.kind) && (
          <Field label="Severity">
            <select className="input" value={report.severity} onChange={(e) => updateFields(report.id, { severity: e.target.value as Severity })}>
              {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        )}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={report.status} />{hasSeverity(report.kind) && <SeverityBadge severity={report.severity} />}<KindTag kind={report.kind} /></p>

      {(report.description || report.pageUrl) && (
        <Section title="What the client said">
          {report.description && <p className="whitespace-pre-wrap break-words">{report.description}</p>}
          {report.pageUrl && <p className="mt-2 break-all text-sm text-muted">{report.pageUrl}</p>}
        </Section>
      )}

      <Section title="Related roadmap work">
        {linked.length === 0 ? <p className="text-muted">Not linked to any roadmap item.</p> : (
          <ul className="space-y-1.5">
            {linked.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-control border border-line px-3 py-2">
                <span className="flex min-w-0 items-center gap-2"><Link2 className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" /><span className="truncate">{i.title}</span></span>
                <span className="shrink-0 text-sm text-muted">{i.state}</span>
              </li>
            ))}
          </ul>
        )}
        {linkable.length > 0 && (
          <div className="mt-2">
            <Field label="Link to a roadmap item">
              <select className="input" value="" disabled={!!linking} onChange={(e) => e.target.value && link(e.target.value)}>
                <option value="">Choose an item…</option>
                {linkable.map((i) => <option key={i.id} value={i.id}>{i.title} ({i.state})</option>)}
              </select>
            </Field>
          </div>
        )}
      </Section>

      <Section title="Shared replies">
        <p className="mb-3 text-sm text-muted">The client sees these and is emailed.</p>
        <Conversation history={report.history} viewer="admin" />
        <div className="mt-3">
          <Field label="Shared reply">
            <textarea className="input" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
          </Field>
          <div className="mt-2 flex justify-end">
            <Button onClick={send} pending={sending} disabled={!reply.trim()}><Send className="h-4 w-4" aria-hidden="true" /> Send reply</Button>
          </div>
        </div>
      </Section>

      <Section title="Internal note" tone="private">
        <p className="mb-2 text-sm text-muted">Only your team can see this. It is never emailed or exported.</p>
        <Field label="Internal note">
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" disabled={notes === (report.notes ?? '')} onClick={() => setNotes(report.notes ?? '')}>Cancel</Button>
          <Button onClick={saveNotes} pending={savingNotes} disabled={notes === (report.notes ?? '')}>Save note</Button>
        </div>
      </Section>

      <Section title="Resolution evidence">
        <Field label="Resolution video link" hint="Shown to the client. Paste a link to a short video of the fix.">
          <input className="input" inputMode="url" placeholder="https://…" value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" disabled={resolution === report.resolutionUrl} onClick={() => setResolution(report.resolutionUrl)}>Cancel</Button>
          <Button onClick={saveResolution} pending={savingRes} disabled={resolution === report.resolutionUrl}>Save link</Button>
        </div>
      </Section>

      <Section title="History"><History history={report.history} /></Section>
    </div>
  )
}
