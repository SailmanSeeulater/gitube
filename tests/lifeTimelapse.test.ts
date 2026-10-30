/**
 * Person mode's time-lapse (PROFILE_SPEC.md Phase 5): a play paced by the wall clock, which runs
 * from the timeline's start (the join year on these recordings) to today; the caption the canvas
 * carries; the view it draws (life lines), painted by the view's own painter on a recording context,
 * only ever adding lines, labels and repos; a hit test that never names a repo before it appears; the
 * privacy toggle on every frame, caption included; frames asked for only while the time-lapse is
 * live or its progress moves; and the analytics it sends: timelapse-play when it opens, export
 * { format: 'webm' } when a recording is saved, never a name. A recording from rec to its download
 * (LapseRecorder): thrown away when the privacy toggle changes under it, deaf to a stop in its first
 * moments, and kept for another try when the exporters' chunk will not load. Also the controls'
 * markup (react-dom/server).
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportFileName } from '../src/export/repoFile'
import type { VideoType } from '../src/export/video'
import { ChunkLoadError } from '../src/lazy/chunk'
import { useAppStore } from '../src/store/useAppStore'
import { getTheme } from '../src/theme/themes'
import LifeView from '../src/profile/LifeViewCanvas'
import { LINES_VIEW } from '../src/profile/lifeViews'
import { linesAnchor } from '../src/profile/lifeLinesPaint'
import PersonTimelapse from '../src/profile/PersonTimelapse'
import {
  LAPSE_DEFAULT_LENGTH,
  LAPSE_FPS,
  LAPSE_HOLD_MS,
  LAPSE_LENGTHS,
  LAPSE_MIN_TAKE_MS,
  LapseRecorder,
  closeLifeTimelapse,
  downloadLifeRecording,
  lapseCaption,
  lapseDate,
  lapseDay,
  lapseSaveError,
  lapseTick,
  openLifeTimelapse,
  paintLapseHud,
  type LapseKit,
  type LapsePlay,
} from '../src/profile/lifeTimelapse'
import type { LifePainter } from '../src/profile/lifePaint'
import { dayAt, dayNumber, githubDay } from '../src/profile/timeline'
import { repoKey } from '../src/profile/privacy'
import { LIFE_LABEL_FONT, labelNames, lifeLabelSpec } from '../src/profile/useLifeLabels'
import type { ProfileData } from '../src/types'
import { recordingCtx } from './helpers/recordingCtx'
import { GAEARON_NOW, KEPANO_NOW, VIEW, gaearonProfile, load, kepanoProfile, paint, painterFor, quietCtx, withPrivate, type Loaded } from './helpers/personScene'

const theme = getTheme('obsidian')
/** The caption's year: repo mode's time-lapse date, in its LABEL_FONT. */
const HUD_YEAR_FONT = '600 22px Inter, ui-sans-serif, system-ui, sans-serif'
const PROGRESSES = [0, 0.25, 0.5, 0.75, 1]

/** kepano's repos made private: the top-starred one, his own, one he only contributed to, a fork with no counted commits, an archived one. */
const KEPANO_PRIVATE = ['kepano/obsidian-skills', 'kepano/tidy', 'obsidianmd/wordgard', 'kepano/bookcover-api', 'kepano/obsidian-highlights-sidebar']

let kepano: ProfileData
let gaearon: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState({ token: '' })
})

/** The tracker, stubbed as tests/umami.test.ts does: every event the app sends lands here. */
function stubTracker() {
  const umamiTrack = vi.fn<(event: string, data?: Record<string, unknown>) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '' } })
  return umamiTrack
}

