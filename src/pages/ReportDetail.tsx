import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { addClientComment, clientConfirm, useReports, useReportsLoaded } from '../lib/store'
import { VideoPlayer } from '../components/VideoPlayer'
import { Thread } from '../components/Thread'
import { hasSeverity } from '../lib/types'
import { btnPrimary, btnSecondary, fmtDate, inputCls, KindChip, SeverityChip, StageBadge, StatusBadge } from '../components/ui'

export function ReportDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const report = useReports().find((r) => r.id === id && r.clientId === user?.clientId)
  const loaded = useReportsLoaded()
  const [comment, setComment] = useState('')
  const [brokenNote, setBrokenNote] = useState('')
  const [askBroken, setAskBroken] = useState(false)

  if (!report && !loaded) return <p className="px-6 py-16 text-center text-slate-500">Loading…</p>
  if (!report) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-semibold">Report not found</h1>
        <Link to="/reports" className={`${btnSecondary} mt-4`}>Back to my items</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Link to="/reports" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> My items</Link>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="font-mono">{report.id}</span><span>·</span><span>{fmtDate(report.createdAt)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{report.title}</h1>
          <StatusBadge status={report.status} />
          <KindChip kind={report.kind} />
          {hasSeverity(report.kind) && <SeverityChip severity={report.severity} />}
          {report.roadmapStage && <StageBadge stage={report.roadmapStage} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          {report.hasVideo && <VideoPlayer reportId={report.id} hasVideo />}
          {report.description && <p className="whitespace-pre-wrap text-slate-700">{report.description}</p>}
          {report.pageUrl && <p className="flex items-center gap-1 text-sm text-slate-500"><ExternalLink className="h-3.5 w-3.5" /> {report.pageUrl}</p>}

          {report.resolutionUrl && (
            <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
              <p className="text-sm font-medium text-cyan-900">Fix demo from the team</p>
              <a href={report.resolutionUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700 underline">
                Watch the resolution video <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {report.status === 'Ready to verify' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-medium">Is this fixed for you?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={btnPrimary} onClick={() => clientConfirm(report.id, true, '')}><CheckCircle2 className="h-4 w-4" /> Confirm fixed</button>
                <button className={btnSecondary} onClick={() => setAskBroken(true)}><XCircle className="h-4 w-4" /> Still broken</button>
              </div>
              {askBroken && (
                <div className="mt-3 space-y-2">
                  <textarea rows={2} value={brokenNote} onChange={(e) => setBrokenNote(e.target.value)} placeholder="What is still going wrong?" className={inputCls} />
                  <button className={btnPrimary} onClick={() => { clientConfirm(report.id, false, brokenNote); setAskBroken(false); setBrokenNote('') }}>Send</button>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700">Activity</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); addClientComment(report.id, comment); setComment('') }}
          >
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" className={inputCls} />
            <button type="submit" disabled={!comment.trim()} className={btnPrimary}>Send</button>
          </form>
          <Thread history={report.history} />
        </aside>
      </div>
    </div>
  )
}
