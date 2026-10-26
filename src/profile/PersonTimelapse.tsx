import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import type { VideoType } from '../export/video'
import { exportersChunk, videoChunk } from '../lazy/parts'
import { CloseIcon, PauseIcon, PlayIcon, RecordIcon, StopIcon } from '../components/icons'
import type { LifeTimeline } from './timeline'
import {
  LAPSE_DEFAULT_LENGTH,
  LAPSE_FPS,
  LAPSE_HOLD_MS,
  LAPSE_LENGTHS,
  LapseRecorder,
  lapseDate,
  lapseDay,
  lapseSaveError,
  lapseTick,
  type LapseLength,
  type LapsePlay,
} from './lifeTimelapse'

export interface PersonTimelapseProps {
  onClose: () => void
  timeline: LifeTimeline
  /** the person, for the recording's file name only */
  login: string
  /** 0..1, shared with LifeGarden, which reads it every frame */
  progress: RefObject<number>
  /** the life garden canvas to record */
  getCanvas: () => HTMLCanvasElement | null
  /** the side panel is open: keep clear of it */
  besidePanel: boolean
  /** the privacy toggle: a change throws away a recording made under the other one (LapseRecorder) */
  revealed: boolean
  /** a recording started (true), or it is over, saved or not (false): PersonApp keeps the privacy toggle still meanwhile */
  onRecordingChange?: (recording: boolean) => void
  /**
   * the canvas has to paint every frame (playing, recording or scrubbing): PersonApp hands it to
   * LifeGarden as the time-lapse's live flag, in a new time-lapse value so the canvas wakes for it.
   * Otherwise the canvas paints only while the progress moves (lifePaint.ts)
   */
  onLiveChange?: (live: boolean) => void
  /** a part of the app the save needs would not load: PersonApp shows the reload card (ErrorCard's chunk_failed) */
  onChunkFailed?: () => void
}

/** Where the recorder (export/video, its own chunk) stands: on its way, ready, not in this browser, or not loaded. */
type Recorder = 'loading' | 'ready' | 'none' | 'failed'

const RECORDER_TITLES: Record<Recorder, string> = {
  loading: 'loading the recorder…',
  ready: 'play from the start and save it as a video',
  none: "this browser can't record video",
  failed: "couldn't load the recorder. reload to try again",
}

/** What the recorder's chunk says about this browser, once it is in. */
function recorderOf(video: { pickVideoType: () => VideoType | null } | undefined): Recorder {
  return video === undefined ? 'loading' : video.pickVideoType() !== null ? 'ready' : 'none'
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Person mode's time-lapse controls, mounted while the time-lapse is on (it starts playing from the
 * timeline's start): play/pause, a scrubber over the life, the length of a full play, and recording
 * the canvas to a silent video file. The repo garden's TimelapseBar without the music box (a life
 * has no score), in the same place and look. A recording is thrown away when the privacy toggle
 * changes, or when the controls unmount before it is saved.
 */
