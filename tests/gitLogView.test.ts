/**
 * The git log view: its layout (lanes packed in lane order, the same for the profile in any order,
 * hashes from no name, commits per tier), its geometry and hit test (every branch hit at its label
 * anchor, hidden and unreached ones skipped), its painter on a recording context (only the console
 * palette, no repo name, nothing past the time-lapse's day, hidden branches draw nothing), hundreds
 * of repos, and zero.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { fetchProfileGraphql } from '../src/api/profileGraphql'
import { fetchProfileRest } from '../src/api/profile'
import { THEMES, getTheme, type Theme } from '../src/theme/themes'
import { contrastRatio } from '../src/theme/colour'
import { GITLOG_PALETTE } from '../src/theme/console/gitlog'
import { buildLifeTimeline, dayNumber, type LifeTimeline } from '../src/profile/timeline'
import { fitLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { lifeInk } from '../src/profile/lifeInk'
import { axisHover } from '../src/profile/lifeView'
import { repoKey } from '../src/profile/privacy'
import type { LifeCamera, LifeViewport } from '../src/profile/lifeTypes'
import { branchHash, layoutGitLog, type GitLogLayout } from '../src/profile/gitLogLayout'
import { GITLOG_MAX_PITCH, type GitLogGeom } from '../src/profile/gitLogGeometry'
import { hitGitLog } from '../src/profile/gitLogHit'
import { HASH_FONT, gitLogAnchor, gitLogKeepOut, gitLogLabelOrder, paintGitLog, type GitLogPaintInput } from '../src/profile/gitLogPaint'
import { GITLOG_VIEW } from '../src/profile/gitLogView'
import type { ProfileData, ProfileRepo } from '../src/types'
import { prolific } from './helpers/lifeLinesScale'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './helpers/profileReplay'
import { recordingCtx, type RecordingCtx } from './helpers/recordingCtx'
import { GITLOG_PALETTE as G_PALETTE } from '../src/theme/console/gitlog'
import type { GitBranch } from '../src/profile/gitLogLayout'
import type { CtxEntry } from './helpers/recordingCtx'

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
    milestones: [
      { kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' },
      { kind: 'first-pr', date: iso('2022-05-01'), label: 'first pull request', repo: 'someone/big-project' },
    ],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    landed: [],
    fallback: null,
    ...over,
  }
}

/** One of each kind of branch: busy, private, archived, forked, visited, no counted commits, daily. */
const REPOS: ProfileRepo[] = [
  repo('Me/alpha', { createdAt: iso('2019-02-01'), stars: 120, activity: [...monthly('2019-02', '2020-06', 9), ...monthly('2021-06', '2021-09', 1)] }),
  repo('Me/Secret-Plans', { createdAt: iso('2020-03-01'), language: 'Rust', stars: 30, isPrivate: true, activity: monthly('2020-03', '2024-05', 3) }),
  repo('Me/old-thing', { createdAt: iso('2019-06-01'), language: 'JavaScript', stars: 15, isArchived: true, activity: monthly('2019-06', '2019-12') }),
  repo('Me/forked-lib', { createdAt: iso('2021-01-10'), language: 'Go', isFork: true, activity: monthly('2021-01', '2021-03', 1) }),
  repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-05-01'), isOwn: false, language: null, activity: monthly('2022-05', '2023-02', 5) }),
  repo('Me/empty-uncounted', { createdAt: iso('2023-08-01'), lastActiveAt: iso('2024-02-01'), stars: 5 }),
  repo('Me/daily-grind', {
    createdAt: iso('2023-01-01'),
    language: 'Python',
    activity: Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10), commits: 1 })),
  }),
]
const NAMES = ['alpha', 'secret', 'plans', 'old-thing', 'forked-lib', 'big-project', 'empty-uncounted', 'daily-grind', 'someone']

const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

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
  layout: GitLogLayout
  camera: LifeCamera
  g: GitLogGeom
  input: GitLogPaintInput
}

function scene(p: ProfileData = profile({ repos: REPOS }), now = NOW, theme: Theme = getTheme('obsidian'), camera?: LifeCamera, view = VIEW): Scene {
  const timeline = buildLifeTimeline(p, now)
  const layout = GITLOG_VIEW.layout(timeline, p.source)
  const cam = camera ?? fitLifeCamera(layout.days, view)
  const g = GITLOG_VIEW.scene.geoms(layout, cam, view)
  const input: GitLogPaintInput = {
    layout,
    timeline,
    geoms: g,
    camera: cam,
    view,
    ink: lifeInk(theme),
    colourOf: () => 'not-a-console-colour',
    hidden: new Set(),
    hover: null,
    selected: null,
    at: null,
  }
  return { timeline, layout, camera: cam, g, input }
}

