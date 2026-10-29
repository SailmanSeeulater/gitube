/**
 * The minimap view (a console view: each repo a line of code in a dark editor): its layout is pure
 * and deterministic (the same profile in any order, or renamed, gives the same rows), one row per
 * lane in lane order on the shared time axis, tokens and whitespace tiling each row, tones by how
 * many repos use a language; its geometry fits any number of rows in the plot (300 to 500 still
 * apart and hittable); its hit test finds every repo at its label anchor (fully grown and halfway
 * through the time-lapse), in the gutter and in the minimap strip, skips hidden and unsown rows and
 * otherwise answers the axis; its painter draws no repo name, nothing of a hidden row and nothing
 * past the time-lapse's day, in the console's colours whatever the theme; and a profile without
 * repos works throughout.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { MINIMAP_VIEW } from '../src/profile/minimapView'
import { layoutMinimap, minimapGeom, rowY, stripRowY, stripX, MAX_PITCH, type MinimapLayout } from '../src/profile/minimapLayout'
import { hitMinimap } from '../src/profile/minimapHit'
import { minimapAnchor, minimapKeepOut, minimapLabelOrder, paintMinimap, rowColour, TAB_NAME, toneColour, type MinimapPaintInput } from '../src/profile/minimapPaint'
import { MINIMAP_PALETTE, minimapInk } from '../src/theme/console/minimap'
import { LIFE_YEAR_FONT } from '../src/profile/lifeAxis'
import { fitLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { axisHover, axisOf } from '../src/profile/lifeView'
import { repoKey } from '../src/profile/privacy'
import { buildLifeTimeline, dayAt, type LifeTimeline } from '../src/profile/timeline'
import type { LifeCamera, LifeHover, LifeViewport } from '../src/profile/lifeTypes'
import { THEMES, getTheme } from '../src/theme/themes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { prolific } from './helpers/lifeLinesScale'
import { recordingCtx } from './helpers/recordingCtx'
import { GAEARON_NOW, KEPANO_NOW, gaearonProfile, kepanoProfile } from './helpers/personScene'
import { LANDED_MIN_PX as MINIMAP_LANDED_MIN_PX } from '../src/profile/minimapPaint'
import { MINIMAP_PALETTE as M_PALETTE } from '../src/theme/console/minimap'
import { rowY as mRowY } from '../src/profile/minimapLayout'
import { dayNumber } from '../src/profile/timeline'

const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }
const NONE: ReadonlySet<string> = new Set()
/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
/** after prolific()'s last day */
const SCALE_NOW = Date.parse('2024-07-01T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`
const theme = getTheme('obsidian')

function repo(name: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner: `me/${name}`,
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

function profile(repos: ProfileRepo[], over: Partial<ProfileData> = {}): ProfileData {
  return {
    login: 'me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2019-01-10'),
    source: 'graphql',
    repos,
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

/** A small life: five repos in three languages, one archived, one with a gap, one never counted. */
function small(): ProfileData {
  return profile([
    repo('alpha', { createdAt: iso('2020-02-01'), lastActiveAt: iso('2023-05-01'), activity: [{ date: '2020-02-01', commits: 3 }, { date: '2020-02-03', commits: 1 }, { date: '2022-07-01', commits: 5 }] }),
    repo('beta', { createdAt: iso('2020-06-10'), language: 'Go', lastActiveAt: iso('2021-01-01'), activity: [{ date: '2020-06-10', commits: 2 }, { date: '2020-12-30', commits: 2 }], isArchived: true }),
    repo('gamma', { createdAt: iso('2021-03-01'), language: 'Rust', activity: [{ date: '2021-03-01', commits: 9 }, { date: '2024-06-01', commits: 1 }] }),
    repo('delta', { createdAt: iso('2022-01-05'), activity: [{ date: '2022-01-05', commits: 4 }] }),
    repo('epsilon', { createdAt: iso('2023-08-20'), language: 'Go', activity: [] }),
  ])
}

const json = (value: unknown) => JSON.stringify(value, (_k, v) => (v instanceof Map ? [...v] : v))
/** A layout without its keys: what is drawn, whatever the names. */
const unkeyed = (layout: MinimapLayout) => json({ ...layout, byKey: [...layout.byKey.values()], rows: layout.rows.map(({ key: _key, ...row }) => row) })

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

interface Built {
  timeline: LifeTimeline
  layout: MinimapLayout
  camera: LifeCamera
  view: LifeViewport
}

function build(p: ProfileData, now: number, view: LifeViewport = VIEW): Built {
  const timeline = buildLifeTimeline(p, now)
  const layout = layoutMinimap(timeline, p.source)
  return { timeline, layout, camera: fitLifeCamera(layout.days, view), view }
}

function paintInput(b: Built, over: Partial<MinimapPaintInput> = {}): MinimapPaintInput {
  const palette = languagePalette(b.timeline, theme)
  return {
    layout: b.layout,
    timeline: b.timeline,
    geoms: minimapGeom(b.layout, b.camera, b.view),
    camera: b.camera,
    view: b.view,
    ink: lifeInk(theme),
    colourOf: (language) => languageColour(palette, language, theme),
    hidden: NONE,
    hover: null,
    selected: null,
    at: null,
    ...over,
  }
}

function painted(b: Built, over: Partial<MinimapPaintInput> = {}) {
  const rec = recordingCtx(b.view.width * 2, b.view.height * 2)
  const input = paintInput(b, over)
  paintMinimap(rec.ctx, input)
  return { rec, input }
}

/** Every token drawn, as the x extent of its rounded path (four arcTo calls each). */
function tokens(rec: ReturnType<typeof recordingCtx>): Array<{ x0: number; x1: number; y: number }> {
  const arcs = rec.calls('arcTo')
  const out: Array<{ x0: number; x1: number; y: number }> = []
  for (let i = 0; i + 3 < arcs.length; i += 4) {
    const xs = arcs.slice(i, i + 4).flatMap((c) => [c.args[0] as number, c.args[2] as number])
    const ys = arcs.slice(i, i + 4).flatMap((c) => [c.args[1] as number, c.args[3] as number])
    out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y: (Math.min(...ys) + Math.max(...ys)) / 2 })
  }
  return out
}

let kepano: ProfileData
let gaearon: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
})

