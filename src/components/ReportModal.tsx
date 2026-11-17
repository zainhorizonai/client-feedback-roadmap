import { useEffect, useState } from 'react'
import { Clock, Link2, Lock, Send } from 'lucide-react'
import { videoStamp, type PageContext } from '../lib/environment'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { addReply, assign, setStatus, updateFields, useReports } from '../lib/store'
import { useTeam } from '../lib/team'
import { similarTo } from '../lib/similar'
import { updateItem, useRoadmap } from '../lib/roadmap'
import { hasSeverity, KINDS, SEVERITIES, STATUSES, type Kind, type Report, type Severity, type Status } from '../lib/types'
import { Conversation, History } from './Activity'
import { Block, Button, Field, fmtDateTime, KindTag, Modal, ModalSplit, Mono, SeverityBadge, StatusBadge, VideoEvidence } from './ui'

/** The one report view used from the Inbox, the Tracker and the Roadmap: a large dialog, like a task view. */
export function ReportModal({ report, onClose }: { report: Report; onClose: () => void }) {
  return (
    <Modal
      size="xl"
      title={report.title}
      onClose={onClose}
      eyebrow={<><Mono>{report.id}</Mono><span aria-hidden="true">·</span><span>{report.clientName}</span><span aria-hidden="true">·</span><span>{report.reporterName}</span><span aria-hidden="true">·</span><Mono>{fmtDateTime(report.createdAt)}</Mono></>}
    >
      <ReportBody report={report} />
    </Modal>
  )
}

/** Where and how it happened: the browser, and (with the page snippet) what the page logged. Rendered only as text. */
function ContextBlocks({ ctx }: { ctx: PageContext }) {
  const env = Object.entries(ctx.env ?? {}).filter(([, v]) => v)
  const logs = ctx.logs ?? []
  const net = ctx.network ?? []
  const errors = logs.filter((l) => l.level === 'error').length
  const NAMES: Record<string, string> = { browser: 'Browser', os: 'System', device: 'Device', viewport: 'Window', screen: 'Screen', language: 'Language', timezone: 'Time zone', pixelRatio: 'Pixel ratio' }
  return (
    <Block title="Where it happened" hint={ctx.source === 'widget' ? 'Captured from the page the client was on.' : 'Captured from the browser the client sent this from.'}>
      {ctx.page && <p className="mb-2 break-all text-sm"><a href={/^https?:\/\//.test(ctx.page) ? ctx.page : undefined} target="_blank" rel="noreferrer">{ctx.page}</a></p>}
      {env.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {env.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{NAMES[k] ?? k}</dt><dd className="font-mono">{v}</dd></div>))}
        </dl>
      )}
      {logs.length > 0 && (
        <details className="mt-3 rounded-control border border-line bg-surface" open={errors > 0}>
          <summary className="cursor-pointer px-3 py-2 font-semibold">Console · {logs.length} {logs.length === 1 ? 'message' : 'messages'}{errors > 0 && <span className="ml-2 badge badge-error">{errors} {errors === 1 ? 'error' : 'errors'}</span>}</summary>
          <ol className="max-h-60 overflow-auto border-t border-line px-3 py-2 font-mono text-xs">
            {logs.map((l, i) => (<li key={i} className={`break-words py-0.5 ${l.level === 'error' ? 'text-[var(--seam-error-fg)]' : l.level === 'warn' ? 'text-[var(--seam-warning-fg)]' : ''}`}><span className="text-muted">{l.t} {l.level}</span> {l.msg}</li>))}
          </ol>
        </details>
      )}
      {net.length > 0 && (
        <details className="mt-3 rounded-control border border-line bg-surface" open>
          <summary className="cursor-pointer px-3 py-2 font-semibold">Failed requests · {net.length}</summary>
          <ol className="max-h-60 overflow-auto border-t border-line px-3 py-2 font-mono text-xs">
            {net.map((n, i) => (<li key={i} className="break-all py-0.5"><span className="text-muted">{n.t}</span> {n.method} {n.url} <strong className="text-[var(--seam-error-fg)]">{n.status === 0 ? 'no response' : n.status}</strong> <span className="text-muted">{n.ms} ms</span></li>))}
          </ol>
        </details>
      )}
    </Block>
  )
}

