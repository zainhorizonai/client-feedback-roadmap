import { useState } from 'react'
import { X } from 'lucide-react'
import { addReply, setRoadmapStage, setStatus, updateFields } from '../lib/store'
import { hasSeverity, KINDS, ROADMAP_STAGES, SEVERITIES, STATUSES, type Kind, type Report, type RoadmapStage, type Severity, type Status } from '../lib/types'
import { VideoPlayer } from './VideoPlayer'
import { Thread } from './Thread'
import { btnPrimary, fmtDateTime, inputCls } from './ui'

export function ReportPanel({ report, onClose }: { report: Report; onClose: () => void }) {
  const [reply, setReply] = useState('')

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <div className="font-mono text-xs text-slate-500">{report.id} · {report.clientName}</div>
          <h2 className="truncate text-lg font-semibold">{report.title}</h2>
          <div className="text-xs text-slate-500">{report.reporterName} · {fmtDateTime(report.createdAt)}</div>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {report.hasVideo ? <VideoPlayer reportId={report.id} hasVideo /> : <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">No video was added to this item.</p>}
        {report.description && <p className="whitespace-pre-wrap text-sm text-slate-700">{report.description}</p>}
        {report.pageUrl && <p className="break-all text-xs text-slate-500">{report.pageUrl}</p>}

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Status</span>
            <select value={report.status} onChange={(e) => setStatus(report.id, e.target.value as Status)} className={inputCls}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Type</span>
            <select value={report.kind} onChange={(e) => updateFields(report.id, { kind: e.target.value as Kind })} className={inputCls}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </label>
          {hasSeverity(report.kind) && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Severity</span>
              <select value={report.severity} onChange={(e) => updateFields(report.id, { severity: e.target.value as Severity })} className={inputCls}>
                {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Client roadmap</span>
            <select value={report.roadmapStage ?? ''} onChange={(e) => setRoadmapStage(report.id, e.target.value === '' ? null : (e.target.value as RoadmapStage))} className={inputCls}>
              <option value="">Not on the roadmap</option>
              {ROADMAP_STAGES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Resolution video link <span className="font-normal text-slate-500">(shown to the client)</span></span>
          <input defaultValue={report.resolutionUrl} key={report.id + report.resolutionUrl} onBlur={(e) => updateFields(report.id, { resolutionUrl: e.target.value.trim() })} placeholder="https://…" className={inputCls} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Internal notes <span className="font-normal text-slate-500">(client cannot see)</span></span>
          <textarea rows={3} defaultValue={report.notes ?? ''} key={report.id + '-notes'} onBlur={(e) => updateFields(report.id, { notes: e.target.value })} className={inputCls} />
        </label>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Reply to client</h3>
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Your reply is emailed to the client…" className={inputCls} />
          <div className="mt-2 flex justify-end">
            <button className={btnPrimary} disabled={!reply.trim()} onClick={() => { addReply(report.id, reply); setReply('') }}>Send reply</button>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold">Activity</h3>
          <Thread history={report.history} />
        </div>
      </div>
    </aside>
  )
}
