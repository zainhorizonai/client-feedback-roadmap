import { useEffect, useRef, useState } from 'react'
import { Camera, Circle, Mic, MicOff, Monitor, RotateCcw, Square, Upload, UserRound, type LucideIcon } from 'lucide-react'
import fixWebmDuration from 'fix-webm-duration'
import { CaptureError, canComposite, canShareScreen, canUseCamera, composite, mixAudio, openCamera, openScreen, type Corner } from '../lib/capture'
import { Button, buttonClass, VideoEvidence } from './ui'

interface Props {
  blob: Blob | null
  onChange: (blob: Blob | null) => void
  /** From server configuration. The recording stops by itself at this size. */
  maxMb: number
}

type Mode = 'screen' | 'both' | 'camera'
type Phase = 'idle' | 'starting' | 'countdown' | 'recording'

const ACCEPTED = ['video/webm', 'video/mp4', 'video/quicktime', 'video/ogg', 'video/x-matroska', 'video/3gpp']
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
const stopStream = (s: MediaStream) => s.getTracks().forEach((t) => t.stop())

const MODES: { id: Mode; icon: LucideIcon; label: string; hint: string; action: string; name: string }[] = [
  { id: 'both', icon: UserRound, label: 'Screen and camera', hint: 'Show your screen with your face in a corner, like Loom', action: 'Record screen and camera', name: 'Screen and camera recording' },
  { id: 'screen', icon: Monitor, label: 'Screen', hint: 'Show your screen and talk over it', action: 'Record screen', name: 'Screen recording' },
  { id: 'camera', icon: Camera, label: 'Camera', hint: 'Just you, talking to the camera', action: 'Record camera', name: 'Camera recording' },
]

const CORNERS: { id: Corner; label: string }[] = [
  { id: 'bl', label: 'Bottom left' }, { id: 'br', label: 'Bottom right' }, { id: 'tl', label: 'Top left' }, { id: 'tr', label: 'Top right' },
]

