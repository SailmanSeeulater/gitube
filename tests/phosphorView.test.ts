/**
 * The phosphor view (a green-phosphor CRT, each repo a stack of blocks): its layout is the garden's
 * roots and heights, pure and deterministic (the same repos in any order give the same layout); its
 * hit test finds every drawn stack at its label anchor and skips hidden and unsown ones; its painter
 * draws a hidden or unsown stack not at all, grows stacks with the time-lapse, draws no repo name,
 * keeps to the phosphor palette whatever the theme, lays scanlines and a vignette over the screen,
 * and copes with a person with no repos.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { PHOSPHOR_VIEW } from '../src/profile/phosphorView'
import { layoutPhosphor, type PhosphorLayout } from '../src/profile/phosphorLayout'
import { BLOCK_PX, PITCH_PX, blocksAt, headSide, headTop, phosphorGeom, type PhosphorGeom } from '../src/profile/phosphorGeometry'
import { hitPhosphor } from '../src/profile/phosphorHit'
import { paintPhosphor, phosphorAnchor, phosphorKeepOut, phosphorLabelOrder } from '../src/profile/phosphorPaint'
import { layoutLifeGarden } from '../src/profile/lifeGardenLayout'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { buildLifeTimeline, dayAt, type LifeTimeline } from '../src/profile/timeline'
import { fetchProfileRest } from '../src/api/profile'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import type { LifeCamera, LifeHover, LifeViewport } from '../src/profile/lifeTypes'
import { PHOSPHOR } from '../src/theme/console/phosphor'
import { THEMES, getTheme } from '../src/theme/themes'
import type { ProfileData, ProfileRepo } from '../src/types'
import layoutSource from '../src/profile/phosphorLayout.ts?raw'
import geometrySource from '../src/profile/phosphorGeometry.ts?raw'
import paintSource from '../src/profile/phosphorPaint.ts?raw'
import hitSource from '../src/profile/phosphorHit.ts?raw'
import viewSource from '../src/profile/phosphorView.ts?raw'
import { recordingCtx, type CtxEntry } from './helpers/recordingCtx'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'
import { LANDED_PX as PHOSPHOR_LANDED_PX, landedCentreY as pLandedCentreY } from '../src/profile/phosphorPaint'
import { GAP_PX as P_GAP_PX, PITCH_PX as P_PITCH_PX, BLOCK_PX as P_BLOCK_PX, blocksAt as pBlocksAt } from '../src/profile/phosphorGeometry'
import { PHOSPHOR as P_PALETTE } from '../src/theme/console/phosphor'
import { dayNumber } from '../src/profile/timeline'
import type { RecordingCtx } from './helpers/recordingCtx'

// The recordings replayed as personScene does (not imported from it: it pulls in every view's registry).
const FAKE_TOKEN = 'test-token-not-real'
const kepanoProfile = () => fetchProfileGraphql('kepano', { token: FAKE_TOKEN, fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW })
const gaearonProfile = () => fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW })
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

const NOW = Date.parse('2024-06-15T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`
const theme = getTheme('obsidian')

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

const LAPTOP: LifeViewport = VIEW

interface Scene {
  timeline: LifeTimeline
  layout: PhosphorLayout
  camera: LifeCamera
  view: LifeViewport
  g: PhosphorGeom
}

function scene(p: ProfileData, now: number, view: LifeViewport = LAPTOP): Scene {
  const timeline = buildLifeTimeline(p, now)
  const layout = layoutPhosphor(timeline, p.source)
  const camera = fitLifeCamera(layout.days, view)
  return { timeline, layout, camera, view, g: phosphorGeom(layout, camera, view) }
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
  paintPhosphor(rec.ctx, {
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

/** The rects a stack's blocks are drawn with: 5 px squares at its x. */
function blockRects(log: CtxEntry[], x: number): number {
  const bx = Math.round(x - BLOCK_PX / 2)
  return log.filter((e) => e.kind === 'call' && e.name === 'rect' && e.args[0] === bx && e.args[2] === BLOCK_PX && e.args[3] === BLOCK_PX).length
}

let kepano: ProfileData
let gaearon: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
})

