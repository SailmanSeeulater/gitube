/**
 * The life lines' geometry and painter on a recording context: track pitch and stroke widths from
 * the viewport alone, what the painter fills first, that it draws every number finite and every
 * colour from the theme in all ten themes, that it draws no repo name (the labels are the only
 * names on the canvas), the marks of each kind of line, that hidden lines draw nothing, that the
 * time-lapse clips what is drawn, how the hover and the selection show, and the label anchors,
 * order and keep-out box.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { fetchProfileRest } from '../src/api/profile'
import { THEMES, getTheme, type Theme } from '../src/theme/themes'
import { buildLifeTimeline, dayNumber, type LifeTimeline } from '../src/profile/timeline'
import { fitLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { LIFE_YEAR_FONT } from '../src/profile/lifeAxis'
import { layoutLifeLines, trackGapDays, type LifeLine, type LifeLinesLayout } from '../src/profile/lifeLinesLayout'
import {
  LINES_FOOT_PX,
  LINES_MAX_PITCH,
  drawnTo,
  linesGeom,
  linesPlot,
  rooted,
  isReached,
  stationMark,
  stationRadius,
  stationReached,
  stationRingRadius,
  weightLevel,
  type LinesGeom,
} from '../src/profile/lifeLinesGeometry'
import { ERA_BAND_ALPHA, GRID_ALPHA, UNCOUNTED_DASH, lineColour, linesAnchor, linesKeepOut, linesLabelOrder, paintLifeLines, type LinesPaintInput } from '../src/profile/lifeLinesPaint'
import type { LifeCamera, LifeHover, LifeInk, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'
import { recordingCtx, type CtxEntry, type RecordingCtx } from './helpers/recordingCtx'
import { stationMark as landedMark, stationRadius as landedRadius, stationRingRadius as landedRingRadius } from '../src/profile/lifeLinesGeometry'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`

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

function profile(over: Partial<ProfileData> = {}): ProfileData {
  return {
    login: 'Me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2019-01-10'),
    source: 'graphql',
    repos: [],
    days: [],
    recent: [],
    recentFrom: null,
    milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    landed: [],
    fallback: null,
    ...over,
  }
}

/**
 * A token profile with one of each kind of line: a busy starred one with a quiet spell, a private
 * repo, an archived one, a fork, a repo they only contributed to, and one GitHub counted no commits
 * to (uncounted).
 */
const REPOS: ProfileRepo[] = [
  repo('Me/alpha', { createdAt: iso('2019-02-01'), stars: 120, activity: [...monthly('2019-02', '2020-06', 9), ...monthly('2021-06', '2021-09', 1)] }),
  repo('Me/Secret-Plans', { createdAt: iso('2020-03-01'), language: 'Rust', stars: 30, isPrivate: true, activity: monthly('2020-03', '2024-05', 3) }),
  repo('Me/old-thing', { createdAt: iso('2019-06-01'), language: 'JavaScript', stars: 15, isArchived: true, activity: monthly('2019-06', '2019-12') }),
  repo('Me/forked-lib', { createdAt: iso('2021-01-10'), language: 'Go', isFork: true, activity: monthly('2021-01', '2021-03', 1) }),
  repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-05-01'), isOwn: false, language: null, activity: monthly('2022-05', '2023-02', 5) }),
  repo('Me/empty-uncounted', { createdAt: iso('2023-08-01'), stars: 5 }),
]

const NAMES = ['me/alpha', 'me/secret-plans', 'secret', 'old-thing', 'forked-lib', 'big-project', 'empty-uncounted']

/** The canvas host's frame on a laptop screen. */
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

interface Scene {
  timeline: LifeTimeline
  layout: LifeLinesLayout
  theme: Theme
  ink: LifeInk
  g: LinesGeom
  input: LinesPaintInput
}

function scene(p: ProfileData = profile({ repos: REPOS }), theme: Theme = getTheme('obsidian'), camera?: LifeCamera, now = NOW): Scene {
  const timeline = buildLifeTimeline(p, now)
  const layout = layoutLifeLines(timeline, p.source)
  const ink = lifeInk(theme)
  const palette = languagePalette(timeline, theme)
  const cam = camera ?? fitLifeCamera(layout.days, VIEW)
  const g = linesGeom(layout, cam, VIEW)
  const input: LinesPaintInput = {
    layout,
    timeline,
    geoms: g,
    camera: cam,
    view: VIEW,
    ink,
    colourOf: (language) => languageColour(palette, language, theme),
    hidden: new Set(),
    hover: null,
    selected: null,
    at: null,
  }
  return { timeline, layout, theme, ink, g, input }
}

function paint(s: Scene, over: Partial<LinesPaintInput> = {}): RecordingCtx {
  const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
  paintLifeLines(rec.ctx, { ...s.input, ...over })
  return rec
}

/** Every colour the theme lets the view draw with: its ink and its language colours. */
function allowedColours(s: Scene): Set<string> {
  const { dimAlpha: _alpha, ...flat } = s.ink
  const allowed = new Set<string>(Object.values(flat))
  for (const colour of [...Object.values(languagePalette(s.timeline, s.theme)), s.theme.fallback]) allowed.add(colour)
  return allowed
}

