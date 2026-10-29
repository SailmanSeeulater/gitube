/**
 * The life garden's painter on a recording context: what it fills first, that it draws every number
 * finite and every colour from the theme, in all ten themes, that hidden plants draw nothing, how
 * the hover and the selection show, what the time-lapse leaves out, and that no repo name is ever
 * drawn by it (the labels are useLifeLabels', tested in lifeLabels.test.ts). Then LifeGarden's own
 * frame, hit test and click (makeLifePaint): the garden under its labels from the store's state,
 * names only through the namer, no hit on a hidden plant, and the hover following the camera. Also
 * LifeGarden's markup (react-dom/server), which names the person and never a repo.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MONO_FONT } from '../src/components/gardenUtils'
import { leafColour } from '../src/components/gardenPaint'
import { THEMES, getTheme, type Theme } from '../src/theme/themes'
import { buildLifeTimeline, dayNumber, type LifeTimeline } from '../src/profile/timeline'
import { layoutLifeGarden } from '../src/profile/lifeGardenLayout'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY, plantGeom } from '../src/profile/lifeGeometry'
import { fitLifeCamera, panLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { LIFE_YEAR_FONT, drawLock, grownShare, headAt, paintLifeGarden, plantColour, ringRadius, type LifePaintInput } from '../src/profile/lifeGardenPaint'
import { makeLifePaint, type LifePaintOptions, type LifePaintState, type LifePainter } from '../src/profile/lifePaint'
import { PRIVATE_REPO_LABEL, privateRepoKeys, repoNamer } from '../src/profile/privacy'
import { LIFE_LABEL_FONT } from '../src/profile/useLifeLabels'
import LifeGarden from '../src/profile/LifeGarden'
import type { LifeCamera, LifeGardenLayout, LifeHover, LifeInk, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { recordingCtx, type CtxEntry, type RecordingCtx } from './helpers/recordingCtx'
import { LANDED_PX as GARDEN_LANDED_PX } from '../src/profile/lifeAxis'
import { pointAt as stemPointAt } from '../src/profile/lifeGeometry'
import { dayKey as toDayKey } from '../src/profile/timeline'
import type { LifeLanded, PlantGeom as LandedPlantGeom } from '../src/profile/lifeTypes'

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
 * A token profile with one of each kind of plant: a starred bloom, a private repo, an archived one
 * with stars (a wilted head), a fork (a cutting), a repo they only contributed to (a visitor), and
 * a starred repo GitHub counted no commits to (a seedling).
 */
const REPOS: ProfileRepo[] = [
  repo('Me/alpha', { createdAt: iso('2019-02-01'), stars: 120, activity: monthly('2019-02', '2021-06', 4) }),
  repo('Me/Secret-Plans', { createdAt: iso('2020-03-01'), language: 'Rust', stars: 30, isPrivate: true, activity: monthly('2020-03', '2024-05', 3) }),
  repo('Me/old-thing', { createdAt: iso('2019-06-01'), language: 'JavaScript', stars: 15, isArchived: true, activity: monthly('2019-06', '2019-12') }),
  repo('Me/forked-lib', { createdAt: iso('2021-01-10'), language: 'Go', isFork: true, activity: monthly('2021-01', '2021-03', 1) }),
  repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-05-01'), isOwn: false, language: null, activity: monthly('2022-05', '2023-02', 5) }),
  repo('Me/empty-seedling', { createdAt: iso('2023-08-01'), stars: 5 }),
]

const PRIVATE = ['me/secret-plans']

/** LifeGarden's frame on a laptop screen. */
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

interface Scene {
  timeline: LifeTimeline
  layout: LifeGardenLayout
  theme: Theme
  ink: LifeInk
  input: LifePaintInput
}

