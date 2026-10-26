/**
 * The constellation's geometry and painter on a recording context: radii and plot rows, what it
 * fills first, that it draws every number finite and every colour from the theme, in all ten themes,
 * each kind of star, that hidden stars and their links draw nothing, how the hover and the selection
 * show, the bands and their names, what the time-lapse leaves out and how it grows a star, and that
 * no repo name is ever drawn by it (the labels are useLifeLabels'). Then its label anchors, order and
 * keep-out boxes, its source (no colour literal, no namer), and its frame under the shared painter
 * (makeViewPaint): names only through the namer, no label for a hidden star, the time-lapse caption.
 */
import { describe, expect, it } from 'vitest'
import { THEMES, getTheme, type Theme } from '../src/theme/themes'
import { buildLifeTimeline, dayNumber, type LifeTimeline } from '../src/profile/timeline'
import { layoutConstellation, type ConstellationLayout, type LifeStar } from '../src/profile/constellationLayout'
import { GLOW_PX, SEEDLING_R, STAR_FOOT_PX, STAR_MAX_R, STAR_MIN_R, constellationGeom, starPlotY, starRadius, type ConstellationGeom } from '../src/profile/constellationGeometry'
import {
  constellationKeepOut,
  grownRadius,
  paintConstellation,
  starAnchor,
  starColour,
  starGrownShare,
  starLabelOrder,
  type ConstellationPaintInput,
} from '../src/profile/constellationPaint'
import { hitConstellation } from '../src/profile/constellationHit'
import { LIFE_YEAR_FONT } from '../src/profile/lifeAxis'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { fitLifeCamera, panLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { makeViewPaint, type LifePaintState } from '../src/profile/lifePaint'
import { PRIVATE_REPO_LABEL, privateRepoKeys, repoNamer } from '../src/profile/privacy'
import { LIFE_LABEL_FONT } from '../src/profile/useLifeLabels'
import type { LifeScene } from '../src/profile/lifeView'
import type { LifeHover, LifeInk, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import layoutSource from '../src/profile/constellationLayout.ts?raw'
import geometrySource from '../src/profile/constellationGeometry.ts?raw'
import paintSource from '../src/profile/constellationPaint.ts?raw'
import hitSource from '../src/profile/constellationHit.ts?raw'
import { recordingCtx, type CtxEntry, type RecordingCtx } from './helpers/recordingCtx'

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
    fallback: null,
    ...over,
  }
}

/**
 * A token profile with one star of each kind: a starred one with a sparkle, a private repo, an
 * archived one, a fork (a twin), a repo they only contributed to with no language (hollow), and a
 * starred repo GitHub counted no commits to (a seedling), in five bands.
 */
const REPOS: ProfileRepo[] = [
  repo('Me/alpha', { createdAt: iso('2019-02-01'), stars: 120, activity: monthly('2019-02', '2021-06', 4) }),
  repo('Me/beta', { createdAt: iso('2019-09-01'), activity: monthly('2019-09', '2020-08', 2) }),
  repo('Me/Secret-Plans', { createdAt: iso('2020-03-01'), language: 'Rust', stars: 30, isPrivate: true, activity: monthly('2020-03', '2024-05', 3) }),
  repo('Me/old-thing', { createdAt: iso('2019-06-01'), language: 'JavaScript', stars: 15, isArchived: true, activity: monthly('2019-06', '2019-12') }),
  repo('Me/forked-lib', { createdAt: iso('2021-01-10'), language: 'Go', isFork: true, activity: monthly('2021-01', '2021-03', 1) }),
  repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2021-02-01'), isOwn: false, language: null, activity: monthly('2021-02', '2023-02', 5) }),
  repo('Me/empty-seedling', { createdAt: iso('2023-08-01'), stars: 5 }),
]

const PRIVATE = 'me/secret-plans'
const NAMES = ['alpha', 'beta', 'secret', 'old-thing', 'forked-lib', 'big-project', 'empty-seedling']

/** The canvas host's frame on a laptop screen. */
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

interface Scene {
  timeline: LifeTimeline
  layout: ConstellationLayout
  theme: Theme
  ink: LifeInk
  g: ConstellationGeom
  input: ConstellationPaintInput
}