const play = (over: Partial<LapsePlay> = {}): LapsePlay => ({ from: 0, startedAt: 1000, lengthS: 20, recording: false, endedAt: -1, ...over })

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A private repo's full name, and its name without the owner (own repos are labelled without it), each as a whole name. */
function secretsOf(names: readonly string[]): RegExp[] {
  return names.flatMap((name) => [
    new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w.-])`, 'i'),
    new RegExp(`(?<![\\w./-])${escape(name.slice(name.indexOf('/') + 1))}(?![\\w./-])`, 'i'),
  ])
}

function expectNoSecret(texts: readonly string[], names: readonly string[], where: string): void {
  for (const secret of secretsOf(names)) for (const text of texts) expect(secret.test(text), `${secret} in ${where}: ${text}`).toBe(false)
}

/** The labels drawn on a frame: the label font's fillText calls. */
const labelTexts = (rec: ReturnType<typeof recordingCtx>) => rec.calls('fillText').filter((c) => c.style.font === LIFE_LABEL_FONT).map((c) => String(c.args[0]))

/** The time-lapse's day at a progress, as the painter reads it. */
const atOf = (g: Loaded, p: number) => dayAt(g.timeline.clock, p)

describe('lapseTick', () => {
  it('paces a play by the wall clock, whatever frames came between, and stops at the end', () => {
    expect(lapseTick(play(), 1000)).toEqual({ progress: 0, endedAt: -1, next: 'go' })
    expect(lapseTick(play(), 6000)).toEqual({ progress: 0.25, endedAt: -1, next: 'go' })
    // dropped frames: the same moment is the same progress
    expect(lapseTick(play(), 11000).progress).toBe(0.5)
    // a frame stamped before the play started never goes back
    expect(lapseTick(play(), 900).progress).toBe(0)
    expect(lapseTick(play(), 21000)).toEqual({ progress: 1, endedAt: 21000, next: 'stop' })
    // clamped at 1
    expect(lapseTick(play(), 99000)).toMatchObject({ progress: 1, next: 'stop' })
    // the length control
    expect(lapseTick(play({ lengthS: 10 }), 6000).progress).toBe(0.5)
  })

  it('holds a recording on the finished view, then saves it', () => {
    const rec = play({ recording: true })
    const end = lapseTick(rec, 21000)
    expect(end).toEqual({ progress: 1, endedAt: 21000, next: 'go' })
    const held = { ...rec, endedAt: end.endedAt }
    expect(lapseTick(held, 21000 + LAPSE_HOLD_MS - 1)).toEqual({ progress: 1, endedAt: 21000, next: 'go' })
    expect(lapseTick(held, 21000 + LAPSE_HOLD_MS)).toEqual({ progress: 1, endedAt: 21000, next: 'save' })
  })

  it('resumes from where the scrubber left it', () => {
    const resumed = play({ from: 0.25, lengthS: 40, startedAt: 5000 })
    expect(lapseTick(resumed, 5000).progress).toBe(0.25)
    expect(lapseTick(resumed, 15000).progress).toBe(0.5)
    expect(lapseTick(resumed, 35000)).toMatchObject({ progress: 1, next: 'stop' })
  })

  it('offers the lengths of repo mode, 20 seconds first', () => {
    expect([...LAPSE_LENGTHS]).toEqual([10, 20, 40, 60])
    expect(LAPSE_DEFAULT_LENGTH).toBe(20)
    expect(LAPSE_FPS).toBe(30)
  })
})

describe('lapseDate and lapseDay', () => {
  it("reads a day key as GitHub's day, never the viewer's", () => {
    expect(lapseDate('2019-04-01', 'en-US')).toBe('Apr 2019')
    expect(lapseDate('2019-12-31', 'en-US')).toBe('Dec 2019')
    expect(lapseDate('2020-01-01', 'en-US')).toBe('Jan 2020')
    expect(lapseDate('not a day', 'en-US')).toBe('')
  })

  it('runs from the timeline start to today', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    expect(lapseDay(g.timeline, 0)).toBe(g.timeline.start)
    expect(lapseDay(g.timeline, 1)).toBe(g.timeline.today)
    expect(lapseDay(g.timeline, -1)).toBe(g.timeline.start)
    expect(lapseDay(g.timeline, 2)).toBe(g.timeline.today)
    expect(lapseDay(g.timeline, Number.NaN)).toBe(g.timeline.start)
  })
})

describe('a play from the join year to today', () => {
  const profiles = () => [
    { label: 'kepano (graphql)', profile: kepano, now: KEPANO_NOW },
    { label: 'gaearon (rest)', profile: gaearon, now: GAEARON_NOW },
  ]

  it('shows every day from the start to today in order, and sows every repo not hidden by the end', () => {
    for (const { label, profile, now } of profiles()) {
      const g = load(profile, now, theme)
      // two repos hidden with the eye
      const hidden = new Set(g.layout.lines.slice(0, 2).map((line) => line.key))
      const lapse = play({ startedAt: 0, lengthS: LAPSE_DEFAULT_LENGTH })
      const captions = []
      for (let frame = 0; frame <= LAPSE_DEFAULT_LENGTH * LAPSE_FPS; frame++) {
        const tick = lapseTick(lapse, (frame * 1000) / LAPSE_FPS)
        captions.push(lapseCaption(g.timeline, g.layout.lines, tick.progress, hidden))
        if (tick.next !== 'go') break
      }
      const first = captions[0]
      const last = captions[captions.length - 1]
      const joined = githubDay(profile.createdAt)!
      // the clock's start: the account's creation, or earlier work (kepano's calendar has commits from 2013, before his 2015 account)
      expect(first.day, label).toBe(g.timeline.start)
      expect(first.day <= joined, label).toBe(true)
      expect(captions.some((c) => c.year === joined.slice(0, 4)), label).toBe(true)
      expect(last.day, label).toBe(g.timeline.today)
      expect(last.year, label).toBe(g.timeline.today.slice(0, 4))
      for (let i = 1; i < captions.length; i++) {
        expect(dayNumber(captions[i].day), label).toBeGreaterThanOrEqual(dayNumber(captions[i - 1].day))
        expect(captions[i].reached, label).toBeGreaterThanOrEqual(captions[i - 1].reached)
      }
      expect(last.reached, label).toBe(g.layout.lines.length - hidden.size)
      expect(first.reached, label).toBeLessThan(last.reached)
      // the years go by one after another
      const years = [...new Set(captions.map((c) => c.year))]
      expect(years.length, label).toBe(Number(last.year) - Number(first.year) + 1)
    }
  })

  it('draws the view frame by frame: lines and labels only ever join, each once its repo is reached', () => {
    for (const { label, profile, now } of profiles()) {
      const g = load(profile, now, theme)
      const names = labelNames(g.layout.lines, g.timeline, g.name, profile.login)
      // painterFor's measure
      const measure = (text: string) => text.length * 6.5
      const forms = names.map((name, i) => lifeLabelSpec(i, name, measure).texts)
      let strokes = -1
      let reachedBefore = -1
      for (const p of PROGRESSES) {
        const { rec } = paint(g, { progress: p })
        const count = rec.calls('lineTo').length
        expect(count, `${label} at ${p}`).toBeGreaterThanOrEqual(strokes)
        strokes = count
        const at = atOf(g, p)
        const reached = new Set<string>()
        const unreached = new Set<string>()
        g.layout.lines.forEach((line, i) => {
          for (const text of forms[i]) (line.startDay > at ? unreached : reached).add(text)
        })
        const drawn = labelTexts(rec)
        expect(drawn.filter((text) => unreached.has(text) && !reached.has(text)), `${label} at ${p}`).toEqual([])
        // halfway, some repos are up and labelled and some are still to come
        if (p === 0.5) {
          expect(unreached.size, label).toBeGreaterThan(0)
          expect(drawn.filter((text) => reached.has(text)).length, label).toBeGreaterThan(0)
        }
        const { reached: repos } = lapseCaption(g.timeline, g.layout.lines, p, new Set())
        expect(repos, `${label} at ${p}`).toBeGreaterThanOrEqual(reachedBefore)
        reachedBefore = repos
      }
      // fully drawn at the end: as many strokes as a frame with no time-lapse
      expect(strokes, label).toBe(paint(g).rec.calls('lineTo').length)
      expect(paint(g, { progress: 0 }).rec.calls('lineTo').length, label).toBeLessThan(strokes)
    }
  })

  it('captions the canvas with the year, the repos so far and the person, only while a time-lapse is on', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    for (const p of PROGRESSES) {
      const { rec } = paint(g, { progress: p })
      const caption = lapseCaption(g.timeline, g.layout.lines, p, new Set())
      const texts = rec.calls('fillText').map((c) => String(c.args[0]))
      expect(texts).toContain(caption.year)
      expect(texts).toContain(`${caption.reached} repo${caption.reached === 1 ? '' : 's'}`)
      expect(texts).toContain('kepano · gitube')
      // over the labels, so a label never covers it
      const year = rec.log.findIndex((e) => e.kind === 'call' && e.name === 'fillText' && e.args[0] === caption.year && e.style.font === HUD_YEAR_FONT)
      // (the repos so far share the labels' 12 px type)
      const lastLabel = rec.log.findLastIndex((e) => e.kind === 'call' && e.name === 'fillText' && e.style.font === LIFE_LABEL_FONT && !/^\d+ repos?$/.test(String(e.args[0])))
      expect(year).toBeGreaterThan(lastLabel)
      // the progress bar along the bottom edge
      expect(rec.calls('fillRect').some((c) => c.args[0] === 0 && c.args[1] === g.view.height - 3 && c.args[2] === g.view.width * p)).toBe(true)
    }
    const still = paint(g).rec.calls('fillText').map((c) => String(c.args[0]))
    expect(still.some((text) => text.includes('gitube'))).toBe(false)
    // a title given names the caption instead of the login
    const titled = painterFor(g, {}, { timelapse: { progress: { current: 0.5 }, title: 'Kepano' } }).painter
    const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
    titled.paint(rec.ctx, g.view, g.camera, 16)
    expect(rec.texts()).toContain('Kepano · gitube')
  })

  it('never names a repo before it appears: a hit on where it will appear is a day', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const full = paint(g).painter
    const p = 0.5
    const lapse = paint(g, { progress: p }).painter
    const at = atOf(g, p)
    // each line's start marker, fully drawn
    const out = new Float32Array(3)
    const later = g.layout.lines
      .map((line, i) => (linesAnchor(g.layout, g.geoms, i, null, out), { line, x: out[0], y: out[1] }))
      .filter(({ line, x, y }) => line.startDay > at && x > 0 && x < g.view.width && full.hitAt(x, y)?.kind === 'repo' && (full.hitAt(x, y) as { key: string }).key === line.key)
    expect(later.length).toBeGreaterThanOrEqual(3)
    const hits = later.map(({ x, y }) => lapse.hitAt(x, y))
    for (const [k, hit] of hits.entries()) {
      expect(hit?.kind === 'repo' && hit.key === later[k].line.key).toBe(false)
      if (hit?.kind === 'repo') expect(g.layout.lines[g.layout.byKey.get(hit.key)!].startDay).toBeLessThanOrEqual(at)
      expect(lapse.pickAt(later[k].x, later[k].y)).not.toBe(later[k].line.key)
    }
    expect(hits.some((hit) => hit?.kind === 'day')).toBe(true)
    // once drawn, the same spot is the repo again
    const drawnShare = paint(g, { progress: 1 }).painter
    expect(drawnShare.hitAt(later[0].x, later[0].y)).toEqual({ kind: 'repo', key: later[0].line.key })
  })
})

describe('the privacy toggle on every frame', () => {
  it('keeps private names out of every text drawn or measured, labels and caption alike, until revealed for this login', () => {
    const profile = withPrivate(kepano, KEPANO_PRIVATE)
    for (const revealFor of [null, 'someone-else']) {
      const g = load(profile, KEPANO_NOW, theme, revealFor)
      for (const p of PROGRESSES) {
        const { rec, measured } = paint(g, { progress: p })
        expectNoSecret([...rec.texts(), ...measured], KEPANO_PRIVATE, `${revealFor} at ${p}`)
        // hovered and selected too: their plates
        for (const key of KEPANO_PRIVATE.map(repoKey)) {
          const state = paint(g, { progress: p, hover: { kind: 'repo', key }, selected: key })
          expectNoSecret([...state.rec.texts(), ...state.measured], KEPANO_PRIVATE, `${revealFor} at ${p}, ${key} picked`)
        }
      }
      // and the markup of the canvas and the controls
      const html = [
        renderToStaticMarkup(
          h(LifeView, { ...g, def: LINES_VIEW, login: profile.login, timelapse: { progress: { current: 0.5 }, title: profile.login } }),
        ),
        renderToStaticMarkup(
          h(PersonTimelapse, { onClose: () => {}, timeline: g.timeline, login: profile.login, progress: { current: 0 }, getCanvas: () => null, besidePanel: true, revealed: false }),
        ),
      ]
      expectNoSecret(html, KEPANO_PRIVATE, `${revealFor} markup`)
    }
    const shown = load(profile, KEPANO_NOW, theme, 'KEPANO')
    const { measured } = paint(shown, { progress: 1 })
    expect(measured).toContain('obsidian-skills')
    expect(measured).toContain('obsidianmd/wordgard')
  })
})

describe('paintLapseHud', () => {
  it('draws in the view, haloed, from the theme, and leaves the context as it came', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
    rec.ctx.setTransform(2, 0, 0, 2, 0, 0)
    paintLapseHud(rec.ctx, g.view, g.ink, { day: '2019-04-01', year: '2019', reached: 1 }, 0.4, 'kepano')
    expect(rec.calls('setTransform')).toHaveLength(1)
    expect(rec.calls('save')).toHaveLength(1)
    expect(rec.calls('restore')).toHaveLength(1)
    expect(rec.calls('quadraticCurveTo')).toHaveLength(0)
    const fills = rec.calls('fillText')
    expect(fills.map((c) => c.args.slice(0, 3))).toEqual([
      ['2019', g.view.width - 18, 38],
      ['1 repo', g.view.width - 18, 58],
      ['kepano · gitube', g.view.width - 14, g.view.height - 14],
    ])
    expect(fills[0].style).toMatchObject({ fillStyle: g.ink.text, font: HUD_YEAR_FONT })
    expect(fills[1].style.fillStyle).toBe(g.ink.muted)
    // each text stroked in the halo first
    expect(rec.calls('strokeText').map((c) => [c.args[0], c.style.strokeStyle])).toEqual(fills.map((c) => [c.args[0], g.ink.textHalo]))
    expect(rec.calls('fillRect')).toEqual([expect.objectContaining({ args: [0, g.view.height - 3, g.view.width * 0.4, 3] })])
    expect(rec.calls('fillRect')[0].style.fillStyle).toBe(g.ink.accent)
  })

  it('counts the repos the painter draws: reached and not hidden', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const all = new Set(g.layout.lines.map((line) => line.key))
    expect(lapseCaption(g.timeline, g.layout.lines, 1, new Set()).reached).toBe(g.layout.lines.length)
    expect(lapseCaption(g.timeline, g.layout.lines, 1, all).reached).toBe(0)
    const at = atOf(g, 0.5)
    expect(lapseCaption(g.timeline, g.layout.lines, 0.5, new Set()).reached).toBe(g.layout.lines.filter((line) => line.startDay <= at).length)
    // a progress that is no number paints the start rather than throwing
    const quiet = quietCtx(10, 10)
    expect(() => painterFor(g, {}, { timelapse: { progress: { current: Number.NaN } } }).painter.paint(quiet, g.view, g.camera, 16)).not.toThrow()
  })
})

describe('opening and closing', () => {
  it('opens from the start and sends timelapse-play, with no data', () => {
    const umamiTrack = stubTracker()
    const progress = { current: 1 }
    const open = vi.fn(() => expect(progress.current).toBe(0))
    openLifeTimelapse(progress, open)
    expect(progress.current).toBe(0)
    expect(open).toHaveBeenCalledTimes(1)
    expect(umamiTrack.mock.calls).toEqual([['timelapse-play']])
  })

  it('closes on the whole view, and sends nothing', () => {
    const umamiTrack = stubTracker()
    const progress = { current: 0.3 }
    const close = vi.fn()
    closeLifeTimelapse(progress, close)
    expect(close).toHaveBeenCalledTimes(1)
    expect(progress.current).toBe(1)
    expect(umamiTrack).not.toHaveBeenCalled()
  })
})

describe('frames while the time-lapse is on', () => {
  const quiet = quietCtx(VIEW.width * 2, VIEW.height * 2)

  /** Frames painted until one asks for no other; Infinity when they keep coming for limit frames. */
  function framesUntilStill(painter: LifePainter, g: Loaded, limit = 400): number {
    for (let n = 1; n <= limit; n++) if (!painter.paint(quiet, g.view, g.camera, 16)) return n
    return Number.POSITIVE_INFINITY
  }

  it('leaves a paused time-lapse still: frames only while the labels settle or the progress moves', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const progress = { current: 0.5 }
    const { painter } = painterFor(g, {}, { timelapse: { progress, live: false } })
    // the labels settle, then the canvas is still
    expect(framesUntilStill(painter, g)).toBeLessThan(400)
    expect(painter.paint(quiet, g.view, g.camera, 16)).toBe(false)
    expect(painter.paint(quiet, g.view, g.camera, 16)).toBe(false)
    // a step too small to sow a repo, so no label moves: one frame more sees it still
    progress.current = 0.5 + 1e-6
    expect(painter.paint(quiet, g.view, g.camera, 16)).toBe(true)
    expect(painter.paint(quiet, g.view, g.camera, 16)).toBe(false)
    // a scrub, or the play's last step: frames come until one sees the progress still
    for (const p of [0.75, 0.2, 1]) {
      progress.current = p
      expect(painter.paint(quiet, g.view, g.camera, 16), `at ${p}`).toBe(true)
      expect(framesUntilStill(painter, g), `at ${p}`).toBeLessThan(400)
      expect(painter.paint(quiet, g.view, g.camera, 16), `at ${p}`).toBe(false)
    }
    // and with no time-lapse, a settled view asks for none
    const still = painterFor(g).painter
    expect(framesUntilStill(still, g)).toBeLessThan(400)
    expect(still.paint(quiet, g.view, g.camera, 16)).toBe(false)
  })

  it('keeps every frame coming while live (or not said), the progress still or not, as a recording needs through its hold', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    for (const timelapse of [{ progress: { current: 1 }, live: true }, { progress: { current: 1 } }]) {
      const { painter } = painterFor(g, {}, { timelapse })
      // the labels settled first, as they are on the finished map a recording holds on
      for (let i = 0; i < 400 && painter.labels.placer.busy; i++) painter.paint(quiet, g.view, g.camera, 16)
      expect(painter.labels.placer.busy).toBe(false)
      for (let frame = 0; frame <= (LAPSE_HOLD_MS * LAPSE_FPS) / 1000; frame++) expect(painter.paint(quiet, g.view, g.camera, 16), `frame ${frame}`).toBe(true)
    }
  })
})

describe('a recording, from rec to its download', () => {
  const NOW = new Date(2026, 9, 25, 12)
  const WEBM: VideoType = { mimeType: 'video/webm;codecs=vp9', ext: 'webm' }
  const FILE = 'kepano-life-timelapse-2026-10-25.webm'

  function kit() {
    const downloads: Array<[Blob, string]> = []
    return { downloads, downloadBlob: (blob: Blob, fileName: string) => void downloads.push([blob, fileName]), exportFileName }
  }

  /** export/video's recording, stood in for: finished, it hands over video (or fails with it); it counts how it ended. */
  function take(video: Blob | Error = new Blob(['frames'], { type: 'video/webm' }), type: VideoType = WEBM) {
    return {
      type,
      finish: vi.fn(() => (video instanceof Error ? Promise.reject(video) : Promise.resolve(video))),
      cancel: vi.fn(),
    }
  }

  /** The exporters' chunk failing as a dropped connection leaves it, its message naming the module. */
  const chunkFailure = () => new ChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://gitube.example/assets/exporters-DP1rtgNo.js'))

  it("downloads the person's recording, then counts it as a webm export with no name", async () => {
    for (const token of ['', 'test-token-not-real']) {
      useAppStore.setState({ token })
      const umamiTrack = stubTracker()
      const video = new Blob(['frames'], { type: 'video/webm' })
      const k = kit()
      umamiTrack.mockImplementation(() => expect(k.downloads).toHaveLength(1))
      const recorder = new LapseRecorder()
      const rec = take(video)
      recorder.start(rec, 0, false)
      expect(recorder.recording).toBe(true)
      expect(await recorder.finish('kepano', async () => k, NOW)).toBe(true)
      expect(recorder.recording).toBe(false)
      expect(recorder.hasKept).toBe(false)
      expect(rec.finish).toHaveBeenCalledTimes(1)
      expect(rec.cancel).not.toHaveBeenCalled()
      expect(k.downloads).toEqual([[video, FILE]])
      expect(umamiTrack.mock.calls).toEqual([['export', { format: 'webm' }]])
      expect(JSON.stringify(umamiTrack.mock.calls)).not.toMatch(/kepano|login|repo/)
    }
  })

  it("counts Safari's mp4 as the time-lapse video export too", () => {
    const umamiTrack = stubTracker()
    const k = kit()
    downloadLifeRecording(new Blob(['x']), { mimeType: 'video/mp4', ext: 'mp4' }, 'SailmanSeeulater', k, NOW)
    expect(k.downloads.map(([, name]) => name)).toEqual(['SailmanSeeulater-life-timelapse-2026-10-25.mp4'])
    expect(umamiTrack.mock.calls).toEqual([['export', { format: 'webm' }]])
  })

  it('counts nothing when the recording fails, and has nothing to keep', async () => {
    const umamiTrack = stubTracker()
    const k = kit()
    const recorder = new LapseRecorder()
    recorder.start(take(new Error('the recording failed')), 0, false)
    const failed = recorder.finish('kepano', async () => k, NOW)
    await expect(failed).rejects.toThrow('the recording failed')
    expect(recorder.hasKept).toBe(false)
    expect(await recorder.retry('kepano', async () => k, NOW)).toBe(false)
    expect(k.downloads).toEqual([])
    expect(umamiTrack).not.toHaveBeenCalled()
    expect(lapseSaveError(new Error('the recording failed'))).toEqual({ chunkFailed: false, message: 'the recording failed' })
  })

  it('throws the recording away when the privacy toggle changes under it: no file, no event', async () => {
    for (const [from, to] of [
      [true, false],
      [false, true],
    ]) {
      const umamiTrack = stubTracker()
      const k = kit()
      const recorder = new LapseRecorder()
      const rec = take()
      recorder.start(rec, 0, from)
      // the toggle as it was changes nothing
      expect(recorder.privacy(from)).toBe(false)
      expect(recorder.recording).toBe(true)
      // turned the other way mid-recording: the recorder is cancelled
      expect(recorder.privacy(to)).toBe(true)
      expect(rec.cancel).toHaveBeenCalledTimes(1)
      expect(recorder.recording).toBe(false)
      expect(recorder.canStop(10_000)).toBe(false)
      // the stop, or the end of the hold, that would have saved it
      expect(await recorder.finish('kepano', async () => k, NOW)).toBe(false)
      expect(rec.finish).not.toHaveBeenCalled()
      expect(k.downloads).toEqual([])
      expect(umamiTrack).not.toHaveBeenCalled()
      // a new take under the toggle as it is now saves as ever
      recorder.start(take(), 5000, to)
      expect(await recorder.finish('kepano', async () => k, NOW)).toBe(true)
      expect(k.downloads.map(([, name]) => name)).toEqual([FILE])
      expect(umamiTrack.mock.calls).toEqual([['export', { format: 'webm' }]])
    }
  })

  it('throws it away on its way to the download, or kept after a failed one, too', async () => {
    const umamiTrack = stubTracker()
    const k = kit()
    const recorder = new LapseRecorder()
    // stopped revealed, the exporters still on their way when the toggle hides the names
    let arrive: (kit: LapseKit) => void = () => {}
    const exporters = new Promise<LapseKit>((resolve) => (arrive = resolve))
    recorder.start(take(), 0, true)
    const saved = recorder.finish('kepano', () => exporters, NOW)
    expect(recorder.privacy(false)).toBe(true)
    arrive(k)
    expect(await saved).toBe(false)
    // kept after the exporters failed to load, then the toggle turned
    recorder.start(take(), 0, true)
    await expect(recorder.finish('kepano', () => Promise.reject(chunkFailure()), NOW)).rejects.toBeInstanceOf(ChunkLoadError)
    expect(recorder.hasKept).toBe(true)
    expect(recorder.privacy(false)).toBe(true)
    expect(recorder.hasKept).toBe(false)
    expect(await recorder.retry('kepano', async () => k, NOW)).toBe(false)
    expect(k.downloads).toEqual([])
    expect(umamiTrack).not.toHaveBeenCalled()
    // with nothing recorded, the toggle throws nothing away
    expect(recorder.privacy(true)).toBe(false)
  })

  it('ignores a stop in the first moments of a take: the second click of a double click on rec', async () => {
    const recorder = new LapseRecorder()
    expect(recorder.canStop(0)).toBe(false)
    const rec = take()
    recorder.start(rec, 1000, false)
    expect(LAPSE_MIN_TAKE_MS).toBe(400)
    expect(recorder.canStop(1000)).toBe(false)
    expect(recorder.canStop(1000 + LAPSE_MIN_TAKE_MS - 1)).toBe(false)
    expect(recorder.recording).toBe(true)
    expect(rec.finish).not.toHaveBeenCalled()
    expect(recorder.canStop(1000 + LAPSE_MIN_TAKE_MS)).toBe(true)
    // a recording played to its end saves after its hold, well past it
    expect(LAPSE_LENGTHS[0] * 1000 + LAPSE_HOLD_MS).toBeGreaterThan(LAPSE_MIN_TAKE_MS)
    stubTracker()
    expect(await recorder.finish('kepano', async () => kit(), NOW)).toBe(true)
    expect(recorder.canStop(10_000)).toBe(false)
  })

  it("keeps the video when the exporters' chunk will not load, says so as the reload case, and saves it on another try without recording again", async () => {
    const umamiTrack = stubTracker()
    const k = kit()
    const recorder = new LapseRecorder()
    const video = new Blob(['frames'], { type: 'video/webm' })
    const rec = take(video)
    recorder.start(rec, 0, false)
    const failure = chunkFailure()
    const err = await recorder.finish('kepano', () => Promise.reject(failure), NOW).catch((e: unknown) => e)
    expect(err).toBe(failure)
    // the reload case, in the app's words: no module URL
    expect(lapseSaveError(err)).toEqual({ chunkFailed: true, message: "couldn't load the part of gitube that saves videos" })
    expect(lapseSaveError(err).message).not.toMatch(/https?:|\.js|import/)
    expect(recorder.hasKept).toBe(true)
    expect(k.downloads).toEqual([])
    expect(umamiTrack).not.toHaveBeenCalled()
    // the chunk fails again: still kept
    await expect(recorder.retry('kepano', () => Promise.reject(chunkFailure()), NOW)).rejects.toBeInstanceOf(ChunkLoadError)
    expect(recorder.hasKept).toBe(true)
    // it loads: the same video, from the one take
    expect(await recorder.retry('kepano', async () => k, NOW)).toBe(true)
    expect(k.downloads).toEqual([[video, FILE]])
    expect(rec.finish).toHaveBeenCalledTimes(1)
    expect(umamiTrack.mock.calls).toEqual([['export', { format: 'webm' }]])
    expect(recorder.hasKept).toBe(false)
    expect(await recorder.retry('kepano', async () => k, NOW)).toBe(false)
    expect(k.downloads).toHaveLength(1)
  })

  it('keeps it when the download itself fails, and a new take or closing the controls throws it away', async () => {
    stubTracker()
    const recorder = new LapseRecorder()
    const k = kit()
    const broken = {
      ...k,
      downloadBlob: () => {
        throw new Error('the download was blocked')
      },
    }
    recorder.start(take(), 0, false)
    await expect(recorder.finish('kepano', async () => broken, NOW)).rejects.toThrow('the download was blocked')
    expect(lapseSaveError(new Error('the download was blocked'))).toEqual({ chunkFailed: false, message: 'the download was blocked' })
    expect(recorder.hasKept).toBe(true)
    // a new take replaces it
    const next = take()
    recorder.start(next, 0, false)
    expect(recorder.hasKept).toBe(false)
    // closing the controls mid-take cancels the recorder, and nothing saves after
    recorder.cancel()
    expect(next.cancel).toHaveBeenCalledTimes(1)
    expect(await recorder.finish('kepano', async () => k, NOW)).toBe(false)
    expect(k.downloads).toEqual([])
  })
})

describe('PersonTimelapse', () => {
  it('renders the controls: play, scrubber, lengths, rec (waiting for the recorder) and close', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const html = renderToStaticMarkup(
      h(PersonTimelapse, { onClose: () => {}, timeline: g.timeline, login: 'kepano', progress: { current: 1 }, getCanvas: () => null, besidePanel: false, revealed: true }),
    )
    expect(html).toContain('role="group" aria-label="Time-lapse"')
    // it starts playing
    expect(html).toContain('aria-label="Pause"')
    expect(html).toMatch(/type="range"[^>]*aria-label="Time-lapse position"/)
    expect(html).toContain(`aria-valuetext="${lapseDate(g.timeline.start)}"`)
    for (const s of LAPSE_LENGTHS) expect(html).toMatch(new RegExp(`<option value="${s}"[^>]*>${s}s</option>`))
    expect(html).toContain('title="how long a full play (and a recording) takes"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Record a video" title="loading the recorder…"/)
    expect(html).toContain('aria-label="Close the time-lapse"')
    // no music box in a life, and nothing recording yet
    expect(html).not.toMatch(/music box/i)
    expect(html).not.toContain('recording the canvas')
    expect(html).not.toContain('kepano')
  })
})
