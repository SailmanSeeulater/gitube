/**
 * The life lines' hit test: a line on its track within its slop, the nearest of crowded tracks (the
 * earlier in paint order on a tie) however many tracks a start marker's reach spans, a station
 * snapping before its line but a start marker's repo winning inside its dot, a station reporting its
 * own day, hidden and unsown lines skipped, a line's cut tail and the time-lapse's clock cutting it
 * short, the day otherwise, and null off the life or the canvas. Then the recordings: every line
 * drawn is hit at its label anchor, fully grown and halfway through the time-lapse, a first or top
 * repo's marker selects its repo while its ring shows the milestone, and a prolific profile is hit
 * near every start marker as a search of every line would find it.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { fetchProfileRest } from '../src/api/profile'
import { fitLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { hitLifeLines, STATION_HIT_PX } from '../src/profile/lifeLinesHit'
import { layoutLifeLines, type LifeLine, type LifeLinesLayout, type LineStation } from '../src/profile/lifeLinesLayout'
import { MARKER_RING_PX, drawnTo, linesGeom, rooted, sown, stationMark, stationReached, stationRingRadius, type LinesGeom } from '../src/profile/lifeLinesGeometry'
import { linesAnchor } from '../src/profile/lifeLinesPaint'
import { axisHover } from '../src/profile/lifeView'
import { buildLifeTimeline, dayAt, dayNumber } from '../src/profile/timeline'
import type { LifeCamera, LifeHover, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { prolific } from './helpers/lifeLinesScale'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'

const VIEW: LifeViewport = { width: 1000, height: 600, top: 72, ground: 44, side: 28 }
const CAMERA: LifeCamera = { k: 2, tx: 30 }
const NONE: ReadonlySet<string> = new Set()
const START = 19_000
const DAYS = 400

function makeLine(over: Partial<LifeLine> = {}): LifeLine {
  const x0 = over.x0 ?? 100
  const x1 = over.x1 ?? DAYS
  return {
    lane: 0,
    key: 'me/a',
    startDay: START + x0,
    x: x0 + 0.5,
    x0,
    x1,
    end: x1,
    rootDay: START + x0,
    endDay: START + x1 - 1,
    track: 0,
    language: null,
    dry: false,
    branch: false,
    visiting: false,
    seedling: false,
    weight: 1,
    stars: 0,
    parts: [{ kind: 'active', x0, x1, weight: 1 }],
    landed: [],
    ...over,
  }
}

/** A layout of these lines (already in paint order) over DAYS days, with these stations and milestones. */
function makeLayout(lines: LifeLine[], stations: LineStation[] = [], milestones: LifeLinesLayout['milestones'] = []): LifeLinesLayout {
  return {
    startDay: START,
    todayDay: START + DAYS - 1,
    days: DAYS,
    years: [],
    languages: [],
    milestones,
    byKey: new Map(lines.map((line, i) => [line.key, i])),
    lines,
    tracks: lines.reduce((n, line) => Math.max(n, line.track + 1), 0),
    stations,
  }
}

const sxOf = (x: number, camera: LifeCamera = CAMERA) => camera.tx + x * camera.k

/** A station on line `line` for milestone `index` on day START + day (its middle in world x). */
const stationAt = (index: number, kind: LineStation['kind'], line: number, day: number): LineStation => ({ index, kind, line, day: START + day, x: day + 0.5 })

function hit(layout: LifeLinesLayout, x: number, y: number, opts: { hidden?: ReadonlySet<string>; at?: number | null; g?: LinesGeom; camera?: LifeCamera } = {}) {
  const camera = opts.camera ?? CAMERA
  const g = opts.g ?? linesGeom(layout, camera, VIEW)
  return hitLifeLines(layout, g, camera, VIEW, x, y, opts.hidden ?? NONE, opts.at ?? null)
}

