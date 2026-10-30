/**
 * A person-mode recording, end to end (PROFILE_SPEC.md Phase 5, "a recording plays from the join
 * year to today and respects the privacy toggle"): the recorder captures the view's canvas,
 * painted frame by frame by one painter (as LifeView keeps one while the time-lapse is on) under
 * the time-lapse value PersonApp hands it, its progress written by the controls' clock (lapseTick
 * at LAPSE_FPS) from openLifeTimelapse's 0, through the hold on the grown view, to the save. On
 * every frame the caption's year runs from the timeline's start to today and lines only join; no
 * text drawn or measured on any frame names a private repo while the toggle hides it, and once
 * revealed for this login the names are on the canvas, and a recording the toggle turns under is
 * thrown away, with no file and no event. Then the three events Phase 5 sends (timelapse-play,
 * export webm, poster-export), with a token or without, carry no name, and the files are named
 * after the login alone.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EventData } from '../src/analytics/umami'
import { exportFileName } from '../src/export/repoFile'
import { saveLifePoster, type PosterDeps } from '../src/profile/lifePoster'
import {
  LAPSE_FPS,
  LAPSE_HOLD_MS,
  LAPSE_LENGTHS,
  LapseRecorder,
  closeLifeTimelapse,
  lapseTick,
  openLifeTimelapse,
  type LapseLength,
  type LapsePlay,
} from '../src/profile/lifeTimelapse'
import { githubDay } from '../src/profile/timeline'
import { useAppStore } from '../src/store/useAppStore'
import { getTheme } from '../src/theme/themes'
import type { ProfileData } from '../src/types'
import { LINES_VIEW } from '../src/profile/lifeViews'
import { FAKE_TOKEN, GAEARON_NOW, KEPANO_NOW, gaearonProfile, grow, kepanoProfile, paint, painterFor, withPrivate, type Grown } from './helpers/personScene'
import { recordingCtx } from './helpers/recordingCtx'

const noop = () => {}
const theme = getTheme('obsidian')
/** The caption's year: repo mode's time-lapse date type. */
const HUD_YEAR_FONT = '600 22px Inter, ui-sans-serif, system-ui, sans-serif'
/** The shortest play, so a whole recording stays quick to paint. */
const LENGTH: LapseLength = LAPSE_LENGTHS[0]
const NOW = new Date(2026, 9, 25, 12)

const WEBM = { mimeType: 'video/webm', ext: 'webm' } as const

/** As in personGuards: kepano's top-starred repo, his own, one he contributed to, a seedling fork and an archived one, made private. */
const KEPANO_PRIVATE = ['kepano/obsidian-skills', 'kepano/tidy', 'obsidianmd/wordgard', 'kepano/bookcover-api', 'kepano/obsidian-highlights-sidebar']

let kepano: ProfileData
let gaearon: ProfileData
let secret: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
  secret = withPrivate(kepano, KEPANO_PRIVATE)
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState({ token: '' })
})

