/**
 * Person mode's time-lapse (PROFILE_SPEC.md section 6, "Time-lapse and export"): the view on
 * show (any of them) drawn from the timeline's start (the account's creation, or
 * earlier backdated work) to today on the life clock (timeline.ts), with play, scrub and a silent
 * video recording of the canvas.
 *
 * Pure apart from track(), and no DOM: the pace of a play, what the clock shows at a progress, the
 * caption the canvas carries (so a recording names its person, its year and its repos so far, never
 * a repo), and a recording from rec to its download (LapseRecorder). PersonTimelapse runs the
 * controls and the frame loop with these; lifePaint.ts draws the caption over the view while a
 * time-lapse is set. The recorder itself (export/video) and the download (export/exporters) stay in
 * their own chunks: this module only takes their types, and the kit is handed in.
 */
import { track } from '../analytics/umami'
import type { CanvasRecording, VideoType } from '../export/video'
import { isChunkLoadError } from '../lazy/chunk'
import { dayAt, dayKey, type LifeTimeline } from './timeline'
import type { LifeInk, LifeViewport } from './lifeTypes'

/** Seconds a full play takes (the length control), and so a recording, before its hold. */
export const LAPSE_LENGTHS = [10, 20, 40, 60] as const
export type LapseLength = (typeof LAPSE_LENGTHS)[number]
export const LAPSE_DEFAULT_LENGTH: LapseLength = 20
/** A recording lingers this long on the finished view before it saves. */
export const LAPSE_HOLD_MS = 1500
/** Frames a second the recorder captures. */
export const LAPSE_FPS = 30
/**
 * Stop is ignored this long after rec: Stop takes rec's place under the pointer, so it would be
 * the second click of a double click on rec, and save an almost empty video.
 */
export const LAPSE_MIN_TAKE_MS = 400

/** The caption's type: repo mode's LABEL_FONT, copied so person mode takes no new name from the first download. */
const HUD_FONT = 'Inter, ui-sans-serif, system-ui, sans-serif'

/** A play under way: where it started from, when, how long a full play takes, and whether it records. */
export interface LapsePlay {
  /** progress (0..1) when it started */
  from: number
  /** performance time it started at */
  startedAt: number
  lengthS: LapseLength
  recording: boolean
  /** performance time progress first reached 1; -1 until then */
  endedAt: number
}

export interface LapseTick {
  progress: number
  endedAt: number
  /** keep going, stop playing (the end reached, nothing recording), or save the recording */
  next: 'go' | 'stop' | 'save'
}

function clamp01(p: number): number {
  return p >= 1 ? 1 : p > 0 ? p : 0
}

/**
 * One frame of a play at performance time now, paced by the wall clock, so dropped frames never
 * slow it down: progress runs from `from` to 1 over lengthS seconds for a full play. At 1 a play
 * stops; a recording goes on for LAPSE_HOLD_MS on the finished view, then saves.
 */
export function lapseTick(play: LapsePlay, now: number): LapseTick {
  const progress = Math.min(1, clamp01(play.from) + Math.max(0, now - play.startedAt) / (play.lengthS * 1000))
  if (progress < 1) return { progress, endedAt: -1, next: 'go' }
  const endedAt = play.endedAt < 0 ? now : play.endedAt
  if (!play.recording) return { progress, endedAt, next: 'stop' }
  return { progress, endedAt, next: now - endedAt >= LAPSE_HOLD_MS ? 'save' : 'go' }
}

/** What the time-lapse caption shows at a progress. */
export interface LapseCaption {
  /** the GitHub day the clock shows ('YYYY-MM-DD') */
  day: string
  year: string
  /** repos drawn: reached by the clock's day (startDay <= at) and not hidden, the painter's own rule in every view */
  reached: number
}

/** The GitHub day the clock shows at a progress: timeline.start at 0, timeline.today at 1. */
export function lapseDay(timeline: Pick<LifeTimeline, 'clock' | 'startDay' | 'todayDay'>, progress: number): string {
  const at = dayAt(timeline.clock, clamp01(progress))
  return dayKey(Math.min(timeline.todayDay, Math.max(timeline.startDay, Math.floor(at))))
}

