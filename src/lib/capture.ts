// Helpers for recording: opening the camera, mixing audio, and drawing the screen with the camera in a corner bubble.

// Not yet in TypeScript's DOM types. Chrome and Edge ship it. Where it is missing, "screen and camera" is not offered.
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack })
  readable: ReadableStream<VideoFrame>
}

export type Corner = 'bl' | 'br' | 'tl' | 'tr'

export const canUseCamera = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
export const canShareScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined'
/** Putting the camera on top of the screen needs a way to read frames without relying on the page being visible. */
export const canComposite = () => canShareScreen() && canUseCamera() && typeof MediaStreamTrackProcessor !== 'undefined' && typeof VideoFrame !== 'undefined'

export type CaptureErrorKind = 'camera-blocked' | 'camera-missing' | 'camera-failed' | 'screen-cancelled' | 'screen-failed'

export class CaptureError extends Error {
  kind: CaptureErrorKind
  constructor(kind: CaptureErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** Opens the camera. If the microphone is the problem, the camera still opens and the caller is told. */
export async function openCamera(wantMic: boolean): Promise<{ stream: MediaStream; micFailed: boolean }> {
  const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
  const attempt = (audio: boolean) =>
    navigator.mediaDevices.getUserMedia({ video, audio: audio ? { echoCancellation: true, noiseSuppression: true } : false })
  try {
    return { stream: await attempt(wantMic), micFailed: false }
  } catch (first) {
    // Microphone denied but camera allowed is common. Try the camera alone before giving up.
    if (wantMic) {
      try { return { stream: await attempt(false), micFailed: true } } catch { /* fall through to the camera error */ }
    }
    const name = first instanceof DOMException ? first.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CaptureError('camera-blocked', 'Camera access is blocked.')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CaptureError('camera-missing', 'No camera was found.')
    throw new CaptureError('camera-failed', 'The camera could not be started.')
  }
}

export async function openScreen(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    throw new CaptureError(name === 'NotAllowedError' ? 'screen-cancelled' : 'screen-failed', 'Screen sharing was not started.')
  }
}

/** Several audio sources into one track. A recorder keeps only one audio track reliably, so mix them first. */
export function mixAudio(streams: MediaStream[]): { track: MediaStreamTrack; close: () => void } | null {
  const withAudio = streams.filter((s) => s.getAudioTracks().length > 0)
  if (withAudio.length === 0) return null
  const ctx = new AudioContext()
  const dest = ctx.createMediaStreamDestination()
  for (const s of withAudio) ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest)
  if (ctx.state === 'suspended') void ctx.resume()
  return { track: dest.stream.getAudioTracks()[0], close: () => { void ctx.close() } }
}

export interface Composite {
  /** The recordable result: the combined picture, plus the mixed audio if there is any. */
  stream: MediaStream
  setCorner: (c: Corner) => void
  stop: () => void
}

/**
 * Draws the shared screen with the camera in a round bubble, and records that.
 * Frames are read as they arrive, not on a screen-refresh timer. Browsers pause refresh timers when the page is
 * in the background, which is exactly where the page is while someone shows another window.
 */
export function composite(screen: MediaStream, camera: MediaStream, audio: MediaStreamTrack | null, corner: Corner): Composite {
  const screenTrack = screen.getVideoTracks()[0]
  const cameraTrack = camera.getVideoTracks()[0]
  const s = screenTrack.getSettings()
  // Keep the file reasonable: never wider than 1920.
  const scale = s.width && s.width > 1920 ? 1920 / s.width : 1
  const W = Math.round((s.width ?? 1280) * scale) || 1280
  const H = Math.round((s.height ?? 720) * scale) || 720

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const out = canvas.captureStream(0) // 0 = we decide when a frame is made
  const outTrack = out.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack

  let screenFrame: VideoFrame | null = null
  let camFrame: VideoFrame | null = null
  let where = corner
  let running = true

  function draw() {
    if (!running) return
    if (screenFrame) ctx.drawImage(screenFrame, 0, 0, W, H)
    else { ctx.fillStyle = '#172E26'; ctx.fillRect(0, 0, W, H) }
    if (camFrame) {
      const d = Math.round(H * 0.24)
      const m = Math.round(W * 0.025)
      const x = where.endsWith('r') ? W - m - d : m
      const y = where.startsWith('t') ? m : H - m - d
      const ring = Math.max(4, Math.round(d * 0.03))
      const cw = camFrame.displayWidth
      const ch = camFrame.displayHeight
      const side = Math.min(cw, ch)
      ctx.save()
      ctx.beginPath()
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(camFrame, (cw - side) / 2, (ch - side) / 2, side, side, x, y, d, d) // centre-cropped square
      ctx.restore()
      ctx.lineWidth = ring
      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x + d / 2, y + d / 2, d / 2 - ring / 2, 0, Math.PI * 2)
      ctx.stroke()
    }
    outTrack.requestFrame()
  }

  // The camera sends frames steadily, so it also keeps the picture moving when the screen is still.
  const readers: ReadableStreamDefaultReader<VideoFrame>[] = []
  const pump = (track: MediaStreamTrack, take: (f: VideoFrame) => void) => {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    readers.push(reader)
    void (async () => {
      try {
        while (running) {
          const { value, done } = await reader.read()
          if (done || !value) break
          take(value)
          draw()
        }
      } catch { /* the track ended */ }
    })()
  }
  pump(screenTrack, (f) => { screenFrame?.close(); screenFrame = f })
  pump(cameraTrack, (f) => { camFrame?.close(); camFrame = f })

  const stream = new MediaStream([outTrack, ...(audio ? [audio] : [])])
  return {
    stream,
    setCorner: (c) => { where = c },
    stop: () => {
      running = false
      readers.forEach((r) => { void r.cancel().catch(() => {}) })
      screenFrame?.close(); camFrame?.close()
      screenFrame = null; camFrame = null
      outTrack.stop()
    },
  }
}