function painted(s: Scene, over: Partial<GitLogPaintInput> = {}): RecordingCtx {
  const rec = recordingCtx(s.input.view.width * 2, s.input.view.height * 2)
  paintGitLog(rec.ctx, { ...s.input, ...over })
  return rec
}

/** The layout without its Map, for toEqual. */
function plain(layout: GitLogLayout) {
  const { byKey, slots, ...rest } = layout
  return { ...rest, byKey: [...byKey], slots: [...slots] }
}

const anchorOf = (s: Scene, i: number) => {
  const out = new Float32Array(3)
  expect(gitLogAnchor(s.layout, s.g, i, s.input.at, out)).toBe(true)
  return out
}

describe('git log palette', () => {
  it('keeps every colour readable on its background', () => {
    const P = GITLOG_PALETTE
    for (const colour of [P.fg, P.comment, P.plain, P.tag, P.hover, P.selected, ...P.lanes]) expect(contrastRatio(colour, P.bg), colour).toBeGreaterThanOrEqual(4.5)
    expect(P.lanes).toHaveLength(5)
  })
})

describe('git log layout', () => {
  const s = scene()

  it('is the view registered as gitlog', () => {
    expect(GITLOG_VIEW.id).toBe('gitlog')
    expect(GITLOG_VIEW.title).toBe('git log')
    expect(GITLOG_VIEW.scene.items(s.layout)).toBe(s.layout.branches)
  })

  it('puts every branch on the shared axis, forked at its root, ending at its last activity', () => {
    const { layout, timeline } = s
    expect(layout.branches).toHaveLength(REPOS.length)
    for (const b of layout.branches) {
      const lane = timeline.lanes[b.lane]
      expect(b.key).toBe(repoKey(lane.repo))
      expect(layout.byKey.get(b.key)).toBe(layout.branches.indexOf(b))
      expect(b.x).toBe(lane.rootDay - timeline.startDay + 0.5)
      expect(b.x0).toBeLessThanOrEqual(b.x)
      expect(b.x1).toBe(dayNumber(lane.lastActive) + 1 - timeline.startDay)
      expect(b.x1).toBeLessThanOrEqual(layout.days)
      expect(b.hash).toMatch(/^[0-9a-f]{7}$/)
      expect(b.commits.length).toBeGreaterThan(0)
      for (let j = 0; j < b.commits.length; j++) {
        expect(b.commits[j] > b.x0 && b.commits[j] < b.x1).toBe(true)
        if (j > 0) expect(b.commits[j]).toBeGreaterThan(b.commits[j - 1])
      }
    }
    expect(new Set(layout.branches.map((b) => b.hash)).size).toBe(layout.branches.length)
    // a daily repo has a commit per day; one GitHub counted nothing to, one at its root and its last push
    const daily = layout.branches[layout.byKey.get('me/daily-grind')!]
    expect(daily.commits.length).toBe(120)
    const uncounted = layout.branches[layout.byKey.get('me/empty-uncounted')!]
    expect([...uncounted.commits]).toEqual([uncounted.x, uncounted.x1 - 0.5])
    // no two branches on a lane overlap
    for (const a of layout.branches)
      for (const b of layout.branches) if (a !== b && a.track === b.track) expect(a.x1 <= b.x0 || b.x1 <= a.x0).toBe(true)
    // language slots by first lane: the first language yellow
    expect(layout.slots.get(timeline.lanes.find((l) => l.language)!.language!)).toBe(0)
  })

  it('gives the same layout for the profile in any order', () => {
    for (const seed of [1, 2, 3, 4]) {
      const repos = shuffled(REPOS, seed).map((r, i) => ({ ...r, activity: shuffled(r.activity, seed * 31 + i) }))
      const again = layoutGitLog(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
      expect(plain(again)).toEqual(plain(s.layout))
    }
  })

  it('takes hashes and lanes from no name', () => {
    // every repo renamed: the same lanes, tracks and hashes in the same order
    const renamed = REPOS.map((r, i) => ({ ...r, nameWithOwner: `${r.isOwn ? 'Me' : 'other'}/zz-${String.fromCharCode(122 - i)}` }))
    const other = layoutGitLog(buildLifeTimeline(profile({ repos: renamed, milestones: [] }), NOW), 'graphql')
    const base = layoutGitLog(buildLifeTimeline(profile({ repos: REPOS, milestones: [] }), NOW), 'graphql')
    const strip = (l: GitLogLayout) => l.branches.map(({ key: _key, ...b }) => b)
    expect(strip(other)).toEqual(strip(base))
    expect(branchHash(3, 18000, 17990, 18100, 2)).toBe(branchHash(3, 18000, 17990, 18100, 2))
    expect(branchHash(3, 18000, 17990, 18100, 2)).not.toBe(branchHash(4, 18000, 17990, 18100, 2))
  })

  it('orders labels heaviest first and keeps them off the trunk', () => {
    const order = gitLogLabelOrder(s.layout)
    expect(order).toHaveLength(s.layout.branches.length)
    for (let i = 1; i < order.length; i++) expect(s.layout.branches[order[i - 1]].weight).toBeGreaterThanOrEqual(s.layout.branches[order[i]].weight)
    const box = gitLogKeepOut(s.layout, VIEW)
    expect(box[1]).toBeLessThan(horizonY(VIEW))
    expect(box[3]).toBe(VIEW.height)
  })
})

describe('git log hit test', () => {
  it('hits every branch at its label anchor, and the axis elsewhere', () => {
    const s = scene()
    const none = new Set<string>()
    s.layout.branches.forEach((b, i) => {
      const [x, y] = anchorOf(s, i)
      expect(hitGitLog(s.layout, s.g, s.camera, VIEW, x, y, none, null)).toEqual({ kind: 'repo', key: b.key })
    })
    // on the trunk, on a milestone: the axis's answer
    const m = s.layout.milestones[0]
    const mx = s.camera.tx + m.x * s.camera.k
    const y = horizonY(VIEW)
    expect(hitGitLog(s.layout, s.g, s.camera, VIEW, mx, y, none, null)).toEqual(axisHover(s.layout, s.camera, VIEW, mx, y))
    expect(hitGitLog(s.layout, s.g, s.camera, VIEW, -5, 300, none, null)).toBeNull()
  })

  it('skips hidden and unreached branches', () => {
    const s = scene()
    const b = s.layout.branches[0]
    const [x, y] = anchorOf(s, 0)
    expect(hitGitLog(s.layout, s.g, s.camera, VIEW, x, y, new Set([b.key]), null)).not.toEqual({ kind: 'repo', key: b.key })
    const before = b.startDay - 1
    expect(hitGitLog(s.layout, s.g, s.camera, VIEW, x, y, new Set(), before)).not.toEqual({ kind: 'repo', key: b.key })
  })
})

describe('git log painter', () => {
  const palette = new Set<unknown>([...Object.values(GITLOG_PALETTE).flat()])

  it('draws in the console palette only, whatever the theme', () => {
    for (const theme of THEMES) {
      const rec = painted(scene(undefined, NOW, theme))
      const colours = rec.log.flatMap((e) => (e.kind === 'set' && (e.name === 'fillStyle' || e.name === 'strokeStyle') ? [e.value] : []))
      for (const c of colours) expect(palette.has(c), `${theme.id}: ${String(c)}`).toBe(true)
      expect(rec.calls('fillRect')[0].style.fillStyle).toBe(GITLOG_PALETTE.bg)
      for (const call of rec.log) if (call.kind === 'call') for (const a of call.args) if (typeof a === 'number') expect(Number.isFinite(a)).toBe(true)
    }
  })

  it('draws no repo name: only years, today and hashes', () => {
    const s = scene(undefined, NOW, getTheme('obsidian'), zoomLifeCamera(fitLifeCamera(scene().layout.days, VIEW), 6, 640, scene().layout.days, VIEW))
    for (const rec of [painted(scene()), painted(s), painted(s, { selected: s.layout.branches[1].key, hover: { kind: 'repo', key: s.layout.branches[2].key } })]) {
      for (const text of rec.texts()) {
        expect(text).toMatch(/^(\d{4}|today|[0-9a-f]{7})$/)
        for (const name of NAMES) expect(text.toLowerCase()).not.toContain(name)
      }
    }
  })

  it('draws hashes beside the forks once zoomed in, in the hash font', () => {
    const fit = scene()
    const s = scene(undefined, NOW, getTheme('obsidian'), zoomLifeCamera(fit.camera, 4, 200, fit.layout.days, VIEW))
    const rec = painted(s)
    const hashes = rec.calls('fillText').filter((c) => /^[0-9a-f]{7}$/.test(String(c.args[0])))
    expect(hashes.length).toBeGreaterThan(0)
    for (const h of hashes) {
      expect(h.style.font).toBe(HASH_FONT)
      expect(s.layout.branches.some((b) => b.hash === h.args[0])).toBe(true)
    }
  })

  it('draws nothing of a hidden branch', () => {
    const s = scene(profile({ repos: [REPOS[0]] }))
    const shown = painted(s)
    const hidden = painted(s, { hidden: new Set([s.layout.branches[0].key]) })
    const y = s.g.laneY[0]
    expect(shown.calls('arc').some((c) => c.args[1] === y)).toBe(true)
    expect(hidden.calls('arc').some((c) => c.args[1] === y)).toBe(false)
    expect(hidden.calls('lineTo').some((c) => c.args[1] === y)).toBe(false)
  })

  it('draws nothing past the time-lapse day, and no branch not yet reached', () => {
    const s = scene()
    for (const key of ['2019-09-15', '2021-02-01', '2023-03-01']) {
      const at = dayNumber(key) + 0.5
      const rec = painted(s, { at })
      const limit = s.camera.tx + (at - s.layout.startDay + 0.5) * s.camera.k + 1
      const plotBottom = horizonY(VIEW) - 1
      for (const name of ['arc', 'lineTo', 'moveTo']) {
        for (const c of rec.calls(name)) {
          const [x, y] = c.args as number[]
          // the lanes (the trunk's dots and tags and the day guide aside), with a commit's or terminal's radius
          if (y < plotBottom - 0.5 && name !== 'moveTo') expect(x, `${name} at ${key}`).toBeLessThanOrEqual(limit + s.g.dotR + 2)
        }
      }
      // the unreached branches add nothing: the same as hiding them
      const unreached = new Set(s.layout.branches.filter((b) => b.startDay > at).map((b) => b.key))
      expect(unreached.size).toBeGreaterThan(0)
      expect(painted(s, { at, hidden: unreached }).log).toEqual(rec.log)
    }
  })

  it('anchors labels at the forks', () => {
    const s = scene()
    s.layout.branches.forEach((b, i) => {
      const [x, y] = anchorOf(s, i)
      expect(x).toBeCloseTo(s.camera.tx + b.x * s.camera.k, 3)
      expect(y).toBe(s.g.laneY[b.track])
    })
  })
})

describe('git log at scale', () => {
  for (const n of [300, 500]) {
    for (const source of ['graphql', 'rest'] as const) {
      it(`packs ${n} repos ${source === 'graphql' ? 'with' : 'without'} a token into readable lanes`, () => {
        const s = scene(prolific(n, source), Date.parse('2024-06-15T19:00:00Z'))
        expect(s.layout.branches).toHaveLength(n)
        expect(s.layout.tracks).toBeLessThanOrEqual(n / 5)
        expect(s.g.pitch).toBeGreaterThanOrEqual(5)
        expect(s.g.pitch).toBeLessThanOrEqual(GITLOG_MAX_PITCH)
        const rec = painted(s)
        for (const text of rec.texts()) expect(text).not.toMatch(/r\d+/)
        s.layout.branches.forEach((b, i) => {
          const [x, y] = anchorOf(s, i)
          expect(hitGitLog(s.layout, s.g, s.camera, VIEW, x, y, new Set(), null)).toEqual({ kind: 'repo', key: b.key })
        })
      })
    }
  }
})

describe('git log with zero repos', () => {
  it('lays out, paints and hits an empty life', () => {
    const s = scene(profile({ repos: [] }))
    expect(s.layout.branches).toEqual([])
    expect(s.layout.tracks).toBe(0)
    expect(s.g.laneY).toHaveLength(0)
    const rec = painted(s)
    expect(rec.calls('fillRect').length).toBeGreaterThan(0)
    expect(gitLogLabelOrder(s.layout)).toHaveLength(0)
    expect(gitLogAnchor(s.layout, s.g, 0, null, new Float32Array(3))).toBe(false)
    const x = s.camera.tx + 10 * s.camera.k
    expect(hitGitLog(s.layout, s.g, s.camera, VIEW, x, 300, new Set(), null)).toEqual(axisHover(s.layout, s.camera, VIEW, x, 300))
  })
})

describe('git log: the recordings', () => {
  let kepano: ProfileData
  let gaearon: ProfileData
  beforeAll(async () => {
    ;[kepano, gaearon] = await Promise.all([
      fetchProfileGraphql('kepano', { token: 'test-token-not-real', fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW }),
      fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW }),
    ])
  })

  for (const which of ['kepano', 'gaearon'] as const) {
    it(`lays out, paints and hits ${which} the same in any order, naming nothing`, () => {
      const p = which === 'kepano' ? kepano : gaearon
      const now = which === 'kepano' ? KEPANO_NOW : GAEARON_NOW
      const s = scene(p, now)
      expect(plain(layoutGitLog(buildLifeTimeline({ ...p, repos: shuffled(p.repos, 7) }, now), p.source))).toEqual(plain(s.layout))
      expect(s.g.pitch).toBeGreaterThanOrEqual(4)
      const names = p.repos.flatMap((r) => r.nameWithOwner.toLowerCase().split('/')).filter((part) => part.length > 3)
      const zoomed = scene(p, now, getTheme('obsidian'), zoomLifeCamera(s.camera, 8, 640, s.layout.days, VIEW))
      for (const rec of [painted(s), painted(zoomed)]) {
        for (const text of rec.texts()) {
          expect(text).toMatch(/^(\d{4}|today|[0-9a-f]{7})$/)
          for (const name of names) expect(text.toLowerCase()).not.toContain(name)
        }
      }
      s.layout.branches.forEach((b, i) => {
        const [x, y] = anchorOf(s, i)
        expect(hitGitLog(s.layout, s.g, s.camera, VIEW, x, y, new Set(), null)).toEqual({ kind: 'repo', key: b.key })
      })
    })
  }
})