/** The tracker, stubbed as tests/umami.test.ts does. */
function stubTracker() {
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '' } })
  return umamiTrack
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A private name, whole, with or without its owner (the labels drop the person's own login). */
const SECRETS = KEPANO_PRIVATE.flatMap((name) => [
  new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w.-])`, 'i'),
  new RegExp(`(?<![\\w./-])${escape(name.slice(name.indexOf('/') + 1))}(?![\\w./-])`, 'i'),
])

const leaks = (texts: readonly string[]): string[] => texts.filter((text) => SECRETS.some((secret) => secret.test(text)))

interface Frame {
  progress: number
  /** the caption's year */
  year: string | undefined
  /** lineTo calls: life lines' strokes */
  strokes: number
  /** the caption names the person and the app */
  credited: boolean
}

/**
 * A whole recording as PersonTimelapse runs one: opened at 0, then a frame every 1/LAPSE_FPS s,
 * paced by lapseTick, until it says save. One painter throughout, under PersonApp's time-lapse
 * value ({ progress, title: the login }); each frame's texts are checked as they come.
 */
function record(g: Grown) {
  stubTracker()
  const progress = { current: 1 }
  openLifeTimelapse(progress, noop)
  const { painter, measured } = painterFor(g, {}, { timelapse: { progress, title: g.profile.login } })
  const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
  const frames: Frame[] = []
  const leaked: string[] = []
  const play: LapsePlay = { from: progress.current, startedAt: 0, lengthS: LENGTH, recording: true, endedAt: -1 }
  for (let frame = 0; frame < 10_000; frame++) {
    const tick = lapseTick(play, (frame * 1000) / LAPSE_FPS)
    play.endedAt = tick.endedAt
    if (progress.current < 1) progress.current = tick.progress
    painter.paint(rec.ctx, g.view, g.camera, 1000 / LAPSE_FPS)
    const texts = rec.texts()
    leaked.push(...leaks(texts))
    const year = rec.calls('fillText').find((c) => c.style.font === HUD_YEAR_FONT)?.args[0]
    frames.push({
      progress: progress.current,
      year: typeof year === 'string' ? year : undefined,
      strokes: rec.calls('lineTo').length,
      credited: texts.includes(`${g.profile.login} · gitube`),
    })
    rec.clear()
    if (tick.next === 'save') break
  }
  return { frames, leaked: [...leaked, ...leaks(measured)], measured }
}

describe('a recording of a life', () => {
  it('plays from the start year (through the join year) to today, lines only joining, then holds and saves', () => {
    for (const [label, profile, now] of [
      ['kepano (graphql)', kepano, KEPANO_NOW],
      ['gaearon (rest)', gaearon, GAEARON_NOW],
    ] as const) {
      const g = grow(profile, now, theme)
      const { frames } = record(g)
      // a frame a tick for the play, then the hold on the grown view
      expect(frames.length, label).toBe(LENGTH * LAPSE_FPS + (LAPSE_HOLD_MS * LAPSE_FPS) / 1000 + 1)
      expect(frames[0].progress, label).toBe(0)
      expect(frames.findIndex((f) => f.progress === 1), label).toBe(LENGTH * LAPSE_FPS)
      expect(frames.slice(LENGTH * LAPSE_FPS).every((f) => f.progress === 1), label).toBe(true)

      const years = frames.map((f) => f.year)
      expect(years.every((year) => year !== undefined && /^\d{4}$/.test(year)), label).toBe(true)
      expect(years[0], label).toBe(g.timeline.start.slice(0, 4))
      expect(years[years.length - 1], label).toBe(g.timeline.today.slice(0, 4))
      // the account's year goes by on the way (kepano's calendar starts before his account does)
      const joined = githubDay(profile.createdAt)!.slice(0, 4)
      expect(Number(years[0]), label).toBeLessThanOrEqual(Number(joined))
      expect(years, label).toContain(joined)
      for (let i = 1; i < frames.length; i++) {
        expect(Number(years[i]), `${label} frame ${i}`).toBeGreaterThanOrEqual(Number(years[i - 1]))
        expect(frames[i].strokes, `${label} frame ${i}`).toBeGreaterThanOrEqual(frames[i - 1].strokes)
      }
      expect(frames.every((f) => f.credited), label).toBe(true)
      // it starts sparse and ends fully grown, as a still frame
      expect(frames[0].strokes, label).toBeLessThan(frames[frames.length - 1].strokes)
      expect(frames[frames.length - 1].strokes, label).toBe(paint(g).rec.calls('lineTo').length)
    }
  })

  it('never names a private repo on any frame while hidden, or revealed for another login', () => {
    for (const revealFor of [null, 'someone-else']) {
      const { frames, leaked } = record(grow(secret, KEPANO_NOW, theme, revealFor))
      expect(frames.length).toBeGreaterThan(LENGTH * LAPSE_FPS)
      expect(leaked, String(revealFor)).toEqual([])
    }
  })

  it('carries the names once revealed for this login, as the screen shows them', () => {
    const { leaked, measured } = record(grow(secret, KEPANO_NOW, theme, 'KEPANO'))
    expect(leaked.length).toBeGreaterThan(0)
    expect(measured).toContain('obsidian-skills')
    expect(measured).toContain('obsidianmd/wordgard')
  })

  it('throws the recording away when the toggle hides the names under it: no file, no event', async () => {
    const umamiTrack = stubTracker()
    const downloads: string[] = []
    const kit = { downloadBlob: (_blob: Blob, fileName: string) => void downloads.push(fileName), exportFileName }
    const progress = { current: 1 }
    openLifeTimelapse(progress, noop)
    umamiTrack.mockClear()
    // rec pressed with the names revealed for this login
    const recorder = new LapseRecorder()
    const take = { type: WEBM, finish: vi.fn(async () => new Blob(['frames'])), cancel: vi.fn() }
    recorder.start(take, 0, true)
    const timelapse = { progress, title: secret.login }
    // the view's painter, one per namer: the revealed one, then the hidden one once the toggle turns
    let { painter } = painterFor(grow(secret, KEPANO_NOW, theme, 'KEPANO'), {}, { timelapse })
    const g = grow(secret, KEPANO_NOW, theme)
    const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
    const play: LapsePlay = { from: progress.current, startedAt: 0, lengthS: LENGTH, recording: true, endedAt: -1 }
    // turned in the hold, the private repos all on the canvas by then
    const turn = LENGTH * LAPSE_FPS + 10
    const before: string[] = []
    const after: string[] = []
    let saved: boolean | null = null
    for (let frame = 0; frame < 10_000; frame++) {
      const tick = lapseTick(play, (frame * 1000) / LAPSE_FPS)
      play.endedAt = tick.endedAt
      if (progress.current < 1) progress.current = tick.progress
      if (frame === turn) {
        expect(recorder.privacy(false)).toBe(true)
        painter = painterFor(g, {}, { timelapse }).painter
      }
      painter.paint(rec.ctx, g.view, g.camera, 1000 / LAPSE_FPS)
      ;(frame < turn ? before : after).push(...rec.texts())
      rec.clear()
      // the stop at the end of the hold
      if (tick.next === 'save') {
        saved = await recorder.finish(secret.login, async () => kit, NOW)
        break
      }
    }
    // the frames before the turn named private repos (a file would have kept them), and none after
    expect(leaks(before).length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
    expect(leaks(after)).toEqual([])
    expect(take.cancel).toHaveBeenCalledTimes(1)
    expect(take.finish).not.toHaveBeenCalled()
    expect(saved).toBe(false)
    expect(downloads).toEqual([])
    expect(umamiTrack).not.toHaveBeenCalled()
  })
})

describe("Phase 5's events", () => {
  it('sends timelapse-play, export webm and poster-export, none with a name, with a token or without', async () => {
    for (const token of ['', FAKE_TOKEN]) {
      useAppStore.setState({ token })
      const umamiTrack = stubTracker()
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      const downloads: string[] = []
      const kit = {
        canvasToPng: async () => new Blob(['png']),
        downloadBlob: (_blob: Blob, fileName: string) => void downloads.push(fileName),
        exportFileName,
      }
      const deps: Partial<PosterDeps> = {
        loadKit: async () => kit,
        loadAvatar: async () => null,
        makeCanvas: (width, height) => {
          const rec = recordingCtx(width, height)
          return { width, height, getContext: (kind: string) => (kind === '2d' ? rec.ctx : null) } as unknown as HTMLCanvasElement
        },
        now: () => NOW,
        measure: (text) => text.length * 6.5,
      }
      // the privacy toggle hides the names, as it does by default
      const g = grow(secret, KEPANO_NOW, theme)

      const progress = { current: 1 }
      openLifeTimelapse(progress, noop)
      closeLifeTimelapse(progress, noop)
      const recorder = new LapseRecorder()
      recorder.start({ type: WEBM, finish: async () => new Blob(['webm']), cancel: noop }, 0, false)
      expect(await recorder.finish(g.profile.login, async () => kit, NOW)).toBe(true)
      const { profile, timeline, layout, colourOf, name } = g
      await saveLifePoster({ profile, timeline, layout, view: LINES_VIEW, theme, colourOf, name, hidden: new Set() }, deps)

      expect(umamiTrack.mock.calls, token ? 'with a token' : 'without one').toEqual([['timelapse-play'], ['export', { format: 'webm' }], ['poster-export']])
      const sent = JSON.stringify(umamiTrack.mock.calls)
      expect(sent).not.toMatch(/kepano/i)
      expect(leaks([sent])).toEqual([])
      expect(downloads).toEqual(['kepano-life-timelapse-2026-10-25.webm', 'kepano-life-poster-2026-10-25.png'])
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  })
})