function scene(p: ProfileData = profile({ repos: REPOS }), theme: Theme = getTheme('obsidian'), over: Partial<LifePaintInput> = {}): Scene {
  const timeline = buildLifeTimeline(p, NOW)
  const layout = layoutLifeGarden(timeline, p.source)
  const ink = lifeInk(theme)
  const palette = languagePalette(timeline, theme)
  const colourOf = (language: string | null) => languageColour(palette, language, theme)
  const camera = fitLifeCamera(layout.days, VIEW)
  const geoms = layout.plants.map((plant) => plantGeom(plant, camera, VIEW))
  const input: LifePaintInput = {
    layout,
    timeline,
    geoms,
    camera,
    view: VIEW,
    ink,
    colourOf,
    leafOf: (colour) => leafColour(colour, ink.garden),
    hidden: new Set(),
    hover: null,
    selected: null,
    at: null,
    ...over,
  }
  return { timeline, layout, theme, ink, input }
}

function paint(s: Scene, over: Partial<LifePaintInput> = {}): RecordingCtx {
  const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
  paintLifeGarden(rec.ctx, { ...s.input, ...over })
  return rec
}

/** Every colour the theme lets the life garden draw with: its ink, its language colours and their leaves. */
function allowedColours(s: Scene): Set<string> {
  const allowed = new Set<string>()
  const { garden, dimAlpha: _alpha, ...flat } = s.ink
  for (const value of [...Object.values(flat), ...Object.values(garden)]) allowed.add(value)
  const palette = languagePalette(s.timeline, s.theme)
  for (const colour of [...Object.values(palette), s.theme.fallback]) {
    allowed.add(colour)
    allowed.add(leafColour(colour, s.ink.garden))
  }
  return allowed
}

/** Calls of one method, as plain argument lists. */
const argsOf = (rec: RecordingCtx, name: string) => rec.calls(name).map((c) => c.args)

/** Every number a call was given or a property was set to. */
function numbersOf(log: CtxEntry[]): number[] {
  return log.flatMap((e) => (e.kind === 'call' ? e.args : [e.value])).filter((v): v is number => typeof v === 'number')
}