describe('the layout', () => {
  it("stands each stack at its root, as tall as the garden's plant, once per lane, the tallest painted first", () => {
    const timeline = buildLifeTimeline(RICH, NOW)
    const layout = layoutPhosphor(timeline, 'graphql')
    const garden = layoutLifeGarden(timeline, 'graphql')
    expect(layout.stacks).toHaveLength(RICH.repos.length)
    for (const [i, stack] of layout.stacks.entries()) {
      const lane = timeline.lanes[stack.lane]
      expect(stack.x).toBe(lane.rootDay - timeline.startDay + 0.5)
      expect(stack.startDay).toBe(lane.startDay)
      expect(stack.height).toBe(garden.plants[garden.byKey.get(stack.key)!].height)
      expect(layout.byKey.get(stack.key)).toBe(i)
      if (i > 0) expect(layout.stacks[i - 1].height).toBeGreaterThanOrEqual(stack.height)
    }
    const busy = layout.stacks[layout.byKey.get('me/busy')!]
    expect(busy.height).toBe(Math.max(...layout.stacks.map((s) => s.height)))
    expect(busy.head).toBeGreaterThan(0.5)
    expect(layout.stacks[layout.byKey.get('me/old')!].dry).toBe(true)
    expect(layout.stacks[layout.byKey.get('other/lib')!].visiting).toBe(true)
    expect(layout.stacks[layout.byKey.get('me/revived')!].parts.some((p) => p.kind === 'dormant')).toBe(true)
  })

  it('is the same for the same repos in any order, and twice over', () => {
    const layout = layoutPhosphor(buildLifeTimeline(RICH, NOW), 'graphql')
    for (const seed of [1, 4, 9, 23]) expect(layoutPhosphor(buildLifeTimeline(shuffledProfile(RICH, seed), NOW), 'graphql'), `seed ${seed}`).toEqual(layout)
    const k = layoutPhosphor(buildLifeTimeline(kepano, KEPANO_NOW), 'graphql')
    expect(layoutPhosphor(buildLifeTimeline(shuffledProfile(kepano, 3), KEPANO_NOW), 'graphql')).toEqual(k)
    const g = layoutPhosphor(buildLifeTimeline(gaearon, GAEARON_NOW), 'rest')
    expect(g.stacks).toHaveLength(gaearon.repos.length)
    expect(layoutPhosphor(buildLifeTimeline(shuffledProfile(gaearon, 5), GAEARON_NOW), 'rest')).toEqual(g)
  })

  it('keeps a renamed repo where it was: nothing is seeded from a name', () => {
    const renamed = profile({ repos: RICH.repos.map((r) => ({ ...r, nameWithOwner: r.nameWithOwner.replace('me/', 'me/zz-') })) })
    const a = layoutPhosphor(buildLifeTimeline(RICH, NOW), 'graphql')
    const b = layoutPhosphor(buildLifeTimeline(renamed, NOW), 'graphql')
    const strip = (l: PhosphorLayout) => l.stacks.map(({ key: _key, ...rest }) => rest)
    expect(strip(b)).toEqual(strip(a))
  })

  it('serves a person with no repos: no stacks, the axis alone', () => {
    const s = scene(profile(), NOW)
    expect(s.layout.stacks).toEqual([])
    expect(s.layout.days).toBeGreaterThan(0)
    expect(phosphorLabelOrder(s.layout)).toHaveLength(0)
    const rec = paintLog(s)
    expect(rec.calls('fillRect').length).toBeGreaterThan(0)
    expect(rec.texts().some((t) => /^\d{4}$/.test(t))).toBe(true)
    expect(hitPhosphor(s.layout, s.g, s.camera, s.view, 400, horizonY(s.view) - 50, new Set(), null)?.kind).toBe('day')
  })
})

