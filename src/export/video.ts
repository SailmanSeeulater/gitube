/**
 * Recording the graph canvas to a video file in the browser (MediaRecorder over captureStream),
 * optionally with a sound track (the music box). WebM where the browser can make it; Safari only
 * records MP4, so that is the fallback.
 */

export interface VideoType {
  mimeType: string
  ext: 'webm' | 'mp4'
}

const SILENT: ReadonlyArray<VideoType> = [
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
  { mimeType: 'video/mp4', ext: 'mp4' },
]

const WITH_SOUND: ReadonlyArray<VideoType> = [
  { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  ...SILENT,
]

/** The best type this browser records to, or null when it cannot record a canvas at all. */
export function pickVideoType(withSound = false): VideoType | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') return null
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null
  return (withSound ? WITH_SOUND : SILENT).find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null
}

export interface CanvasRecording {
  type: VideoType
  /** ends the recording and resolves with the video */
  finish: () => Promise<Blob>
  /** ends it and throws the footage away */
  cancel: () => void
}

/**
 * Starts recording a canvas, with the audio tracks of `sound` mixed in when given. The stream only
 * gets a frame when the canvas is painted, so keep it redrawing (and the tab visible: hidden tabs
 * stop painting) for as long as it records. The sound stream is left running for the next one.
 */
export function recordCanvas(canvas: HTMLCanvasElement, fps = 30, sound: MediaStream | null = null): CanvasRecording {
  const audio = sound?.getAudioTracks() ?? []
  const type = pickVideoType(audio.length > 0)
  if (!type) throw new Error("this browser can't record video")
  const video = canvas.captureStream(fps)
  const stream = audio.length > 0 ? new MediaStream([...video.getVideoTracks(), ...audio]) : video
  const recorder = new MediaRecorder(stream, { mimeType: type.mimeType, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  // only the canvas tracks are ours to stop
  const release = () => video.getTracks().forEach((track) => track.stop())
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