function scene(p: ProfileData = profile({ repos: REPOS }), theme: Theme = getTheme('obsidian'), over: Partial<ConstellationPaintInput> = {}): Scene {
  const timeline = buildLifeTimeline(p, NOW)
  const layout = layoutConstellation(timeline, p.source)
  const ink = lifeInk(theme)
  const palette = languagePalette(timeline, theme)
  const colourOf = (language: string | null) => languageColour(palette, language, theme)
  const camera = fitLifeCamera(layout.days, VIEW)
  const g = constellationGeom(layout, camera, VIEW)
  const input: ConstellationPaintInput = { layout, timeline, geoms: g, camera, view: VIEW, ink, colourOf, hidden: new Set(), hover: null, selected: null, at: null, ...over }
  return { timeline, layout, theme, ink, g, input }
}

function paint(s: Scene, over: Partial<ConstellationPaintInput> = {}): RecordingCtx {
  const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
  paintConstellation(rec.ctx, { ...s.input, ...over })
  return rec
}

const indexOf = (s: Scene, key: string) => s.layout.byKey.get(key.toLowerCase())!
const starOf = (s: Scene, key: string): LifeStar => s.layout.stars[indexOf(s, key)]

/** Every colour the theme lets the constellation draw with: its ink and its language colours. */
function allowedColours(s: Scene): Set<string> {
  const { garden: _garden, dimAlpha: _alpha, ...flat } = s.ink
  const allowed = new Set<string>(Object.values(flat))
  for (const colour of [...Object.values(languagePalette(s.timeline, s.theme)), s.theme.fallback]) allowed.add(colour)
  return allowed
}

/** Calls of one method, as plain argument lists. */
const argsOf = (rec: RecordingCtx, name: string) => rec.calls(name).map((c) => c.args as number[])

/** Every number a call was given or a property was set to. */
function numbersOf(log: CtxEntry[]): number[] {
  return log.flatMap((e) => (e.kind === 'call' ? e.args : [e.value])).filter((v): v is number => typeof v === 'number')
}

/** The arcs drawn round star i's centre, by radius, each with the style it was filled or stroked in next. */
function arcsAt(rec: RecordingCtx, x: number, y: number): Array<{ r: number; entry: Extract<CtxEntry, { kind: 'call' }> }> {
  const out: Array<{ r: number; entry: Extract<CtxEntry, { kind: 'call' }> }> = []
  rec.log.forEach((e, i) => {
    if (e.kind !== 'call' || e.name !== 'arc' || e.args[0] !== x || e.args[1] !== y) return
    const next = rec.log.slice(i + 1).find((n): n is Extract<CtxEntry, { kind: 'call' }> => n.kind === 'call' && (n.name === 'fill' || n.name === 'stroke'))
    if (next) out.push({ r: e.args[2] as number, entry: next })
  })
  return out
}

const centre = (s: Scene, i: number) => [s.g.x[i], s.g.y[i]] as const

