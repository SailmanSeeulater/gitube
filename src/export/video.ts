/**
 * Recording the graph canvas to a video file in the browser (MediaRecorder over captureStream).
 * WebM where the browser can make it; Safari only records MP4, so that is the fallback.
 */

export interface VideoType {
  mimeType: string
  ext: 'webm' | 'mp4'
}

const CANDIDATES: ReadonlyArray<VideoType> = [
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
  { mimeType: 'video/mp4', ext: 'mp4' },
]

/** The best type this browser records to, or null when it cannot record a canvas at all. */
export function pickVideoType(): VideoType | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') return null
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null
  return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null
}

export interface CanvasRecording {
  type: VideoType
  /** ends the recording and resolves with the video */
  finish: () => Promise<Blob>
  /** ends it and throws the footage away */
  cancel: () => void
}

/**
 * Starts recording a canvas. The stream only gets a frame when the canvas is painted, so keep it
 * redrawing (and the tab visible: hidden tabs stop painting) for as long as it records.
 */
export function recordCanvas(canvas: HTMLCanvasElement, fps = 30): CanvasRecording {
  const type = pickVideoType()
  if (!type) throw new Error("this browser can't record video")
  const stream = canvas.captureStream(fps)
  const recorder = new MediaRecorder(stream, { mimeType: type.mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const release = () => stream.getTracks().forEach((track) => track.stop())
  recorder.start(250)

  return {
    type,
    finish: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: type.mimeType.split(';')[0] }))
        }
        recorder.onerror = () => {
          release()
          reject(new Error('the recording failed'))
        }
        if (recorder.state === 'inactive') recorder.onstop(new Event('stop'))
        else recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}