const argsOf = (rec: RecordingCtx, name: string) => rec.calls(name).map((c) => c.args as number[])

function numbersOf(log: CtxEntry[]): number[] {
  return log.flatMap((e) => (e.kind === 'call' ? e.args.flat() : [e.value])).filter((v): v is number => typeof v === 'number')
}

const lineOf = (s: Scene, key: string) => s.layout.byKey.get(key)!
const sx = (s: Scene, x: number) => s.input.camera.tx + x * s.input.camera.k
const yOf = (s: Scene, line: LifeLine) => s.g.trackY[line.track]

/** Whether anything was stroked or filled along a track (a moveTo at its y between two x). */
function drawnOn(rec: RecordingCtx, y: number, x0 = -Infinity, x1 = Infinity): boolean {
  return argsOf(rec, 'moveTo').some(([x, my]) => Math.abs(my - y) < 1e-6 && x >= x0 - 1e-6 && x <= x1 + 1e-6)
}

/** The start marker's disc of a line: an arc at its root on its track at the marker's radius. */
function markerOf(rec: RecordingCtx, s: Scene, line: LifeLine, r = s.g.stationR) {
  return rec.calls('arc').filter((c) => c.args[0] === sx(s, line.x) && c.args[1] === yOf(s, line) && c.args[2] === r)
}

describe('linesGeom', () => {
  it('spreads the tracks over the plot, centred, never further apart than the most', () => {
    const few = linesGeom({ tracks: 3 }, { k: 1, tx: 0 }, VIEW)
    expect(few.pitch).toBe(LINES_MAX_PITCH)
    const { top, bottom } = linesPlot(VIEW)
    expect(top).toBe(VIEW.top)
    expect(bottom).toBe(horizonY(VIEW) - LINES_FOOT_PX)
    expect([...few.trackY]).toEqual([0, 1, 2].map((t) => (top + bottom) / 2 + (t - 1) * LINES_MAX_PITCH))
    const many = linesGeom({ tracks: 300 }, { k: 1, tx: 0 }, VIEW)
    expect(many.pitch).toBeCloseTo((bottom - top) / 300, 9)
    expect(many.trackY[0] - many.pitch / 2).toBeCloseTo(top, 3)
    expect(many.trackY[299] + many.pitch / 2).toBeCloseTo(bottom, 3)
    for (const y of many.trackY) {
      expect(y).toBeGreaterThan(top)
      expect(y).toBeLessThan(bottom)
    }
  })

  it('draws wide strokes for few tracks and thin ones for many, within their clamps, at any zoom', () => {
    for (const tracks of [0, 1, 3, 20, 80, 300, 5000]) {
      const g = linesGeom({ tracks }, { k: 1, tx: 0 }, VIEW)
      expect(g.trackY).toHaveLength(tracks)
      const [light, medium, heavy] = g.activePx
      expect(light).toBeLessThan(medium)
      expect(medium).toBeLessThan(heavy)
      expect(heavy).toBeGreaterThanOrEqual(1.25)
      expect(heavy).toBeLessThanOrEqual(7)
      expect(light).toBeCloseTo(heavy * (0.55 + 0.45 / 3), 9)
      expect(g.dormantPx).toBeGreaterThanOrEqual(0.75)
      expect(g.dormantPx).toBeLessThan(light)
      expect(g.stationR).toBeGreaterThanOrEqual(2)
      expect(g.stationR).toBeLessThanOrEqual(5)
      // the zoom moves lines apart and never thickens them
      const zoomed = linesGeom({ tracks }, { k: 24, tx: -900 }, VIEW)
      expect([zoomed.pitch, zoomed.activePx, zoomed.dormantPx, zoomed.stationR, [...zoomed.trackY]]).toEqual([g.pitch, g.activePx, g.dormantPx, g.stationR, [...g.trackY]])
    }
    expect(linesGeom({ tracks: 1 }, { k: 1, tx: 0 }, VIEW).activePx[2]).toBe(7)
    expect(linesGeom({ tracks: 1 }, { k: 1, tx: 0 }, VIEW).stationR).toBe(5)
    expect(linesGeom({ tracks: 5000 }, { k: 1, tx: 0 }, VIEW).activePx[2]).toBe(1.25)
    expect(linesGeom({ tracks: 5000 }, { k: 1, tx: 0 }, VIEW).stationR).toBe(2.25)
  })

  it('keeps every number finite in a viewport too small for a plot', () => {
    const tiny: LifeViewport = { width: 20, height: 40, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }
    const g = linesGeom({ tracks: 4 }, { k: 1, tx: 0 }, tiny)
    for (const n of [g.pitch, ...g.activePx, g.dormantPx, g.stationR, ...g.trackY]) expect(Number.isFinite(n)).toBe(true)
  })

  it('quantises an active weight to three levels', () => {
    expect([0, 0.2, 1 / 3, 0.34, 0.5, 2 / 3, 0.67, 1].map(weightLevel)).toEqual([0, 0, 0, 1, 1, 1, 2, 2])
  })

  it('says what of a line the time-lapse has drawn', () => {
    const line = { startDay: 100, rootDay: 110, end: 300 }
    expect(drawnTo(line, 0, null)).toBe(300)
    expect(drawnTo(line, 0, 150.5)).toBe(150.5)
    expect(drawnTo(line, 0, 900)).toBe(300)
    // a line cut short of the next on its track is drawn to its cut, never on to its own end
    expect(drawnTo({ end: 240 }, 0, null)).toBe(240)
    expect(drawnTo({ end: 240 }, 0, 900)).toBe(240)
    expect([isReached(line, null), isReached(line, 99.9), isReached(line, 100)]).toEqual([true, false, true])
    expect([rooted(line, null), rooted(line, 109.9), rooted(line, 110)]).toEqual([true, false, true])
    expect([stationReached(20.5, 100, null), stationReached(20.5, 100, 119.9), stationReached(20.5, 100, 120)]).toEqual([true, false, true])
  })
})