describe('constellation geometry', () => {
  it('sizes a core from its weight, a seedling smallest, and its glow from its stars', () => {
    expect(starRadius({ size: 0, seedling: false })).toBe(STAR_MIN_R)
    expect(starRadius({ size: 1, seedling: false })).toBe(STAR_MAX_R)
    expect(starRadius({ size: 0.5, seedling: false })).toBeCloseTo((STAR_MIN_R + STAR_MAX_R) / 2, 12)
    expect(starRadius({ size: 0, seedling: true })).toBe(SEEDLING_R)
    const s = scene()
    s.layout.stars.forEach((star, i) => {
      expect(s.g.r[i]).toBe(starRadius(star))
      expect(s.g.r[i] >= SEEDLING_R && s.g.r[i] <= STAR_MAX_R).toBe(true)
      expect(s.g.glow[i]).toBe(GLOW_PX * star.glow)
    })
  })

  it('plots y from the viewport only, between its top and a little above the horizon, and x from the camera', () => {
    const s = scene()
    const foot = horizonY(VIEW) - STAR_FOOT_PX
    s.layout.stars.forEach((star, i) => {
      expect(s.g.y[i]).toBe(starPlotY(VIEW, star.y))
      expect(s.g.y[i] > VIEW.top && s.g.y[i] < foot).toBe(true)
      expect(s.g.x[i]).toBe(s.input.camera.tx + star.x * s.input.camera.k)
    })
    s.layout.bands.forEach((band, i) => {
      expect(s.g.bandTop[i]).toBe(starPlotY(VIEW, band.y0))
      expect(s.g.bandFoot[i]).toBe(starPlotY(VIEW, band.y1))
    })
    expect(s.g.bandTop[0]).toBe(VIEW.top)
    expect(s.g.bandFoot[s.layout.bands.length - 1]).toBe(foot)
    // a zoom spreads stars apart along time and never moves or grows them up and down
    const zoomed = panLifeCamera(zoomLifeCamera(s.input.camera, 4, VIEW.width / 2, s.layout.days, VIEW), 100, s.layout.days, VIEW)
    const z = constellationGeom(s.layout, zoomed, VIEW)
    expect([...z.y]).toEqual([...s.g.y])
    expect([...z.r]).toEqual([...s.g.r])
    expect([...z.x]).not.toEqual([...s.g.x])
  })

  it('keeps a tiny viewport finite', () => {
    const s = scene()
    const tiny: LifeViewport = { ...VIEW, width: 40, height: 60 }
    const g = constellationGeom(s.layout, fitLifeCamera(s.layout.days, tiny), tiny)
    for (const arr of [g.x, g.y, g.r, g.glow, g.bandTop, g.bandFoot]) for (const n of arr) expect(Number.isFinite(n)).toBe(true)
    for (const y of g.y) expect(y).toBe(tiny.top)
  })
})

