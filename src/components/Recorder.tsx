import { useEffect, useRef, useState } from 'react'
import { Circle, Mic, MicOff, RotateCcw, Square, Upload } from 'lucide-react'
import { Button, buttonClass, VideoEvidence } from './ui'

interface Props {
  blob: Blob | null
  onChange: (blob: Blob | null) => void
  /** From server configuration. The recording stops by itself at this size. */
  maxMb: number
}

const ACCEPTED = ['video/webm', 'video/mp4', 'video/quicktime', 'video/ogg', 'video/x-matroska', 'video/3gpp']
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

export function Recorder({ blob, onChange, maxMb }: Props) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [narrate, setNarrate] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState<{ kind: 'recorded' | 'uploaded'; name: string } | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const streams = useRef<MediaStream[]>([])
  const timer = useRef<number | null>(null)
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'

  useEffect(() => {
    if (!blob) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  useEffect(() => () => cleanup(), [])

  function cleanup() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    streams.current = []
  }

  async function start() {
    setError('')
    setNote('')
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      streams.current = [screen]
      const tracks = [...screen.getTracks()]
      if (narrate) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
          streams.current.push(mic)
          tracks.push(...mic.getAudioTracks())
        } catch {
          // A microphone problem never blocks the recording.
          setNote('We could not use your microphone, so this recording has no narration. You can still describe the problem in the details.')
        }
      }
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
      const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined)
      const chunks: BlobPart[] = []
      let bytes = 0
      rec.ondataavailable = (e) => {
        if (!e.data.size) return
        chunks.push(e.data)
        bytes += e.data.size
        if (bytes > maxMb * 1024 * 1024 * 0.95 && rec.state !== 'inactive') {
          setNote(`The recording reached the ${maxMb} MB limit and stopped. You can send it as it is.`)
          rec.stop()
        }
      }
      rec.onstop = () => {
        const out = new Blob(chunks, { type: rec.mimeType || 'video/webm' })
        setSource({ kind: 'recorded', name: 'Screen recording' })
        onChange(out)
        setRecording(false)
        cleanup()
      }
      // Stopping the browser's own "stop sharing" button ends the recording cleanly.
      screen.getVideoTracks()[0].addEventListener('ended', () => rec.state !== 'inactive' && rec.stop())
      rec.start(1000)
      recorder.current = rec
      setSeconds(0)
      setRecording(true)
      timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (e) {
      cleanup()
      setRecording(false)
      const name = e instanceof DOMException ? e.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Screen sharing was cancelled or blocked. Allow screen sharing in your browser and try again, or upload a video instead.'
          : 'We could not start the recording in this browser. Upload a video instead.',
      )
    }
  }

  function stop() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }

  function onFile(file: File | undefined) {
    if (!file) return
    setNote('')
    if (!ACCEPTED.includes(file.type)) return setError('That file type is not supported. Use a WebM, MP4 or MOV video.')
    if (file.size > maxMb * 1024 * 1024) return setError(`That file is ${mb(file.size)}. The limit is ${maxMb} MB.`)
    setError('')
    setSource({ kind: 'uploaded', name: file.name })
    onChange(file)
  }

  const fileInput = (label: string, variant: 'primary' | 'secondary' = 'secondary') => (
    <label className={`${buttonClass(variant)} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus`}>
      <Upload className="h-4 w-4" aria-hidden="true" />{label}
      <input type="file" accept="video/*" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
    </label>
  )

  if (blob && previewUrl) {
    return (
      <div className="space-y-3">
        <VideoEvidence src={previewUrl} title="Preview of your video" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-muted"><span className="font-semibold text-ink">{source?.name ?? 'Video'}</span> · {mb(blob.size)} ready to send</p>
          <div className="flex gap-2">
            {source?.kind === 'recorded' && <Button variant="secondary" onClick={() => { onChange(null); setSource(null); start() }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Re-record</Button>}
            {source?.kind === 'uploaded' ? fileInput('Replace file') : <Button variant="tertiary" onClick={() => { onChange(null); setSource(null) }}>Remove</Button>}
          </div>
        </div>
        {note && <p className="text-sm text-muted">{note}</p>}
        {error && <p role="alert" className="text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
      </div>
    )
  }

  if (recording) {
    return (
      <div className="rounded-card border border-[var(--seam-error-fg)]/40 bg-[var(--seam-error-bg)] p-6 text-center" role="status">
        <p className="flex items-center justify-center gap-2 font-semibold text-[var(--seam-error-fg)]">
          <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--seam-error-fg)]" aria-hidden="true" />
          Recording <span className="font-mono tabular-nums">{fmt(seconds)}</span>
        </p>
        <p className="mt-1 text-muted">Show the problem, then stop. It stops by itself at {maxMb} MB.</p>
        <Button variant="danger" onClick={stop} className="mt-4"><Square className="h-4 w-4 fill-current" aria-hidden="true" />Stop recording</Button>
      </div>
    )
  }

  return (
    <div>
      <div className="rounded-card border border-dashed border-control bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          {supported && <Button onClick={start}><Circle className="h-4 w-4 fill-current" aria-hidden="true" />Record screen</Button>}
          {fileInput(supported ? 'Upload video' : 'Upload a video', supported ? 'secondary' : 'primary')}
        </div>
        {supported ? (
          <button type="button" onClick={() => setNarrate((n) => !n)} aria-pressed={narrate} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-control text-sm text-muted hover:text-ink">
            {narrate ? <Mic className="h-4 w-4 text-action" aria-hidden="true" /> : <MicOff className="h-4 w-4" aria-hidden="true" />}
            {narrate ? 'Microphone on. Talk while you show the problem.' : 'Microphone off. The recording will have no narration.'}
          </button>
        ) : (
          <p className="mt-3 text-sm text-muted">Screen recording is not available on this device or browser. Upload a video from your phone or computer instead.</p>
        )}
        <p className="mt-2 text-xs text-muted">WebM, MP4 or MOV, up to {maxMb} MB.</p>
      </div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
    </div>
  )
}