describe('layoutMinimap', () => {
  it('lays out one row per lane, in lane order, over the shared axis', () => {
    for (const [p, now] of [[small(), NOW], [kepano, KEPANO_NOW], [gaearon, GAEARON_NOW]] as const) {
      const timeline = buildLifeTimeline(p, now)
      const layout = layoutMinimap(timeline, p.source)
      const { startDay, todayDay, days, years, languages, milestones } = layout
      expect({ startDay, todayDay, days, years, languages, milestones }).toEqual(axisOf(timeline))
      expect(layout.rows.length).toBe(timeline.lanes.length)
      layout.rows.forEach((row, i) => {
        const lane = timeline.lanes[i]
        expect(row.lane).toBe(i)
        expect(row.key).toBe(repoKey(lane.repo))
        expect(layout.byKey.get(row.key)).toBe(i)
        expect(row.startDay).toBe(lane.startDay)
        expect(row.x).toBe(lane.rootDay - timeline.startDay + 0.5)
        // tokens and whitespace tile the row from x0 to x1, the root inside a token
        const parts = [...row.tokens, ...row.dormant].sort((a, b) => a.x0 - b.x0)
        expect(parts[0].x0).toBe(row.x0)
        expect(parts.at(-1)!.x1).toBe(row.x1)
        for (let k = 1; k < parts.length; k++) expect(parts[k].x0).toBe(parts[k - 1].x1)
        expect(row.tokens.some((t) => t.x0 <= row.x && row.x <= t.x1)).toBe(true)
      })
    }
  })

  it('is deterministic: the same profile in any order gives the same layout', () => {
    for (const [p, now] of [[small(), NOW], [kepano, KEPANO_NOW], [gaearon, GAEARON_NOW]] as const) {
      const first = json(layoutMinimap(buildLifeTimeline(p, now), p.source))
      expect(json(layoutMinimap(buildLifeTimeline(p, now), p.source))).toBe(first)
      for (const seed of [1, 2, 3]) {
        const q = { ...p, repos: shuffled(p.repos, seed) }
        expect(json(layoutMinimap(buildLifeTimeline(q, now), q.source))).toBe(first)
      }
    }
  })

  it('orders and draws rows from no name: renamed repos, private or not, keep their rows', () => {
    const base = small()
    // names in the opposite alphabetical order
    const renamed = profile(base.repos.map((r, i) => ({ ...r, nameWithOwner: `me/${String.fromCharCode(122 - i)}-renamed` })))
    expect(unkeyed(layoutMinimap(buildLifeTimeline(renamed, NOW), 'graphql'))).toBe(unkeyed(layoutMinimap(buildLifeTimeline(base, NOW), 'graphql')))
    // two private repos alike in everything but their names, in either naming
    const twins = (a: string, b: string) =>
      profile([
        repo(a, { isPrivate: true, createdAt: iso('2021-01-01'), activity: [{ date: '2021-01-01', commits: 2 }] }),
        repo(b, { isPrivate: true, createdAt: iso('2021-01-01'), activity: [{ date: '2021-01-01', commits: 2 }] }),
        repo('public', { createdAt: iso('2021-01-01'), activity: [{ date: '2021-01-01', commits: 2 }] }),
      ])
    expect(unkeyed(layoutMinimap(buildLifeTimeline(twins('aaa', 'zzz'), NOW), 'graphql'))).toBe(unkeyed(layoutMinimap(buildLifeTimeline(twins('zzz', 'aaa'), NOW), 'graphql')))
  })

  it('gives a language its tone by how many repos use it, then by its own name', () => {
    const { layout } = build(small(), NOW)
    expect([...layout.toneOf]).toEqual([['Go', 0], ['TypeScript', 1], ['Rust', 2]])
    const tone = (name: string) => layout.rows[layout.byKey.get(`me/${name}`)!].tone
    expect([tone('alpha'), tone('beta'), tone('gamma'), tone('delta'), tone('epsilon')]).toEqual([1, 0, 2, 1, 0])
    const noLanguage = build(profile([repo('x', { language: null })]), NOW).layout
    expect(noLanguage.rows[0].tone).toBe(-1)
    expect(toneColour(-1)).toBe(MINIMAP_PALETTE.plain)
    expect(toneColour(MINIMAP_PALETTE.tokens.length)).toBe(MINIMAP_PALETTE.tokens[0])
    expect(rowColour({ dry: true, tone: 0 })).toBe(MINIMAP_PALETTE.comment)
  })

  it('lays out a user with no repos', () => {
    const { layout, camera, view } = build(profile([]), NOW)
    expect(layout.rows).toEqual([])
    const g = minimapGeom(layout, camera, view)
    expect(Number.isFinite(g.pitch)).toBe(true)
    expect(minimapLabelOrder(layout).length).toBe(0)
    const { rec } = painted({ ...build(profile([]), NOW) })
    expect(rec.calls('arcTo')).toHaveLength(0)
    expect(rec.texts()).toContain(TAB_NAME)
    const hit = hitMinimap(layout, g, camera, view, 300, 300, NONE, null)
    expect(hit).toEqual(axisHover(layout, camera, view, 300, 300))
  })
})