describe('paintLifeGarden', () => {
  it('fills the whole backing store with the canvas colour first, without the pixel transform', () => {
    const s = scene()
    const rec = paint(s)
    const first = rec.log.findIndex((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name))
    const call = rec.log[first]
    expect(call).toMatchObject({ kind: 'call', name: 'fillRect', args: [0, 0, VIEW.width * 2, VIEW.height * 2] })
    expect(call.kind === 'call' && call.style.fillStyle).toBe(s.ink.canvas)
    expect(argsOf(rec, 'setTransform')[0]).toEqual([1, 0, 0, 1, 0, 0])
    // and leaves the context as it found it
    expect(rec.calls('save')).toHaveLength(rec.calls('restore').length)
  })

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s: draws every number finite and every colour from the theme', (_id, theme) => {
    const s = scene(profile({ repos: REPOS }), theme)
    const key = s.layout.plants[0].key
    for (const over of [{}, { selected: key }, { hover: { kind: 'repo', key } as LifeHover }, { hover: { kind: 'day', day: s.layout.startDay + 40, milestone: 0 } as LifeHover }]) {
      const rec = paint(s, over)
      for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
      const allowed = allowedColours(s)
      for (const colour of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(allowed, String(colour)).toContain(colour)
      for (const alpha of rec.sets('globalAlpha')) expect([1, theme.dimAlpha]).toContain(alpha)
    }
  })

  it('draws a plant of each kind: blooms, a wilted head, roots, leaves and a cutting', () => {
    const s = scene()
    const rec = paint(s)
    const kinds = new Set(s.layout.plants.map((p) => p.tip))
    expect(kinds).toEqual(new Set(['bloom', 'bud', 'wilted']))
    // petals are ellipses: blooms and the wilted head
    expect(rec.calls('ellipse').length).toBeGreaterThan(0)
    // a wilted head is drawn in the theme's wilt colour, with the star signal kept
    const wilted = s.layout.plants.find((p) => p.dry)!
    expect(wilted.tip).toBe('wilted')
    expect(wilted.bloom).toBeGreaterThan(0)
    expect(rec.calls('fill').some((c) => c.style.fillStyle === s.ink.garden.wilt)).toBe(true)
    // the cutting grows no roots: only its stem starts at its root, where a rooted plant's four
    // root tendrils start too; its slanted base is drawn in the horizon's colour
    const fromRoot = (i: number) => {
      const g = s.input.geoms[i]
      return argsOf(rec, 'moveTo').filter(([x, y]) => x === g.x0 && y === g.y0).length
    }
    const cutting = s.layout.plants.findIndex((p) => p.cutting)
    expect(fromRoot(cutting)).toBe(1)
    expect(fromRoot(s.layout.plants.findIndex((p) => !p.cutting))).toBe(5)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.horizon && c.style.lineWidth === 1.5)).toBe(true)
    // the visitor's root ring
    const visitor = s.layout.plants.findIndex((p) => p.visiting)
    const vg = s.input.geoms[visitor]
    expect(argsOf(rec, 'arc').some(([x, y, r]) => x === vg.x0 && y === vg.y0 && r === 2.6)).toBe(true)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.rootRing)).toBe(true)
  })

  it('draws no repo name: only year labels and today', () => {
    const s = scene()
    for (const over of [{}, { selected: s.layout.plants[1].key }, { hover: { kind: 'repo', key: PRIVATE[0] } as LifeHover }]) {
      const rec = paint(s, over)
      const texts = argsOf(rec, 'fillText').map(([text]) => String(text))
      expect(texts.length).toBeGreaterThan(0)
      for (const text of texts) expect(text).toMatch(/^(\d{4}|today)$/)
      for (const text of rec.texts()) for (const name of [...PRIVATE, 'me/alpha', 'secret']) expect(text.toLowerCase()).not.toContain(name)
    }
    expect(paint(s).calls('fillText').every((c) => c.style.font === LIFE_YEAR_FONT)).toBe(true)
  })

  it('draws nothing of a hidden plant', () => {
    const s = scene()
    const all = paint(s, { hidden: new Set(s.layout.plants.map((p) => p.key)) })
    // stems, leaves, roots and petals all go through curves or ellipses; the ground uses neither
    expect(all.calls('quadraticCurveTo')).toHaveLength(0)
    expect(all.calls('ellipse')).toHaveLength(0)

    const i = s.layout.plants.findIndex((p) => !p.cutting && !p.visiting)
    const g = s.input.geoms[i]
    const key = s.layout.plants[i].key
    const shown = paint(s)
    const hidden = paint(s, { hidden: new Set([key]), hover: { kind: 'repo', key }, selected: key })
    expect(hidden.calls('quadraticCurveTo').length).toBeLessThan(shown.calls('quadraticCurveTo').length)
    expect(argsOf(hidden, 'moveTo').some(([x, y]) => x === g.x0 && y === g.y0)).toBe(false)
    expect(argsOf(hidden, 'arc').some(([x, y]) => x === g.x2 && y === g.y2)).toBe(false)
  })

  it('dims every other plant behind a selection and rings the selected and the hovered one', () => {
    const s = scene()
    const selected = s.layout.plants[2]
    const hovered = s.layout.plants[0]
    const rec = paint(s, { selected: selected.key, hover: { kind: 'repo', key: hovered.key } })
    expect(rec.calls('stroke').some((c) => c.style.globalAlpha === s.ink.dimAlpha)).toBe(true)
    const ring = (i: number) => {
      const g = s.input.geoms[i]
      return argsOf(rec, 'arc').some(([x, y, r]) => x === g.x2 && y === g.y2 && r === ringRadius(g))
    }
    expect(ring(2)).toBe(true)
    expect(ring(0)).toBe(true)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.inspectedRing && c.style.globalAlpha === 1)).toBe(true)
    expect(rec.calls('stroke').some((c) => c.style.strokeStyle === s.ink.hoverRing)).toBe(true)
  })

  it('guides a hovered day from the sky to the horizon, and marks a hovered milestone', () => {
    const s = scene()
    const day = s.layout.startDay + 100
    const rec = paint(s, { hover: { kind: 'day', day, milestone: null } })
    const x = Math.round(s.input.camera.tx + (day - s.layout.startDay + 0.5) * s.input.camera.k) + 0.5
    const lines = rec.calls('lineTo').filter((c) => c.args[0] === x && c.args[1] === horizonY(VIEW))
    expect(lines).toHaveLength(1)
    const before = paint(s).calls('stroke').filter((c) => c.style.strokeStyle === s.ink.hoverRing).length
    const marked = paint(s, { hover: { kind: 'day', day, milestone: s.layout.milestones[0].index } })
    expect(marked.calls('stroke').filter((c) => c.style.strokeStyle === s.ink.hoverRing).length).toBe(before + 2)
  })

  it('splits a language switch diamond into the old and the new language', () => {
    const s = scene()
    const switches = s.layout.milestones.filter((m) => m.kind === 'language-switch')
    expect(switches.length).toBeGreaterThan(0)
    const rec = paint(s)
    const colours = new Set(rec.calls('fill').map((c) => c.style.fillStyle))
    const eras = s.timeline.languageEras
    expect(colours).toContain(s.input.colourOf(eras[0].language))
    expect(colours).toContain(s.input.colourOf(eras[1].language))
  })

  it('draws only what the time-lapse has grown', () => {
    const s = scene()
    expect(paint(s, { at: s.layout.startDay - 1 }).calls('quadraticCurveTo')).toHaveLength(0)
    const at = dayNumber('2021-01-05')
    const sown = s.layout.plants.filter((p) => p.startDay <= at)
    expect(sown.length).toBeGreaterThan(0)
    expect(sown.length).toBeLessThan(s.layout.plants.length)
    const rec = paint(s, { at })
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
    // a plant not sown yet draws nothing, not even its roots
    s.layout.plants.forEach((plant, i) => {
      const g = s.input.geoms[i]
      const rooted = argsOf(rec, 'moveTo').some(([x, y]) => x === g.x0 && y === g.y0)
      expect(rooted, plant.key).toBe(plant.startDay <= at)
    })
    // a plant halfway through its life is drawn halfway up its stem
    const plant = s.layout.plants.find((p) => p.startDay < at && p.endDay > at)!
    const g = s.input.geoms[s.layout.plants.indexOf(plant)]
    const share = grownShare(plant, at)
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(1)
    expect(headAt(g, share)[1]).toBeGreaterThan(g.y2)
    expect(headAt(g, 1)).toEqual([g.x2, g.y2])
  })

  it('paints a profile without repos, and an account a day old', () => {
    const empty = scene(profile({ repos: [], source: 'rest' }))
    expect(empty.layout.plants).toHaveLength(0)
    const rec = paint(empty)
    expect(rec.calls('fillRect').length).toBeGreaterThan(0)
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)

    const young = scene(
      profile({ createdAt: iso('2024-06-14'), milestones: [], repos: [repo('Me/new', { createdAt: iso('2024-06-14'), activity: [{ date: '2024-06-14', commits: 1 }] })] }),
    )
    expect(young.layout.days).toBeLessThanOrEqual(2)
    const yr = paint(young)
    for (const n of numbersOf(yr.log)) expect(Number.isFinite(n)).toBe(true)
    expect(yr.calls('quadraticCurveTo').length).toBeGreaterThan(0)
  })

  it('paints a tier 1 profile: spans from creation to the last push, no seedlings', () => {
    const rest = profile({
      source: 'rest',
      repos: REPOS.filter((r) => r.isOwn).map((r) => ({ ...r, activity: [], lastActiveAt: r.activity.at(-1) ? iso(r.activity.at(-1)!.date) : r.createdAt })),
    })
    const s = scene(rest)
    expect(s.layout.plants.some((p) => p.seedling)).toBe(false)
    const rec = paint(s)
    for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
    const allowed = allowedColours(s)
    for (const colour of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(allowed).toContain(colour)
  })

  it('colours a plant by its language, and an archived one dry', () => {
    const s = scene()
    const dry = s.layout.plants.find((p) => p.dry)!
    const live = s.layout.plants.find((p) => !p.dry && p.language === 'Rust')!
    expect(plantColour(dry, s.ink, s.input.colourOf)).toBe(s.ink.dry)
    expect(plantColour(live, s.ink, s.input.colourOf)).toBe(s.input.colourOf('Rust'))
  })

  it("draws year labels in the repo garden's mono font", () => {
    expect(LIFE_YEAR_FONT).toBe(`10px ${MONO_FONT}`)
  })
})