describe('paintLifeLines', () => {
  it('fills the whole backing store with the canvas colour first, without the pixel transform', () => {
    const s = scene()
    const rec = paint(s)
    const first = rec.log.findIndex((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name))
    const call = rec.log[first]
    expect(call).toMatchObject({ kind: 'call', name: 'fillRect', args: [0, 0, VIEW.width * 2, VIEW.height * 2] })
    expect(call.kind === 'call' && call.style.fillStyle).toBe(s.ink.canvas)
    expect(argsOf(rec, 'setTransform')[0]).toEqual([1, 0, 0, 1, 0, 0])
    expect(rec.calls('save')).toHaveLength(rec.calls('restore').length)
  })

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s: draws every number finite and every colour from the theme', (_id, theme) => {
    const s = scene(profile({ repos: REPOS }), theme)
    const key = s.layout.lines[0].key
    const station = s.layout.stations[0]
    for (const over of [
      {},
      { selected: key },
      { hover: { kind: 'repo', key } as LifeHover },
      { hover: { kind: 'day', day: s.layout.startDay + Math.floor(station.x), milestone: station.index } as LifeHover },
      { at: dayNumber('2021-02-01') },
    ]) {
      const rec = paint(s, over)
      for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
      const allowed = allowedColours(s)
      for (const colour of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(allowed, String(colour)).toContain(colour)
      for (const alpha of rec.sets('globalAlpha')) expect([1, theme.dimAlpha, ERA_BAND_ALPHA, GRID_ALPHA]).toContain(alpha)
    }
  })

  it('draws no repo name: only year labels and today, in the year font', () => {
    const s = scene()
    for (const over of [{}, { selected: s.layout.lines[1].key }, { hover: { kind: 'repo', key: 'me/secret-plans' } as LifeHover }]) {
      const rec = paint(s, over)
      const texts = rec.calls('fillText').map((c) => String(c.args[0]))
      expect(texts.length).toBeGreaterThan(0)
      for (const text of texts) expect(text).toMatch(/^(\d{4}|today)$/)
      for (const text of rec.texts()) for (const name of NAMES) expect(text.toLowerCase()).not.toContain(name)
      expect(rec.calls('fillText').every((c) => c.style.font === LIFE_YEAR_FONT)).toBe(true)
    }
  })

  it('draws the language eras behind the lines and a gridline at each new year', () => {
    const s = scene()
    const rec = paint(s)
    const bands = rec.calls('fillRect').filter((c) => c.style.globalAlpha === ERA_BAND_ALPHA)
    expect(bands).toHaveLength(s.layout.languages.length)
    bands.forEach((band, i) => {
      expect(band.style.fillStyle).toBe(s.input.colourOf(s.layout.languages[i].language))
      expect(band.args[1]).toBe(0)
      expect(band.args[3]).toBe(horizonY(VIEW))
    })
    const grid = rec.calls('stroke').filter((c) => c.style.globalAlpha === GRID_ALPHA)
    expect(grid).toHaveLength(1)
    expect(grid[0].style.strokeStyle).toBe(s.ink.muted)
    const years = s.layout.years.filter((y) => y.x0 > 0)
    for (const year of years) expect(argsOf(rec, 'lineTo').some(([x, y]) => x === Math.round(sx(s, year.x0)) + 0.5 && y === horizonY(VIEW))).toBe(true)
  })

  it('draws every line on its track, active parts thick and dormant ones thin, each weight at its width', () => {
    const s = scene()
    const rec = paint(s)
    for (const line of s.layout.lines) expect(drawnOn(rec, yOf(s, line)), line.key).toBe(true)
    const widths = new Set(rec.calls('stroke').map((c) => c.style.lineWidth))
    expect(widths).toContain(s.g.dormantPx)
    // alpha's busy run and its light one, and the others
    const active = s.layout.lines.flatMap((l) => (l.uncounted ? [] : l.parts.filter((p) => p.kind === 'active').map((p) => weightLevel(p.weight))))
    expect(new Set(active).size).toBeGreaterThan(1)
    for (const level of new Set(active)) expect(widths).toContain(s.g.activePx[level])
    // dormant parts with butt caps, active ones round
    const alpha = s.layout.lines[lineOf(s, 'me/alpha')]
    const dormant = alpha.parts.find((p) => p.kind === 'dormant')!
    expect(argsOf(rec, 'moveTo').some(([x, y]) => x === sx(s, dormant.x0) && y === yOf(s, alpha))).toBe(true)
    expect(argsOf(rec, 'lineTo').some(([x, y]) => x === sx(s, dormant.x1) && y === yOf(s, alpha))).toBe(true)
  })

  it('draws a dormant tail only until the next line on its track, a gap short of where it starts', () => {
    const s = scene()
    // alpha went quiet in 2021; big-project starts on its track the year after
    const alpha = s.layout.lines[lineOf(s, 'me/alpha')]
    const next = s.layout.lines[lineOf(s, 'someone/big-project')]
    expect(next.track).toBe(alpha.track)
    expect(alpha.end).toBeLessThan(alpha.x1)
    expect(next.x0 - alpha.end).toBe(trackGapDays(s.layout.days))
    const y = yOf(s, alpha)
    const [a, b] = [sx(s, alpha.end), sx(s, next.x0)]
    for (const over of [{}, { selected: alpha.key }, { hover: { kind: 'repo', key: alpha.key } as LifeHover }]) {
      const rec = paint(s, over)
      // the tail reaches its cut, and nothing is drawn along the track in the gap after it
      expect(argsOf(rec, 'lineTo').some(([x, ly]) => Math.abs(x - a) < 1e-6 && ly === y)).toBe(true)
      for (const [x, ly] of [...argsOf(rec, 'moveTo'), ...argsOf(rec, 'lineTo')]) if (ly === y) expect(x <= a + 1e-6 || x >= b - 1e-6, `${x}`).toBe(true)
    }
  })

  it('draws one stroke width for every active part without a token', () => {
    const rest = profile({ source: 'rest', repos: REPOS.map((r) => ({ ...r, activity: [], lastActiveAt: r.activity.at(-1) ? iso(r.activity.at(-1)!.date) : r.createdAt })) })
    const s = scene(rest)
    expect(s.layout.lines.some((l) => l.uncounted)).toBe(false)
    const rec = paint(s)
    const widths = new Set(rec.calls('stroke').filter((c) => c.style.globalAlpha === 1).map((c) => c.style.lineWidth))
    expect(widths).toContain(s.g.activePx[2])
    expect(widths).not.toContain(s.g.activePx[0])
    expect(widths).not.toContain(s.g.activePx[1])
    expect(rec.calls('setLineDash')).toHaveLength(0)
  })

  it('marks each kind of line: start discs, a hollow start, a fork stub, a terminus and dotted uncounted lines', () => {
    const s = scene()
    const rec = paint(s)
    const own = s.layout.lines[lineOf(s, 'me/alpha')]
    const disc = markerOf(rec, s, own)
    expect(disc.length).toBeGreaterThan(0)
    const ownFill = rec.calls('fill').find((c) => c.style.fillStyle === s.input.colourOf('TypeScript'))
    expect(ownFill).toBeDefined()
    // a visitor's start is hollow: the canvas colour, ringed in its colour
    const visitor = s.layout.lines[lineOf(s, 'someone/big-project')]
    expect(markerOf(rec, s, visitor).length).toBe(1)
    const vi = rec.log.findIndex((e) => e.kind === 'call' && e.name === 'arc' && e.args[0] === sx(s, visitor.x) && e.args[1] === yOf(s, visitor))
    const after = rec.log.slice(vi).filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && (e.name === 'fill' || e.name === 'stroke'))
    expect(after[0]).toMatchObject({ name: 'fill', style: { fillStyle: s.ink.canvas } })
    expect(after[1]).toMatchObject({ name: 'stroke', style: { strokeStyle: s.input.colourOf(null) } })
    // a fork's branch stub runs up and back into its start
    const fork = s.layout.lines[lineOf(s, 'me/forked-lib')]
    const stub = Math.min(8, Math.max(3, s.g.pitch))
    expect(argsOf(rec, 'moveTo').some(([x, y]) => x === sx(s, fork.x) - stub && y === yOf(s, fork) - stub)).toBe(true)
    // an archived line ends at a terminus in the dry colour
    const dry = s.layout.lines[lineOf(s, 'me/old-thing')]
    const h = s.g.activePx[2] + 4
    expect(argsOf(rec, 'moveTo').some(([x, y]) => x === sx(s, dry.x1) && y === yOf(s, dry) - h / 2)).toBe(true)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.dry && c.style.lineWidth === 1.5)).toBe(true)
    expect(lineColour(dry, s.ink, s.input.colourOf)).toBe(s.ink.dry)
    expect(lineColour(own, s.ink, s.input.colourOf)).toBe(s.input.colourOf('TypeScript'))
    // an uncounted repo is dotted, and the dash is put back
    expect(argsOf(rec, 'setLineDash').map((a) => a[0])).toEqual([[...UNCOUNTED_DASH], []])
  })

  it('draws the stations on their lines, larger and ringed while hovered', () => {
    const s = scene()
    expect(s.layout.stations.length).toBeGreaterThan(0)
    const rec = paint(s)
    for (const station of s.layout.stations) {
      const line = s.layout.lines[station.line]
      const { x, y, ring } = stationMark(line, station, s.g, null)
      const r = ring ? stationRingRadius(s.g) : stationRadius(s.g)
      expect(argsOf(rec, 'arc').some(([ax, ay, ar]) => ax === x && ay === y && ar === r)).toBe(true)
    }
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.text)).toBe(true)
    for (const station of s.layout.stations) {
      const line = s.layout.lines[station.line]
      const { x, y, ring } = stationMark(line, station, s.g, null)
      const hovered = paint(s, { hover: { kind: 'day', day: station.day, milestone: station.index } })
      const r = ring ? stationRingRadius(s.g, true) : stationRadius(s.g, true)
      expect(r).toBe((ring ? stationRingRadius(s.g) : stationRadius(s.g)) + 2)
      expect(argsOf(hovered, 'arc').some(([ax, ay, ar]) => ax === x && ay === y && ar === r)).toBe(true)
      expect(argsOf(hovered, 'arc').some(([ax, ay, ar]) => ax === x && ay === y && ar === r + 3)).toBe(true)
      expect(hovered.calls('stroke').some((c) => c.style.strokeStyle === s.ink.hoverRing && c.style.lineWidth === 1.5)).toBe(true)
    }
  })

  it("rings a station on a start marker, the marker's dot left in its colour; a station off it is a disc on its own day", () => {
    const s = scene()
    // alpha is the first repo, and the most starred: both dated at its root
    const alpha = s.layout.lines[lineOf(s, 'me/alpha')]
    const onRoot = s.layout.stations.filter((st) => s.layout.lines[st.line] === alpha)
    expect(onRoot.map((st) => st.kind).sort()).toEqual(['first-repo', 'top-repo'])
    for (const st of onRoot) expect(st.day).toBe(alpha.rootDay)
    const rec = paint(s)
    const x = sx(s, alpha.x)
    const y = yOf(s, alpha)
    const colour = s.input.colourOf('TypeScript')
    const atMarker = (e: CtxEntry) => e.kind === 'call' && e.name === 'arc' && e.args[0] === x && e.args[1] === y
    // the dot is filled in alpha's colour, and nothing is filled over it after
    const dot = rec.log.findIndex((e) => atMarker(e) && e.kind === 'call' && e.args[2] === s.g.stationR)
    expect(dot).toBeGreaterThanOrEqual(0)
    const later = rec.log.slice(dot).filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && (e.name === 'fill' || e.name === 'arc' || e.name === 'stroke'))
    expect(later.find((e) => e.name === 'fill')).toMatchObject({ style: { fillStyle: colour } })
    expect(argsOf(rec, 'arc').filter(([ax, ay, ar]) => ax === x && ay === y && ar === stationRadius(s.g))).toHaveLength(0)
    // a ring round it in the text ink, stroked and never filled
    const ringAt = rec.log.findIndex((e) => atMarker(e) && e.kind === 'call' && e.args[2] === stationRingRadius(s.g))
    expect(ringAt).toBeGreaterThan(dot)
    const next = rec.log.slice(ringAt + 1).find((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && (e.name === 'fill' || e.name === 'stroke'))
    expect(next).toMatchObject({ name: 'stroke', style: { strokeStyle: s.ink.text, lineWidth: 1.5 } })
    expect(stationRingRadius(s.g)).toBe(s.g.stationR + 1.5)

    // zoomed in far enough, a station a day off the root is a disc of its own, filled in the canvas colour
    const withPr = profile({ repos: REPOS, milestones: [{ kind: 'first-pr', date: iso('2019-02-02'), label: 'first pull request', repo: 'Me/alpha' }] })
    const camera: LifeCamera = { k: 60, tx: 400 - alpha.x * 60 }
    const zoomed = scene(withPr, getTheme('obsidian'), camera)
    const pr = zoomed.layout.stations.find((st) => st.kind === 'first-pr')!
    const mark = stationMark(zoomed.layout.lines[pr.line], pr, zoomed.g, null)
    expect(mark).toEqual({ x: sx(zoomed, pr.x), y: yOf(zoomed, zoomed.layout.lines[pr.line]), ring: false })
    const zr = paint(zoomed)
    const disc = zr.log.findIndex((e) => e.kind === 'call' && e.name === 'arc' && e.args[0] === mark.x && e.args[2] === stationRadius(zoomed.g))
    expect(disc).toBeGreaterThanOrEqual(0)
    expect(zr.log.slice(disc).find((e) => e.kind === 'call' && e.name === 'fill')).toMatchObject({ style: { fillStyle: zoomed.ink.canvas } })
  })

  it('draws nothing of a hidden line', () => {
    const s = scene()
    const all = paint(s, { hidden: new Set(s.layout.lines.map((l) => l.key)) })
    for (const line of s.layout.lines) expect(drawnOn(all, yOf(s, line), 0, VIEW.width), line.key).toBe(false)
    expect(all.calls('arc')).toHaveLength(0)
    expect(all.calls('setLineDash')).toHaveLength(0)

    const line = s.layout.lines[lineOf(s, 'me/alpha')]
    const hidden = paint(s, { hidden: new Set([line.key]), hover: { kind: 'repo', key: line.key }, selected: line.key })
    expect(markerOf(hidden, s, line)).toHaveLength(0)
    expect(markerOf(hidden, s, line, s.g.stationR + 3)).toHaveLength(0)
    // (the lines after it on its track still draw past its end)
    expect(drawnOn(hidden, yOf(s, line), sx(s, line.x0) - 1, sx(s, line.end) + 1)).toBe(false)
    // hovering a hidden line draws nothing more than hiding it
    expect(paint(s, { hidden: new Set([line.key]), hover: { kind: 'repo', key: line.key } }).log).toEqual(paint(s, { hidden: new Set([line.key]) }).log)
    // nor its stations
    for (const station of s.layout.stations.filter((st) => st.line === lineOf(s, line.key))) expect(argsOf(hidden, 'arc').some(([x]) => x === sx(s, station.x))).toBe(false)
  })

  it('dims every other line behind a selection, haloes and rings the selected and the hovered one', () => {
    const s = scene()
    const selected = s.layout.lines[lineOf(s, 'me/secret-plans')]
    const hovered = s.layout.lines[lineOf(s, 'me/alpha')]
    const rec = paint(s, { selected: selected.key, hover: { kind: 'repo', key: hovered.key } })
    expect(rec.calls('stroke').some((c) => c.style.globalAlpha === s.ink.dimAlpha)).toBe(true)
    expect(rec.calls('fill').some((c) => c.style.globalAlpha === s.ink.dimAlpha)).toBe(true)
    const full = (line: LifeLine) => s.g.activePx[Math.max(...line.parts.filter((p) => p.kind === 'active').map((p) => weightLevel(p.weight)))]
    const halo = (line: LifeLine, colour: string, extra: number) =>
      rec.calls('stroke').some((c) => c.style.strokeStyle === colour && c.style.lineWidth === full(line) + extra && c.style.globalAlpha === 1)
    expect(halo(selected, s.ink.inspectedRing, 3)).toBe(true)
    expect(halo(hovered, s.ink.hoverRing, 2)).toBe(true)
    expect(markerOf(rec, s, selected, s.g.stationR + 3)).toHaveLength(1)
    expect(markerOf(rec, s, hovered, s.g.stationR + 3)).toHaveLength(1)
    // the selected line is drawn again, at full strength, over its halo
    const last = rec.log.filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && e.name === 'stroke' && e.style.strokeStyle === s.input.colourOf('Rust'))
    expect(last.at(-1)!.style.globalAlpha).toBe(1)
    // without a selection nothing is dimmed
    expect(paint(s).calls('stroke').some((c) => c.style.globalAlpha === s.ink.dimAlpha)).toBe(false)
  })

  it('guides a hovered day from the top to the horizon', () => {
    const s = scene()
    const day = s.layout.startDay + 100
    const rec = paint(s, { hover: { kind: 'day', day, milestone: null } })
    const x = Math.round(sx(s, day - s.layout.startDay + 0.5)) + 0.5
    expect(argsOf(rec, 'moveTo').some(([mx, my]) => mx === x && my === 0)).toBe(true)
    expect(argsOf(rec, 'lineTo').some(([lx, ly]) => lx === x && ly === horizonY(VIEW))).toBe(true)
    expect(paint(s).calls('stroke').some((c) => c.style.strokeStyle === s.ink.hoverRing)).toBe(false)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.hoverRing && c.style.lineWidth === 1)).toBe(true)
  })

  it('draws only what the time-lapse has reached', () => {
    const s = scene()
    const before = paint(s, { at: s.layout.startDay - 1 })
    for (const line of s.layout.lines) expect(drawnOn(before, yOf(s, line), -Infinity, Infinity)).toBe(false)
    expect(before.calls('arc')).toHaveLength(0)

    const at = dayNumber('2021-02-01')
    const reachedLines = s.layout.lines.filter((l) => l.startDay <= at)
    expect(reachedLines.length).toBeGreaterThan(0)
    expect(reachedLines.length).toBeLessThan(s.layout.lines.length)
    const rec = paint(s, { at })
    const clock = sx(s, at - s.layout.startDay)
    for (const line of s.layout.lines) {
      const y = yOf(s, line)
      expect(drawnOn(rec, y, sx(s, line.x0), sx(s, line.end)), line.key).toBe(line.startDay <= at)
      // nothing on a line past the clock, but its start marker's edge and round caps
      const reach = Math.max(s.g.stationR, s.g.activePx[2]) + 1e-6
      for (const [x, ly] of argsOf(rec, 'lineTo')) if (Math.abs(ly - y) < 1e-6) expect(x).toBeLessThanOrEqual(clock + reach)
    }
    // a line still running is drawn to the clock and no further
    const running = s.layout.lines[lineOf(s, 'me/secret-plans')]
    expect(argsOf(rec, 'lineTo').some(([x, y]) => Math.abs(x - clock) < 1e-6 && y === yOf(s, running))).toBe(true)
    // the eras behind are cut at the clock too
    for (const band of rec.calls('fillRect').filter((c) => c.style.globalAlpha === ERA_BAND_ALPHA)) {
      const [x, , w] = band.args as number[]
      expect(x + w).toBeLessThanOrEqual(clock + 1e-6)
    }
    // the fork is reached but not rooted until its root day: no marker before then
    const fork = s.layout.lines[lineOf(s, 'me/forked-lib')]
    expect(markerOf(paint(s, { at: fork.rootDay - 0.5 }), s, fork)).toHaveLength(0)
    expect(markerOf(paint(s, { at: fork.rootDay + 0.5 }), s, fork).length).toBeGreaterThan(0)
    // a station appears when its day comes (here a ring round alpha's start marker)
    const station = s.layout.stations[0]
    const mark = stationMark(s.layout.lines[station.line], station, s.g, null)
    const stationArc = (r: RecordingCtx) => argsOf(r, 'arc').some(([x, , rr]) => x === mark.x && rr === (mark.ring ? stationRingRadius(s.g) : stationRadius(s.g)))
    expect(stationArc(paint(s, { at: station.day - 0.01 }))).toBe(false)
    expect(stationArc(paint(s, { at: station.day }))).toBe(true)
  })

  it('skips lines off screen when zoomed in, and draws those on it', () => {
    const s0 = scene()
    const camera = zoomLifeCamera(s0.input.camera, 24, 200, s0.layout.days, VIEW)
    const s = scene(profile({ repos: REPOS }), getTheme('obsidian'), camera)
    const rec = paint(s)
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
    for (const line of s.layout.lines) {
      const a = sx(s, line.x0)
      const b = sx(s, line.x1)
      const visible = b >= -30 && a <= VIEW.width + 30
      if (!visible) expect(drawnOn(rec, yOf(s, line), a, b), line.key).toBe(false)
    }
    // whatever is drawn stays near the screen
    for (const [x] of argsOf(rec, 'lineTo')) expect(Math.abs(x)).toBeLessThan(VIEW.width * 4)
  })

  it('paints a profile without repos, and an account a day old', () => {
    const empty = scene(profile({ repos: [], source: 'rest' }))
    expect(empty.layout.lines).toHaveLength(0)
    const rec = paint(empty)
    expect(rec.calls('fillRect').length).toBeGreaterThan(0)
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)

    const young = scene(profile({ createdAt: iso('2024-06-14'), milestones: [], repos: [repo('Me/new', { createdAt: iso('2024-06-14'), activity: [{ date: '2024-06-14', commits: 1 }] })] }))
    expect(young.layout.days).toBeLessThanOrEqual(2)
    const yr = paint(young)
    for (const n of numbersOf(yr.log)) expect(Number.isFinite(n)).toBe(true)
    expect(drawnOn(yr, yOf(young, young.layout.lines[0]))).toBe(true)
  })
})

