/**
 * Canvas recorder — captures a `<canvas>` element to a downloadable WebM
 * file via `MediaRecorder`. Side-effect free until `start()` is called.
 *
 * Browser support: `HTMLCanvasElement.captureStream()` works in Chromium,
 * Firefox, and recent Safari. WebM/VP9 is preferred when available; we fall
 * back to VP8 then to the browser default.
 */

const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const mt of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mt)) return mt
  }
  return undefined
}

export interface CanvasRecording {
  stop: () => Promise<Blob>
  cancel: () => void
  readonly mimeType: string
  readonly startedAt: number
}

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined'
}

/**
 * Start recording the given canvas. The returned `stop()` resolves with a
 * Blob containing the encoded video; `cancel()` discards the recording.
 *
 * @param canvas Source canvas. Must be a Pixi-backed canvas (or any canvas
 *   that supports `captureStream`).
 * @param fps    Capture frame rate. 30 is a sensible default; higher rates
 *   trade CPU/battery for smoother playback.
 */
export function startCanvasRecording(canvas: HTMLCanvasElement, fps = 30): CanvasRecording {
  if (!isRecordingSupported()) {
    throw new Error('MediaRecorder is not available in this browser.')
  }
  const stream = canvas.captureStream(fps)
  const mimeType = pickMimeType()
  const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  let stopResolve: ((b: Blob) => void) | null = null
  let stopReject: ((e: Error) => void) | null = null
  let cancelled = false
  rec.onstop = () => {
    // Stop tracks so the browser releases the capture pipeline.
    for (const t of stream.getTracks()) t.stop()
    if (cancelled) return
    const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' })
    stopResolve?.(blob)
  }
  rec.onerror = () => {
    stopReject?.(new Error('MediaRecorder error during canvas capture.'))
  }
  rec.start(1000) // emit chunks every 1s so very short clips still produce data
  return {
    mimeType: rec.mimeType || mimeType || 'video/webm',
    startedAt: performance.now(),
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        if (rec.state === 'inactive') {
          resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
          return
        }
        stopResolve = resolve
        stopReject = reject
        rec.stop()
      }),
    cancel: () => {
      cancelled = true
      if (rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
      }
    },
  }
}

/**
 * Trigger a download of `blob` as `filename`. Browser-only; safe to call
 * from a click handler.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Defer revoke so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