describe('paintConstellation', () => {
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
    const key = starOf(s, 'Me/alpha').key
    const allowed = allowedColours(s)
    for (const over of [{}, { selected: key }, { hover: { kind: 'repo', key } as LifeHover }, { hover: { kind: 'day', day: s.layout.startDay + 40, milestone: 0 } as LifeHover }]) {
      const rec = paint(s, over)
      for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
      for (const colour of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(allowed, String(colour)).toContain(colour)
      for (const alpha of rec.sets('globalAlpha') as number[]) expect(alpha > 0 && alpha <= 1, String(alpha)).toBe(true)
    }
  })

  it('draws a star of each kind: glow, sparkle, twin, hollow, faint and dry', () => {
    const s = scene()
    const rec = paint(s)
    const colourOf = s.input.colourOf

    // a starred star: three glow discs, the outermost faintest, round its core; 120 stars sparkle
    const a = indexOf(s, 'Me/alpha')
    const [ax, ay] = centre(s, a)
    const r = s.g.r[a]
    const glow = s.g.glow[a]
    const arcs = arcsAt(rec, ax, ay)
    expect(arcs.map((arc) => arc.r)).toEqual([r + glow, r + glow * 0.66, r + glow * 0.33, r])
    expect(arcs.map((arc) => arc.entry.style.globalAlpha)).toEqual([0.1, 0.16, 0.24, 1])
    for (const arc of arcs) expect(arc.entry.style.fillStyle).toBe(colourOf('TypeScript'))
    const arm = r + 0.9 * glow
    expect(argsOf(rec, 'moveTo').some(([x, y]) => x === ax - arm && y === ay)).toBe(true)
    expect(argsOf(rec, 'moveTo').some(([x, y]) => x === ax && y === ay - arm)).toBe(true)
    // fewer stars: no sparkle
    const o = indexOf(s, 'Me/old-thing')
    expect(argsOf(rec, 'moveTo').some(([x, y]) => y === s.g.y[o] && x < s.g.x[o])).toBe(false)

    // a fork: a companion up and to the right
    const f = indexOf(s, 'Me/forked-lib')
    const d = (s.g.r[f] + 2.5) * Math.SQRT1_2
    expect(argsOf(rec, 'arc').some(([x, y, rr]) => x === s.g.x[f] + d && y === s.g.y[f] - d && rr === Math.max(1, s.g.r[f] * 0.4))).toBe(true)

    // a repo they only contributed to: hollow, ringed in its colour (no language: the fallback)
    const v = indexOf(s, 'someone/big-project')
    const hollow = arcsAt(rec, ...centre(s, v)).filter((arc) => arc.r === s.g.r[v])
    expect(hollow[0].entry).toMatchObject({ name: 'fill', style: { fillStyle: s.ink.canvas } })
    const ring = rec.calls('stroke').find((c) => c.style.strokeStyle === s.theme.fallback && c.style.lineWidth === 1.5)
    expect(ring).toBeDefined()

    // a seedling: faint
    const seed = indexOf(s, 'Me/empty-seedling')
    expect(starOf(s, 'Me/empty-seedling').seedling).toBe(true)
    const faint = arcsAt(rec, ...centre(s, seed)).find((arc) => arc.r === s.g.r[seed])!
    expect(faint.entry.style.globalAlpha).toBe(0.55)

    // an archived repo: dry
    const dry = arcsAt(rec, ...centre(s, o)).find((arc) => arc.r === s.g.r[o])!
    expect(dry.entry.style.fillStyle).toBe(s.ink.dry)
    expect(starColour(starOf(s, 'Me/old-thing'), s.ink, colourOf)).toBe(s.ink.dry)
    expect(starColour(starOf(s, 'Me/Secret-Plans'), s.ink, colourOf)).toBe(colourOf('Rust'))
  })

  it('sparkles a repo with 100 stars or more, as the legend says, and not one with 99', () => {
    const s = scene(
      profile({
        repos: [
          repo('Me/ninety-nine', { createdAt: iso('2019-03-01'), stars: 99, activity: monthly('2019-03', '2020-03') }),
          repo('Me/hundred', { createdAt: iso('2021-03-01'), stars: 100, activity: monthly('2021-03', '2022-03') }),
        ],
      }),
    )
    const rec = paint(s)
    const sparkles = (key: string) => {
      const i = indexOf(s, key)
      const [x, y] = centre(s, i)
      const arm = s.g.r[i] + 0.9 * s.g.glow[i]
      return argsOf(rec, 'moveTo').some(([mx, my]) => mx === x - arm && my === y) && argsOf(rec, 'moveTo').some(([mx, my]) => mx === x && my === y - arm)
    }
    // 99 stars glow as brightly as the old threshold, but only 100 sparkle
    expect(starOf(s, 'Me/ninety-nine').glow).toBe(0.5)
    expect(sparkles('Me/ninety-nine')).toBe(false)
    expect(sparkles('Me/hundred')).toBe(true)
  })

  it('draws no repo name: only years, today and the bands', () => {
    const s = scene()
    const bands = s.layout.bands.map((b) => b.label)
    // Rust has the most counted commits, then TypeScript
    expect(bands).toEqual(['Rust', 'TypeScript', 'JavaScript', 'Go', 'no language'])
    for (const over of [{}, { selected: PRIVATE }, { hover: { kind: 'repo', key: PRIVATE } as LifeHover }]) {
      const rec = paint(s, over)
      const texts = [...argsOf(rec, 'fillText'), ...argsOf(rec, 'strokeText')].map(([text]) => String(text))
      expect(texts.length).toBeGreaterThan(0)
      for (const text of texts) expect(/^(\d{4}|today)$/.test(text) || bands.includes(text), text).toBe(true)
      for (const text of rec.texts()) for (const name of NAMES) expect(text.toLowerCase()).not.toContain(name)
    }
    const rec = paint(s)
    expect([...rec.calls('fillText'), ...rec.calls('strokeText')].every((c) => c.style.font === LIFE_YEAR_FONT)).toBe(true)
  })

  it('draws nothing of a hidden star, nor its links', () => {
    const s = scene()
    const all = paint(s, { hidden: new Set(s.layout.stars.map((star) => star.key)) })
    s.layout.stars.forEach((_star, i) => expect(arcsAt(all, ...centre(s, i))).toEqual([]))
    expect(all.calls('stroke').some((c) => c.style.strokeStyle === s.ink.muted && c.style.lineWidth === 1 && c.style.globalAlpha === 0.22)).toBe(false)

    const i = indexOf(s, 'Me/alpha')
    const key = s.layout.stars[i].key
    expect(s.layout.links.some((link) => link.a === i || link.b === i)).toBe(true)
    const shown = paint(s)
    const hidden = paint(s, { hidden: new Set([key]), hover: { kind: 'repo', key }, selected: key })
    expect(arcsAt(shown, ...centre(s, i)).length).toBeGreaterThan(0)
    expect(arcsAt(hidden, ...centre(s, i))).toEqual([])
    const [x, y] = centre(s, i)
    const touches = (rec: RecordingCtx) => [...argsOf(rec, 'moveTo'), ...argsOf(rec, 'lineTo')].some(([px, py]) => px === x && py === y)
    expect(touches(shown)).toBe(true)
    expect(touches(hidden)).toBe(false)
    expect(hidden.calls('stroke').some((c) => c.style.strokeStyle === s.ink.inspectedRing || c.style.strokeStyle === s.ink.hoverRing)).toBe(false)
  })

  it('links stars faintly, dims every other star behind a selection, lights its links and rings it and the hover', () => {
    const s = scene()
    const plain = paint(s)
    // in the muted colour, apart from the gridlines (0.18) and today's tick (opaque)
    const links = (rec: RecordingCtx) =>
      rec.calls('stroke').filter((c) => c.style.strokeStyle === s.ink.muted && c.style.lineWidth === 1 && c.style.globalAlpha !== 0.18 && c.style.globalAlpha !== 1)
    expect(links(plain).map((c) => c.style.globalAlpha)).toEqual([0.22])

    const sel = indexOf(s, 'Me/alpha')
    const hov = indexOf(s, 'Me/Secret-Plans')
    const rec = paint(s, { selected: s.layout.stars[sel].key, hover: { kind: 'repo', key: s.layout.stars[hov].key } })
    expect(links(rec).map((c) => c.style.globalAlpha)).toEqual([0.22 * 0.4])
    // every other star dimmed, the selected one not
    const core = (i: number) => arcsAt(rec, ...centre(s, i)).find((arc) => arc.r === s.g.r[i])!
    expect(core(sel).entry.style.globalAlpha).toBe(1)
    expect(core(hov).entry.style.globalAlpha).toBe(s.ink.dimAlpha)
    // the selected star's links lit in its colour, and the hovered one's in its own
    const lit = rec.calls('stroke').filter((c) => c.style.lineWidth === 1.25)
    expect(lit.map((c) => [c.style.strokeStyle, c.style.globalAlpha])).toEqual([
      [s.input.colourOf('TypeScript'), 0.75],
      [s.input.colourOf('Rust'), 0.75],
    ])
    // rings: the selected at 4 px beyond its core, the hovered at 3
    const rings = (i: number, colour: string, gap: number) => arcsAt(rec, ...centre(s, i)).some((arc) => arc.r === s.g.r[i] + gap && arc.entry.style.strokeStyle === colour)
    expect(rings(sel, s.ink.inspectedRing, 4)).toBe(true)
    expect(rings(hov, s.ink.hoverRing, 3)).toBe(true)
    // hovering the selected star rings it once
    const same = paint(s, { selected: s.layout.stars[sel].key, hover: { kind: 'repo', key: s.layout.stars[sel].key } })
    expect(same.calls('stroke').filter((c) => c.style.strokeStyle === s.ink.hoverRing)).toHaveLength(0)
  })

  it('fills every other band across the plot, and names each, a language with its colour', () => {
    const s = scene()
    const rec = paint(s)
    const fills = rec.calls('fillRect').filter((c) => c.style.fillStyle === s.ink.eraBand)
    expect(fills.map((c) => c.args)).toEqual(
      s.layout.bands.flatMap((_band, i) => (i % 2 === 1 ? [[0, s.g.bandTop[i], VIEW.width, s.g.bandFoot[i] - s.g.bandTop[i]]] : [])),
    )
    for (const [i, band] of s.layout.bands.entries()) {
      const top = s.g.bandTop[i] + 4
      expect(argsOf(rec, 'fillText').some(([text, , y]) => String(text) === band.label && (y as unknown as number) === top)).toBe(true)
      const dot = rec.calls('arc').some((c) => c.args[0] === 13 && c.args[1] === top + 5 && c.args[2] === 3)
      expect(dot, band.label).toBe(band.kind === 'language')
    }
  })

  it('draws a faint gridline at each new year, from the top to the horizon', () => {
    const s = scene()
    const rec = paint(s)
    const grid = rec.calls('stroke').filter((c) => c.style.globalAlpha === 0.18)
    expect(grid).toHaveLength(1)
    expect(grid[0].style.strokeStyle).toBe(s.ink.muted)
    const years = s.layout.years.filter((y) => y.x0 > 0)
    const xs = years.map((y) => Math.round(s.input.camera.tx + y.x0 * s.input.camera.k) + 0.5)
    for (const x of xs) {
      expect(argsOf(rec, 'moveTo').some(([px, py]) => px === x && py === 0)).toBe(true)
      expect(argsOf(rec, 'lineTo').some(([px, py]) => px === x && py === horizonY(VIEW))).toBe(true)
    }
  })

  it('guides a hovered day and marks a hovered milestone, as every view does', () => {
    const s = scene()
    const day = s.layout.startDay + 100
    const rec = paint(s, { hover: { kind: 'day', day, milestone: null } })
    const x = Math.round(s.input.camera.tx + (day - s.layout.startDay + 0.5) * s.input.camera.k) + 0.5
    expect(rec.calls('lineTo').filter((c) => c.args[0] === x && c.args[1] === horizonY(VIEW))).toHaveLength(1)
    const before = paint(s).calls('stroke').filter((c) => c.style.strokeStyle === s.ink.hoverRing).length
    const marked = paint(s, { hover: { kind: 'day', day, milestone: s.layout.milestones[0].index } })
    expect(marked.calls('stroke').filter((c) => c.style.strokeStyle === s.ink.hoverRing).length).toBe(before + 2)
  })

  it('draws only what the time-lapse has sown, grown as far as it has got, and links once both are active', () => {
    const s = scene()
    const none = paint(s, { at: s.layout.startDay - 1 })
    s.layout.stars.forEach((_star, i) => expect(arcsAt(none, ...centre(s, i))).toEqual([]))
    expect(none.calls('lineTo').filter((c) => c.style.lineWidth === 1 && c.style.globalAlpha === 0.22)).toHaveLength(0)

    const at = dayNumber('2020-06-15') + 0.5
    const sown = s.layout.stars.filter((star) => star.startDay <= at)
    expect(sown.length).toBeGreaterThan(0)
    expect(sown.length).toBeLessThan(s.layout.stars.length)
    const rec = paint(s, { at })
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
    s.layout.stars.forEach((star, i) => {
      const arcs = arcsAt(rec, ...centre(s, i))
      expect(arcs.length > 0, star.key).toBe(star.startDay <= at)
      if (star.startDay > at) return
      const share = starGrownShare(star, at)
      expect(arcs.some((arc) => arc.r === grownRadius(s.g.r[i], share)), star.key).toBe(true)
    })
    // a star still growing is drawn smaller than it ends
    const alpha = indexOf(s, 'Me/alpha')
    const share = starGrownShare(s.layout.stars[alpha], at)
    expect(share > 0 && share < 1).toBe(true)
    expect(grownRadius(s.g.r[alpha], share)).toBeLessThan(s.g.r[alpha])
    // a link is drawn from its first shared day
    const drawnLinks = s.layout.links.filter((link) => at >= link.fromDay)
    const waiting = s.layout.links.filter((link) => at < link.fromDay)
    expect(drawnLinks.length).toBeGreaterThan(0)
    expect(waiting.length).toBeGreaterThan(0)
    const segments = new Set(argsOf(rec, 'lineTo').map(([x, y]) => `${x} ${y}`))
    for (const link of drawnLinks) expect(segments.has(`${s.g.x[link.b]} ${s.g.y[link.b]}`)).toBe(true)
  })

  it('paints a profile without repos, and an account a day old', () => {
    const empty = scene(profile({ repos: [], source: 'rest' }))
    expect(empty.layout.stars).toHaveLength(0)
    const rec = paint(empty)
    expect(rec.calls('fillRect').length).toBeGreaterThan(0)
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)

    const young = scene(profile({ createdAt: iso('2024-06-14'), milestones: [], repos: [repo('Me/new', { createdAt: iso('2024-06-14'), activity: [{ date: '2024-06-14', commits: 1 }] })] }))
    expect(young.layout.days).toBeLessThanOrEqual(2)
    const yr = paint(young)
    for (const n of numbersOf(yr.log)) expect(Number.isFinite(n)).toBe(true)
    expect(arcsAt(yr, ...centre(young, 0)).length).toBeGreaterThan(0)
  })
})