export default function PersonTimelapse({
  onClose,
  timeline,
  login,
  progress,
  getCanvas,
  besidePanel,
  revealed,
  onRecordingChange,
  onLiveChange,
  onChunkFailed,
}: PersonTimelapseProps) {
  const [playing, setPlaying] = useState(true)
  const [shown, setShown] = useState(0)
  const [length, setLength] = useState<LapseLength>(LAPSE_DEFAULT_LENGTH)
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null)
  /** a stopped recording on its way to the download */
  const [saving, setSaving] = useState(false)
  /** a finished recording whose download failed waits for another try */
  const [kept, setKept] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** why a recording was thrown away */
  const [notice, setNotice] = useState<string | null>(null)
  const [recordings] = useState(() => new LapseRecorder())
  const [recorder, setRecorder] = useState<Recorder>(() => recorderOf(videoChunk.peek()))

  // the recorder comes in its own chunk; rec waits for it
  useEffect(() => {
    let live = true
    videoChunk.load().then(
      (video) => {
        if (live) setRecorder(recorderOf(video))
      },
      () => {
        if (live) setRecorder('failed')
      },
    )
    return () => {
      live = false
    }
  }, [])

  const seek = (p: number) => {
    progress.current = Math.min(1, Math.max(0, p))
    setShown(progress.current)
  }

  // the life starts from the timeline's start
  useLayoutEffect(() => {
    progress.current = 0
  }, [progress])

  // ---- playback, paced by the clock (lapseTick: dropped frames never slow it down); LifeGarden
  // repaints every frame while it plays (onLiveChange) ----
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const play: LapsePlay = { from: progress.current, startedAt: performance.now(), lengthS: length, recording: recording !== null, endedAt: -1 }
    const step = (now: number) => {
      const tick = lapseTick(play, now)
      play.endedAt = tick.endedAt
      if (progress.current < 1) {
        progress.current = tick.progress
        setShown(tick.progress)
      }
      if (recording) setElapsed(now - recording.startedAt)
      if (tick.next === 'stop') {
        setPlaying(false)
        return
      }
      // a recording lingers on the grown garden, then saves
      if (tick.next === 'save') {
        void finishRecording()
        return
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // finishRecording reads the recordings only; recording only matters for its start time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, length, recording])

  // closing never leaves a recorder running, or a recording on its way to the download
  useEffect(() => () => recordings.cancel(), [recordings])

  // A recording only saves under the privacy toggle it was made under: a change throws it away,
  // before the canvas paints a frame under the new one.
  useLayoutEffect(() => {
    const wasRecording = recordings.recording
    if (!recordings.privacy(revealed)) return
    if (wasRecording) {
      setRecording(null)
      setPlaying(false)
    }
    setKept(false)
    setError(null)
    setNotice('the privacy toggle changed: recording discarded')
  }, [recordings, revealed])

  // the privacy toggle stays still from rec until the recording is saved or thrown away
  const locked = recording !== null || saving
  useEffect(() => {
    if (!locked) return
    onRecordingChange?.(true)
    return () => onRecordingChange?.(false)
  }, [locked, onRecordingChange])

  // the canvas paints every frame only while it has to; a recording keeps it painting throughout, its hold included
  const live = playing || recording !== null || scrubbing
  useEffect(() => {
    onLiveChange?.(live)
  }, [live, onLiveChange])

  const failed = (err: unknown) => {
    const { chunkFailed, message } = lapseSaveError(err)
    setError(message)
    if (chunkFailed) onChunkFailed?.()
  }

  /** a save (of the take just stopped, or of the kept one again) and what it leaves behind */
  const saveWith = async (save: () => Promise<boolean>) => {
    setSaving(true)
    try {
      await save()
    } catch (err) {
      failed(err)
    } finally {
      setSaving(false)
      setKept(recordings.hasKept)
    }
  }

  const finishRecording = async () => {
    if (!recordings.recording) return
    setRecording(null)
    setPlaying(false)
    await saveWith(() => recordings.finish(login, exportersChunk.load))
  }

  const retrySave = async () => {
    setError(null)
    await saveWith(() => recordings.retry(login, exportersChunk.load))
  }

  // Stop takes rec's place under the pointer: the second click of a double click on rec is ignored
  const stopRecording = () => {
    if (recordings.canStop(performance.now())) void finishRecording()
  }

  const startRecording = () => {
    const canvas = getCanvas()
    const video = videoChunk.peek()
    if (!canvas || !video || saving) return
    setError(null)
    setNotice(null)
    try {
      seek(0)
      const startedAt = performance.now()
      recordings.start(video.recordCanvas(canvas, LAPSE_FPS, null), startedAt, revealed)
      setKept(false)
      setElapsed(0)
      setRecording({ startedAt })
      setPlaying(true)
      // the download needs the exporters: fetch them while it records
      exportersChunk.load().catch(() => {})
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const togglePlay = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (progress.current >= 1) seek(0)
    setPlaying(true)
  }

  const endScrub = () => setScrubbing(false)

  const date = lapseDate(lapseDay(timeline, shown))
  const busy = recording !== null
  const total = length * 1000 + LAPSE_HOLD_MS

  // in the status strip's place, bottom left; beside the panel it keeps 16px + the panel's 312px + 16px clear
  return (
    <div
      role="group"
      aria-label="Time-lapse"
      className={`absolute bottom-4 left-4 z-20 flex w-[460px] flex-col gap-1 rounded-xl border border-garden-border bg-garden-panel/95 px-2.5 py-2 text-[12px] shadow-soft backdrop-blur ${
        besidePanel ? 'max-w-[max(260px,calc(100vw-344px))]' : 'max-w-[calc(100vw-2rem)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          disabled={busy}
          aria-label={playing ? 'Pause' : 'Play'}
          className="shrink-0 rounded-lg p-1.5 text-garden-accent hover:bg-garden-hover disabled:opacity-40"
        >
          {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round(shown * 1000)}
          disabled={busy}
          onChange={(event) => {
            setPlaying(false)
            setScrubbing(true)
            seek(Number(event.target.value) / 1000)
          }}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onKeyUp={endScrub}
          onBlur={endScrub}
          aria-label="Time-lapse position"
          aria-valuetext={date || undefined}
          className="min-w-0 flex-1 accent-garden-accent disabled:opacity-60"
        />
        <span className="w-[92px] shrink-0 text-right font-mono text-[11px] tabular-nums text-garden-text-dim" title="how far the life has grown, in GitHub's days">
          {date}
        </span>
        <select
          value={length}
          disabled={busy}
          onChange={(event) => setLength(Number(event.target.value) as LapseLength)}
          aria-label="Length of a full play"
          title="how long a full play (and a recording) takes"
          className="shrink-0 rounded-md bg-garden-field px-1 py-0.5 text-[11px] text-garden-text outline-none disabled:opacity-60"
        >
          {LAPSE_LENGTHS.map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
        {busy ? (
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording and save"
            title="stop now and save what was recorded"
            className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 font-mono text-[11px] tabular-nums text-garden-danger hover:bg-garden-hover"
          >
            <StopIcon size={12} />
            {clock(elapsed)} / {clock(total)}
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            disabled={recorder !== 'ready' || saving}
            aria-label="Record a video"
            title={RECORDER_TITLES[recorder]}
            className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] text-garden-text-dim hover:bg-garden-hover hover:text-garden-danger disabled:opacity-40"
          >
            <RecordIcon size={12} />
            rec
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the time-lapse"
          className="shrink-0 rounded-lg p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
        >
          <CloseIcon />
        </button>
      </div>
      {(busy || error !== null || notice !== null) && (
        <p className={`px-1 text-[11px] ${error ? 'text-garden-danger' : 'text-garden-muted'}`} role="status">
          {error ?? (busy ? 'recording the canvas: keep this tab in front until it saves' : notice)}
          {error !== null && kept && (
            <>
              . the video is kept:{' '}
              <button type="button" onClick={() => void retrySave()} disabled={saving} className="font-medium text-garden-accent hover:underline">
                try again
              </button>
            </>
          )}
        </p>
      )}
    </div>
  )
}