describe('life lines labels', () => {
  it("anchors a label at a line's start marker once rooted, else where it starts", () => {
    const s = scene()
    const out = new Float32Array(3)
    s.layout.lines.forEach((line, i) => {
      expect(linesAnchor(s.layout, s.g, i, null, out)).toBe(true)
      expect([...out]).toEqual([...Float32Array.of(sx(s, line.x), yOf(s, line), s.g.stationR)])
    })
    const backdated = profile({ repos: [repo('Me/back', { createdAt: iso('2022-01-10'), activity: [{ date: '2021-11-01', commits: 2 }, { date: '2022-01-10', commits: 1 }] })] })
    const b = scene(backdated)
    const line = b.layout.lines[0]
    expect(line.x0).toBeLessThan(line.x - 1)
    linesAnchor(b.layout, b.g, 0, line.rootDay - 3, out)
    expect(out[0]).toBeCloseTo(sx(b, line.x0), 3)
    linesAnchor(b.layout, b.g, 0, line.rootDay, out)
    expect(out[0]).toBeCloseTo(sx(b, line.x), 3)
    expect(linesAnchor(b.layout, b.g, 5, null, out)).toBe(false)
  })

  it('orders labels by weight, then stars, then paint order', () => {
    const s = scene()
    const order = [...linesLabelOrder(s.layout)]
    expect([...order].sort((a, b) => a - b)).toEqual(s.layout.lines.map((_, i) => i))
    for (let q = 1; q < order.length; q++) {
      const a = s.layout.lines[order[q - 1]]
      const b = s.layout.lines[order[q]]
      expect(a.weight > b.weight || (a.weight === b.weight && (a.stars > b.stars || (a.stars === b.stars && order[q - 1] < order[q])))).toBe(true)
    }
    expect(s.layout.lines[order[0]].key).toBe('me/alpha')
  })

  it('keeps labels off the ground under the horizon', () => {
    const s = scene()
    expect([...linesKeepOut(s.layout, VIEW)]).toEqual([0, horizonY(VIEW) - 1, VIEW.width, VIEW.height])
  })
})