describe('the geometry', () => {
  it('builds stacks of 5 px blocks from the ground, as tall as their share of the plot, a starred head bigger', () => {
    const s = scene(RICH, NOW)
    const plot = horizonY(s.view) - s.view.top
    s.layout.stacks.forEach((stack, i) => {
      expect(s.g.head[i]).toBe(headSide(stack))
      expect(Math.abs(s.g.blocks[i] * PITCH_PX + s.g.head[i] - plot * stack.height)).toBeLessThanOrEqual(PITCH_PX / 2 + 1e-9)
      expect(headTop(s.g, i, s.g.blocks[i])).toBeGreaterThanOrEqual(s.view.top - PITCH_PX)
    })
    const busy = s.layout.byKey.get('me/busy')!
    const quiet = s.layout.byKey.get('me/quiet')!
    expect(s.g.head[busy]).toBeGreaterThan(s.g.head[quiet])
    expect(s.g.head[quiet]).toBe(BLOCK_PX)
  })

  it('grows a stack with the time-lapse: no body on its first day, all of it from its last', () => {
    const s = scene(RICH, NOW)
    const i = s.layout.byKey.get('me/busy')!
    const stack = s.layout.stacks[i]
    const n = s.g.blocks[i]
    expect(blocksAt(stack, n, stack.startDay)).toBe(0)
    expect(blocksAt(stack, n, null)).toBe(n)
    expect(blocksAt(stack, n, stack.endDay + 1)).toBe(n)
    let last = 0
    for (let day = stack.startDay; day <= stack.endDay + 1; day += 30) {
      const b = blocksAt(stack, n, day)
      expect(b).toBeGreaterThanOrEqual(last)
      last = b
    }
  })
})

describe('the hit test', () => {
  /** Every drawn stack is hit at its anchor: as itself, or as a stack drawn over it there. */
  function expectHitAtAnchors(s: Scene, hidden: ReadonlySet<string>, at: number | null) {
    const out = new Float32Array(3)
    let hits = 0
    s.layout.stacks.forEach((stack, i) => {
      if (hidden.has(stack.key)) return
      const sown = phosphorAnchor(s.layout, s.g, i, at, out)
      expect(sown).toBe(!(at !== null && stack.startDay > at))
      if (!sown) return
      const notDrawn = new Set(hidden)
      if (at !== null) for (const other of s.layout.stacks) if (other.startDay > at) notDrawn.add(other.key)
      const hit = hitPhosphor(s.layout, s.g, s.camera, s.view, out[0], out[1], notDrawn, at)
      expect(hit?.kind, stack.key).toBe('repo')
      const j = s.layout.byKey.get((hit as { key: string }).key)!
      expect(j, stack.key).toBeGreaterThanOrEqual(i)
      expect(hidden.has(s.layout.stacks[j].key)).toBe(false)
      if (j === i) hits++
    })
    return hits
  }

  it('hits every stack of RICH, kepano and gaearon at its anchor, fully grown, halfway and with some hidden', () => {
    for (const s of [scene(RICH, NOW), scene(kepano, KEPANO_NOW), scene(gaearon, GAEARON_NOW)]) {
      const n = s.layout.stacks.length
      // most are hit as themselves; the rest under a shorter stack drawn over them at the same root
      const self = expectHitAtAnchors(s, new Set(), null)
      expect(self).toBeGreaterThan(n * 0.5)
      expectHitAtAnchors(s, new Set(), dayAt(s.timeline.clock, 0.5))
      expectHitAtAnchors(s, new Set(s.layout.stacks.filter((_s, i) => i % 3 === 0).map((st) => st.key)), null)
    }
  })

  it('skips a hidden or unsown stack, and falls back to the day or milestone under the pointer', () => {
    const s = scene(RICH, NOW)
    const i = s.layout.byKey.get('me/busy')!
    const stack = s.layout.stacks[i]
    const x = s.g.x[i]
    const y = s.g.base - 2
    expect(hitPhosphor(s.layout, s.g, s.camera, s.view, x, y, new Set(), null)).toEqual({ kind: 'repo', key: 'me/busy' })
    const hidden = hitPhosphor(s.layout, s.g, s.camera, s.view, x, y, new Set(['me/busy']), null)
    expect(hidden?.kind === 'repo' ? hidden.key : null).not.toBe('me/busy')
    const early = hitPhosphor(s.layout, s.g, s.camera, s.view, x, y, new Set(), stack.startDay - 1)
    expect(early?.kind === 'repo' ? early.key : null).not.toBe('me/busy')
    // above a stack's head: the day
    const over = hitPhosphor(s.layout, s.g, s.camera, s.view, x, headTop(s.g, i, s.g.blocks[i]) - 20, new Set(), null)
    expect(over).toEqual({ kind: 'day', day: s.layout.startDay + Math.floor(stack.x), milestone: null })
    expect(hitPhosphor(s.layout, s.g, s.camera, s.view, -5, 100, new Set(), null)).toBeNull()
  })
})

