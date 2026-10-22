import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { readSound, writeSound } from '../audio/context'
import { MusicBox } from '../audio/musicBox'
import { buildScore, notesBetween, pickNotes } from '../graph/score'
import { clockAt, type Timeline } from '../graph/timeline'
import { gardenFileName } from '../export/gardenFile'
import { downloadBlob } from '../export/image'
import { pickVideoType, recordCanvas, type CanvasRecording } from '../export/video'
import type { Graph, RepoData } from '../types'
import { CloseIcon, MuteIcon, PauseIcon, PlayIcon, RecordIcon, SoundIcon, StopIcon } from './icons'

export interface TimelapseBarProps {
  onClose: () => void
  /** the graph on show */
  graph: Graph
  /** the repo it was built from: its branches give the music box its pitches, its name the recording's */
  data: RepoData
  /** of the graph on show */
  timeline: Timeline | null
  /** 0..1, shared with Garden, which reads it every frame */
  progress: RefObject<number>
  /** the graph canvas to record */
  getCanvas: () => HTMLCanvasElement | null
  /** the side panel is open: keep clear of it */
  besidePanel: boolean
}

/** Playback lengths offered, in seconds. */
const LENGTHS = [10, 20, 40, 60] as const
/** A recording holds the grown garden this long before it ends. */
const HOLD_MS = 1500
/** Notes struck in one frame at most (pickNotes thins a burst of commits to this). */
const NOTES_PER_FRAME = 4
/** Presses that count as a user gesture for starting audio. */
const GESTURES = ['click', 'touchend', 'keydown'] as const