describe('starGrownShare', () => {
  const star = { growthDays: [100, 110, 150, 160], growthShares: [0, 0.75, 0.75, 1] }
  it('grows along each active span and rests between them', () => {
    expect(starGrownShare(star, null)).toBe(1)
    expect(starGrownShare(star, 90)).toBe(0)
    expect(starGrownShare(star, 100)).toBe(0)
    expect(starGrownShare(star, 105)).toBeCloseTo(0.375, 12)
    expect(starGrownShare(star, 110)).toBe(0.75)
    expect(starGrownShare(star, 130)).toBe(0.75)
    expect(starGrownShare(star, 155)).toBeCloseTo(0.875, 12)
    expect(starGrownShare(star, 160)).toBe(1)
    expect(starGrownShare(star, 1e6)).toBe(1)
  })

  it('draws a star just sown at a share of its size, and fully grown at its full size', () => {
    expect(grownRadius(8, 0)).toBeCloseTo(8 * 0.35, 12)
    expect(grownRadius(8, 0.25)).toBe(4)
    expect(grownRadius(8, 1)).toBe(8)
  })
})

describe('constellation labels', () => {
  it('anchors a label on its star, as grown by the time-lapse, and none before it is sown', () => {
    const s = scene()
    const out = new Float32Array(3)
    s.layout.stars.forEach((_star, i) => {
      expect(starAnchor(s.layout, s.g, i, null, out)).toBe(true)
      expect([...out]).toEqual([...Float32Array.from([s.g.x[i], s.g.y[i], s.g.r[i] + 1])])
    })
    const late = indexOf(s, 'Me/empty-seedling')
    const star = s.layout.stars[late]
    expect(starAnchor(s.layout, s.g, late, star.startDay - 1, out)).toBe(false)
    expect(starAnchor(s.layout, s.g, late, star.startDay + 0.5, out)).toBe(true)
    expect(out[2]).toBeCloseTo(grownRadius(s.g.r[late], starGrownShare(star, star.startDay + 0.5)) + 1, 5)
  })

  it('offers labels by stars, then size, then paint order', () => {
    const s = scene()
    const order = [...starLabelOrder(s.layout)]
    expect([...order].sort((a, b) => a - b)).toEqual(s.layout.stars.map((_star, i) => i))
    const stars = order.map((i) => s.layout.stars[i])
    for (let k = 1; k < stars.length; k++) {
      const [a, b] = [stars[k - 1], stars[k]]
      expect(a.stars > b.stars || (a.stars === b.stars && (a.size > b.size || (a.size === b.size && order[k - 1] < order[k])))).toBe(true)
    }
    expect(stars[0].key).toBe('me/alpha')
  })

  it("keeps labels off the ground and each band's name", () => {
    const s = scene()
    const boxes = [...constellationKeepOut(s.layout, VIEW)]
    expect(boxes.length).toBe(4 * (1 + s.layout.bands.length))
    expect(boxes.slice(0, 4)).toEqual([0, horizonY(VIEW) - 1, VIEW.width, VIEW.height])
    s.layout.bands.forEach((_band, i) => {
      const [x0, y0, x1, y1] = boxes.slice(4 + 4 * i, 8 + 4 * i)
      expect(x1 - x0).toBe(120)
      expect(y1 - y0).toBe(16)
      // round the name drawn at (20, top + 4)
      expect(x0 <= 20 && x1 > 100).toBe(true)
      expect(y0).toBeCloseTo(s.g.bandTop[i] + 2, 4)
    })
  })
})

