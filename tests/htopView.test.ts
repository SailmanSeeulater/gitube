/**
 * The htop view: its layout (one row per lane in lane order, meters tiling each lane, levels by tier,
 * colour slots from language use), the same layout for the profile in any order and for a renamed
 * repo, its geometry (rows inside the plot, thinner when there are many), its hit test (every row
 * drawn hit at its label anchor, fully grown, zoomed and halfway through the time-lapse; hidden and
 * unsown rows skipped; the gutter; the axis otherwise), and its painter on a recording context: only
 * the console palette whatever the theme, no repo name, nothing of a hidden row, nothing past the
 * time-lapse's day, finite numbers. Then at scale (a prolific profile of 400 repos, gaearon's 301)
 * and with no repos at all.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { fetchProfileRest } from '../src/api/profile'
import { getTheme } from '../src/theme/themes'
import { HTOP_PALETTE } from '../src/theme/console/htop'
import { buildLifeTimeline, dayAt, type LifeTimeline } from '../src/profile/timeline'
import { fitLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { axisHover } from '../src/profile/lifeView'
import { layoutHtop, type HtopLayout } from '../src/profile/htopLayout'
import { HTOP_GUTTER_PX, HTOP_MAX_PITCH, htopDrawnTo, htopGeom, htopSown, rowY, type HtopGeom } from '../src/profile/htopGeometry'
import { hitHtop } from '../src/profile/htopHit'
import { htopAnchor, htopKeepOut, htopLabelOrder, htopRowColour, paintHtop, type HtopPaintInput } from '../src/profile/htopPaint'
import { HTOP_VIEW } from '../src/profile/htopView'
import type { LifeCamera, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { prolific } from './helpers/lifeLinesScale'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'
import { recordingCtx, type RecordingCtx } from './helpers/recordingCtx'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }
const NONE: ReadonlySet<string> = new Set()

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

/** Every day from..to ('YYYY-MM-DD'), one commit each. */
function daily(from: string, days: number): ProfileRepo['activity'] {
  const start = Date.parse(`${from}T12:00:00Z`)
  return Array.from({ length: days }, (_, i) => ({ date: new Date(start + i * 86_400_000).toISOString().slice(0, 10), commits: 1 }))
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

const REPOS: ProfileRepo[] = [
  repo('Me/alpha', { createdAt: iso('2019-02-01'), stars: 120, activity: [...monthly('2019-02', '2020-06', 9), ...monthly('2021-06', '2021-09', 1)] }),
  repo('Me/Secret-Plans', { createdAt: iso('2020-03-01'), language: 'Rust', stars: 30, isPrivate: true, activity: monthly('2020-03', '2024-05', 3) }),
  repo('Me/old-thing', { createdAt: iso('2019-06-01'), language: 'JavaScript', stars: 15, isArchived: true, activity: monthly('2019-06', '2019-12') }),
  repo('Me/forked-lib', { createdAt: iso('2021-01-10'), language: 'Go', isFork: true, activity: monthly('2021-01', '2021-03', 1) }),
  repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-05-01'), isOwn: false, language: null, activity: monthly('2022-05', '2023-02', 5) }),
  repo('Me/busy-bee', { createdAt: iso('2022-09-01'), activity: daily('2022-09-01', 40) }),
  repo('Me/empty-seedling', { createdAt: iso('2023-08-01'), stars: 5 }),
]
const NAMES = ['alpha', 'secret', 'old-thing', 'forked-lib', 'big-project', 'busy-bee', 'empty-seedling', 'someone']

/** A seeded shuffle, so a failure reproduces. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  let state = seed
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648
    const j = state % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface Scene {
  timeline: LifeTimeline
  layout: HtopLayout
  camera: LifeCamera
  g: HtopGeom
  input: HtopPaintInput
}

function scene(p: ProfileData = profile({ repos: REPOS }), now = NOW, camera?: LifeCamera, themeId = 'obsidian'): Scene {
  const timeline = buildLifeTimeline(p, now)
  const layout = layoutHtop(timeline, p.source)
  const cam = camera ?? fitLifeCamera(layout.days, VIEW)
  const g = htopGeom(layout, cam, VIEW)
  const theme = getTheme(themeId)
  const palette = languagePalette(timeline, theme)
  const input: HtopPaintInput = {
    layout,
    timeline,
    geoms: g,
    camera: cam,
    view: VIEW,
    ink: lifeInk(theme),
    colourOf: (language) => languageColour(palette, language, theme),
    hidden: NONE,
    hover: null,
    selected: null,
    at: null,
  }
  return { timeline, layout, camera: cam, g, input }
}

function paint(s: Scene, over: Partial<HtopPaintInput> = {}): RecordingCtx {
  const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
  paintHtop(rec.ctx, { ...s.input, ...over })
  return rec
}

const anchorOf = (s: Scene, i: number, at: number | null = null) => {
  const out = new Float32Array(3)
  expect(htopAnchor(s.layout, s.g, i, at, out)).toBe(true)
  return out
}

/** The set of repos not drawn at a time-lapse day, as the painter's host makes it. */
const notDrawnAt = (s: Scene, at: number | null, hidden: ReadonlySet<string> = NONE) =>
  new Set([...hidden, ...s.layout.rows.filter((r) => !htopSown(r, at)).map((r) => r.key)])

/** Every drawn row is hit at its own label anchor. */
function expectHitAtAnchors(s: Scene, at: number | null = null) {
  const notDrawn = notDrawnAt(s, at)
  let checked = 0
  s.layout.rows.forEach((row, i) => {
    if (notDrawn.has(row.key)) return
    const [x, y] = anchorOf(s, i, at)
    if (x < 0 || x > VIEW.width) return
    expect(hitHtop(s.layout, s.g, s.camera, VIEW, x, y, notDrawn, at), row.key).toEqual({ kind: 'repo', key: row.key })
    checked++
  })
  return checked
}

describe('htop layout', () => {
  it('has a row per lane, in lane order, its cells tiling the lane', () => {
    const s = scene()
    expect(s.layout.rows.map((r) => r.lane)).toEqual(s.timeline.lanes.map((_, i) => i))
    s.layout.rows.forEach((row, i) => {
      const lane = s.timeline.lanes[i]
      expect(row.row).toBe(i)
      expect(s.layout.byKey.get(row.key)).toBe(i)
      expect(row.x0).toBe(lane.startDay - s.timeline.startDay)
      expect(row.x1).toBe(lane.endDay + 1 - s.timeline.startDay)
      expect(row.x).toBe(lane.rootDay - s.timeline.startDay + 0.5)
      expect(row.cells[0].x0).toBe(row.x0)
      expect(row.cells.at(-1)!.x1).toBe(row.x1)
      for (let c = 1; c < row.cells.length; c++) expect(row.cells[c].x0).toBe(row.cells[c - 1].x1)
    })
  })

  it('lights active stretches by how busy they were with a token, all full without one', () => {
    const s = scene()
    const levels = new Set(s.layout.rows.flatMap((r) => r.cells.filter((c) => c.level > 0).map((c) => c.level)))
    expect(levels.size).toBeGreaterThan(1)
    const busy = s.layout.rows[s.layout.byKey.get('me/busy-bee')!]
    expect(busy.cells.some((c) => c.level === 3)).toBe(true)
    // a lane GitHub counted no commits to is lit half
    expect(s.layout.rows[s.layout.byKey.get('me/empty-seedling')!].cells[0].level).toBe(2)
    const rest = scene(profile({ repos: REPOS, source: 'rest' }))
    for (const row of rest.layout.rows) for (const cell of row.cells) expect([0, 3]).toContain(cell.level)
  })

  it('gives colour slots by how many lanes use a language', () => {
    const s = scene()
    expect(s.layout.slots.get('TypeScript')).toBe(0)
    expect(new Set(s.layout.slots.values()).size).toBe(s.layout.slots.size)
    expect(s.layout.rows[s.layout.byKey.get('someone/big-project')!].slot).toBe(-1)
    expect(htopRowColour(s.layout.rows[s.layout.byKey.get('me/old-thing')!])).toBe(HTOP_PALETTE.dry)
  })

  it('gives the same layout for the profile in any order', () => {
    const base = scene().layout
    for (const seed of [1, 2, 3, 4, 5]) {
      const repos = shuffled(REPOS, seed).map((r, i) => ({ ...r, activity: shuffled(r.activity, seed * 31 + i) }))
      expect(layoutHtop(buildLifeTimeline(profile({ repos }), NOW), 'graphql')).toEqual(base)
    }
  })

  it('keeps a renamed repo on its row: the order never follows a name', () => {
    const base = scene().layout
    const strip = (l: HtopLayout) => l.rows.map(({ key: _key, ...rest }) => rest)
    for (const [from, to] of [
      ['Me/alpha', 'Me/zzz-renamed'],
      ['Me/busy-bee', 'Me/aaa'],
      ['Me/Secret-Plans', 'Me/0'],
    ]) {
      const repos = REPOS.map((r) => (r.nameWithOwner === from ? { ...r, nameWithOwner: to } : r))
      const layout = layoutHtop(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
      expect(strip(layout)).toEqual(strip(base))
      expect(layout.slots).toEqual(base.slots)
    }
  })

  it('is the view lifeViews.ts imports', () => {
    expect(HTOP_VIEW.id).toBe('htop')
    expect(HTOP_VIEW.title).toBe('htop')
    const s = scene()
    expect(HTOP_VIEW.layout(s.timeline, 'graphql')).toEqual(s.layout)
    expect(HTOP_VIEW.scene.items(s.layout)).toBe(s.layout.rows)
  })
})

describe('htop geometry', () => {
  it('stacks the rows from the plot top under the header, inside the horizon', () => {
    const s = scene()
    expect(s.g.pitch).toBe(HTOP_MAX_PITCH)
    expect(s.g.detail).toBe(true)
    expect(rowY(s.g, 0) - s.g.pitch / 2).toBe(s.g.top)
    expect(s.g.top).toBeGreaterThan(VIEW.top)
    expect(rowY(s.g, s.layout.rows.length - 1)).toBeLessThan(horizonY(VIEW))
  })

  it('packs hundreds of rows thinner, all of them inside the plot', () => {
    const big = scene(prolific(400, 'graphql'), Date.parse('2024-07-01T19:00:00Z'))
    expect(big.layout.rows.length).toBe(400)
    expect(big.g.pitch).toBeLessThan(HTOP_MAX_PITCH)
    expect(big.g.pitch).toBeGreaterThan(0)
    expect(big.g.detail).toBe(false)
    expect(rowY(big.g, 399) + big.g.pitch / 2).toBeLessThanOrEqual(big.g.bottom + 1e-6)
  })
})

describe('htop hit test', () => {
  it('hits every row at its label anchor, fully grown and zoomed in', () => {
    const s = scene()
    expect(expectHitAtAnchors(s)).toBe(s.layout.rows.length)
    const zoomed = scene(undefined, NOW, zoomLifeCamera(s.camera, 3, VIEW.width / 2, s.layout.days, VIEW))
    expect(expectHitAtAnchors(zoomed)).toBeGreaterThan(0)
  })

  it('hits a row along its meter and in the gutter, and the axis elsewhere', () => {
    const s = scene()
    const i = s.layout.byKey.get('me/alpha')!
    const row = s.layout.rows[i]
    const y = rowY(s.g, i)
    const mid = s.camera.tx + ((row.x0 + row.x1) / 2) * s.camera.k
    expect(hitHtop(s.layout, s.g, s.camera, VIEW, mid, y, NONE, null)).toEqual({ kind: 'repo', key: row.key })
    expect(hitHtop(s.layout, s.g, s.camera, VIEW, HTOP_GUTTER_PX / 2, y, NONE, null)).toEqual({ kind: 'repo', key: row.key })
    // the busy row starts late: left of its meter is a day
    const late = s.layout.byKey.get('me/empty-seedling')!
    const before = s.camera.tx + (s.layout.rows[late].x0 / 2) * s.camera.k
    const yl = rowY(s.g, late)
    expect(hitHtop(s.layout, s.g, s.camera, VIEW, before, yl, NONE, null)).toEqual(axisHover(s.layout, s.camera, VIEW, before, yl))
    expect(hitHtop(s.layout, s.g, s.camera, VIEW, -1, y, NONE, null)).toBeNull()
  })

  it('skips hidden rows and rows the time-lapse has not sown', () => {
    const s = scene()
    const i = s.layout.byKey.get('me/alpha')!
    const [x, y] = anchorOf(s, i)
    const hit = hitHtop(s.layout, s.g, s.camera, VIEW, x, y, new Set(['me/alpha']), null)
    expect(hit?.kind === 'repo' && hit.key === 'me/alpha').toBe(false)

    const last = s.layout.rows.at(-1)!
    const at = last.startDay - 1
    const [lx, ly] = anchorOf(s, s.layout.rows.length - 1, at)
    const notDrawn = notDrawnAt(s, at)
    expect(notDrawn.has(last.key)).toBe(true)
    const unsown = hitHtop(s.layout, s.g, s.camera, VIEW, lx, ly, notDrawn, at)
    expect(unsown?.kind === 'repo' && unsown.key === last.key).toBe(false)
  })

  it('hits every sown row at its anchor halfway through the time-lapse, and not past its day', () => {
    const s = scene()
    const at = dayAt(s.timeline.clock, 0.5)
    expect(expectHitAtAnchors(s, at)).toBeGreaterThan(0)
    const row = s.layout.rows[s.layout.byKey.get('me/secret-plans')!]
    const end = htopDrawnTo(row, s.layout.startDay, at)
    expect(end).toBeLessThan(row.x1)
    const past = s.camera.tx + (end + 60) * s.camera.k
    const hit = hitHtop(s.layout, s.g, s.camera, VIEW, past, rowY(s.g, row.row), notDrawnAt(s, at), at)
    expect(hit?.kind).toBe('day')
  })
})

describe('htop painter', () => {
  /** Every colour the console may draw with. */
  const allowed = new Set<string>(Object.values(HTOP_PALETTE).flat())

  it('draws only the console palette, the same in every theme', () => {
    const dark = paint(scene(undefined, NOW, undefined, 'obsidian'))
    const light = paint(scene(undefined, NOW, undefined, 'paper'))
    expect(light.log).toEqual(dark.log)
    for (const name of ['fillStyle', 'strokeStyle']) for (const v of dark.sets(name)) expect(allowed, String(v)).toContain(v)
    // the screen is filled first, near-black
    expect(dark.calls('fillRect')[0].style.fillStyle).toBe(HTOP_PALETTE.background)
  })

  it('draws no repo name, whatever is hovered or selected', () => {
    const s = scene()
    for (const over of [{}, { hover: { kind: 'repo', key: 'me/alpha' } as const, selected: 'me/secret-plans' }]) {
      const rec = paint(s, over)
      const texts = rec.texts().map((t) => t.toLowerCase())
      expect(texts.length).toBeGreaterThan(0)
      for (const name of NAMES) for (const t of texts) expect(t).not.toContain(name)
      for (const t of texts) expect(t).toMatch(/^(\d+|PID|today)$/i)
    }
  })

  it('draws every number finite, and a meter at every row', () => {
    const s = scene()
    const rec = paint(s, { hover: { kind: 'repo', key: 'me/alpha' }, selected: 'me/old-thing' })
    for (const e of rec.log) if (e.kind === 'call') for (const a of e.args) if (typeof a === 'number') expect(Number.isFinite(a)).toBe(true)
    const ys = new Set(rec.calls('rect').map((c) => Math.round((c.args[1] as number) + (c.args[3] as number) / 2)))
    s.layout.rows.forEach((_, i) => expect(ys.has(Math.round(rowY(s.g, i)))).toBe(true))
  })

  it('draws nothing of a hidden row', () => {
    const s = scene()
    const i = s.layout.byKey.get('me/alpha')!
    const y = rowY(s.g, i)
    const rec = paint(s, { hidden: new Set(['me/alpha']), selected: 'me/alpha', hover: { kind: 'repo', key: 'me/alpha' } })
    const onRow = (args: unknown[]) => Math.abs((args[1] as number) + (args[3] as number) / 2 - y) < 1e-6
    expect(rec.calls('rect').some((c) => onRow(c.args))).toBe(false)
    expect(rec.calls('fillRect').some((c) => c.args[0] === 0 && onRow(c.args))).toBe(false)
    expect(rec.calls('fillText').some((c) => c.args[0] === String(i + 1))).toBe(false)
  })

  it('draws nothing past the time-lapse day, and no row it has not sown', () => {
    const s = scene()
    for (const p of [0.05, 0.3, 0.5, 0.8]) {
      const at = dayAt(s.timeline.clock, p)
      const limit = s.camera.tx + (at - s.layout.startDay) * s.camera.k + 1e-6
      const rec = paint(s, { at, selected: 'me/alpha', hover: { kind: 'repo', key: 'me/busy-bee' } })
      for (const c of rec.calls('rect')) expect((c.args[0] as number) + (c.args[2] as number)).toBeLessThanOrEqual(limit)
      for (const name of ['moveTo', 'lineTo'])
        for (const c of rec.calls(name)) if (c.style.strokeStyle === HTOP_PALETTE.bracket) expect(c.args[0] as number).toBeLessThanOrEqual(limit)
      const ys = new Set(rec.calls('rect').map((c) => Math.round((c.args[1] as number) + (c.args[3] as number) / 2)))
      s.layout.rows.forEach((row, i) => {
        if (row.startDay > at) expect(ys.has(Math.round(rowY(s.g, i)))).toBe(false)
      })
    }
  })

  it('anchors labels at each meter start, the heaviest first, kept off the header, gutter and ground', () => {
    const s = scene()
    const [x, y] = anchorOf(s, 0)
    expect(x).toBeCloseTo(s.camera.tx + s.layout.rows[0].x0 * s.camera.k)
    expect(y).toBeCloseTo(rowY(s.g, 0))
    const order = Array.from(htopLabelOrder(s.layout))
    expect(order.length).toBe(s.layout.rows.length)
    const w = order.map((i) => s.layout.rows[i].weight)
    for (let k = 1; k < w.length; k++) expect(w[k]).toBeLessThanOrEqual(w[k - 1])
    expect(htopKeepOut(s.layout, VIEW).length).toBe(12)
  })
})

describe('htop at scale and empty', () => {
  it('keeps 400 repos hittable and painted', () => {
    const now = Date.parse('2024-07-01T19:00:00Z')
    for (const source of ['graphql', 'rest'] as const) {
      const s = scene(prolific(400, source), now)
      expect(expectHitAtAnchors(s)).toBe(400)
      expect(expectHitAtAnchors(s, dayAt(s.timeline.clock, 0.6))).toBeGreaterThan(100)
      const rec = paint(s)
      for (const e of rec.log) if (e.kind === 'call') for (const a of e.args) if (typeof a === 'number') expect(Number.isFinite(a)).toBe(true)
    }
  })

  it('works with no repos', () => {
    const s = scene(profile({ repos: [] }))
    expect(s.layout.rows).toEqual([])
    expect(htopLabelOrder(s.layout).length).toBe(0)
    expect(() => paint(s)).not.toThrow()
    const y = (VIEW.top + horizonY(VIEW)) / 2
    expect(hitHtop(s.layout, s.g, s.camera, VIEW, 400, y, NONE, null)).toEqual(axisHover(s.layout, s.camera, VIEW, 400, y))
  })
})

describe('htop: the recordings', () => {
  let kepano: ProfileData
  let gaearon: ProfileData
  beforeAll(async () => {
    ;[kepano, gaearon] = await Promise.all([
      fetchProfileGraphql('kepano', { token: 'test-token-not-real', fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW }),
      fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW }),
    ])
  })

  it('lays out kepano the same in any order, every row hit at its anchor, no name painted', () => {
    const s = scene(kepano, KEPANO_NOW)
    expect(layoutHtop(buildLifeTimeline({ ...kepano, repos: shuffled(kepano.repos, 5) }, KEPANO_NOW), 'graphql')).toEqual(s.layout)
    expect(expectHitAtAnchors(s)).toBe(s.layout.rows.length)
    const names = s.timeline.lanes.map((l) => l.repo.split('/')[1].toLowerCase()).filter((n) => !/^\d+$/.test(n) && n !== 'today' && n !== 'pid')
    for (const t of paint(s).texts()) expect(names).not.toContain(t.toLowerCase())
  })

  it("keeps gaearon's 301 repos hittable", () => {
    const s = scene(gaearon, GAEARON_NOW)
    expect(s.layout.rows.length).toBeGreaterThan(300)
    expect(layoutHtop(buildLifeTimeline({ ...gaearon, repos: shuffled(gaearon.repos, 9) }, GAEARON_NOW), 'rest')).toEqual(s.layout)
    expect(expectHitAtAnchors(s)).toBe(s.layout.rows.length)
    expect(expectHitAtAnchors(s, dayAt(s.timeline.clock, 0.5))).toBeGreaterThan(0)
  })
})