export function Recorder({ blob, onChange, maxMb }: Props) {
  const screenOk = canShareScreen()
  const cameraOk = canUseCamera()
  const bothOk = canComposite()
  // Phones cannot share their screen, so the camera is the way to record there. Prefer the richest mode that works.
  const available = MODES.filter((m) => (m.id === 'both' ? bothOk : m.id === 'screen' ? screenOk : cameraOk))
  const [mode, setMode] = useState<Mode>(available[0]?.id ?? 'camera')
  const [corner, setCorner] = useState<Corner>('bl')
  const [mic, setMic] = useState(true)
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(3)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState<{ kind: 'recorded' | 'uploaded'; name: string } | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selfStream, setSelfStream] = useState<MediaStream | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const cleanups = useRef<(() => void)[]>([])
  const timer = useRef<number | null>(null)
  const cancelled = useRef(false)
  const selfRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!blob) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])

  // The live picture of yourself, so you can see what the viewer will see.
  useEffect(() => {
    const el = selfRef.current
    if (el) el.srcObject = selfStream
  }, [selfStream, phase])

  useEffect(() => () => release(), [])

  function release() {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = null
    cleanups.current.forEach((fn) => { try { fn() } catch { /* already closed */ } })
    cleanups.current = []
    setSelfStream(null)
  }

  function fail(e: unknown) {
    release()
    setPhase('idle')
    if (e instanceof CaptureError) {
      setError(
        e.kind === 'camera-blocked' ? 'Your camera is blocked. Allow camera access in your browser, then try again. You can also record just your screen, or upload a video.'
        : e.kind === 'camera-missing' ? 'We could not find a camera on this device. You can record just your screen, or upload a video.'
        : e.kind === 'camera-failed' ? 'The camera would not start. Another app may be using it. Close that app and try again, or upload a video.'
        : e.kind === 'screen-cancelled' ? 'Screen sharing was cancelled or blocked. Allow screen sharing in your browser and try again, or choose Camera.'
        : 'We could not start the screen recording in this browser. Try Camera, or upload a video.',
      )
    } else {
      setError('We could not start the recording in this browser. Upload a video instead.')
    }
  }

  async function begin() {
    if (phase !== 'idle') return
    setError('')
    setNote('')
    cancelled.current = false
    setPhase('starting')
    try {
      let stream: MediaStream
      let screen: MediaStream | null = null

      if (mode === 'camera') {
        const cam = await openCamera(mic)
        cleanups.current.push(() => stopStream(cam.stream))
        if (cam.micFailed) setNote('We could not use your microphone, so this recording has no sound.')
        setSelfStream(cam.stream)
        stream = cam.stream
      } else if (mode === 'screen') {
        screen = await openScreen()
        const s = screen
        cleanups.current.push(() => stopStream(s))
        let micStream: MediaStream | null = null
        if (mic) {
          try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); const m = micStream; cleanups.current.push(() => stopStream(m)) }
          catch { setNote('We could not use your microphone, so this recording has no narration. You can still describe the problem in the details.') }
        }
        const mixed = mixAudio([s, ...(micStream ? [micStream] : [])])
        if (mixed) cleanups.current.push(mixed.close)
        stream = new MediaStream([s.getVideoTracks()[0], ...(mixed ? [mixed.track] : [])])
      } else {
        screen = await openScreen()
        const s = screen
        cleanups.current.push(() => stopStream(s))
        const cam = await openCamera(mic)
        cleanups.current.push(() => stopStream(cam.stream))
        if (cam.micFailed) setNote('We could not use your microphone, so this recording has no narration.')
        setSelfStream(cam.stream)
        const mixed = mixAudio([s, cam.stream])
        if (mixed) cleanups.current.push(mixed.close)
        const comp = composite(s, cam.stream, mixed?.track ?? null, corner)
        cleanups.current.push(comp.stop)
        stream = comp.stream
      }

      // The browser's own "stop sharing" button ends a screen recording cleanly, or cancels the countdown.
      screen?.getVideoTracks()[0].addEventListener('ended', () => {
        if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
        else cancel()
      })

      // 3, 2, 1: time to get ready, with the camera already showing so you can check how you look.
      setPhase('countdown')
      for (let n = 3; n >= 1; n--) {
        setCount(n)
        await new Promise((r) => setTimeout(r, 1000))
        if (cancelled.current) return
      }
      startRecorder(stream)
    } catch (e) {
      if (!cancelled.current) fail(e)
    }
  }

  function startRecorder(stream: MediaStream) {
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
    // A modest bitrate keeps a long recording small. Screen text stays sharp at this rate.
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 })
    const chunks: BlobPart[] = []
    let bytes = 0
    const startedAt = Date.now()
    const chosen = MODES.find((m) => m.id === mode)!
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
      const finish = (b: Blob) => { setSource({ kind: 'recorded', name: chosen.name }); onChange(b) }
      // Browsers write WebM without a length, so a long recording shows 0:00 and cannot be scrubbed. Fix that.
      if (out.type.includes('webm')) {
        try { fixWebmDuration(out, Date.now() - startedAt, (fixed) => finish(fixed)) } catch { finish(out) }
      } else finish(out)
      setPhase('idle')
      release()
    }
    rec.start(1000)
    recorder.current = rec
    setSeconds(0)
    setPhase('recording')
    timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
  }

  function stop() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }

  function cancel() {
    cancelled.current = true
    release()
    setPhase('idle')
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

  const selfView = (
    <video ref={selfRef} autoPlay muted playsInline aria-label="You, as the camera sees you" className="aspect-square w-28 -scale-x-100 rounded-full border-4 border-white bg-forest object-cover shadow-md" />
  )

  // ---- a finished video ----
  if (blob && previewUrl) {
    return (
      <div className="space-y-3">
        <VideoEvidence src={previewUrl} title="Preview of your video" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-muted"><span className="font-semibold text-ink">{source?.name ?? 'Video'}</span> · {mb(blob.size)} ready to send</p>
          <div className="flex gap-2">
            {source?.kind === 'recorded' && <Button variant="secondary" onClick={() => { onChange(null); setSource(null); void begin() }}><RotateCcw className="h-4 w-4" aria-hidden="true" />Re-record</Button>}
            {source?.kind === 'uploaded' ? fileInput('Replace file') : <Button variant="tertiary" onClick={() => { onChange(null); setSource(null) }}>Remove</Button>}
          </div>
        </div>
        {note && <p className="text-sm text-muted">{note}</p>}
        {error && <p role="alert" className="text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
      </div>
    )
  }

  // ---- getting ready ----
  if (phase === 'starting' || phase === 'countdown') {
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-center" role="status" aria-live="polite">
        {phase === 'starting' ? (
          <p className="font-semibold">Starting… allow the camera or screen sharing if your browser asks.</p>
        ) : (
          <>
            <p className="text-muted">Recording starts in</p>
            <p className="my-2 text-6xl font-semibold tabular-nums" aria-label={`${count}`}>{count}</p>
            {selfStream && <div className="my-3 flex justify-center">{selfView}</div>}
            <p className="text-sm text-muted">{mode === 'screen' ? 'Get the screen you want to show ready.' : 'Check how you look and sound, then start talking.'}</p>
          </>
        )}
        {note && <p className="mt-3 rounded-control bg-[var(--seam-warning-bg)] px-3 py-2 text-sm font-medium text-[var(--seam-warning-fg)]">{note}</p>}
        <Button variant="secondary" onClick={cancel} className="mt-4">Cancel</Button>
      </div>
    )
  }

  // ---- recording ----
  if (phase === 'recording') {
    return (
      <div className="rounded-card border border-[var(--seam-error-fg)]/40 bg-[var(--seam-error-bg)] p-6 text-center" role="status">
        <p className="flex items-center justify-center gap-2 font-semibold text-[var(--seam-error-fg)]">
          <span className="h-3 w-3 animate-pulse rounded-full bg-[var(--seam-error-fg)]" aria-hidden="true" />
          Recording <span className="font-mono tabular-nums">{fmt(seconds)}</span>
        </p>
        {selfStream && <div className="my-3 flex justify-center">{selfView}</div>}
        <p className="mt-1 text-muted">Take as long as you need, then stop. There is no time limit, only the {maxMb} MB file size.</p>
        {note && <p className="mt-3 rounded-control bg-[var(--seam-warning-bg)] px-3 py-2 text-sm font-medium text-[var(--seam-warning-fg)]">{note}</p>}
        <Button variant="danger" onClick={stop} className="mt-4"><Square className="h-4 w-4 fill-current" aria-hidden="true" />Stop recording</Button>
      </div>
    )
  }

  // ---- choose how to record ----
  const chosen = MODES.find((m) => m.id === mode)!
  return (
    <div>
      <div className="rounded-card border border-dashed border-control bg-surface p-5">
        {available.length > 0 ? (
          <>
            <fieldset>
              <legend className="mb-2 font-semibold">How do you want to record?</legend>
              <div className={`grid gap-2 ${available.length === 3 ? 'sm:grid-cols-3' : available.length === 2 ? 'sm:grid-cols-2' : ''}`}>
                {available.map((m) => (
                  <label key={m.id} className={`flex cursor-pointer flex-col rounded-card border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${mode === m.id ? 'border-action bg-surface ring-2 ring-action' : 'border-line bg-surface hover:border-control'}`}>
                    <input type="radio" name="record-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="sr-only" />
                    <m.icon className={`h-5 w-5 ${mode === m.id ? 'text-action' : 'text-muted'}`} aria-hidden="true" />
                    <span className="mt-2 font-semibold">{m.label}</span>
                    <span className="text-sm text-muted">{m.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" onClick={() => setMic((n) => !n)} aria-pressed={mic} className="inline-flex min-h-9 items-center gap-2 rounded-control text-sm text-muted hover:text-ink">
                {mic ? <Mic className="h-4 w-4 text-action" aria-hidden="true" /> : <MicOff className="h-4 w-4" aria-hidden="true" />}
                {mic ? 'Microphone on' : 'Microphone off'}
              </button>
              {mode === 'both' && (
                <label className="inline-flex items-center gap-2 text-sm text-muted">
                  <span>Camera bubble</span>
                  <select className="input !min-h-9 !w-auto" value={corner} onChange={(e) => setCorner(e.target.value as Corner)} aria-label="Camera bubble position">
                    {CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={begin}><Circle className="h-4 w-4 fill-current" aria-hidden="true" />{chosen.action}</Button>
              {fileInput('Upload video')}
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-muted">Recording is not available on this device or browser. Upload a video from your phone or computer instead.</p>
            {fileInput('Upload a video', 'primary')}
          </>
        )}
        {screenOk && !bothOk && cameraOk && <p className="mt-3 text-sm text-muted">Showing your screen and your face together needs Chrome or Edge on a computer. You can still record your screen, or your camera.</p>}
        {!screenOk && cameraOk && <p className="mt-3 text-sm text-muted">Screen recording is not available on this device, but you can record yourself with the camera.</p>}
        <p className="mt-2 text-xs text-muted">WebM, MP4 or MOV, up to {maxMb} MB.</p>
      </div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      {error && <p role="alert" className="mt-2 text-sm font-medium text-[var(--seam-error-fg)]">{error}</p>}
    </div>
  )
}