function ReportBody({ report }: { report: Report }) {
  const items = useRoadmap()
  const { user } = useAuth()
  const team = useTeam()
  const all = useReports()
  const [, setParams] = useSearchParams()
  const duplicates = similarTo(report.title, all, report.clientId, report.id)
  const [reply, setReply] = useState('')
  // After sending, the status can move too. Left alone it follows the reply: a question waits for the client.
  const [chosen, setChosen] = useState<Status | null>(null)
  const auto: Status = reply.includes('?') ? 'Needs client input' : report.status === 'New' ? 'Triaging' : report.status
  const afterStatus = chosen ?? auto
  const [sending, setSending] = useState(false)
  const [notes, setNotes] = useState(report.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [resolution, setResolution] = useState(report.resolutionUrl)
  const [savingRes, setSavingRes] = useState(false)
  const [linking, setLinking] = useState('')

  // Switching to another report resets the drafts. Edits to the same report keep them.
  useEffect(() => { setNotes(report.notes ?? ''); setResolution(report.resolutionUrl); setReply(''); setChosen(null) }, [report.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const linked = report.roadmapItems ?? []
  const linkable = items.filter((i) => i.clientId === report.clientId && !linked.some((l) => l.id === i.id))

  async function send() {
    setSending(true)
    if (await addReply(report.id, reply, afterStatus)) { setReply(''); setChosen(null) }
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

  const main = (
    <>
      <VideoEvidence src={report.hasVideo ? `/api/reports/${report.id}/video` : null} title={`Video for ${report.title}`} />

      {(report.description || report.pageUrl) && (
        <Block title="What the client said">
          {report.description && <p className="whitespace-pre-wrap break-words">{report.description}</p>}
          {report.pageUrl && <p className="mt-2 break-all text-sm text-muted">{report.pageUrl}</p>}
        </Block>
      )}

      {report.context && <ContextBlocks ctx={report.context} />}

      <Block title="Shared replies" hint="The client sees these and is emailed.">
        <Conversation history={report.history} viewer="admin" />
        <div className="mt-3">
          <Field label="Shared reply">
            <textarea className="input" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
          </Field>
          <div className="mt-2 flex flex-wrap items-end justify-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Then set status to</span>
              <select className="input !w-auto" value={afterStatus} onChange={(e) => setChosen(e.target.value as Status)}>
                {STATUSES.map((st) => <option key={st} value={st}>{st === report.status ? `${st} (no change)` : st}</option>)}
              </select>
            </label>
            {report.hasVideo && <Button variant="tertiary" onClick={() => { const t = videoStamp(); if (t) setReply((r) => `${r}${r && !r.endsWith(' ') && !r.endsWith('\n') ? ' ' : ''}${t} `) }}><Clock className="h-4 w-4" aria-hidden="true" />Add video time</Button>}
            <Button onClick={send} pending={sending} disabled={!reply.trim()}><Send className="h-4 w-4" aria-hidden="true" /> Send reply</Button>
          </div>
        </div>
      </Block>

      <Block title="History"><History history={report.history} /></Block>
    </>
  )

  const side = (
    <>
      <div className="space-y-3">
        <Field label="Status">
          <select className="input" value={report.status} onChange={(e) => setStatus(report.id, e.target.value as Status)}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Assigned to">
          <select className="input" value={report.assignee?.id ?? ''} onChange={(e) => assign(report.id, e.target.value, team.find((t) => t.id === e.target.value)?.name ?? '')}>
            <option value="">Unassigned</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === user?.id ? ' (you)' : ''}</option>)}
          </select>
        </Field>
        {user && report.assignee?.id !== user.id && <Button variant="secondary" className="!min-h-9" onClick={() => assign(report.id, user.id, user.name)}>Assign to me</Button>}
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
      <p className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={report.status} />{hasSeverity(report.kind) && <SeverityBadge severity={report.severity} />}<KindTag kind={report.kind} /></p>

      {duplicates.length > 0 && (
        <Block title="Possible duplicates" hint="Open items in this project with a similar title.">
          <ul className="space-y-1.5">
            {duplicates.map((d) => (
              <li key={d.id}><button type="button" onClick={() => setParams({ report: d.id }, { replace: true })} className="flex w-full items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2 text-left hover:bg-canvas"><span className="min-w-0 truncate"><Mono className="text-sm text-muted">{d.id}</Mono> {d.title}</span><span className="shrink-0 text-sm text-muted">{d.status}</span></button></li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Related roadmap work">
        {linked.length === 0 ? <p className="text-muted">Not linked to any roadmap item.</p> : (
          <ul className="space-y-1.5">
            {linked.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2">
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
      </Block>

      <section className="mt-6 rounded-card border border-dashed border-control bg-subtle/50 p-4">
        <h3 className="mb-1.5 flex items-center gap-2 font-semibold"><Lock className="h-4 w-4" aria-hidden="true" />Internal note</h3>
        <p className="mb-2 text-sm text-muted">Only your team can see this. It is never emailed or exported.</p>
        <Field label="Internal note">
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" disabled={notes === (report.notes ?? '')} onClick={() => setNotes(report.notes ?? '')}>Cancel</Button>
          <Button onClick={saveNotes} pending={savingNotes} disabled={notes === (report.notes ?? '')}>Save note</Button>
        </div>
      </section>

      <Block title="Resolution evidence">
        <Field label="Resolution video link" hint="Shown to the client. Paste a link to a short video of the fix.">
          <input className="input" inputMode="url" placeholder="https://…" value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" disabled={resolution === report.resolutionUrl} onClick={() => setResolution(report.resolutionUrl)}>Cancel</Button>
          <Button onClick={saveResolution} pending={savingRes} disabled={resolution === report.resolutionUrl}>Save link</Button>
        </div>
      </Block>
    </>
  )

  return <ModalSplit main={main} side={side} />
}