describe('the painter', () => {
  it('fills the phosphor screen first and keeps to the phosphor palette, whatever the theme', () => {
    const allowed = new Set(Object.values(PHOSPHOR))
    for (const t of THEMES) {
      const s = scene(RICH, NOW)
      const rec = paintLog(s, { themeId: t.id, hover: { kind: 'repo', key: 'me/steady' }, selected: 'me/busy', at: dayAt(s.timeline.clock, 0.8) })
      const first = rec.log.find((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name)) as Extract<CtxEntry, { kind: 'call' }>
      expect(first.name).toBe('fillRect')
      expect(first.args).toEqual([0, 0, s.view.width * 2, s.view.height * 2])
      expect(first.style.fillStyle).toBe(PHOSPHOR.screen)
      for (const e of rec.log) {
        if (e.kind !== 'call') continue
        if (/^(fill|fillRect|fillText)$/.test(e.name)) expect(allowed.has(String(e.style.fillStyle)), `${t.id} ${e.name} ${String(e.style.fillStyle)}`).toBe(true)
        if (/^(stroke|strokeRect|strokeText)$/.test(e.name)) expect(allowed.has(String(e.style.strokeStyle)), `${t.id} ${e.name} ${String(e.style.strokeStyle)}`).toBe(true)
      }
      // the same frame in every theme: a terminal screen
      expect(rec.log).toEqual(paintLog(s, { hover: { kind: 'repo', key: 'me/steady' }, selected: 'me/busy', at: dayAt(s.timeline.clock, 0.8) }).log)
    }
  })

  it('draws years and "today" in monospace, and never a repo name', () => {
    for (const s of [scene(RICH, NOW), scene(kepano, KEPANO_NOW), scene(gaearon, GAEARON_NOW)]) {
      const names = s.timeline.lanes.map((lane) => lane.repo.toLowerCase())
      const rec = paintLog(s, { hover: { kind: 'repo', key: s.layout.stacks[0].key }, selected: s.layout.stacks[1].key })
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

  it('draws a hidden stack not at all', () => {
    const s = scene(RICH, NOW)
    const all = new Set(s.layout.stacks.map((st) => st.key))
    const base = paintLog(s, { hidden: all }).log.length
    for (const stack of s.layout.stacks) {
      const alone = new Set(all)
      alone.delete(stack.key)
      expect(paintLog(s, { hidden: alone }).log.length, stack.key).toBeGreaterThan(base)
    }
    // hiding one takes its blocks away and nothing else of the others'
    const i = s.layout.byKey.get('me/busy')!
    expect(blockRects(paintLog(s).log, s.g.x[i])).toBeGreaterThan(0)
    expect(blockRects(paintLog(s, { hidden: new Set(['me/busy']) }).log, s.g.x[i])).toBe(0)
  })

  it('draws nothing after the time-lapse day, and grows each stack with it', () => {
    for (const s of [scene(RICH, NOW), scene(kepano, KEPANO_NOW)]) {
      const all = new Set(s.layout.stacks.map((st) => st.key))
      for (const p of [0, 0.3, 0.6, 1]) {
        const at = dayAt(s.timeline.clock, p)
        const unsown = new Set(s.layout.stacks.filter((st) => st.startDay > at).map((st) => st.key))
        // the unsown stacks draw nothing: the frame is the same with them hidden
        expect(paintLog(s, { at }).log, `at ${p}`).toEqual(paintLog(s, { at, hidden: unsown }).log)
        if (p === 0) expect(paintLog(s, { at }).log).toEqual(paintLog(s, { at, hidden: all }).log)
      }
      const i = s.layout.byKey.get(s.layout.stacks[0].key)!
      const stack = s.layout.stacks[i]
      const mid = Math.floor((stack.startDay + stack.endDay) / 2)
      const only = new Set([...all].filter((k) => k !== stack.key))
      const grownAt = (at: number | null) => blockRects(paintLog(s, { at, hidden: only }).log, s.g.x[i])
      expect(grownAt(stack.startDay)).toBe(0)
      expect(grownAt(mid)).toBeGreaterThan(0)
      expect(grownAt(mid)).toBeLessThan(grownAt(null))
      expect(grownAt(null)).toBe(s.g.blocks[i])
    }
  })

  it('brightens blocks toward the top, dims dormant stretches, archived repos and the unselected', () => {
    const s = scene(RICH, NOW)
    const alphasOf = (key: string, opts: PaintOpts = {}) => {
      const others = new Set(s.layout.stacks.map((st) => st.key).filter((k) => k !== key))
      const log = paintLog(s, { ...opts, hidden: new Set([...others, ...(opts.hidden ?? [])]) }).log
      return log.filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && e.name === 'fill' && (e.style.fillStyle === PHOSPHOR.phosphor || e.style.fillStyle === PHOSPHOR.dim)).map((e) => Number(e.style.globalAlpha))
    }
    const busy = alphasOf('me/busy')
    expect(busy.length).toBeGreaterThan(2)
    // the active blocks' passes come first, foot to top, each brighter than the last, up to the top's 0.85
    let rising = 1
    while (rising < busy.length && busy[rising] > busy[rising - 1]) rising++
    const active = busy.slice(0, rising)
    expect(active.length).toBeGreaterThan(2)
    expect(active[0]).toBeLessThan(0.4)
    // the revived repo's long dormant stretch draws in a pass dimmer than the faintest active block (0.22)
    const revived = alphasOf('me/revived')
    expect(Math.min(...revived)).toBeLessThan(0.22)
    const old = alphasOf('me/old')
    expect(Math.max(...old)).toBeLessThan(Math.max(...busy))
    expect(Math.max(...alphasOf('me/busy', { selected: 'me/steady', hidden: new Set() }))).toBeLessThan(Math.max(...busy))
  })

  it('frames the hovered and the selected stack', () => {
    const s = scene(RICH, NOW)
    const plain = paintLog(s).calls('strokeRect').length
    expect(paintLog(s, { hover: { kind: 'repo', key: 'me/busy' } }).calls('strokeRect').length).toBe(plain + 1)
    expect(paintLog(s, { hover: { kind: 'repo', key: 'me/busy' }, selected: 'me/steady' }).calls('strokeRect').length).toBe(plain + 2)
    expect(paintLog(s, { selected: 'me/busy', hidden: new Set(['me/busy']) }).calls('strokeRect').length).toBe(plain)
  })

  it('lays scanlines every 3 px and a vignette over the whole screen, after the stacks', () => {
    const s = scene(RICH, NOW)
    const rec = paintLog(s)
    const scan = rec.calls('rect').filter((c) => c.args[0] === 0 && c.args[2] === s.view.width && c.args[3] === 1)
    expect(scan.length).toBe(Math.ceil(s.view.height / 3))
    scan.forEach((c, k) => expect(c.args[1]).toBe(k * 3))
    const evenodd = rec.calls('fill').filter((c) => c.args[0] === 'evenodd')
    expect(evenodd.length).toBeGreaterThan(4)
    for (const c of evenodd) expect(c.style.fillStyle).toBe(PHOSPHOR.shade)
    const lastBlock = rec.log.map((e, i) => (e.kind === 'call' && e.name === 'rect' && e.args[2] === BLOCK_PX ? i : -1)).reduce((a, b) => Math.max(a, b))
    const firstScan = rec.log.indexOf(scan[0])
    expect(firstScan).toBeGreaterThan(lastBlock)
  })
})

describe('the scene', () => {
  it('anchors every stack on its head block, orders labels by stars, and keeps labels off the ground', () => {
    const s = scene(kepano, KEPANO_NOW)
    const def = PHOSPHOR_VIEW
    expect(def.id).toBe('phosphor')
    expect(def.title).toBe('phosphor')
    expect(def.scene.items(s.layout)).toBe(s.layout.stacks)
    const order = Array.from(phosphorLabelOrder(s.layout))
    expect([...order].sort((a, b) => a - b)).toEqual(s.layout.stacks.map((_x, i) => i))
    for (let k = 1; k < order.length; k++) expect(s.layout.stacks[order[k - 1]].stars).toBeGreaterThanOrEqual(s.layout.stacks[order[k]].stars)
    expect(Array.from(phosphorKeepOut(s.layout, s.view))).toEqual([0, horizonY(s.view) - 1, s.view.width, s.view.height])
    const out = new Float32Array(3)
    s.layout.stacks.forEach((_stack, i) => {
      expect(phosphorAnchor(s.layout, s.g, i, null, out)).toBe(true)
      expect(out[0]).toBeCloseTo(s.g.x[i], 3)
      expect(out[1]).toBeCloseTo(headTop(s.g, i, s.g.blocks[i]) + s.g.head[i] / 2, 3)
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

// ---------- landed pull requests ----------

describe('landed pull requests on the phosphor screen', () => {
  const landedProfile = (): ProfileData => ({ ...RICH, landed: [{ day: '2021-03-05', repo: 'other/lib' }, { day: '2021-02-10', repo: 'Other/Lib' }] })

  /** Whether the bright diamond of landed day l is drawn over its block: its top corner's moveTo in the bright colour. */
  function diamondAt(rec: RecordingCtx, s: Scene, i: number, l: { t: number; day: number }, grown: number): boolean {
    const cy = pLandedCentreY(s.g, i, grown, l.t)
    return rec.calls('moveTo').some((c) => c.args[0] === s.g.x[i] && c.args[1] === cy - PHOSPHOR_LANDED_PX && c.style.fillStyle === P_PALETTE.bright)
  }

  it('sits over the body block at its day, or over the head block while none has risen', () => {
    const g = { base: 100, head: Float64Array.of(7), blocks: Int32Array.of(10), x: Float64Array.of(50) }
    expect(pLandedCentreY(g, 0, 10, 0.45)).toBe(100 - 5 * P_PITCH_PX + P_GAP_PX + P_BLOCK_PX / 2)
    expect(pLandedCentreY(g, 0, 10, 0.999)).toBe(100 - 10 * P_PITCH_PX + P_GAP_PX + P_BLOCK_PX / 2)
    expect(pLandedCentreY(g, 0, 3, 0.9)).toBe(100 - 3 * P_PITCH_PX + P_GAP_PX + P_BLOCK_PX / 2)
    expect(pLandedCentreY(g, 0, 0, 0.5)).toBe(100 - 7 / 2)
  })

  it('draws a bright diamond over the block at each landed day\'s height, once the time-lapse has reached it', () => {
    const s = scene(landedProfile(), NOW)
    const i = s.layout.byKey.get('other/lib')!
    const stack = s.layout.stacks[i]
    expect(stack.landed.map((l) => l.day)).toEqual([dayNumber('2021-02-10'), dayNumber('2021-03-05')])
    expect(s.layout.stacks.filter((st) => st.landed.length > 0)).toHaveLength(1)
    const full = paintLog(s)
    for (const l of stack.landed) expect(diamondAt(full, s, i, l, s.g.blocks[i])).toBe(true)
    // the mark is drawn in the bright colour, filled
    expect(full.calls('fill').some((c) => c.style.fillStyle === P_PALETTE.bright)).toBe(true)
    // before the stack rises: nothing; between its two days: the first only
    expect(paintLog(s, { at: stack.startDay - 1 }).calls('moveTo').filter((c) => c.args[0] === s.g.x[i] && c.style.fillStyle === P_PALETTE.bright)).toHaveLength(0)
    const between = dayNumber('2021-02-20')
    const grown = pBlocksAt(stack, s.g.blocks[i], between)
    // the stack has only begun to rise: the one mark reached sits over its head block
    expect(grown).toBe(0)
    const rec = paintLog(s, { at: between })
    expect(diamondAt(rec, s, i, stack.landed[0], grown)).toBe(true)
    const brightMoves = (r: RecordingCtx) => r.calls('moveTo').filter((c) => c.args[0] === s.g.x[i] && c.style.fillStyle === P_PALETTE.bright)
    expect(brightMoves(rec)).toHaveLength(1)
    expect(brightMoves(full)).toHaveLength(2)
    // later, over the body block at its day's height
    const later = dayNumber('2023-06-01')
    const risen = pBlocksAt(stack, s.g.blocks[i], later)
    expect(risen).toBeGreaterThan(0)
    for (const l of stack.landed) expect(diamondAt(paintLog(s, { at: later }), s, i, l, risen)).toBe(true)
    // hidden: none
    expect(paintLog(s, { hidden: new Set(['other/lib']) }).calls('moveTo').filter((c) => c.args[0] === s.g.x[i] && c.style.fillStyle === P_PALETTE.bright)).toHaveLength(0)
  })
})