// ---------- landed pull requests ----------

describe('landed pull requests on the git log', () => {
  const landedProfile = () => profile({ repos: REPOS, landed: [{ day: '2023-01-15', repo: 'someone/big-project' }, { day: '2022-08-01', repo: 'someone/big-project' }] })

  /** The merge dots on branch b: arcs on its lane a pad larger than a commit, filled in the tag colour. */
  function dotsOn(rec: RecordingCtx, s: Scene, b: GitBranch): number[] {
    const y = s.g.laneY[b.track]
    const out: number[] = []
    rec.log.forEach((e, i) => {
      if (e.kind !== 'call' || e.name !== 'arc' || e.args[1] !== y || e.args[2] !== s.g.dotR + 1) return
      const next = rec.log.slice(i + 1).find((n): n is Extract<CtxEntry, { kind: 'call' }> => n.kind === 'call' && (n.name === 'fill' || n.name === 'stroke'))
      if (next?.name === 'fill' && next.style.fillStyle === G_PALETTE.tag) out.push(e.args[0] as number)
    })
    return out
  }

  it('draws a merge dot in the tag colour on each landed day of a branch once reached, never on a hidden one', () => {
    const s = scene(landedProfile())
    const i = s.layout.byKey.get('someone/big-project')!
    const b = s.layout.branches[i]
    expect([...b.landed]).toEqual([dayNumber('2022-08-01') - s.layout.startDay + 0.5, dayNumber('2023-01-15') - s.layout.startDay + 0.5])
    const sx = (x: number) => s.camera.tx + x * s.camera.k
    expect(dotsOn(painted(s), s, b)).toEqual([...b.landed].map(sx))
    for (const other of s.layout.branches) if (other !== b && other.track !== b.track) expect(dotsOn(painted(s), s, other)).toEqual([])
    expect(dotsOn(painted(s, { at: b.startDay - 1 }), s, b)).toEqual([])
    expect(dotsOn(painted(s, { at: dayNumber('2022-12-01') }), s, b)).toEqual([sx(b.landed[0])])
    expect(dotsOn(painted(s, { at: dayNumber('2023-01-15') }), s, b)).toEqual([...b.landed].map(sx))
    expect(dotsOn(painted(s, { hidden: new Set([b.key]) }), s, b)).toEqual([])
  })
})
