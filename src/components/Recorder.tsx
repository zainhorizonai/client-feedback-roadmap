import { useEffect, useRef, useState } from 'react'
import { Circle, Mic, MicOff, RotateCcw, Square, Upload } from 'lucide-react'
import { btnPrimary, btnSecondary } from './ui'

interface Props {
  blob: Blob | null
  onChange: (blob: Blob | null) => void
}

const MAX_SECONDS = 600
const MAX_UPLOAD_MB = 500

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function Recorder({ blob, onChange }: Props) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [narrate, setNarrate] = useState(true)
  const [error, setError] = useState('')
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
          setError('Microphone not available, recording without narration.')
        }
      }
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
      const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined)
      const chunks: BlobPart[] = []
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        onChange(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
        setRecording(false)
        cleanup()
      }
      screen.getVideoTracks()[0].addEventListener('ended', () => rec.state !== 'inactive' && rec.stop())
      rec.start(1000)
      recorder.current = rec
      setSeconds(0)
      setRecording(true)
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) rec.state !== 'inactive' && rec.stop()
          return s + 1
        })
      }, 1000)
    } catch (e) {
      cleanup()
      setRecording(false)
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Screen sharing was cancelled.' : 'Could not start recording in this browser.')
    }
  }

  function stop() {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }

  function onFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('video/')) return setError('Please choose a video file.')
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return setError(`That file is larger than ${MAX_UPLOAD_MB} MB.`)
    setError('')
    onChange(file)
  }

  if (blob && previewUrl) {
    return (
      <div className="space-y-3">
        <video src={previewUrl} controls className="aspect-video w-full rounded-lg bg-black" />
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{(blob.size / 1024 / 1024).toFixed(1)} MB ready to send</span>
          <button type="button" className={btnSecondary} onClick={() => onChange(null)}>
            <RotateCcw className="h-4 w-4" /> Record again
          </button>
        </div>
      </div>
    )
  }

  if (recording) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-red-200 bg-red-50 p-8">
        <div className="flex items-center gap-2 text-red-700">
          <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
          <span className="text-lg font-semibold tabular-nums">{fmt(seconds)}</span>
          <span className="text-sm text-red-600">/ {fmt(MAX_SECONDS)} max</span>
        </div>
        <p className="text-sm text-slate-600">Recording your screen. Show the problem, then stop.</p>
        <button type="button" onClick={stop} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-700">
          <Square className="h-4 w-4 fill-current" /> Stop recording
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center">
        {supported ? (
          <>
            <button type="button" onClick={start} className={`${btnPrimary} px-5 py-2.5`}>
              <Circle className="h-4 w-4 fill-current" /> Start screen recording
            </button>
            <button
              type="button"
              onClick={() => setNarrate((n) => !n)}
              className="mx-auto mt-3 flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
            >
              {narrate ? <Mic className="h-4 w-4 text-brand-600" /> : <MicOff className="h-4 w-4" />}
              {narrate ? 'Narration on: talk while you show the issue' : 'Narration off'}
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-600">Screen recording is not supported in this browser. Please upload a video instead.</p>
        )}
        <div className="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
        </div>
        <label className={`${btnSecondary} cursor-pointer`}>
          <Upload className="h-4 w-4" /> Upload a video file
          <input type="file" accept="video/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