describe('life lines on the recordings', () => {
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

  it("rings a first or top repo's start marker, its dot left in the line's colour", () => {
    for (const [p, now] of profiles) {
      const s = scene(p, getTheme('obsidian'), undefined, now)
      const onRoot = s.layout.stations.filter((st) => st.day === s.layout.lines[st.line].rootDay)
      expect(onRoot.length, p.login).toBeGreaterThan(0)
      for (const hover of [null, { kind: 'day', day: onRoot[0].day, milestone: onRoot[0].index } as LifeHover]) {
        const rec = paint(s, { hover })
        for (const station of onRoot) {
          const line = s.layout.lines[station.line]
          const [x, y] = [sx(s, line.x), yOf(s, line)]
          const at = (r: number) => (e: CtxEntry) => e.kind === 'call' && e.name === 'arc' && e.args[0] === x && e.args[1] === y && e.args[2] === r
          // the dot is filled in the line's colour (the canvas colour for a repo they only contributed to)
          const dot = rec.log.findIndex(at(s.g.stationR))
          expect(dot, line.key).toBeGreaterThanOrEqual(0)
          const fill = rec.log.slice(dot).find((e) => e.kind === 'call' && e.name === 'fill')
          expect(fill).toMatchObject({ style: { fillStyle: line.visiting ? s.ink.canvas : lineColour(line, s.ink, s.input.colourOf) } })
          // no station disc over it, hovered or not
          expect(rec.log.findIndex(at(stationRadius(s.g)))).toBe(-1)
          expect(rec.log.findIndex(at(stationRadius(s.g, true)))).toBe(-1)
          // a ring round it in the text ink, stroked and not filled
          const hovered = hover?.kind === 'day' && hover.milestone === station.index
          const ring = rec.log.findIndex(at(stationRingRadius(s.g, hovered)))
          expect(ring, line.key).toBeGreaterThan(dot)
          const next = rec.log.slice(ring + 1).find((e) => e.kind === 'call' && (e.name === 'fill' || e.name === 'stroke'))
          expect(next).toMatchObject({ name: 'stroke', style: { strokeStyle: s.ink.text } })
        }
      }
    }
  })
})