describe('hitLifeLines', () => {
  it('hits a line on its track, within its slop, along its drawn stretch', () => {
    const layout = makeLayout([makeLine({ x0: 100, x1: 300 })])
    const g = linesGeom(layout, CAMERA, VIEW)
    const y = g.trackY[0]
    const reach = Math.max(4, g.activePx[2] / 2 + 3)
    for (const x of [100, 150, 299.9]) expect(hit(layout, sxOf(x), y)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(200), y + reach - 0.1)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(200), y - reach + 0.1)).toEqual({ kind: 'repo', key: 'me/a' })
    // just beyond its slop, above or below, it is the day under the pointer
    expect(hit(layout, sxOf(200), y + reach + 0.5)).toEqual({ kind: 'day', day: START + 200, milestone: null })
    // past its end, beyond the slop, likewise
    expect(hit(layout, sxOf(300) + reach + 0.5, y)).toEqual({ kind: 'day', day: START + Math.floor(300 + (reach + 0.5) / CAMERA.k), milestone: null })
    // and before its start, where the root marker reaches a little way back
    expect(hit(layout, sxOf(100) - 1, y)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(100) - reach - g.stationR, y)).toEqual({ kind: 'day', day: START + Math.floor(100 - (reach + g.stationR) / CAMERA.k), milestone: null })
  })

  it('picks the nearest of crowded tracks, and the earlier in paint order on a tie', () => {
    // 200 tracks: a pitch of about 2 px, closer than any line's slop
    const lines = Array.from({ length: 200 }, (_, t) => makeLine({ key: `me/t${t}`, lane: t, track: t }))
    const layout = makeLayout(lines)
    const g = linesGeom(layout, CAMERA, VIEW)
    expect(g.pitch).toBeLessThan(4)
    for (const t of [0, 1, 50, 120, 199]) expect(hit(layout, sxOf(250), g.trackY[t])).toEqual({ kind: 'repo', key: `me/t${t}` })
    // a little off a track, its own line is still the nearest
    expect(hit(layout, sxOf(250), g.trackY[80] + g.pitch * 0.3)).toEqual({ kind: 'repo', key: 'me/t80' })
    expect(hit(layout, sxOf(250), g.trackY[80] - g.pitch * 0.3)).toEqual({ kind: 'repo', key: 'me/t80' })
    // halfway between two tracks, the earlier line wins
    expect(hit(layout, sxOf(250), (g.trackY[80] + g.trackY[81]) / 2)).toEqual({ kind: 'repo', key: 'me/t80' })
    // a hidden line gives way to its neighbours
    expect(hit(layout, sxOf(250), g.trackY[80], { hidden: new Set(['me/t80']) })).toEqual({ kind: 'repo', key: 'me/t79' })
  })

  it('reaches a start marker across as many crowded tracks as its reach spans', () => {
    // 200 tracks about 2.4 px apart; only line 100 starts early, its neighbours far to the right
    const lines = Array.from({ length: 200 }, (_, t) => makeLine({ key: `me/t${t}`, lane: t, track: t, ...(t === 100 ? {} : { x0: 300, x: 300.5, rootDay: START + 300, startDay: START + 300 }) }))
    const layout = makeLayout(lines)
    const g = linesGeom(layout, CAMERA, VIEW)
    const markerReach = g.stationR + 3
    // more than two tracks away: a scan of the next track either side would miss it
    expect(markerReach - 0.25).toBeGreaterThan(2 * g.pitch)
    for (const dy of [-(markerReach - 0.25), -g.pitch * 2, g.pitch * 2, markerReach - 0.25]) {
      expect(hit(layout, sxOf(100.5), g.trackY[100] + dy), `dy ${dy}`).toEqual({ kind: 'repo', key: 'me/t100' })
    }
    expect(hit(layout, sxOf(100.5), g.trackY[100] + markerReach + 0.25)).toEqual({ kind: 'day', day: START + 100, milestone: null })
  })

  it('tells lines on one track apart by their stretch', () => {
    const layout = makeLayout([
      makeLine({ key: 'me/early', x0: 10, x1: 120, dry: true }),
      makeLine({ key: 'me/late', lane: 1, x0: 150, x1: DAYS }),
    ])
    const g = linesGeom(layout, CAMERA, VIEW)
    expect(hit(layout, sxOf(60), g.trackY[0])).toEqual({ kind: 'repo', key: 'me/early' })
    expect(hit(layout, sxOf(250), g.trackY[0])).toEqual({ kind: 'repo', key: 'me/late' })
    // in the gap between them, away from either end's slop: the day
    expect(hit(layout, sxOf(135), g.trackY[0])).toEqual({ kind: 'day', day: START + 135, milestone: null })
  })

  it("stops a line at its drawn end, where its dormant tail is cut short of the next on its track", () => {
    const layout = makeLayout([
      makeLine({ key: 'me/early', x0: 10, x1: DAYS, end: 120, parts: [{ kind: 'active', x0: 10, x1: 40, weight: 1 }, { kind: 'dormant', x0: 40, x1: DAYS, weight: 0 }] }),
      makeLine({ key: 'me/late', lane: 1, x0: 150, x1: DAYS }),
    ])
    const g = linesGeom(layout, CAMERA, VIEW)
    expect(hit(layout, sxOf(100), g.trackY[0])).toEqual({ kind: 'repo', key: 'me/early' })
    expect(hit(layout, sxOf(135), g.trackY[0])).toEqual({ kind: 'day', day: START + 135, milestone: null })
    expect(hit(layout, sxOf(250), g.trackY[0])).toEqual({ kind: 'repo', key: 'me/late' })
  })

  it('snaps to a station before its line, the nearest and then the earliest', () => {
    const stations: LineStation[] = [stationAt(2, 'first-repo', 0, 200), stationAt(4, 'top-repo', 0, 200), stationAt(5, 'first-pr', 0, 204)]
    const layout = makeLayout([makeLine({ x0: 100, x1: 300 })], stations)
    const g = linesGeom(layout, CAMERA, VIEW)
    const y = g.trackY[0]
    expect(hit(layout, sxOf(200.5), y)).toEqual({ kind: 'day', day: START + 200, milestone: 2 })
    expect(hit(layout, sxOf(200.5) + 1, y + 1)).toEqual({ kind: 'day', day: START + 200, milestone: 2 })
    expect(hit(layout, sxOf(204.5) - 1, y)).toEqual({ kind: 'day', day: START + 204, milestone: 5 })
    // beyond the station's reach, the line
    expect(hit(layout, sxOf(250), y)).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(200.5), y - STATION_HIT_PX - 0.5)).toEqual({ kind: 'repo', key: 'me/a' })
    // not on a hidden line, nor before the time-lapse reaches its day
    expect(hit(layout, sxOf(200.5), y, { hidden: new Set(['me/a']) })).toEqual({ kind: 'day', day: START + 200, milestone: null })
    // (the line, drawn to the clock half a day short, is within its slop)
    expect(hit(layout, sxOf(200.5), y, { at: START + 199.5 })).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(200.5), y, { at: START + 200 })).toEqual({ kind: 'day', day: START + 200, milestone: 2 })
  })

  it("lets a start marker's repo win inside its dot, and a station ringing it beyond", () => {
    // a first repo and a top repo on the root, and a first pull request a day later
    const stations = [stationAt(1, 'first-repo', 0, 100), stationAt(3, 'top-repo', 0, 100), stationAt(4, 'first-pr', 0, 101)]
    const layout = makeLayout([makeLine({ x0: 100, x1: 300 })], stations)
    const g = linesGeom(layout, CAMERA, VIEW)
    const y = g.trackY[0]
    const x = sxOf(100.5)
    // a day is 2 px here: all three ring the marker
    for (const s of stations) expect(stationMark(layout.lines[0], s, g, null)).toEqual({ x, y, ring: true })
    // inside the dot, the repo, so a click there selects it; on the ring, the earliest milestone
    for (const [dx, dy] of [[0, 0], [g.stationR - 0.25, 0], [0, -(g.stationR - 0.25)], [sxOf(101.5) - x, 0]]) {
      expect(hit(layout, x + dx, y + dy), `${dx}, ${dy}`).toEqual({ kind: 'repo', key: 'me/a' })
    }
    const ring = stationRingRadius(g)
    for (const [dx, dy] of [[0, -ring], [0, ring], [-ring, 0], [0, -(g.stationR + 0.25)], [0, -(ring + MARKER_RING_PX / 2 + 1)]]) {
      expect(hit(layout, x + dx, y + dy), `${dx}, ${dy}`).toEqual({ kind: 'day', day: START + 100, milestone: 1 })
    }
    // zoomed in, the first pull request is a disc of its own on its day, the marker's dot still the repo's
    const near: LifeCamera = { k: 40, tx: -3500 }
    const gz = linesGeom(layout, near, VIEW)
    expect(stationMark(layout.lines[0], stations[2], gz, null)).toEqual({ x: sxOf(101.5, near), y, ring: false })
    expect(hit(layout, sxOf(101.5, near), y, { camera: near, g: gz })).toEqual({ kind: 'day', day: START + 101, milestone: 4 })
    expect(hit(layout, sxOf(100.5, near), y, { camera: near, g: gz })).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(100.5, near), y - stationRingRadius(gz), { camera: near, g: gz })).toEqual({ kind: 'day', day: START + 100, milestone: 1 })
    // before the time-lapse roots a backdated line it has no marker: a station on its root would be a
    // disc, and is not reached yet, so the line drawn to the clock is what is there
    const back = makeLayout([makeLine({ x0: 90, x: 100.5, rootDay: START + 100, x1: 300 })], stations)
    expect(stationMark(back.lines[0], stations[0], g, START + 99)).toEqual({ x, y, ring: false })
    expect(hit(back, x, y, { at: START + 99 })).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(back, x, y, { at: START + 100 })).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(back, x, y - ring, { at: START + 100 })).toEqual({ kind: 'day', day: START + 100, milestone: 1 })
    // on the very root day of a line that is not backdated (where the time-lapse of someone whose
    // first repo dates from the day they joined opens) the marker is drawn before any stretch, and
    // its dot is still the repo's
    expect(drawnTo(layout.lines[0], START, START + 100)).toBe(100)
    expect(rooted(layout.lines[0], START + 100)).toBe(true)
    expect(hit(layout, x, y, { at: START + 100 })).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, x, y - ring, { at: START + 100 })).toEqual({ kind: 'day', day: START + 100, milestone: 1 })
  })

  it("reports a station's own day, and none for a milestone dated before its line starts", () => {
    const iso = (day: string) => `${day}T20:00:00Z`
    const base: ProfileRepo = {
      nameWithOwner: 'them/lib',
      createdAt: iso('2015-01-01'),
      firstActiveAt: iso('2021-01-05'),
      lastActiveAt: iso('2021-04-01'),
      isOwn: false,
      language: 'Go',
      languageColor: null,
      stars: 0,
      forks: 0,
      isFork: false,
      isArchived: false,
      isPrivate: false,
      activity: [
        { date: '2021-01-05', commits: 3 },
        { date: '2021-04-01', commits: 1 },
      ],
    }
    const now = Date.parse('2024-06-15T19:00:00Z')
    const profile: ProfileData = {
      login: 'me',
      name: null,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      createdAt: iso('2019-01-10'),
      source: 'graphql',
      repos: [base],
      days: [],
      recent: [],
      recentFrom: null,
      milestones: [
        // in the quiet stretch between its two runs, and before their part in it starts
        { kind: 'first-pr', date: iso('2021-02-20'), label: 'first pull request', repo: 'them/lib' },
        { kind: 'first-issue', date: iso('2020-11-20'), label: 'first issue', repo: 'them/lib' },
      ],
      restrictedContributions: 0,
      truncated: false,
      lostWindows: [],
      landed: [],
      fallback: null,
    }
    const timeline = buildLifeTimeline(profile, now)
    const layout = layoutLifeLines(timeline, 'graphql')
    const camera: LifeCamera = { k: 4, tx: 30 - (dayNumber('2020-11-01') - timeline.startDay) * 4 }
    const g = linesGeom(layout, camera, VIEW)
    const at = (index: number) => ({ index, ...timeline.milestones[index] })
    const pr = at(timeline.milestones.findIndex((m) => m.kind === 'first-pr'))
    const issue = at(timeline.milestones.findIndex((m) => m.kind === 'first-issue'))
    expect(layout.stations.map((s) => s.index)).toEqual([pr.index])
    const station = layout.stations[0]
    const y = g.trackY[layout.lines[0].track]
    expect(hit(layout, camera.tx + station.x * camera.k, y, { camera, g })).toEqual({ kind: 'day', day: dayNumber(pr.day), milestone: pr.index })
    // the first issue predates the line: the line's start is the repo, and its own day is on the horizon
    const line = layout.lines[0]
    expect(hit(layout, camera.tx + line.x * camera.k, y, { camera, g })).toEqual({ kind: 'repo', key: 'them/lib' })
    const marker = layout.milestones.find((m) => m.index === issue.index)!
    expect(hit(layout, camera.tx + marker.x * camera.k, horizonY(VIEW), { camera, g })).toEqual({ kind: 'day', day: dayNumber(issue.day), milestone: issue.index })
  })

  it('cuts a line short at the clock, and skips one not sown yet', () => {
    const layout = makeLayout([makeLine({ x0: 100, x1: 300 })])
    const g = linesGeom(layout, CAMERA, VIEW)
    const y = g.trackY[0]
    expect(hit(layout, sxOf(140), y, { at: START + 150 })).toEqual({ kind: 'repo', key: 'me/a' })
    expect(hit(layout, sxOf(200), y, { at: START + 150 })).toEqual({ kind: 'day', day: START + 200, milestone: null })
    expect(hit(layout, sxOf(100.5), y, { at: START + 99 })).toEqual({ kind: 'day', day: START + 100, milestone: null })
    // a line rooted after it starts (backdated work): its start marker waits for its root day
    const back = makeLayout([makeLine({ x0: 100, x: 150.5, rootDay: START + 150, x1: 300 })])
    expect(hit(back, sxOf(150.5), y, { at: START + 120 })).toEqual({ kind: 'day', day: START + 150, milestone: null })
    expect(hit(back, sxOf(110), y, { at: START + 120 })).toEqual({ kind: 'repo', key: 'me/a' })
  })

  it('finds milestones on the horizon and days elsewhere, and nothing off the life or the canvas', () => {
    const layout = makeLayout([makeLine({ x0: 100, x1: 300 })], [], [{ index: 0, kind: 'joined', x: 20.5, x1: null }])
    const ground = horizonY(VIEW)
    expect(hit(layout, sxOf(20.5), ground)).toEqual({ kind: 'day', day: START + 20, milestone: 0 })
    expect(hit(layout, sxOf(50), 20)).toEqual({ kind: 'day', day: START + 50, milestone: null })
    // before the life's first day, after today, and off the canvas
    expect(hit(layout, sxOf(-1), 300)).toBeNull()
    expect(hit(layout, sxOf(DAYS) + 1, 300)).toBeNull()
    expect(hit(layout, -1, 300)).toBeNull()
    expect(hit(layout, 500, VIEW.height + 1)).toBeNull()
    expect(hit(layout, 500, -1)).toBeNull()
  })

  it('works with no lines at all', () => {
    const layout = makeLayout([])
    expect(hit(layout, sxOf(50), 200)).toEqual({ kind: 'day', day: START + 50, milestone: null })
  })
})