describe('constellation sources', () => {
  const sources = { layoutSource, geometrySource, paintSource, hitSource }
  it('write no colour: every colour comes from the theme', () => {
    for (const [name, text] of Object.entries(sources)) expect(text, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('never take a namer: repo names reach the canvas only through the shared labels', () => {
    for (const [name, text] of Object.entries(sources)) {
      expect(text, name).not.toMatch(/RepoNamer|repoNamer|ShownName|fillText\(\s*(star|layout)/)
      expect(text, name).not.toMatch(/graph\/metro/)
    }
  })
})

describe("the constellation's frame under the shared painter", () => {
  const SCENE: LifeScene<ConstellationLayout, ConstellationGeom> = {
    items: (layout) => layout.stars,
    geoms: constellationGeom,
    paint: paintConstellation,
    hit: hitConstellation,
    anchor: starAnchor,
    labelOrder: starLabelOrder,
    keepOut: constellationKeepOut,
    itemColour: (layout, i, ink, colourOf) => starColour(layout.stars[i], ink, colourOf),
  }

  function painterFor(s: Scene, state: Partial<LifePaintState> = {}, revealed = false, progress?: number) {
    const measured: string[] = []
    const store: LifePaintState = { hidden: new Set(), hover: null, selected: null, ...state }
    const painter = makeViewPaint(SCENE, {
      layout: s.layout,
      timeline: s.timeline,
      ink: s.ink,
      colourOf: s.input.colourOf,
      name: repoNamer(privateRepoKeys(profile({ repos: REPOS })), revealed),
      login: 'Me',
      measure: (text) => {
        measured.push(text)
        return text.length * 6.5
      },
      timelapse: progress === undefined ? null : { progress: { current: progress } },
      state: () => store,
    })
    const quiet = () => recordingCtx(VIEW.width * 2, VIEW.height * 2).ctx
    for (let i = 0; i < 400; i++) if (!painter.paint(quiet(), VIEW, s.input.camera, 16) && progress === undefined) break
    const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
    painter.paint(rec.ctx, VIEW, s.input.camera, 16)
    return { painter, measured, rec }
  }
  const labelTexts = (rec: RecordingCtx) => rec.calls('fillText').filter((c) => c.style.font === LIFE_LABEL_FONT).map((c) => String(c.args[0]))

  it('labels stars only by what the namer shows', () => {
    const s = scene()
    for (const state of [{ hover: { kind: 'repo', key: PRIVATE } as LifeHover }, { selected: PRIVATE }]) {
      const hidden = painterFor(s, state)
      for (const text of [...hidden.rec.texts(), ...hidden.measured]) expect(text.toLowerCase()).not.toContain('secret')
      expect(labelTexts(hidden.rec)).toContain(PRIVATE_REPO_LABEL)
      const shown = painterFor(s, state, true)
      expect(labelTexts(shown.rec)).toContain('Secret-Plans')
    }
    expect(labelTexts(painterFor(s).rec)).toContain('alpha')
  })

  it('gives a hidden star no label and no hit, and hits a star at its anchor', () => {
    const s = scene()
    const key = 'me/alpha'
    const i = indexOf(s, key)
    const { painter, rec } = painterFor(s, { hidden: new Set([key]), hover: { kind: 'repo', key }, selected: key })
    expect(labelTexts(rec)).not.toContain('alpha')
    const hit = painter.hitAt(s.g.x[i], s.g.y[i])
    expect(hit?.kind === 'repo' && hit.key === key).toBe(false)
    const open = painterFor(s).painter
    expect(open.hitAt(s.g.x[i], s.g.y[i])).toEqual({ kind: 'repo', key })
    expect(open.pickAt(s.g.x[i], s.g.y[i])).toBe(key)
  })

  it('draws the time-lapse caption over the constellation, counting only the sown stars', () => {
    const s = scene()
    const caption = (rec: RecordingCtx) => argsOf(rec, 'fillText').map(([text]) => String(text)).filter((text) => /^\d+ repos?$/.test(text))
    const early = painterFor(s, {}, false, 0).rec
    s.layout.stars.forEach((star, i) => expect(arcsAt(early, ...centre(s, i)).length, star.key).toBe(0))
    expect(caption(early)).toEqual(['0 repos'])
    const done = painterFor(s, {}, false, 1).rec
    expect(caption(done)).toEqual([`${s.layout.stars.length} repos`])
    expect(argsOf(done, 'fillText').map(([text]) => String(text))).toContain('Me · repo-garden')
  })
})