// ---------- landed pull requests ----------

describe('landed pull requests on the lines', () => {
  const landedProfile = () =>
    profile({
      repos: [...REPOS, repo('upstream/tool', { isOwn: false, createdAt: iso('2016-01-01'), firstActiveAt: iso('2021-05-05'), lastActiveAt: iso('2021-05-05') })],
      landed: [
        { day: '2023-01-15', repo: 'someone/big-project' },
        { day: '2022-08-01', repo: 'someone/big-project' },
        { day: '2022-08-01', repo: 'someone/big-project' },
        { day: '2021-05-05', repo: 'upstream/tool' },
      ],
    })

  /** The arcs at (x, y) with radius r whose next fill or stroke is in the accent. */
  function accentArcs(rec: RecordingCtx, s: Scene, x: number, y: number, r: number): Array<'fill' | 'stroke'> {
    const out: Array<'fill' | 'stroke'> = []
    rec.log.forEach((e, i) => {
      if (e.kind !== 'call' || e.name !== 'arc' || e.args[0] !== x || e.args[1] !== y || e.args[2] !== r) return
      const next = rec.log.slice(i + 1).find((n): n is Extract<CtxEntry, { kind: 'call' }> => n.kind === 'call' && (n.name === 'fill' || n.name === 'stroke'))
      if (!next) return
      if (next.name === 'fill' && next.style.fillStyle === s.ink.accent) out.push('fill')
      if (next.name === 'stroke' && next.style.strokeStyle === s.ink.accent) out.push('stroke')
    })
    return out
  }

  it('lays one station per landed day on the line, at that day', () => {
    const s = scene(landedProfile())
    const line = s.layout.lines[lineOf(s, 'someone/big-project')]
    expect(line.landed).toEqual([dayNumber('2022-08-01') - s.layout.startDay + 0.5, dayNumber('2023-01-15') - s.layout.startDay + 0.5])
    const tool = s.layout.lines[lineOf(s, 'upstream/tool')]
    expect(tool.landed).toEqual([tool.x])
    expect(tool.uncounted).toBe(true)
  })

  it('draws a filled accent station on each landed day once reached, ringing the start marker where it would cover its dot', () => {
    const s = scene(landedProfile())
    const line = s.layout.lines[lineOf(s, 'someone/big-project')]
    const y = yOf(s, line)
    const full = paint(s)
    for (const lx of line.landed) expect(accentArcs(full, s, sx(s, lx), y, landedRadius(s.g))).toEqual(['fill'])
    // a repo known only by a landed pull request: the station is on its start marker, so it rings it in the accent
    const tool = s.layout.lines[lineOf(s, 'upstream/tool')]
    const mark = landedMark(tool, { x: tool.landed[0] }, s.g, null)
    expect(mark.ring).toBe(true)
    expect(accentArcs(full, s, mark.x, yOf(s, tool), landedRingRadius(s.g))).toEqual(['stroke'])
    // the hollow start marker's dot is still drawn under it
    expect(markerOf(full, s, tool).length).toBeGreaterThan(0)

    // the time-lapse: nothing before the line is reached, the first station between its two days
    const before = paint(s, { at: line.startDay - 1 })
    for (const lx of line.landed) expect(accentArcs(before, s, sx(s, lx), y, landedRadius(s.g))).toEqual([])
    const between = paint(s, { at: dayNumber('2022-12-01') })
    expect(accentArcs(between, s, sx(s, line.landed[0]), y, landedRadius(s.g))).toEqual(['fill'])
    expect(accentArcs(between, s, sx(s, line.landed[1]), y, landedRadius(s.g))).toEqual([])
    const onDay = paint(s, { at: dayNumber('2023-01-15') })
    expect(accentArcs(onDay, s, sx(s, line.landed[1]), y, landedRadius(s.g))).toEqual(['fill'])
    // hidden: none
    const hidden = paint(s, { hidden: new Set([line.key]) })
    for (const lx of line.landed) expect(accentArcs(hidden, s, sx(s, lx), y, landedRadius(s.g))).toEqual([])
  })
})