describe('hitLifeLines on the recordings', () => {
  const FRAME: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }
  let profiles: Array<[ProfileData, number]>
  beforeAll(async () => {
    const [kepano, gaearon] = await Promise.all([
      fetchProfileGraphql('kepano', { token: 'test-token-not-real', fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW }),
      fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW }),
    ])
    profiles = [
      [kepano, KEPANO_NOW],
      [gaearon, GAEARON_NOW],
    ]
  })

  /** Every line drawn is hit at its label anchor: as itself, or as a station drawn over it there. */
  function expectHitAtAnchors(layout: LifeLinesLayout, camera: LifeCamera, at: number | null, hidden: ReadonlySet<string> = NONE): number {
    const g = linesGeom(layout, camera, FRAME)
    const out = new Float32Array(3)
    let checked = 0
    layout.lines.forEach((line, i) => {
      if (hidden.has(line.key) || !sown(line, at) || !linesAnchor(layout, g, i, at, out)) return
      const [x, y] = out
      if (x < 0 || x > FRAME.width) return
      const got = hitLifeLines(layout, g, camera, FRAME, x, y, hidden, at)
      const station = layout.stations.find(
        (s) => !hidden.has(layout.lines[s.line].key) && stationReached(s.x, layout.startDay, at) && Math.hypot(camera.tx + s.x * camera.k - x, g.trackY[layout.lines[s.line].track] - y) <= STATION_HIT_PX,
      )
      if (got?.kind === 'day' && station) expect(got.milestone).not.toBeNull()
      else expect(got, line.key).toEqual({ kind: 'repo', key: line.key })
      checked++
    })
    return checked
  }

  it('hits every line at its anchor, fully grown, zoomed in, halfway through the time-lapse, and with some hidden', () => {
    for (const [profile, now] of profiles) {
      const timeline = buildLifeTimeline(profile, now)
      const layout = layoutLifeLines(timeline, profile.source)
      const fit = fitLifeCamera(layout.days, FRAME)
      expect(expectHitAtAnchors(layout, fit, null)).toBe(layout.lines.length)
      const zoomed = zoomLifeCamera(fit, 8, FRAME.width / 2, layout.days, FRAME)
      expect(expectHitAtAnchors(layout, zoomed, null)).toBeGreaterThan(0)
      const half = dayAt(timeline.clock, 0.5)
      const sownCount = layout.lines.filter((l) => l.startDay <= half).length
      expect(sownCount).toBeGreaterThan(0)
      expect(expectHitAtAnchors(layout, fit, half)).toBe(sownCount)
      const hidden = new Set(layout.lines.filter((_, i) => i % 3 === 0).map((l) => l.key))
      expect(expectHitAtAnchors(layout, fit, null, hidden)).toBe(layout.lines.length - hidden.size)
      // a hidden line is never hit anywhere along its track
      const g = linesGeom(layout, fit, FRAME)
      for (const line of layout.lines) {
        if (!hidden.has(line.key)) continue
        const got = hitLifeLines(layout, g, fit, FRAME, fit.tx + ((line.x0 + line.x1) / 2) * fit.k, g.trackY[line.track], hidden, null)
        expect(got?.kind === 'repo' && got.key === line.key).toBe(false)
      }
    }
  })

  it("selects a first or top repo inside its start marker's dot, and shows the milestone on the ring round it", () => {
    for (const [profile, now] of profiles) {
      const layout = layoutLifeLines(buildLifeTimeline(profile, now), profile.source)
      const camera = fitLifeCamera(layout.days, FRAME)
      const g = linesGeom(layout, camera, FRAME)
      const sx = (x: number) => camera.tx + x * camera.k
      /** Whether a drawn line's start marker other than line's has (px, py) inside its dot. */
      const inOtherDot = (line: LifeLine, px: number, py: number) =>
        layout.lines.some((l) => l !== line && Math.hypot(px - sx(l.x), py - g.trackY[l.track]) <= g.stationR)
      const onRoot = layout.stations.filter((st) => st.day === layout.lines[st.line].rootDay)
      // kepano's top repo, gaearon's first and top repos: each dated at its root
      expect(onRoot.map((st) => st.kind), profile.login).toContain('top-repo')
      for (const station of onRoot) {
        const line = layout.lines[station.line]
        const x = sx(line.x)
        const y = g.trackY[line.track]
        if (x < 0 || x > FRAME.width) continue
        expect(stationMark(line, station, g, null)).toEqual({ x, y, ring: true })
        // the dot is the repo's: a click there selects it rather than clear the selection
        expect(hitLifeLines(layout, g, camera, FRAME, x, y, NONE, null), line.key).toEqual({ kind: 'repo', key: line.key })
        // the ring is the milestone's (the earliest of those ringing this marker), with its own day
        const ringing = layout.stations.filter((st) => st.line === station.line && stationMark(line, st, g, null).ring)
        const first = ringing.reduce((a, b) => (b.index < a.index ? b : a))
        const r = stationRingRadius(g)
        for (const [px, py] of [[x, y - r], [x, y + r]]) {
          if (inOtherDot(line, px, py)) continue
          expect(hitLifeLines(layout, g, camera, FRAME, px, py, NONE, null), line.key).toEqual({ kind: 'day', day: first.day, milestone: first.index })
        }
      }
    }
  })

  /** The hit test's rule for lines, over every line drawn rather than the tracks near the pointer. */
  function searchEveryLine(layout: LifeLinesLayout, g: LinesGeom, camera: LifeCamera, view: LifeViewport, px: number, py: number, at: number | null): LifeHover {
    const reach = Math.max(4, g.activePx[2] / 2 + 3)
    const sx = (x: number) => camera.tx + x * camera.k
    let best: string | null = null
    let bestD = Infinity
    for (const line of layout.lines) {
      const end = drawnTo(line, layout.startDay, at)
      if (!(end > line.x0)) continue
      const y = g.trackY[line.track]
      const dx = px < sx(line.x0) ? sx(line.x0) - px : px > sx(end) ? px - sx(end) : 0
      let d = Math.hypot(dx, py - y)
      let near = d <= reach
      if (rooted(line, at)) {
        const m = Math.hypot(px - sx(line.x), py - y)
        near ||= m <= g.stationR + 3
        d = Math.min(d, m)
      }
      if (near && d < bestD) {
        best = line.key
        bestD = d
      }
    }
    return best !== null ? { kind: 'repo', key: best } : axisHover(layout, camera, view, px, py)
  }

  it('hits a prolific profile near every start marker as a search of every line finds it, however close its tracks', () => {
    const SHORT: LifeViewport = { ...FRAME, height: 420 }
    const scale = prolific(400, 'graphql')
    const layout = layoutLifeLines(buildLifeTimeline(scale, Date.parse('2024-06-15T19:00:00Z')), 'graphql')
    const gaearon = profiles[1][0]
    const recorded = layoutLifeLines(buildLifeTimeline(gaearon, GAEARON_NOW), 'rest')
    let wide = 0
    for (const [l, view] of [
      [layout, FRAME],
      [layout, SHORT],
      [recorded, FRAME],
      [recorded, SHORT],
    ] as const) {
      const camera = fitLifeCamera(l.days, view)
      const g = linesGeom(l, camera, view)
      // on the short frame a start marker's reach spans more than the next track either side
      if (view === SHORT) expect(g.stationR + 3, 'pitch').toBeGreaterThan(1.5 * g.pitch)
      const sx = (x: number) => camera.tx + x * camera.k
      const nearStation = (px: number, py: number) =>
        l.stations.some((st) => {
          const mark = stationMark(l.lines[st.line], st, g, null)
          return Math.hypot(px - mark.x, py - mark.y) <= Math.max(STATION_HIT_PX, stationRingRadius(g) + MARKER_RING_PX / 2 + 1.5)
        })
      // just inside a start marker's reach
      const out = g.stationR + 2.9
      for (const line of l.lines) {
        const x = sx(line.x)
        const y = g.trackY[line.track]
        for (const [dx, dy] of [[0, 0], [0, -out], [0, out], [-out, 0], [out, 0], [0, -1.5 * g.pitch], [0, 1.5 * g.pitch]]) {
          const px = x + dx
          const py = y + dy
          if (px < 0 || px > view.width || nearStation(px, py)) continue
          const got = hitLifeLines(l, g, camera, view, px, py, NONE, null)
          expect(got, `${line.key} ${dx} ${dy}`).toEqual(searchEveryLine(l, g, camera, view, px, py, null))
          if (got?.kind === 'repo' && Math.abs(g.trackY[l.lines[l.byKey.get(got.key)!].track] - py) > 1.5 * g.pitch) wide++
        }
      }
    }
    // some of them were found more than a track and a half away
    expect(wide).toBeGreaterThan(0)
  })
})