function shortDate(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The time-lapse controls, mounted while the time-lapse is on (it starts playing from the first
 * commit): play/pause, a scrubber over the garden's history, the length of a full play, the music
 * box (each commit a note as it appears), and recording the canvas, with its sound, to a video
 * file. Unmounting throws away an unfinished recording and closes the audio.
 */
export default function TimelapseBar({ onClose, graph, data, timeline, progress, getCanvas, besidePanel }: TimelapseBarProps) {
  // the same history as notes, for the music box (pitches follow the palette's branch order)
  const score = useMemo(
    () => (timeline ? buildScore(graph, timeline, data.branches.map((b) => b.name), data.defaultBranch) : null),
    [graph, timeline, data],
  )
  const [playing, setPlaying] = useState(true)
  const [shown, setShown] = useState(0)
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(20)
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<CanvasRecording | null>(null)
  const [canRecord] = useState(() => pickVideoType() !== null)

  // ---- the music box: on by choice (remembered); the instrument is made on the first click ----
  const [sound, setSound] = useState(readSound)
  const soundRef = useRef(sound)
  soundRef.current = sound
  const musicRef = useRef<MusicBox | null>(null)
  const scoreRef = useRef(score)
  scoreRef.current = score
  /** progress whose notes have sounded; a seek moves it without playing what was skipped */
  const heardRef = useRef(-1)
  const ensureMusic = (): MusicBox | null => {
    if (!musicRef.current && typeof AudioContext !== 'undefined') musicRef.current = new MusicBox()
    void musicRef.current?.resume()
    return musicRef.current
  }
  const toggleSound = () => {
    const next = !sound
    if (next) ensureMusic()
    setSound(next)
    writeSound(next)
  }
  // Left on last time: ready the instrument now. Audio may start at once: the click that opened the
  // time-lapse counts when these controls mount within it (their chunk was loaded already), or when
  // App unlocked audio in it (audio/context.ts). Otherwise WebKit keeps it suspended, so the next
  // press anywhere starts it.
  useEffect(() => {
    if (soundRef.current) ensureMusic()
    const stopWaking = () => {
      for (const type of GESTURES) window.removeEventListener(type, wake, true)
    }
    const wake = () => {
      stopWaking()
      if (soundRef.current) ensureMusic()
    }
    if (musicRef.current && !musicRef.current.running) {
      for (const type of GESTURES) window.addEventListener(type, wake, true)
    }
    return () => {
      stopWaking()
      musicRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const seek = (p: number) => {
    progress.current = Math.min(1, Math.max(0, p))
    // from the very start, the first commit still sounds
    heardRef.current = progress.current === 0 ? -1 : progress.current
    setShown(progress.current)
  }

  // the garden starts from its first commit
  useLayoutEffect(() => {
    progress.current = 0
    heardRef.current = -1
  }, [progress])

  // ---- playback, paced by the clock (not by frames, so dropped frames never slow it down); Garden
  // repaints every frame while this is mounted ----
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const startedAt = performance.now()
    const from = progress.current
    let endedAt = -1
    const step = (now: number) => {
      if (progress.current < 1) {
        progress.current = Math.min(1, from + (now - startedAt) / (length * 1000))
        setShown(progress.current)
      }
      // the commits that appeared since the last frame, as notes (dropped while the audio is not
      // running yet, rather than all sounding at once when it starts)
      const music = musicRef.current
      const notes = scoreRef.current
      if (soundRef.current && music?.running && notes) {
        for (const note of pickNotes(notesBetween(notes, heardRef.current, progress.current), NOTES_PER_FRAME)) music.play(note)
      }
      heardRef.current = progress.current
      const rec = recorderRef.current
      if (rec) setElapsed(now - (recording?.startedAt ?? now))
      if (progress.current >= 1) {
        if (!rec) {
          setPlaying(false)
          return
        }
        // a recording lingers on the grown garden, then saves
        if (endedAt < 0) endedAt = now
        if (now - endedAt >= HOLD_MS) {
          void finishRecording()
          return
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // finishRecording reads refs only; recording only matters for its start time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, length, recording])

  // closing never leaves a recorder running
  useEffect(() => () => recorderRef.current?.cancel(), [])

  const finishRecording = async () => {
    const rec = recorderRef.current
    if (!rec) return
    recorderRef.current = null
    setRecording(null)
    setPlaying(false)
    try {
      downloadBlob(await rec.finish(), gardenFileName(data, rec.type.ext, new Date(), 'timelapse'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const startRecording = () => {
    const canvas = getCanvas()
    if (!canvas) return
    setError(null)
    try {
      seek(0)
      // with the music box on, its mix is the sound track
      const music = sound ? ensureMusic() : null
      recorderRef.current = recordCanvas(canvas, 30, music?.stream ?? null)
      setElapsed(0)
      setRecording({ startedAt: performance.now() })
      setPlaying(true)
    } catch (err) {
      recorderRef.current = null
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const togglePlay = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (progress.current >= 1) seek(0)
    if (sound) ensureMusic()
    setPlaying(true)
  }

  const now = timeline ? clockAt(timeline, shown) : null
  const busy = recording !== null
  const total = length * 1000 + HOLD_MS

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
            seek(Number(event.target.value) / 1000)
          }}
          aria-label="Time-lapse position"
          aria-valuetext={now ? shortDate(now.time) : undefined}
          className="min-w-0 flex-1 accent-garden-accent disabled:opacity-60"
        />
        <span className="w-[92px] shrink-0 text-right font-mono text-[11px] tabular-nums text-garden-text-dim" title="the date of the newest commit on show">
          {now ? shortDate(now.time) : ''}
        </span>
        <select
          value={length}
          disabled={busy}
          onChange={(event) => setLength(Number(event.target.value) as (typeof LENGTHS)[number])}
          aria-label="Length of a full play"
          title="how long a full play (and a recording) takes"
          className="shrink-0 rounded-md bg-garden-field px-1 py-0.5 text-[11px] text-garden-text outline-none disabled:opacity-60"
        >
          {LENGTHS.map((s) => (
            <option key={s} value={s}>
              {s}s
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          aria-label={sound ? 'Music box on' : 'Music box off'}
          title="music box: every commit plays a note as it appears. each branch has its own pitch, merges are chords, and recordings carry the sound"
          className={`shrink-0 rounded-lg p-1 hover:bg-garden-hover ${sound ? 'text-garden-accent' : 'text-garden-muted hover:text-garden-text'}`}
        >
          {sound ? <SoundIcon size={15} /> : <MuteIcon size={15} />}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => void finishRecording()}
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
            disabled={!canRecord}
            aria-label="Record a video"
            title={canRecord ? 'play from the start and save it as a video' : "this browser can't record video"}
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
      {(busy || error) && (
        <p className={`px-1 text-[11px] ${error ? 'text-garden-danger' : 'text-garden-muted'}`} role="status">
          {error ?? 'recording the canvas: keep this tab in front until it saves'}
        </p>
      )}
    </div>
  )
}
