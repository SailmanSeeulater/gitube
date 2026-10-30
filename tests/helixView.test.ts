/**
 * The helix view (an amber vector display, the life wound into a coil one turn a year, each repo a
 * thread on its own ring): its layout packs rings in lane order and samples every span on the
 * calendar, pure and deterministic (the same repos in any order give the same layout); its geometry
 * puts January 1 at the top of every turn and the near side of the coil to the right; its hit test
 * finds every drawn thread at its label anchor and skips hidden and unwound ones; its painter draws
 * a hidden or unwound thread not at all, winds threads on with the time-lapse, draws the far side
 * dimmer, draws no repo name, keeps to the helix palette whatever the theme, and copes with a person
 * with no repos.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { HELIX_VIEW } from '../src/profile/helixView'
import { SAMPLE_DAYS, angleAt, layoutHelix, ringGapDays, yearStartsOf, type HelixLayout } from '../src/profile/helixLayout'
import { ACTIVE_PX, DORMANT_PX, START_PX, drawnTo, helixGeom, pointAt, spanWidth, walkSpan, wound, type HelixGeom } from '../src/profile/helixGeometry'
import { hitHelix } from '../src/profile/helixHit'
import { FAR_ALPHA, LANDED_PX, helixAnchor, helixKeepOut, helixLabelOrder, paintHelix } from '../src/profile/helixPaint'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { buildLifeTimeline, dayAt, dayNumber, type LifeTimeline } from '../src/profile/timeline'
import { fetchProfileRest } from '../src/api/profile'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import type { LifeCamera, LifeHover, LifeViewport } from '../src/profile/lifeTypes'
import { HELIX_PALETTE } from '../src/theme/console/helix'
import { contrastRatio } from '../src/theme/colour'
import { THEMES, getTheme } from '../src/theme/themes'
import type { ProfileData, ProfileRepo } from '../src/types'
import layoutSource from '../src/profile/helixLayout.ts?raw'
import geometrySource from '../src/profile/helixGeometry.ts?raw'
import paintSource from '../src/profile/helixPaint.ts?raw'
import hitSource from '../src/profile/helixHit.ts?raw'
import viewSource from '../src/profile/helixView.ts?raw'
import { recordingCtx, type CtxEntry, type RecordingCtx } from './helpers/recordingCtx'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'

// The recordings replayed as personScene does (not imported from it: it pulls in every view's registry).
const FAKE_TOKEN = 'test-token-not-real'
const kepanoProfile = () => fetchProfileGraphql('kepano', { token: FAKE_TOKEN, fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW })
const gaearonProfile = () => fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW })
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

const NOW = Date.parse('2024-06-15T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`
const theme = getTheme('obsidian')
const TWO_PI = Math.PI * 2

function repo(nameWithOwner: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner,
    createdAt,
    firstActiveAt: createdAt,
    lastActiveAt: createdAt,
    isOwn: true,
    language: 'TypeScript',
    languageColor: null,
    stars: 0,
    forks: 0,
    isFork: false,
    isArchived: false,
    isPrivate: false,
    activity: [],
    ...over,
  }
}

function profile(over: Partial<ProfileData> = {}): ProfileData {
  return {
    login: 'me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2019-01-10'),
    source: 'graphql',
    repos: [],
    days: [],
    recent: [],
    recentFrom: null,
    milestones: [],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    landed: [],
    fallback: null,
    ...over,
  }
}

/** A commit on the first of each month from..to (inclusive, 'YYYY-MM'). */
function monthly(from: string, to: string, commits = 2): ProfileRepo['activity'] {
  const out: ProfileRepo['activity'] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-01`, commits })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

/** A seeded shuffle, so a failure reproduces. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function shuffledProfile(p: ProfileData, seed: number): ProfileData {
  return { ...p, repos: shuffled(p.repos, seed).map((r, i) => ({ ...r, activity: shuffled(r.activity, seed * 31 + i) })), milestones: shuffled(p.milestones, seed + 7) }
}

/** Busy and quiet repos, a starred one, an archived one, one they contributed to, a fork, two rooted the same day, a long dormant stretch. */
const RICH = profile({
  repos: [
    repo('me/busy', { createdAt: iso('2019-02-01'), stars: 900, language: 'Go', activity: monthly('2019-02', '2021-06', 6) }),
    repo('me/steady', { createdAt: iso('2019-03-04'), stars: 12, activity: monthly('2019-03', '2020-12', 3) }),
    repo('me/quiet', { createdAt: iso('2019-04-02'), activity: [{ date: '2019-04-02', commits: 1 }] }),
    repo('me/twin-a', { createdAt: iso('2020-05-05'), language: null, activity: monthly('2020-05', '2020-08', 1) }),
    repo('me/twin-b', { createdAt: iso('2020-05-05'), language: null, activity: monthly('2020-05', '2020-08', 1) }),
    repo('me/old', { createdAt: iso('2019-06-01'), isArchived: true, activity: monthly('2019-06', '2019-09', 2) }),
    repo('other/lib', { createdAt: iso('2018-01-01'), firstActiveAt: iso('2021-01-10'), isOwn: false, stars: 40, language: 'Rust', activity: monthly('2021-01', '2021-03', 2) }),
    repo('me/fork', { createdAt: iso('2021-02-02'), isFork: true, activity: monthly('2021-02', '2021-02', 1) }),
    repo('me/revived', { createdAt: iso('2019-08-01'), activity: [...monthly('2019-08', '2019-10', 2), ...monthly('2023-08', '2023-10', 2)] }),
  ],
})
const NAMES = RICH.repos.map((r) => r.nameWithOwner)

interface Scene {
  timeline: LifeTimeline
  layout: HelixLayout
  camera: LifeCamera
  view: LifeViewport
  g: HelixGeom
}

function scene(p: ProfileData, now: number, view: LifeViewport = VIEW, camera?: LifeCamera): Scene {
  const timeline = buildLifeTimeline(p, now)
  const layout = layoutHelix(timeline, p.source)
  const cam = camera ?? fitLifeCamera(layout.days, view)
  return { timeline, layout, camera: cam, view, g: helixGeom(layout, cam, view) }
}

interface PaintOpts {
  hidden?: ReadonlySet<string>
  hover?: LifeHover
  selected?: string | null
  at?: number | null
  themeId?: string
}

function paintLog(s: Scene, opts: PaintOpts = {}) {
  const t = opts.themeId ? getTheme(opts.themeId) : theme
  const palette = languagePalette(s.timeline, t)
  const rec = recordingCtx(s.view.width * 2, s.view.height * 2)
  paintHelix(rec.ctx, {
    layout: s.layout,
    timeline: s.timeline,
    geoms: s.g,
    camera: s.camera,
    view: s.view,
    ink: lifeInk(t),
    colourOf: (language) => languageColour(palette, language, t),
    hidden: opts.hidden ?? new Set(),
    hover: opts.hover ?? null,
    selected: opts.selected ?? null,
    at: opts.at ?? null,
  })
  return rec
}

/** The strokes in the thread colours (amber, or dim), as the painter batches them. */
function threadStrokes(rec: RecordingCtx) {
  return rec.calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.thread || c.style.strokeStyle === HELIX_PALETTE.dim || c.style.strokeStyle === HELIX_PALETTE.bright)
}

/** How many lineTo calls a frame has: the threads' and the cage's segments. */
const lineTos = (rec: RecordingCtx) => rec.calls('lineTo').length

let kepano: ProfileData
let gaearon: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
})

describe('the calendar', () => {
  it('lays January 1 of every year of the life down, from the first to the one after the last', () => {
    const start = dayNumber('2019-01-10')
    const starts = yearStartsOf(start, 2000)
    expect(Array.from(starts)).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025'].map((y) => dayNumber(`${y}-01-01`) - start))
    expect(starts[0]).toBeLessThanOrEqual(0)
    expect(starts[starts.length - 1]).toBeGreaterThanOrEqual(2000)
    // a one-day life still has its year and the next
    expect(yearStartsOf(dayNumber('2020-06-01'), 1).length).toBe(2)
  })

  it('winds a day round the coil by its share of its calendar year: January 1 at 0, the middle of the year at π, a leap year 366 days long', () => {
    const start = dayNumber('2019-01-01')
    const starts = yearStartsOf(start, 4 * 366)
    expect(angleAt(starts, 0)).toBe(0)
    expect(angleAt(starts, 365)).toBe(0)
    expect(angleAt(starts, 365 + 366)).toBe(0)
    expect(angleAt(starts, 365 / 2)).toBeCloseTo(Math.PI, 9)
    expect(angleAt(starts, 365 + 183)).toBeCloseTo(Math.PI, 9)
    expect(angleAt(starts, 365 + 365)).toBeCloseTo(TWO_PI * (365 / 366), 9)
    // past the years laid down, the pace of the nearest year
    expect(angleAt(starts, -10)).toBeCloseTo(-TWO_PI * (10 / 365), 9)
    // monotone within a year
    let last = -1
    for (let x = 0; x < 365; x += 0.5) {
      const a = angleAt(starts, x)
      expect(a).toBeGreaterThan(last)
      last = a
    }
  })
})

describe('the layout', () => {
  it('winds each repo on its ring at its root, tiles its days with spans, and paints by ring then x', () => {
    const timeline = buildLifeTimeline(RICH, NOW)
    const layout = layoutHelix(timeline, 'graphql')
    expect(layout.threads).toHaveLength(RICH.repos.length)
    expect(layout.tracks).toBeGreaterThan(1)
    expect(layout.tracks).toBeLessThanOrEqual(RICH.repos.length)
    for (const [i, thread] of layout.threads.entries()) {
      const lane = timeline.lanes[thread.lane]
      expect(thread.x).toBe(lane.rootDay - timeline.startDay + 0.5)
      expect(thread.startDay).toBe(lane.startDay)
      expect(thread.x0).toBe(Math.min(lane.startDay, lane.rootDay) - timeline.startDay)
      expect(thread.x1).toBe(lane.endDay + 1 - timeline.startDay)
      expect(thread.end).toBeLessThanOrEqual(thread.x1)
      expect(layout.byKey.get(thread.key)).toBe(i)
      if (i > 0) {
        const prev = layout.threads[i - 1]
        expect(prev.track < thread.track || (prev.track === thread.track && prev.x <= thread.x)).toBe(true)
      }
      // the spans tile x0 to end, active first, in turn
      expect(thread.spans.length).toBeGreaterThan(0)
      expect(thread.spans[0].x0).toBe(thread.x0)
      expect(thread.spans[0].kind).toBe('active')
      expect(thread.spans[thread.spans.length - 1].x1).toBe(thread.end)
      for (let s = 1; s < thread.spans.length; s++) {
        expect(thread.spans[s].x0).toBe(thread.spans[s - 1].x1)
        expect(thread.spans[s].kind).not.toBe(thread.spans[s - 1].kind)
      }
      for (const span of thread.spans) {
        expect(span.weight).toBeGreaterThanOrEqual(0)
        expect(span.weight).toBeLessThanOrEqual(1)
        if (span.kind === 'dormant') expect(span.weight).toBe(0)
        else expect(span.weight).toBeGreaterThan(0)
      }
    }
    const busy = layout.threads[layout.byKey.get('me/busy')!]
    expect(Math.max(...busy.spans.map((s) => s.weight))).toBe(1)
    expect(busy.weight).toBe(Math.max(...layout.threads.map((t) => t.weight)))
    expect(layout.threads[layout.byKey.get('me/old')!].dry).toBe(true)
    expect(layout.threads[layout.byKey.get('other/lib')!].visiting).toBe(true)
    expect(layout.threads[layout.byKey.get('me/fork')!].fork).toBe(true)
    expect(layout.threads[layout.byKey.get('me/revived')!].spans.some((s) => s.kind === 'dormant')).toBe(true)
  })

  it('shares a ring between threads that let go a gap apart, and cuts a dormant tail short of the next, never an active span', () => {
    const timeline = buildLifeTimeline(RICH, NOW)
    const layout = layoutHelix(timeline, 'graphql')
    const gap = ringGapDays(layout.days)
    expect(gap).toBe(Math.max(14, Math.round(layout.days / 100)))
    const byTrack = new Map<number, typeof layout.threads>()
    for (const t of layout.threads) byTrack.set(t.track, [...(byTrack.get(t.track) ?? []), t])
    let shared = 0
    for (const list of byTrack.values()) {
      for (let k = 1; k < list.length; k++) {
        shared++
        expect(list[k - 1].end + gap).toBeLessThanOrEqual(list[k].x0 + 1e-9)
        // the earlier thread's active spans all end before the later starts
        for (const span of list[k - 1].spans) if (span.kind === 'active') expect(span.x1 + gap).toBeLessThanOrEqual(list[k].x0 + 1e-9)
      }
    }
    expect(shared).toBeGreaterThan(0)
    // the quiet repo's dormant tail is cut, an active span never
    const quiet = layout.threads[layout.byKey.get('me/quiet')!]
    expect(quiet.end).toBeLessThan(quiet.x1)
    const k = layoutHelix(buildLifeTimeline(kepano, KEPANO_NOW), 'graphql')
    expect(k.tracks).toBeLessThan(k.threads.length / 2)
  })

  it('samples every span SAMPLE_DAYS apart and at both its ends, with its angle on the calendar', () => {
    const layout = layoutHelix(buildLifeTimeline(RICH, NOW), 'graphql')
    let seen = 0
    for (const thread of layout.threads) {
      for (const span of thread.spans) {
        const xs = Array.from(layout.sampleX.slice(span.from, span.from + span.count))
        expect(xs[0]).toBe(span.x0)
        expect(xs[xs.length - 1]).toBe(span.x1)
        for (let k = 1; k < xs.length; k++) {
          expect(xs[k]).toBeGreaterThan(xs[k - 1])
          expect(xs[k] - xs[k - 1]).toBeLessThanOrEqual(SAMPLE_DAYS + 1e-9)
          if (k < xs.length - 1) expect(xs[k] - xs[k - 1]).toBe(SAMPLE_DAYS)
        }
        for (let k = span.from; k < span.from + span.count; k++) {
          const a = angleAt(layout.yearStarts, layout.sampleX[k])
          expect(layout.sampleCos[k]).toBeCloseTo(Math.cos(a), 5)
          expect(layout.sampleSin[k]).toBeCloseTo(Math.sin(a), 5)
        }
        seen += span.count
      }
    }
    expect(seen).toBe(layout.sampleX.length)
    expect(layout.sampleCos.length).toBe(seen)
  })

  it('is the same for the same repos in any order, and twice over', () => {
    const layout = layoutHelix(buildLifeTimeline(RICH, NOW), 'graphql')
    for (const seed of [1, 4, 9, 23]) expect(layoutHelix(buildLifeTimeline(shuffledProfile(RICH, seed), NOW), 'graphql'), `seed ${seed}`).toEqual(layout)
    const k = layoutHelix(buildLifeTimeline(kepano, KEPANO_NOW), 'graphql')
    expect(layoutHelix(buildLifeTimeline(shuffledProfile(kepano, 3), KEPANO_NOW), 'graphql')).toEqual(k)
    const g = layoutHelix(buildLifeTimeline(gaearon, GAEARON_NOW), 'rest')
    expect(g.threads).toHaveLength(gaearon.repos.length)
    expect(layoutHelix(buildLifeTimeline(shuffledProfile(gaearon, 5), GAEARON_NOW), 'rest')).toEqual(g)
    // without a token every active span weighs the same
    for (const thread of g.threads) for (const span of thread.spans) expect(span.weight).toBe(span.kind === 'active' ? 1 : 0)
  })

  it('keeps a renamed repo where it was: nothing is seeded from a name', () => {
    const renamed = profile({ repos: RICH.repos.map((r) => ({ ...r, nameWithOwner: r.nameWithOwner.replace('me/', 'me/zz-') })) })
    const a = layoutHelix(buildLifeTimeline(RICH, NOW), 'graphql')
    const b = layoutHelix(buildLifeTimeline(renamed, NOW), 'graphql')
    const strip = (l: HelixLayout) => l.threads.map(({ key: _key, ...rest }) => rest)
    expect(strip(b)).toEqual(strip(a))
  })

  it('serves a person with no repos: no threads, the axis and the coil alone', () => {
    const s = scene(profile(), NOW)
    expect(s.layout.threads).toEqual([])
    expect(s.layout.tracks).toBe(0)
    expect(s.layout.days).toBeGreaterThan(0)
    expect(helixLabelOrder(s.layout)).toHaveLength(0)
    const rec = paintLog(s)
    expect(rec.calls('fillRect').length).toBeGreaterThan(0)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === HELIX_PALETTE.cage)).toBe(true)
    expect(rec.texts().some((t) => /^\d{4}$/.test(t))).toBe(true)
    expect(hitHelix(s.layout, s.g, s.camera, s.view, 400, horizonY(s.view) - 50, new Set(), null)?.kind).toBe('day')
  })
})

describe('the geometry', () => {
  it('centres the coil in the plot, January 1 at its top and the middle of the year at its bottom, the near side to the right', () => {
    const s = scene(RICH, NOW)
    const top = s.view.top
    const bottom = horizonY(s.view)
    expect(s.g.cy).toBe((top + bottom) / 2)
    expect(s.g.R).toBe((bottom - top) / 2 - 10)
    expect(s.g.skew).toBeGreaterThan(0)
    expect(s.g.skew).toBeLessThanOrEqual(s.view.side)
    const jan = s.layout.yearStarts[1]
    const [jx, jy, jd] = pointAt(s.layout, s.g, s.g.R, jan)
    expect(jy).toBeCloseTo(top + 10, 6)
    expect(jx).toBeCloseTo(s.camera.tx + jan * s.camera.k, 6)
    expect(jd).toBeCloseTo(0, 6)
    const year = s.layout.yearStarts[2] - jan
    const [, my, md] = pointAt(s.layout, s.g, s.g.R, jan + year / 2)
    expect(my).toBeCloseTo(bottom - 10, 6)
    expect(md).toBeCloseTo(0, 6)
    // a quarter in: the near side, to the right of the axis; three quarters in: the far side, to the left
    const [qx, qy, qd] = pointAt(s.layout, s.g, s.g.R, jan + year / 4)
    expect(qd).toBeCloseTo(1, 6)
    expect(qx - (s.camera.tx + (jan + year / 4) * s.camera.k)).toBeCloseTo(s.g.skew, 6)
    expect(qy).toBeCloseTo(s.g.cy, 6)
    const [tx, , td] = pointAt(s.layout, s.g, s.g.R, jan + (3 * year) / 4)
    expect(td).toBeCloseTo(-1, 6)
    expect(tx - (s.camera.tx + (jan + (3 * year) / 4) * s.camera.k)).toBeCloseTo(-s.g.skew, 6)
    // rings count in, each smaller, none under two fifths of the coil
    expect(s.g.ring.length).toBe(s.layout.tracks)
    expect(s.g.ring[0]).toBe(s.g.R)
    for (let t = 1; t < s.g.ring.length; t++) expect(s.g.ring[t]).toBeLessThan(s.g.ring[t - 1])
    expect(s.g.ring[s.g.ring.length - 1]).toBeGreaterThanOrEqual(s.g.R * 0.4 - 1e-9)
    // the coil never leaves the canvas, slant and all
    const k = scene(kepano, KEPANO_NOW)
    expect(k.g.skew).toBeLessThanOrEqual(k.view.side)
    expect(k.g.ring[k.g.ring.length - 1]).toBeGreaterThanOrEqual(k.g.R * 0.4 - 1e-9)
  })

  it('widens an active span by its weight, keeps a dormant one thin, and thins every thread as the turns crowd together', () => {
    const full = { thin: 1 }
    expect(spanWidth({ kind: 'dormant', weight: 0 }, full)).toBe(DORMANT_PX)
    expect(spanWidth({ kind: 'active', weight: 0.1 }, full)).toBe(ACTIVE_PX[0])
    expect(spanWidth({ kind: 'active', weight: 0.5 }, full)).toBe(ACTIVE_PX[1])
    expect(spanWidth({ kind: 'active', weight: 1 }, full)).toBe(ACTIVE_PX[2])
    expect(spanWidth({ kind: 'active', weight: 1 }, { thin: 0.5 })).toBe(ACTIVE_PX[2] / 2)
    expect(ACTIVE_PX[0]).toBeLessThan(ACTIVE_PX[1])
    expect(ACTIVE_PX[1]).toBeLessThan(ACTIVE_PX[2])
    expect(DORMANT_PX).toBeLessThan(ACTIVE_PX[0])
    // a short life fitted to the plot has long turns: full width; kepano's twelve years, thinner; zoomed in, full again
    expect(scene(RICH, NOW).g.thin).toBe(1)
    const k = scene(kepano, KEPANO_NOW)
    expect(k.g.thin).toBeLessThan(1)
    expect(k.g.thin).toBeGreaterThanOrEqual(0.45)
    expect(scene(kepano, KEPANO_NOW, VIEW, { k: 1, tx: 0 }).g.thin).toBe(1)
    expect(scene(kepano, KEPANO_NOW, VIEW, { k: 0.01, tx: 0 }).g.thin).toBe(0.45)
  })

  it('winds a thread on with the time-lapse: its dot on its first day, its stretch to the day reached, all of it from its last', () => {
    const s = scene(RICH, NOW)
    const i = s.layout.byKey.get('me/busy')!
    const thread = s.layout.threads[i]
    expect(wound(thread, thread.startDay - 1)).toBe(false)
    expect(wound(thread, thread.startDay)).toBe(true)
    expect(wound(thread, null)).toBe(true)
    expect(drawnTo(thread, s.layout.startDay, thread.startDay)).toBe(thread.x0)
    expect(drawnTo(thread, s.layout.startDay, null)).toBe(thread.end)
    expect(drawnTo(thread, s.layout.startDay, thread.endDay + 10)).toBe(thread.end)
    let last = -Infinity
    for (let day = thread.startDay; day <= thread.endDay + 1; day += 30) {
      const to = drawnTo(thread, s.layout.startDay, day)
      expect(to).toBeGreaterThanOrEqual(last)
      last = to
    }
  })

  it('walks a span to the day reached: its samples under it, then the point there, in x order', () => {
    const s = scene(RICH, NOW)
    const thread = s.layout.threads[s.layout.byKey.get('me/busy')!]
    const span = thread.spans[0]
    const r = s.g.ring[thread.track]
    const xs: number[] = []
    const full = walkSpan(s.layout, s.g, r, span, span.x1, (x) => xs.push(x))
    expect(full).toBe(span.count)
    expect(xs).toHaveLength(span.count)
    for (let k = 1; k < xs.length; k++) expect(xs[k]).toBeGreaterThanOrEqual(xs[k - 1] - s.g.skew * 2)
    // halfway: fewer points, the last at the day reached
    const mid = (span.x0 + span.x1) / 2 + 0.3
    const pts: Array<[number, number]> = []
    const half = walkSpan(s.layout, s.g, r, span, mid, (x, y) => pts.push([x, y]))
    expect(half).toBeLessThan(full)
    expect(half).toBeGreaterThan(1)
    const [ex, ey] = pointAt(s.layout, s.g, r, mid)
    expect(pts[pts.length - 1]).toEqual([ex, ey])
    // before its start: nothing
    expect(walkSpan(s.layout, s.g, r, span, span.x0, () => {})).toBe(0)
  })
})

describe('the hit test', () => {
  /** Every drawn thread is hit at its anchor: as itself, or as a thread drawn there too. */
  function expectHitAtAnchors(s: Scene, hidden: ReadonlySet<string>, at: number | null) {
    const out = new Float32Array(3)
    let hits = 0
    s.layout.threads.forEach((thread, i) => {
      if (hidden.has(thread.key)) return
      const reached = helixAnchor(s.layout, s.g, i, at, out)
      expect(reached).toBe(!(at !== null && thread.startDay > at))
      if (!reached) return
      const notDrawn = new Set(hidden)
      if (at !== null) for (const other of s.layout.threads) if (other.startDay > at) notDrawn.add(other.key)
      const hit = hitHelix(s.layout, s.g, s.camera, s.view, out[0], out[1], notDrawn, at)
      expect(hit?.kind, thread.key).toBe('repo')
      const key = (hit as { key: string }).key
      expect(hidden.has(key)).toBe(false)
      expect(notDrawn.has(key)).toBe(false)
      if (key === thread.key) hits++
    })
    return hits
  }

  it('hits every thread of RICH, kepano and gaearon at its anchor, fully wound, halfway and with some hidden', () => {
    for (const s of [scene(RICH, NOW), scene(kepano, KEPANO_NOW), scene(gaearon, GAEARON_NOW)]) {
      const n = s.layout.threads.length
      // most are hit as themselves; the rest under a thread on a neighbouring ring
      const self = expectHitAtAnchors(s, new Set(), null)
      expect(self).toBeGreaterThan(n * 0.5)
      expectHitAtAnchors(s, new Set(), dayAt(s.timeline.clock, 0.5))
      expectHitAtAnchors(s, new Set(s.layout.threads.filter((_t, i) => i % 3 === 0).map((t) => t.key)), null)
    }
  })

  it('skips a hidden or unwound thread, and falls back to the day or milestone under the pointer', () => {
    const s = scene(RICH, NOW)
    const i = s.layout.byKey.get('me/busy')!
    const thread = s.layout.threads[i]
    // a point on its first span, a few weeks in
    const [x, y] = pointAt(s.layout, s.g, s.g.ring[thread.track], thread.x0 + 20)
    expect(hitHelix(s.layout, s.g, s.camera, s.view, x, y, new Set(), null)).toEqual({ kind: 'repo', key: 'me/busy' })
    const hidden = hitHelix(s.layout, s.g, s.camera, s.view, x, y, new Set(['me/busy']), null)
    expect(hidden?.kind === 'repo' ? hidden.key : null).not.toBe('me/busy')
    const early = hitHelix(s.layout, s.g, s.camera, s.view, x, y, new Set(), thread.startDay - 1)
    expect(early?.kind === 'repo' ? early.key : null).not.toBe('me/busy')
    // the time-lapse a week in: the stretch past it is not there to hit, the dot is
    const soon = hitHelix(s.layout, s.g, s.camera, s.view, x, y, new Set(), thread.startDay + 7)
    expect(soon?.kind === 'repo' ? soon.key : null).not.toBe('me/busy')
    const [dx, dy] = pointAt(s.layout, s.g, s.g.ring[thread.track], thread.x0)
    expect(hitHelix(s.layout, s.g, s.camera, s.view, dx, dy, new Set(), thread.startDay)).toEqual({ kind: 'repo', key: 'me/busy' })
    // in the coil's heart, off every ring: the day
    const heart = hitHelix(s.layout, s.g, s.camera, s.view, s.camera.tx + thread.x * s.camera.k, s.g.cy, new Set(), null)
    expect(heart).toEqual({ kind: 'day', day: s.layout.startDay + Math.floor(thread.x), milestone: null })
    expect(hitHelix(s.layout, s.g, s.camera, s.view, -5, 100, new Set(), null)).toBeNull()
  })
})

describe('the painter', () => {
  it('fills the screen first and keeps to the helix palette, whatever the theme', () => {
    const allowed = new Set(Object.values(HELIX_PALETTE))
    for (const t of THEMES) {
      const s = scene(RICH, NOW)
      const rec = paintLog(s, { themeId: t.id, hover: { kind: 'repo', key: 'me/steady' }, selected: 'me/busy', at: dayAt(s.timeline.clock, 0.8) })
      const first = rec.log.find((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name)) as Extract<CtxEntry, { kind: 'call' }>
      expect(first.name).toBe('fillRect')
      expect(first.args).toEqual([0, 0, s.view.width * 2, s.view.height * 2])
      expect(first.style.fillStyle).toBe(HELIX_PALETTE.screen)
      for (const e of rec.log) {
        if (e.kind !== 'call') continue
        if (/^(fill|fillRect|fillText)$/.test(e.name)) expect(allowed.has(String(e.style.fillStyle)), `${t.id} ${e.name} ${String(e.style.fillStyle)}`).toBe(true)
        if (/^(stroke|strokeRect|strokeText)$/.test(e.name)) expect(allowed.has(String(e.style.strokeStyle)), `${t.id} ${e.name} ${String(e.style.strokeStyle)}`).toBe(true)
      }
      // the same frame in every theme: a vector display
      expect(rec.log).toEqual(paintLog(s, { hover: { kind: 'repo', key: 'me/steady' }, selected: 'me/busy', at: dayAt(s.timeline.clock, 0.8) }).log)
    }
  })

  it('reads at 4.5:1 or better: the thread, the text and the bright colour on the screen', () => {
    const p = HELIX_PALETTE
    for (const colour of [p.thread, p.text, p.bright]) expect(contrastRatio(colour, p.screen), colour).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(p.ground, p.screen)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(p.text, p.plate)).toBeGreaterThanOrEqual(4.5)
  })

  it('draws years and "today" in monospace, and never a repo name', () => {
    for (const s of [scene(RICH, NOW), scene(kepano, KEPANO_NOW), scene(gaearon, GAEARON_NOW)]) {
      const names = s.timeline.lanes.map((lane) => lane.repo.toLowerCase())
      const rec = paintLog(s, { hover: { kind: 'repo', key: s.layout.threads[0].key }, selected: s.layout.threads[1].key })
      const texts = rec.texts()
      expect(texts.length).toBeGreaterThan(0)
      for (const text of texts) {
        expect(text).toMatch(/^(\d{4}|today)$/)
        for (const name of names) expect(text.toLowerCase()).not.toContain(name.slice(name.indexOf('/') + 1))
      }
      for (const c of rec.calls('fillText')) expect(String(c.style.font)).toMatch(/monospace/)
    }
    expect(NAMES.length).toBeGreaterThan(0)
  })

  it('winds the coil one turn a year: a hoop at each January 1 on the canvas, and the cage on both sides', () => {
    const s = scene(RICH, NOW)
    const rec = paintLog(s)
    const hoops = rec.calls('ellipse')
    const jans = Array.from(s.layout.yearStarts).filter((x) => x >= 0 && x <= s.layout.days)
    expect(hoops).toHaveLength(jans.length)
    hoops.forEach((c, k) => {
      expect(c.args[0]).toBeCloseTo(s.camera.tx + jans[k] * s.camera.k, 6)
      expect(c.args[1]).toBe(s.g.cy)
      expect(c.args[2]).toBe(s.g.skew)
      expect(c.args[3]).toBe(s.g.R)
      expect(c.style.strokeStyle).toBe(HELIX_PALETTE.cage)
    })
    const cage = rec.calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.cage)
    // the far side's pass, the near side's, then the hoops
    expect(cage.length).toBe(2 + hoops.length)
    expect(cage[0].style.globalAlpha).toBe(FAR_ALPHA)
    expect(cage[1].style.globalAlpha).toBe(1)
    // the time-lapse winds it up: fewer segments early on, none at the start
    const start = paintLog(s, { at: s.layout.startDay })
    expect(lineTos(start)).toBeLessThan(lineTos(paintLog(s, { at: dayAt(s.timeline.clock, 0.5) })))
    expect(lineTos(paintLog(s, { at: dayAt(s.timeline.clock, 0.5) }))).toBeLessThan(lineTos(rec))
    expect(start.calls('ellipse').length).toBeLessThanOrEqual(1)
  })

  it('draws a hidden thread not at all', () => {
    const s = scene(RICH, NOW)
    const all = new Set(s.layout.threads.map((t) => t.key))
    const base = paintLog(s, { hidden: all })
    for (const thread of s.layout.threads) {
      const alone = new Set(all)
      alone.delete(thread.key)
      expect(lineTos(paintLog(s, { hidden: alone })), thread.key).toBeGreaterThan(lineTos(base))
    }
    // with every thread hidden no thread is stroked (the cage, the horizon and today are), and no dot is filled
    expect(threadStrokes(base)).toHaveLength(0)
    expect(base.calls('stroke').some((c) => c.style.strokeStyle === HELIX_PALETTE.cage)).toBe(true)
    expect(base.calls('arc')).toHaveLength(0)
  })

  it('draws nothing after the time-lapse day, and winds each thread on with it', () => {
    for (const s of [scene(RICH, NOW), scene(kepano, KEPANO_NOW)]) {
      const all = new Set(s.layout.threads.map((t) => t.key))
      for (const p of [0, 0.3, 0.6, 1]) {
        const at = dayAt(s.timeline.clock, p)
        const unwound = new Set(s.layout.threads.filter((t) => t.startDay > at).map((t) => t.key))
        // the unwound threads draw nothing: the frame is the same with them hidden
        expect(paintLog(s, { at }).log, `at ${p}`).toEqual(paintLog(s, { at, hidden: unwound }).log)
        if (p === 0) expect(paintLog(s, { at }).log).toEqual(paintLog(s, { at, hidden: all }).log)
      }
      const thread = s.layout.threads[0]
      const mid = Math.floor((thread.startDay + thread.endDay) / 2)
      const only = new Set([...all].filter((k) => k !== thread.key))
      const segmentsAt = (at: number | null) => {
        const rec = paintLog(s, { at, hidden: only })
        // the thread's own lineTo calls: those stroked in a thread colour (the cage's are not)
        let n = 0
        let pending = 0
        for (const e of rec.log) {
          if (e.kind !== 'call') continue
          if (e.name === 'beginPath') pending = 0
          else if (e.name === 'lineTo') pending++
          else if (e.name === 'stroke' && (e.style.strokeStyle === HELIX_PALETTE.thread || e.style.strokeStyle === HELIX_PALETTE.dim)) n += pending
        }
        return n
      }
      // on its first day: its dot, and no stretch yet
      expect(segmentsAt(thread.startDay)).toBe(0)
      expect(paintLog(s, { at: thread.startDay, hidden: only }).calls('arc').length).toBe(1)
      expect(segmentsAt(mid)).toBeGreaterThan(0)
      expect(segmentsAt(mid)).toBeLessThan(segmentsAt(null))
    }
  })

  it('draws the far side of the coil dimmer, dormant spans thinner and fainter, archived repos dim, and the unselected dimmed', () => {
    const s = scene(RICH, NOW)
    const strokesOf = (key: string, opts: PaintOpts = {}) => {
      const others = new Set(s.layout.threads.map((t) => t.key).filter((k) => k !== key))
      return threadStrokes(paintLog(s, { ...opts, hidden: new Set([...others, ...(opts.hidden ?? [])]) }))
    }
    const busy = strokesOf('me/busy')
    expect(busy.length).toBeGreaterThan(1)
    const heavy = busy.filter((c) => c.style.lineWidth === ACTIVE_PX[2]).map((c) => Number(c.style.globalAlpha))
    // its heaviest spans: the far pass at FAR_ALPHA, then the near pass at 1
    expect(heavy).toEqual([FAR_ALPHA, 1])
    expect(Math.max(...busy.map((c) => Number(c.style.globalAlpha)))).toBe(1)
    expect(busy.every((c) => c.style.strokeStyle === HELIX_PALETTE.thread)).toBe(true)
    expect(Math.max(...busy.map((c) => Number(c.style.lineWidth)))).toBe(ACTIVE_PX[2])
    // the revived repo: a dormant stretch at DORMANT_PX and half the alpha
    const revived = strokesOf('me/revived')
    const dormant = revived.filter((c) => c.style.lineWidth === DORMANT_PX)
    expect(dormant.length).toBeGreaterThan(0)
    expect(Math.max(...dormant.map((c) => Number(c.style.globalAlpha)))).toBe(0.5)
    // archived: the dim colour
    const old = strokesOf('me/old')
    expect(old.every((c) => c.style.strokeStyle === HELIX_PALETTE.dim)).toBe(true)
    // the contributed repo: dashed
    const lib = paintLog(s, { hidden: new Set(s.layout.threads.map((t) => t.key).filter((k) => k !== 'other/lib')) })
    expect(lib.calls('setLineDash').some((c) => (c.args[0] as number[]).length === 2)).toBe(true)
    // an own repo's thread is never dashed
    const own = paintLog(s, { hidden: new Set(s.layout.threads.map((t) => t.key).filter((k) => k !== 'me/busy')) })
    expect(own.calls('setLineDash').every((c) => (c.args[0] as number[]).length === 0)).toBe(true)
    // another selected: dimmed to the display's dim alpha on the near side
    const dimmed = strokesOf('me/busy', { selected: 'me/steady', hidden: new Set() })
    expect(Math.max(...dimmed.map((c) => Number(c.style.globalAlpha)))).toBe(0.3)
  })

  it('halos the hovered and the selected thread, and draws the selected one bright', () => {
    const s = scene(RICH, NOW)
    const plain = paintLog(s)
    const hovered = paintLog(s, { hover: { kind: 'repo', key: 'me/busy' } })
    expect(hovered.calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.text).length).toBeGreaterThan(plain.calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.text).length)
    const selected = paintLog(s, { selected: 'me/busy' })
    const bright = selected.calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.bright)
    expect(bright.length).toBeGreaterThan(0)
    expect(plain.calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.bright)).toHaveLength(0)
    // hidden, no halo and nothing bright
    expect(paintLog(s, { selected: 'me/busy', hidden: new Set(['me/busy']) }).calls('stroke').filter((c) => c.style.strokeStyle === HELIX_PALETTE.bright)).toHaveLength(0)
    // a hovered day: a ring on the coil
    const day = paintLog(s, { hover: { kind: 'day', day: s.layout.startDay + 400, milestone: null } })
    expect(day.calls('arc').filter((c) => c.style.strokeStyle === HELIX_PALETTE.text && c.args[2] === 4)).toHaveLength(1)
  })

  it('draws a bright diamond on the thread at each landed day, once the time-lapse has reached it', () => {
    const landed: ProfileData = { ...RICH, landed: [{ day: '2021-03-05', repo: 'other/lib' }, { day: '2021-02-10', repo: 'Other/Lib' }] }
    const s = scene(landed, NOW)
    const i = s.layout.byKey.get('other/lib')!
    const thread = s.layout.threads[i]
    expect(Array.from(thread.landed)).toEqual([dayNumber('2021-02-10'), dayNumber('2021-03-05')].map((d) => d - s.layout.startDay + 0.5))
    // bright fills over the frame with the repo hidden: the milestones fill bright diamonds too
    const without = new Set(['other/lib'])
    const brightFills = (rec: RecordingCtx) => rec.calls('fill').filter((c) => c.style.fillStyle === HELIX_PALETTE.bright).length
    const marks = (opts: PaintOpts) => brightFills(paintLog(s, opts)) - brightFills(paintLog(s, { ...opts, hidden: without }))
    expect(marks({})).toBe(2)
    const full = paintLog(s)
    for (const lx of thread.landed) {
      const [x, y] = pointAt(s.layout, s.g, s.g.ring[thread.track], lx)
      expect(full.calls('moveTo').some((c) => c.args[0] === x && c.args[1] === y - LANDED_PX)).toBe(true)
    }
    expect(marks({ at: thread.startDay - 1 })).toBe(0)
    expect(marks({ at: dayNumber('2021-02-20') })).toBe(1)
  })
})

describe('the scene', () => {
  it('anchors every thread on its start dot, orders labels by weight then stars, and keeps labels off the ground', () => {
    const s = scene(kepano, KEPANO_NOW)
    const def = HELIX_VIEW
    expect(def.id).toBe('helix')
    expect(def.title).toBe('helix')
    expect(def.scene.items(s.layout)).toBe(s.layout.threads)
    const order = Array.from(helixLabelOrder(s.layout))
    expect([...order].sort((a, b) => a - b)).toEqual(s.layout.threads.map((_x, i) => i))
    for (let k = 1; k < order.length; k++) {
      const a = s.layout.threads[order[k - 1]]
      const b = s.layout.threads[order[k]]
      expect(a.weight > b.weight || (a.weight === b.weight && a.stars >= b.stars)).toBe(true)
    }
    expect(Array.from(helixKeepOut(s.layout, s.view))).toEqual([0, horizonY(s.view) - 1, s.view.width, s.view.height])
    const out = new Float32Array(3)
    s.layout.threads.forEach((thread, i) => {
      expect(helixAnchor(s.layout, s.g, i, null, out)).toBe(true)
      const [x, y] = pointAt(s.layout, s.g, s.g.ring[thread.track], thread.x0)
      expect(out[0]).toBeCloseTo(x, 3)
      expect(out[1]).toBeCloseTo(y, 3)
      expect(out[2]).toBe(START_PX + 1)
      expect(out[0]).toBeGreaterThanOrEqual(0)
      expect(out[0]).toBeLessThanOrEqual(s.view.width)
      expect(out[1]).toBeGreaterThanOrEqual(s.view.top)
      expect(out[1]).toBeLessThanOrEqual(horizonY(s.view))
    })
  })

  it('writes no colour literal, reads no namer, and hashes nothing', () => {
    for (const [file, text] of Object.entries({ layoutSource, geometrySource, paintSource, hitSource, viewSource })) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      expect(code.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i), file).toBeNull()
      expect(code, file).not.toMatch(/RepoNamer|repoNamer|\bname\(|hash01/)
    }
  })
})