describe("makeLifePaint: LifeGarden's frame, hit test and click", () => {
  /** LifeGarden's painter for s, as LifeGarden makes it, the store's state as given (and changeable), every measured label text kept. */
  function painterFor(s: Scene, state: Partial<LifePaintState> = {}, revealed = false, over: Partial<LifePaintOptions> = {}) {
    const measured: string[] = []
    const store: LifePaintState = { hidden: new Set(), hover: null, selected: null, ...state }
    const painter = makeLifePaint({
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
      state: () => store,
      ...over,
    })
    return { painter, measured, store }
  }

  /** Frames until the labels settle (at most 400), then one more on a recording context, as the canvas loop paints them. */
  function settle(painter: LifePainter, camera: LifeCamera): { rec: RecordingCtx; frames: boolean[] } {
    const frames: boolean[] = []
    for (let i = 0; i < 400; i++) {
      frames.push(painter.paint(recordingCtx(VIEW.width * 2, VIEW.height * 2).ctx, VIEW, camera, 16))
      if (!frames[i]) break
    }
    const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
    frames.push(painter.paint(rec.ctx, VIEW, camera, 16))
    return { rec, frames }
  }

  const drawn = (rec: RecordingCtx) => argsOf(rec, 'fillText').map(([text]) => String(text))

  it("paints the garden, then its labels over it, from the store's state at each frame", () => {
    const s = scene()
    const { painter, store } = painterFor(s)
    const { rec, frames } = settle(painter, s.input.camera)
    // more frames while the labels appear, none once they rest
    expect(frames[0]).toBe(true)
    expect(frames.at(-2)).toBe(false)
    expect(frames.at(-1)).toBe(false)
    // the canvas colour first, then the garden, then the labels in their font, the owner left off
    const first = rec.log.find((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name))
    expect(first).toMatchObject({ kind: 'call', name: 'fillRect', args: [0, 0, VIEW.width * 2, VIEW.height * 2] })
    const labels = rec.calls('fillText').filter((c) => c.style.font === LIFE_LABEL_FONT)
    expect(labels.map((c) => c.args[0])).toContain('alpha')
    expect(rec.log.indexOf(labels[0])).toBeGreaterThan(rec.log.findIndex((e) => e.kind === 'call' && e.name === 'fillText' && e.args[0] === 'today'))
    expect(drawn(rec).some((text) => text.startsWith('Me/'))).toBe(false)

    // a selection made in the store shows on the next frame: the others dimmed, the selected one ringed and on a plate
    const i = s.layout.plants.findIndex((p) => p.key === 'me/alpha')
    store.selected = 'me/alpha'
    const picked = settle(painter, s.input.camera).rec
    expect(picked.calls('stroke').some((c) => c.style.globalAlpha === s.ink.dimAlpha)).toBe(true)
    const g = s.input.geoms[i]
    expect(argsOf(picked, 'arc').some(([x, y, r]) => x === g.x2 && y === g.y2 && r === ringRadius(g))).toBe(true)
    expect(picked.calls('fill').some((c) => c.style.fillStyle === s.ink.labelPlateFill)).toBe(true)

    // the time-lapse keeps frames coming, and draws only what has grown
    const lapse = painterFor(s, {}, false, { timelapse: { progress: { current: 0 } } }).painter
    expect(lapse.paint(recordingCtx().ctx, VIEW, s.input.camera, 16)).toBe(true)
    const early = settle(lapse, s.input.camera).rec
    expect(early.calls('quadraticCurveTo')).toHaveLength(0)
  })

  it('labels a repo only by what the namer shows', () => {
    const s = scene()
    const secret = s.layout.byKey.get(PRIVATE[0])!
    expect(secret).toBeGreaterThanOrEqual(0)
    for (const state of [{ hover: { kind: 'repo', key: PRIVATE[0] } as LifeHover }, { selected: PRIVATE[0] }, {}]) {
      const hidden = painterFor(s, state)
      const { rec } = settle(hidden.painter, s.input.camera)
      for (const text of [...rec.texts(), ...hidden.measured]) expect(text.toLowerCase()).not.toContain('secret')
      if (Object.keys(state).length > 0) expect(drawn(rec)).toContain(PRIVATE_REPO_LABEL)

      const shown = painterFor(s, state, true)
      const named = settle(shown.painter, s.input.camera).rec
      expect(shown.measured).toContain('Secret-Plans')
      if (Object.keys(state).length > 0) expect(drawn(named)).toContain('Secret-Plans')
    }
  })

  it('hit tests and clicks what the last frame drew, and never a hidden plant', () => {
    const s = scene()
    const { painter, store } = painterFor(s)
    // nothing drawn yet: nothing to hit
    expect(painter.hitAt(VIEW.width / 2, VIEW.height / 2)).toBeNull()
    expect(painter.pickAt(VIEW.width / 2, VIEW.height / 2)).toBeNull()
    settle(painter, s.input.camera)

    // a plant's head is that repo, until it is hidden
    const heads = s.layout.plants.map((plant, i) => ({ key: plant.key, x: s.input.geoms[i].x2, y: s.input.geoms[i].y2 }))
    const free = heads.filter((head) => {
      const hit = painter.hitAt(head.x, head.y)
      return hit?.kind === 'repo' && hit.key === head.key && painter.pickAt(head.x, head.y) === head.key
    })
    expect(free.length).toBeGreaterThanOrEqual(3)
    for (const head of free) {
      store.hidden = new Set([head.key])
      settle(painter, s.input.camera)
      const hit = painter.hitAt(head.x, head.y)
      expect(hit?.kind === 'repo' && hit.key === head.key, head.key).toBe(false)
      expect(painter.pickAt(head.x, head.y)).not.toBe(head.key)
      store.hidden = new Set()
    }
    settle(painter, s.input.camera)

    // a label is its plant's, to the hover and to a click
    const placer = painter.labels.placer
    const shown = s.layout.plants.findIndex((_, i) => placer.alpha[i] > 0.5 && !placer.forcedNow[i])
    expect(shown).toBeGreaterThanOrEqual(0)
    const x = placer.x0[shown] + placer.w[shown] / 2
    const y = placer.y0[shown] + placer.h[shown] / 2
    expect(painter.hitAt(x, y)).toEqual({ kind: 'repo', key: s.layout.plants[shown].key })
    expect(painter.pickAt(x, y)).toBe(s.layout.plants[shown].key)
    // the ground is a day
    expect(painter.hitAt(VIEW.width / 2, horizonY(VIEW) + 20)).toMatchObject({ kind: 'day' })
    expect(painter.pickAt(VIEW.width / 2, horizonY(VIEW) + 20)).toBeNull()
  })

  it('moves the hover with the camera under a still pointer, and only then', () => {
    const s = scene()
    const i = s.layout.plants.findIndex((p) => p.key === 'me/alpha')
    const g = s.input.geoms[i]
    const pointer = { x: g.x2, y: g.y2 }
    const setHover = vi.fn()
    const { painter } = painterFor(s, {}, false, { setHover, pointer: () => pointer })
    settle(painter, s.input.camera)
    // while the labels appear the hover follows them, and it lands on the plant under the pointer
    expect(setHover).toHaveBeenLastCalledWith({ kind: 'repo', key: 'me/alpha' })
    setHover.mockClear()
    painter.paint(recordingCtx().ctx, VIEW, s.input.camera, 16)
    expect(setHover).not.toHaveBeenCalled()
    // the camera moves: what is under the pointer now is hovered
    const moved = panLifeCamera(zoomLifeCamera(s.input.camera, 3, 0, s.layout.days, VIEW), -400, s.layout.days, VIEW)
    painter.paint(recordingCtx().ctx, VIEW, moved, 16)
    expect(setHover).toHaveBeenCalledTimes(1)
    expect(setHover.mock.calls[0][0]).toEqual(painter.hitAt(pointer.x, pointer.y))
    expect(setHover.mock.calls[0][0]).not.toEqual({ kind: 'repo', key: 'me/alpha' })

    // no pointer over the canvas: the hover is left alone
    const still = vi.fn()
    const away = painterFor(s, {}, false, { setHover: still, pointer: () => null }).painter
    settle(away, s.input.camera)
    away.paint(recordingCtx().ctx, VIEW, moved, 16)
    expect(still).not.toHaveBeenCalled()
  })
})

