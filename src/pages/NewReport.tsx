import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ArrowLeft } from 'lucide-react'
import { ApiError } from '../lib/api'
import { createReport } from '../lib/store'
import { SEVERITIES, type Severity } from '../lib/types'
import { Recorder } from '../components/Recorder'
import { btnPrimary, btnSecondary, inputCls } from '../components/ui'

export function NewReport() {
  const nav = useNavigate()
  const [video, setVideo] = useState<Blob | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [doneId, setDoneId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!video) return
    setBusy(true)
    setProgress(0)
    setError('')
    try {
      const r = await createReport({ title: title.trim(), description: description.trim(), pageUrl: pageUrl.trim(), severity }, video, setProgress)
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
        <h1 className="mt-4 text-2xl font-semibold">Report sent</h1>
        <p className="mt-2 text-slate-600">
          Thanks. Your report is <span className="font-mono font-medium">{doneId}</span>. We have been emailed and will update you here and by email.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button className={btnPrimary} onClick={() => nav(`/reports/${doneId}`)}>View report</button>
          <Link to="/reports" className={btnSecondary}>All reports</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <Link to="/reports" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> My reports</Link>
      <h1 className="text-2xl font-semibold">New report</h1>
      <p className="mt-1 text-sm text-slate-600">Show us what is wrong. A short video with your voice is the fastest way.</p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">1. Record or upload a video</h2>
          <Recorder blob={video} onChange={setVideo} />
        </section>

        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">2. Add details</h2>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Title <span className="text-red-500">*</span></span>
            <input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Save button does nothing" className={inputCls} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">What did you expect to happen?</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Page or feature</span>
              <input value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} placeholder="https://… or feature name" className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Severity</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className={inputCls}>
                {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
        </section>

        {busy && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          {!video && <span className="text-sm text-slate-500">Add a video to continue</span>}
          <button type="submit" disabled={!video || !title.trim() || busy} className={btnPrimary}>{busy ? `Uploading ${Math.round(progress * 100)}%` : 'Send report'}</button>
        </div>
      </form>
    </div>
  )
}