/**
 * The caption at a progress, counting the repos drawn as every view decides them: a view's items
 * (its lines or stars, say) are reached on their first day, so the count is the same whichever is on show.
 */
export function lapseCaption(
  timeline: LifeTimeline,
  items: ReadonlyArray<{ key: string; startDay: number }>,
  progress: number,
  hidden: ReadonlySet<string>,
): LapseCaption {
  const p = clamp01(progress)
  const at = dayAt(timeline.clock, p)
  const day = lapseDay(timeline, p)
  let reached = 0
  for (const item of items) if (!(item.startDay > at) && !hidden.has(item.key)) reached++
  return { day, year: day.slice(0, 4), reached }
}

/** 'Apr 2019': a day key read in UTC, so it is GitHub's day whatever the viewer's time zone. */
export function lapseDate(day: string, locale?: string): string {
  const time = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(locale, { year: 'numeric', month: 'short', timeZone: 'UTC' }) : ''
}

/**
 * The caption, drawn on the canvas so recordings carry it, as repo mode's time-lapse does:
 * the year the clock has reached big at the top right with the repos so far under it, the person
 * at the bottom right, and the progress along the bottom edge. In the view's CSS px, under the
 * device transform the frame came in with; each text stroked in the halo colour first.
 */
export function paintLapseHud(ctx: CanvasRenderingContext2D, view: LifeViewport, ink: LifeInk, caption: LapseCaption, progress: number, title: string): void {
  const W = view.width
  const H = view.height
  const p = clamp01(progress)
  ctx.save()
  ctx.globalAlpha = 1
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const text = (s: string, x: number, y: number) => {
    ctx.strokeStyle = ink.textHalo
    ctx.lineWidth = 4
    ctx.strokeText(s, x, y)
    ctx.fillText(s, x, y)
  }
  ctx.font = `600 22px ${HUD_FONT}`
  ctx.fillStyle = ink.text
  text(caption.year, W - 18, 38)
  ctx.font = `12px ${HUD_FONT}`
  ctx.fillStyle = ink.muted
  text(`${caption.reached} repo${caption.reached === 1 ? '' : 's'}`, W - 18, 58)
  ctx.font = `11px ${HUD_FONT}`
  text(`${title} · gitube`, W - 14, H - 14)
  ctx.globalAlpha = 0.85
  ctx.fillStyle = ink.accent
  ctx.fillRect(0, H - 3, W * p, 3)
  ctx.restore()
}

/** Opens the time-lapse from the timeline's start, and counts it (timelapse-play, no data, as in repo mode). */
export function openLifeTimelapse(progress: { current: number }, open: () => void): void {
  progress.current = 0
  open()
  track('timelapse-play')
}

/** Closes it, leaving the whole view on show; counts nothing. */
export function closeLifeTimelapse(progress: { current: number }, close: () => void): void {
  close()
  progress.current = 1
}

/** The exporters (export/exporters) a recording needs: the download and the file name. */
export interface LapseKit {
  downloadBlob(blob: Blob, fileName: string): void
  exportFileName(data: { owner: string; repo: string }, ext: string, now?: Date, kind?: string): string
}

/**
 * Downloads a finished recording as '<login>-life-timelapse-<day>.<ext>', then counts it as
 * TimelapseBar does: export { format: 'webm' }, whatever the browser recorded (Safari's is mp4).
 * Nothing is counted when the download fails; the error is passed on.
 */
export function downloadLifeRecording(video: Blob, type: VideoType, login: string, kit: LapseKit, now: Date = new Date()): void {
  kit.downloadBlob(video, kit.exportFileName({ owner: login, repo: 'life' }, type.ext, now, 'timelapse'))
  track('export', { format: 'webm' })
}

/** What a take needs of export/video's recording. */
export type LapseRec = Pick<CanvasRecording, 'type' | 'finish' | 'cancel'>

/** A finished recording, waiting for its download. */
interface LapseFootage {
  video: Blob
  type: VideoType
}