describe('drawLock', () => {
  it('draws a padlock inside its box, in the one colour given', () => {
    const rec = recordingCtx()
    drawLock(rec.ctx, 50, 40, 8, 'ink')
    for (const colour of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(colour).toBe('ink')
    const [x, y, w, h] = argsOf(rec, 'rect')[0] as number[]
    expect(x).toBeGreaterThanOrEqual(46)
    expect(x + w).toBeLessThanOrEqual(54)
    expect(y + h).toBeCloseTo(44)
    expect(rec.calls('arc').some((c) => c.args[3] === Math.PI && c.args[4] === 0)).toBe(true)
    for (const name of ['moveTo', 'lineTo', 'arc']) {
      for (const [px, py] of argsOf(rec, name) as number[][]) {
        expect(px).toBeGreaterThanOrEqual(46)
        expect(px).toBeLessThanOrEqual(54)
        expect(py).toBeGreaterThanOrEqual(36)
        expect(py).toBeLessThanOrEqual(44)
      }
    }
  })
})

describe('LifeGarden markup', () => {
  it('is one focusable canvas named for the person, their repo count and years, never a repo', () => {
    const p = profile({ repos: REPOS })
    const s = scene(p)
    for (const revealed of [false, true]) {
      const html = renderToStaticMarkup(
        h(LifeGarden, {
          timeline: s.timeline,
          layout: s.layout,
          theme: s.theme,
          colourOf: s.input.colourOf,
          name: repoNamer(privateRepoKeys(p), revealed),
          login: 'Me',
        }),
      )
      expect(html).toBe('<div class="h-full w-full"><canvas role="img" aria-label="life garden of Me: 6 repos, 2019 to 2024" tabindex="0" style="display:block;touch-action:none"></canvas></div>')
    }
    const one = scene(profile({ repos: [REPOS[0]] }))
    const html = renderToStaticMarkup(h(LifeGarden, { timeline: one.timeline, layout: one.layout, theme: one.theme, colourOf: one.input.colourOf, name: repoNamer(new Set(), false), login: 'Me' }))
    expect(html).toContain('aria-label="life garden of Me: 1 repo, 2019 to 2024"')
  })
})

// ---------- landed pull requests ----------

describe('landed pull requests in the garden', () => {
  /** The REPOS plus a repo known only by a landed pull request, and the landed entries. */
  const landedProfile = () =>
    profile({
      repos: [...REPOS, repo('upstream/tool', { isOwn: false, createdAt: iso('2016-01-01'), firstActiveAt: iso('2021-05-05'), lastActiveAt: iso('2021-05-05') })],
      landed: [
        { day: '2023-01-15', repo: 'someone/big-project' },
        { day: '2022-08-01', repo: 'Someone/Big-Project' },
        { day: '2022-08-01', repo: 'someone/big-project' },
        { day: '2021-05-05', repo: 'upstream/tool' },
      ],
    })

  /** Whether the mark of landed day l is drawn on a plant: a diamond whose top corner is on the stem at its day. */
  function markAt(rec: RecordingCtx, g: LandedPlantGeom, l: LifeLanded, grown = 1): boolean {
    const [x, y] = stemPointAt(g, Math.min(l.t, grown))
    const r = GARDEN_LANDED_PX * g.scale
    return argsOf(rec, 'moveTo').some(([mx, my]) => Math.abs((mx as number) - x) < 1e-9 && Math.abs((my as number) - (y - r)) < 1e-9)
  }

  it('lays one mark per landed day on the stem, at that day', () => {
    const s = scene(landedProfile())
    const plant = s.layout.plants.find((p) => p.key === 'someone/big-project')!
    expect(plant.landed.map((l) => toDayKey(l.day))).toEqual(['2022-08-01', '2023-01-15'])
    for (const l of plant.landed) {
      expect(l.t).toBeGreaterThan(0)
      expect(l.t).toBeLessThan(1)
    }
    // a repo known only by its landed pull requests is a seedling rooted on that day, with its mark
    const tool = s.layout.plants.find((p) => p.key === 'upstream/tool')!
    expect(tool.seedling).toBe(true)
    expect(tool.visiting).toBe(true)
    expect(tool.landed.map((l) => toDayKey(l.day))).toEqual(['2021-05-05'])
    expect(s.timeline.lanes[tool.lane].root).toBe('2021-05-05')
    expect(REPOS.every((r) => s.layout.plants[s.layout.byKey.get(r.nameWithOwner.toLowerCase())!].landed.length === 0 || r.nameWithOwner === 'someone/big-project')).toBe(true)
  })

  it('draws the mark as an accent diamond, only once the time-lapse has reached its day, never on a hidden plant', () => {
    const s = scene(landedProfile())
    const plant = s.layout.plants.find((p) => p.key === 'someone/big-project')!
    const g = s.input.geoms[s.layout.plants.indexOf(plant)]
    const tool = s.layout.plants.find((p) => p.key === 'upstream/tool')!
    const tg = s.input.geoms[s.layout.plants.indexOf(tool)]

    const full = paint(s)
    for (const l of plant.landed) expect(markAt(full, g, l)).toBe(true)
    expect(markAt(full, tg, tool.landed[0])).toBe(true)
    // the diamond is filled in the accent over a halo stroke
    const fills = full.calls('fill').filter((c) => c.style.fillStyle === s.ink.accent)
    expect(fills.length).toBeGreaterThanOrEqual(3)

    // before the plant is sown: nothing; between its two days: the first, where the stem has grown to
    expect(markAt(paint(s, { at: plant.startDay - 1 }), g, plant.landed[0], 0)).toBe(false)
    const between = dayNumber('2022-12-01')
    const grown = grownShare(plant, between)
    const rec = paint(s, { at: between })
    expect(markAt(rec, g, plant.landed[0], grown)).toBe(true)
    expect(markAt(rec, g, plant.landed[1], grown)).toBe(false)
    expect(markAt(rec, g, plant.landed[1], 1)).toBe(false)
    // on its very day it is drawn
    expect(markAt(paint(s, { at: plant.landed[1].day }), g, plant.landed[1], grownShare(plant, plant.landed[1].day))).toBe(true)

    // hidden: no mark either
    const hidden = paint(s, { hidden: new Set([plant.key]) })
    for (const l of plant.landed) expect(markAt(hidden, g, l)).toBe(false)
    // a profile without landed pull requests draws no accent diamond on any stem
    const none = scene()
    expect(none.layout.plants.every((p) => p.landed.length === 0)).toBe(true)
  })
})