describe('minimapGeom', () => {
  it('stacks rows top-down under the tab bar, an editor line apart at most, inside the plot', () => {
    const b = build(small(), NOW)
    const g = minimapGeom(b.layout, b.camera, VIEW)
    expect(g.pitch).toBe(MAX_PITCH)
    expect(g.rowsTop).toBe(g.tabBottom)
    expect(rowY(g, 0)).toBe(g.rowsTop + MAX_PITCH / 2)
    expect(g.numberStep).toBe(1)
    // the gutter and the strip stay in the side margins of a fitted life
    expect(g.gutterW).toBeLessThanOrEqual(b.camera.tx)
    expect(g.strip.x0).toBeGreaterThanOrEqual(b.camera.tx + b.layout.days * b.camera.k)
    expect(g.strip.x1).toBe(VIEW.width)
  })

  it('keeps 300 to 500 repos apart, inside the plot, with line numbers that fit', () => {
    for (const n of [300, 500]) {
      const b = build(prolific(n, 'graphql'), SCALE_NOW)
      const g = minimapGeom(b.layout, b.camera, VIEW)
      expect(b.layout.rows.length).toBe(n)
      expect(g.pitch).toBeGreaterThanOrEqual(1)
      expect(g.tokenH).toBeGreaterThanOrEqual(1)
      expect(rowY(g, n - 1) + g.pitch / 2).toBeLessThanOrEqual(horizonY(VIEW) + 0.001)
      expect(g.numberStep * g.pitch).toBeGreaterThanOrEqual(g.numberPx + 1)
      expect(stripRowY(g.strip, n - 1) + g.strip.barH).toBeLessThanOrEqual(g.strip.y1 + 1)
      expect(g.numberPx * String(n).length * 0.62).toBeLessThanOrEqual(g.gutterW)
    }
  })

  it('keeps every number finite in a viewport too small for a plot', () => {
    const b = build(small(), NOW, { width: 80, height: 60, top: 72, ground: 96, side: 4 })
    const g = minimapGeom(b.layout, b.camera, b.view)
    for (const v of [g.pitch, g.tokenH, g.numberPx, g.strip.pitch, g.strip.barH, rowY(g, 4)]) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('hitMinimap', () => {
  /** Hits every row drawn at its label anchor. */
  function hitsAtAnchors(b: Built, at: number | null) {
    const g = minimapGeom(b.layout, b.camera, b.view)
    const out = new Float32Array(3)
    let checked = 0
    b.layout.rows.forEach((row, i) => {
      if (at !== null && row.startDay > at) return
      expect(minimapAnchor(b.layout, g, i, at, out)).toBe(true)
      const [x, y] = out
      expect(hitMinimap(b.layout, g, b.camera, b.view, x, y, NONE, at), `${i} at ${at}`).toEqual({ kind: 'repo', key: row.key })
      checked++
    })
    return checked
  }

  it('hits every repo at its label anchor, fully grown and halfway through the time-lapse', () => {
    for (const [p, now] of [[small(), NOW], [kepano, KEPANO_NOW], [gaearon, GAEARON_NOW]] as const) {
      const b = build(p, now)
      expect(hitsAtAnchors(b, null)).toBe(b.layout.rows.length)
      expect(hitsAtAnchors(b, dayAt(b.timeline.clock, 0.5))).toBeGreaterThan(0)
    }
  })

  it('hits every one of 300 and 500 repos at its anchor, fitted and zoomed in', () => {
    for (const n of [300, 500]) {
      const b = build(prolific(n, n === 300 ? 'graphql' : 'rest'), SCALE_NOW)
      expect(hitsAtAnchors(b, null)).toBe(n)
      const zoomed = { ...b, camera: zoomLifeCamera(b.camera, 4, VIEW.width / 2, b.layout.days, VIEW) }
      const g = minimapGeom(b.layout, zoomed.camera, VIEW)
      const out = new Float32Array(3)
      b.layout.rows.forEach((row, i) => {
        minimapAnchor(b.layout, g, i, null, out)
        if (out[0] < 0 || out[0] >= g.strip.x0) return
        expect(hitMinimap(b.layout, g, zoomed.camera, VIEW, out[0], out[1], NONE, null)).toEqual({ kind: 'repo', key: row.key })
      })
    }
  })

  it('skips hidden and unsown rows, and answers the axis away from any row', () => {
    const b = build(small(), NOW)
    const g = minimapGeom(b.layout, b.camera, VIEW)
    const out = new Float32Array(3)
    const i = b.layout.byKey.get('me/gamma')!
    minimapAnchor(b.layout, g, i, null, out)
    const [x, y] = out
    const axis = axisHover(b.layout, b.camera, VIEW, x, y)
    expect(hitMinimap(b.layout, g, b.camera, VIEW, x, y, new Set(['me/gamma']), null)).toEqual(axis)
    const before = b.layout.rows[i].startDay - 1
    expect(hitMinimap(b.layout, g, b.camera, VIEW, x, y, NONE, before)).toEqual(axisHover(b.layout, b.camera, VIEW, x, y))
    // left of where the row starts, and below every row
    const row = b.layout.rows[i]
    const left = b.camera.tx + row.x0 * b.camera.k - 20
    expect(hitMinimap(b.layout, g, b.camera, VIEW, left, y, NONE, null)).toEqual(axisHover(b.layout, b.camera, VIEW, left, y))
    const below = rowY(g, b.layout.rows.length - 1) + 40
    expect(hitMinimap(b.layout, g, b.camera, VIEW, x, below, NONE, null)).toEqual(axisHover(b.layout, b.camera, VIEW, x, below))
    expect(hitMinimap(b.layout, g, b.camera, VIEW, -5, y, NONE, null)).toBeNull()
  })

  it('hits a row by its line number in the gutter and by its bar in the strip', () => {
    const b = build(small(), NOW)
    const g = minimapGeom(b.layout, b.camera, VIEW)
    b.layout.rows.forEach((row, i) => {
      expect(hitMinimap(b.layout, g, b.camera, VIEW, g.gutterW / 2, rowY(g, i), NONE, null)).toEqual({ kind: 'repo', key: row.key })
      const sy = stripRowY(g.strip, i) + g.strip.barH / 2
      expect(hitMinimap(b.layout, g, b.camera, VIEW, (g.strip.x0 + g.strip.x1) / 2, sy, NONE, null)).toEqual({ kind: 'repo', key: row.key })
      expect(hitMinimap(b.layout, g, b.camera, VIEW, g.gutterW / 2, rowY(g, i), new Set([row.key]), null)).not.toEqual({ kind: 'repo', key: row.key })
    })
  })
})

describe('paintMinimap', () => {
  it('fills the whole backing store with the editor background first, whatever the theme', () => {
    const b = build(small(), NOW)
    for (const t of THEMES) {
      const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
      const palette = languagePalette(b.timeline, t)
      paintMinimap(rec.ctx, { ...paintInput(b), ink: lifeInk(t), colourOf: (l) => languageColour(palette, l, t) })
      const first = rec.calls('fillRect')[0]
      expect(first.args).toEqual([0, 0, VIEW.width * 2, VIEW.height * 2])
      expect(first.style.fillStyle).toBe(MINIMAP_PALETTE.background)
    }
  })

  it('draws no repo name: only line numbers, the tab, years and today', () => {
    for (const [p, now] of [[small(), NOW], [kepano, KEPANO_NOW], [gaearon, GAEARON_NOW]] as const) {
      const b = build(p, now)
      const selected = b.layout.rows[0].key
      const { rec } = painted(b, { selected, hover: { kind: 'repo', key: b.layout.rows.at(-1)!.key } })
      const names = p.repos.flatMap((r) => [r.nameWithOwner.toLowerCase(), r.nameWithOwner.split('/')[1].toLowerCase()])
      for (const text of rec.texts()) {
        expect(text === TAB_NAME || text === '×' || text === 'today' || /^\d+$/.test(text), text).toBe(true)
        for (const name of names) expect(text.toLowerCase()).not.toContain(name)
      }
    }
  })

  it("draws every row's tokens on its line, in its tone, and line numbers for every row", () => {
    const b = build(small(), NOW)
    const { rec, input } = painted(b)
    const g = input.geoms
    const drawn = tokens(rec)
    expect(drawn.length).toBe(b.layout.rows.reduce((n, row) => n + row.tokens.length, 0))
    const ys = new Set(drawn.map((t) => Math.round(t.y * 100)))
    b.layout.rows.forEach((_, i) => expect(ys.has(Math.round(rowY(g, i) * 100))).toBe(true))
    const fills = new Set(rec.calls('fill').map((c) => c.style.fillStyle))
    for (const row of b.layout.rows) if (!row.seedling) expect(fills.has(rowColour(row))).toBe(true)
    const numbers = rec.calls('fillText').filter((c) => c.style.font !== LIFE_YEAR_FONT && /^\d+$/.test(String(c.args[0]))).map((c) => Number(c.args[0]))
    expect(numbers.sort((a, z) => a - z)).toEqual(b.layout.rows.map((_, i) => i + 1))
  })

  it('draws nothing of a hidden row, in the editor, the gutter or the strip', () => {
    const b = build(small(), NOW)
    const key = 'me/gamma'
    const i = b.layout.byKey.get(key)!
    const all = painted(b)
    const without = painted(b, { hidden: new Set([key]) })
    expect(tokens(without.rec).length).toBe(tokens(all.rec).length - b.layout.rows[i].tokens.length)
    const y = rowY(all.input.geoms, i)
    expect(tokens(without.rec).some((t) => Math.abs(t.y - y) < 0.01)).toBe(false)
    expect(without.rec.calls('fillText').some((c) => c.args[0] === String(i + 1))).toBe(false)
    const s = all.input.geoms.strip
    const stripBars = (rec: ReturnType<typeof recordingCtx>) => rec.calls('fillRect').filter((c) => (c.args[0] as number) >= s.ix0 - 0.01 && c.args[1] === stripRowY(s, i))
    expect(stripBars(all.rec).length).toBeGreaterThan(0)
    expect(stripBars(without.rec)).toHaveLength(0)
  })

  it('draws nothing past the time-lapse day, and no row sown after it', () => {
    for (const [p, now] of [[small(), NOW], [kepano, KEPANO_NOW], [gaearon, GAEARON_NOW]] as const) {
      const b = build(p, now)
      for (const progress of [0, 0.3, 0.6]) {
        const at = dayAt(b.timeline.clock, progress)
        const { rec, input } = painted(b, { at })
        const g = input.geoms
        const edge = b.camera.tx + (at - b.layout.startDay) * b.camera.k
        for (const t of tokens(rec)) expect(t.x0).toBeLessThanOrEqual(edge + 1.01)
        const unsown = b.layout.rows.flatMap((row, i) => (row.startDay > at ? [i] : []))
        const ys = tokens(rec).map((t) => t.y)
        for (const i of unsown) expect(ys.some((y) => Math.abs(y - rowY(g, i)) < 0.01)).toBe(false)
        const numbers = new Set(rec.calls('fillText').map((c) => String(c.args[0])))
        for (const i of unsown) expect(numbers.has(String(i + 1))).toBe(false)
        const stripEdge = stripX(g.strip, at - b.layout.startDay) + 1.01
        const bars = rec.calls('fillRect').filter((c) => (c.args[0] as number) >= g.strip.ix0 - 0.01 && (c.args[3] as number) === g.strip.barH)
        for (const bar of bars) expect(bar.args[0] as number).toBeLessThanOrEqual(stripEdge)
      }
    }
  })

  it('bands the hovered and the selected row, brightens their numbers and dims the rest behind a selection', () => {
    const b = build(small(), NOW)
    const sel = b.layout.rows[1].key
    const hov: LifeHover = { kind: 'repo', key: b.layout.rows[3].key }
    const { rec } = painted(b, { selected: sel, hover: hov })
    const fills = rec.calls('fillRect').map((c) => c.style.fillStyle)
    expect(fills).toContain(MINIMAP_PALETTE.lineHighlight)
    expect(fills).toContain(MINIMAP_PALETTE.selection)
    const bright = rec.calls('fillText').filter((c) => c.style.fillStyle === MINIMAP_PALETTE.lineNumberActive).map((c) => c.args[0])
    expect(bright.sort()).toEqual(['2', '4'])
    const alphas = new Set(rec.calls('fill').map((c) => c.style.globalAlpha))
    expect(alphas.has(1)).toBe(true)
    expect([...alphas].some((a) => (a as number) < 1)).toBe(true)
  })

  it('paints 500 repos, thin but every row drawn', () => {
    const b = build(prolific(500, 'graphql'), SCALE_NOW)
    const { rec, input } = painted(b)
    const ys = new Set(tokens(rec).map((t) => Math.round(t.y * 100)))
    b.layout.rows.forEach((_, i) => expect(ys.has(Math.round(rowY(input.geoms, i) * 100))).toBe(true))
  })
})

describe('minimap labels and the view', () => {
  it("anchors a label at a row's root once rooted, else where it starts, on its line", () => {
    const b = build(small(), NOW)
    const g = minimapGeom(b.layout, b.camera, VIEW)
    const out = new Float32Array(3)
    b.layout.rows.forEach((row, i) => {
      expect(minimapAnchor(b.layout, g, i, null, out)).toBe(true)
      expect(out[0]).toBeCloseTo(b.camera.tx + row.x * b.camera.k, 3)
      expect(out[1]).toBeCloseTo(rowY(g, i), 3)
      minimapAnchor(b.layout, g, i, row.rootDay - 0.5, out)
      if (row.startDay < row.rootDay) expect(out[0]).toBeCloseTo(b.camera.tx + row.x0 * b.camera.k, 3)
    })
    expect(minimapAnchor(b.layout, g, 99, null, out)).toBe(false)
  })

  it('orders labels by weight, then stars, then line order', () => {
    const { layout } = build(small(), NOW)
    const order = Array.from(minimapLabelOrder(layout))
    expect([...order].sort()).toEqual(layout.rows.map((_, i) => i))
    for (let k = 1; k < order.length; k++) expect(layout.rows[order[k - 1]].weight).toBeGreaterThanOrEqual(layout.rows[order[k]].weight)
  })

  it('keeps labels off the ground first, then the tab bar, the gutter and the strip', () => {
    const { layout } = build(small(), NOW)
    const box = Array.from(minimapKeepOut(layout, VIEW))
    expect(box.length % 4).toBe(0)
    expect(box.slice(0, 4)).toEqual([0, horizonY(VIEW) - 1, VIEW.width, VIEW.height])
    const g = minimapGeom(layout, fitLifeCamera(layout.days, VIEW), VIEW)
    expect(box.slice(4)).toEqual([0, 0, VIEW.width, g.tabBottom, 0, 0, g.gutterW, horizonY(VIEW), g.strip.x0, 0, VIEW.width, VIEW.height])
  })

  it('is the registry entry: id, title and a scene over its own modules, its ink and plate colours the editor’s', () => {
    expect(MINIMAP_VIEW.id).toBe('minimap')
    expect(MINIMAP_VIEW.title).toBe('minimap')
    const b = build(small(), NOW)
    const layout = MINIMAP_VIEW.layout(b.timeline, 'graphql')
    expect(MINIMAP_VIEW.scene.items(layout)).toBe(layout.rows)
    const ink = lifeInk(theme)
    const palette = languagePalette(b.timeline, theme)
    const colourOf = (l: string | null) => languageColour(palette, l, theme)
    // a plate's dot is the row's own token colour, as drawn on the editor, never the theme's
    layout.rows.forEach((row, i) => expect(MINIMAP_VIEW.scene.itemColour(layout, i, ink, colourOf)).toBe(rowColour(row)))
    expect(MINIMAP_VIEW.ink).toBe(minimapInk)
  })

  it('spells no colour outside src/theme and takes no namer', () => {
    const sources = import.meta.glob<string>(['../src/profile/minimap*.ts'], { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4)
    for (const [file, text] of Object.entries(sources)) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      expect(code.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i), file).toBeNull()
      expect(code, file).not.toMatch(/RepoNamer|repoNamer|nameWithOwner/)
    }
  })
})

// ---------- landed pull requests ----------

describe('landed pull requests on the minimap', () => {
  const landedProfile = () =>
    profile([...small().repos, repo('tool', { nameWithOwner: 'up/tool', isOwn: false, createdAt: iso('2018-01-01'), firstActiveAt: iso('2021-06-01'), lastActiveAt: iso('2022-02-01') })], {
      landed: [
        { day: '2022-02-01', repo: 'up/tool' },
        { day: '2021-06-01', repo: 'UP/tool' },
      ],
    })

  /** The accent squares on row i: rects in the accent centred on the row, as wide as tall. */
  function squaresOn(rec: ReturnType<typeof recordingCtx>, input: MinimapPaintInput, i: number): number[] {
    const y = mRowY(input.geoms, i)
    return rec
      .calls('rect')
      .filter((c) => c.style.fillStyle === M_PALETTE.accent && c.args[2] === c.args[3] && (c.args[2] as number) >= MINIMAP_LANDED_MIN_PX && Math.abs((c.args[1] as number) + (c.args[3] as number) / 2 - y) < 1e-6)
      .map((c) => (c.args[0] as number) + (c.args[2] as number) / 2)
  }

  it('draws an accent square on each landed day of a row once reached, never on a hidden row', () => {
    const b = build(landedProfile(), NOW)
    const i = b.layout.byKey.get('up/tool')!
    const row = b.layout.rows[i]
    expect(row.landed).toEqual([dayNumber('2021-06-01') - b.layout.startDay + 0.5, dayNumber('2022-02-01') - b.layout.startDay + 0.5])
    expect(row.seedling).toBe(true)
    const sx = (x: number) => b.camera.tx + x * b.camera.k
    const full = painted(b)
    expect(squaresOn(full.rec, full.input, i).map((x) => Math.round(x * 1e6) / 1e6)).toEqual(row.landed.map(sx).map((x) => Math.round(x * 1e6) / 1e6))
    for (let k = 0; k < b.layout.rows.length; k++) if (k !== i) expect(squaresOn(full.rec, full.input, k)).toEqual([])
    const before = painted(b, { at: row.startDay - 1 })
    expect(squaresOn(before.rec, before.input, i)).toEqual([])
    const between = painted(b, { at: dayNumber('2021-12-01') })
    expect(squaresOn(between.rec, between.input, i)).toHaveLength(1)
    const onDay = painted(b, { at: dayNumber('2022-02-01') })
    expect(squaresOn(onDay.rec, onDay.input, i)).toHaveLength(2)
    const hidden = painted(b, { hidden: new Set(['up/tool']) })
    expect(squaresOn(hidden.rec, hidden.input, i)).toEqual([])
  })
})