/**
 * A time-lapse's recordings, outside React (PersonTimelapse keeps one, and the tests drive it as it
 * does): the take under way, and a finished one whose download failed, kept so that trying again
 * saves it without recording again (most often the exporters' chunk would not load: see
 * lazy/chunk.ts).
 *
 * A recording only ever saves under the privacy toggle it was made under: a change throws away the
 * take under way (its recorder cancelled), its save on the way and a kept one, with no file and no
 * export event, so a video never carries a name the toggle has hidden since, or a mix of both.
 */
export class LapseRecorder {
  private take: { rec: LapseRec; startedAt: number } | null = null
  private kept: LapseFootage | null = null
  /** the privacy toggle the take (and so its footage) was made under */
  private revealed = false
  /** a save between the stop and the download */
  private saving = false
  /** counts what was thrown away, so a save on its way can tell that it no longer downloads */
  private run = 0

  /** a take is under way */
  get recording(): boolean {
    return this.take !== null
  }

  /** a finished recording waits for another try at its download (retry) */
  get hasKept(): boolean {
    return this.kept !== null
  }

  /** A new take, made under the privacy toggle as it is now; whatever came before is thrown away. */
  start(rec: LapseRec, now: number, revealed: boolean): void {
    this.cancel()
    this.take = { rec, startedAt: now }
    this.revealed = revealed
  }

  /** Whether Stop, pressed at performance time now, stops the take: never in its first LAPSE_MIN_TAKE_MS. */
  canStop(now: number): boolean {
    return this.take !== null && now - this.take.startedAt >= LAPSE_MIN_TAKE_MS
  }

  /**
   * The privacy toggle as it is now. A change from the one the recording was made under throws the
   * recording away, under way, on its way to the download or kept; true when there was one.
   */
  privacy(revealed: boolean): boolean {
    if (revealed === this.revealed) return false
    const had = this.take !== null || this.saving || this.kept !== null
    this.cancel()
    this.revealed = revealed
    return had
  }

  /** Throws away the take under way (cancelling its recorder), its save on the way and a kept one. */
  cancel(): void {
    this.run++
    this.take?.rec.cancel()
    this.take = null
    this.saving = false
    this.kept = null
  }

  /**
   * Ends the take and downloads it (downloadLifeRecording). True once saved; false when there was no
   * take, or it was thrown away on the way. A failure passes its error on, and once the recorder
   * has handed the video over it stays kept for retry().
   */
  finish(login: string, loadKit: () => Promise<LapseKit>, now: Date = new Date()): Promise<boolean> {
    const take = this.take
    if (take === null) return Promise.resolve(false)
    this.take = null
    // the recorder stops now; the download waits for the exporters (on their way since rec was pressed)
    const video = take.rec.finish()
    return this.save(async () => ({ video: await video, type: take.rec.type }), login, loadKit, now)
  }

  /** Another try at downloading the kept recording, with no new take: as finish(). */
  retry(login: string, loadKit: () => Promise<LapseKit>, now: Date = new Date()): Promise<boolean> {
    const kept = this.kept
    if (kept === null || this.saving) return Promise.resolve(false)
    return this.save(async () => kept, login, loadKit, now)
  }

  private async save(footage: () => Promise<LapseFootage>, login: string, loadKit: () => Promise<LapseKit>, now: Date): Promise<boolean> {
    const run = this.run
    this.saving = true
    try {
      const got = await footage()
      if (run !== this.run) return false
      this.kept = got
      const kit = await loadKit()
      if (run !== this.run) return false
      downloadLifeRecording(got.video, got.type, login, kit, now)
      this.kept = null
      return true
    } finally {
      if (run === this.run) this.saving = false
    }
  }
}

/**
 * What the controls say about a failed save. A part of the app that would not load is the reload
 * case (ErrorCard's chunk_failed), said in the app's words rather than the module URL its message
 * carries; anything else in its own words.
 */
export function lapseSaveError(err: unknown): { chunkFailed: boolean; message: string } {
  if (isChunkLoadError(err)) return { chunkFailed: true, message: "couldn't load the part of gitube that saves videos" }
  return { chunkFailed: false, message: err instanceof Error ? err.message : String(err) }
}
