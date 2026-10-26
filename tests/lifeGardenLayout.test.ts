import { describe, expect, it } from 'vitest'
import { LIFE_ROWS, MAX_LEAVES_PER_PLANT, bloomOfStars, layoutLifeGarden } from '../src/profile/lifeGardenLayout'
import { ROW_LIFT_PX, ROW_SHRINK, horizonY, leafGeom, plantGeom, pointAt, rowScale, subQuad, tangentAt } from '../src/profile/lifeGeometry'
import { buildLifeTimeline, dayKey, dayNumber, progressAtDay, type LifeTimeline } from '../src/profile/timeline'
import type { LifeCamera, LifePlant, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const TODAY = '2024-06-15'

/** A timestamp on a day: 20:00 UTC is 12:00 or 13:00 the same day in Los Angeles. */
const iso = (day: string) => `${day}T20:00:00Z`
const plus = (day: string, n: number) => dayKey(dayNumber(day) + n)

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
    fallback: null,
    ...over,
  }
}

/** One activity entry per day given, with that many commits. */
const commitsOn = (entries: Record<string, number>) => Object.entries(entries).map(([date, commits]) => ({ date, commits }))

/** Every day from..to (inclusive), with count(day) contributions. */
function calendar(from: string, to: string, count: (day: string) => number): { date: string; count: number }[] {
  const days = []
  for (let n = dayNumber(from); n <= dayNumber(to); n++) days.push({ date: dayKey(n), count: count(dayKey(n)) })
  return days
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

/** A token profile with a bit of everything: busy, quiet, archived, forked, starred and visited repos. */
const RICH = profile({
  repos: [
    repo('busy', { createdAt: iso('2019-02-01'), stars: 900, language: 'Go', activity: commitsOn({ '2019-02-01': 20, '2019-02-10': 30, '2020-06-01': 50 }) }),
    repo('quiet', { createdAt: iso('2019-03-01'), activity: commitsOn({ '2019-03-02': 1 }) }),
    repo('old', { createdAt: iso('2019-04-01'), isArchived: true, stars: 40, activity: commitsOn({ '2019-04-01': 4, '2019-04-20': 2 }) }),
    repo('copy', { createdAt: iso('2019-05-01'), isFork: true, stars: 3 }),
    { ...repo('theirs', { createdAt: iso('2015-01-01'), isOwn: false, language: 'Rust', activity: commitsOn({ '2021-01-05': 7 }) }), nameWithOwner: 'them/Theirs', firstActiveAt: iso('2021-01-05') },
    repo('Upper', { createdAt: iso('2022-08-01'), language: null, activity: commitsOn({ '2022-08-01': 2 }) }),
  ],
  days: calendar('2019-01-01', TODAY, (day) => (day === '2019-02-10' ? 30 : 0)),
  milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
})

const richTimeline = buildLifeTimeline(RICH, NOW)
const rich = layoutLifeGarden(richTimeline, 'graphql')
const plantOf = (layout: ReturnType<typeof layoutLifeGarden>, name: string) => layout.plants[layout.byKey.get(name.toLowerCase())!]

describe('life garden layout: placement', () => {
  it('is deterministic: the same timeline, or the same repos in any order, give the same layout', () => {
    expect(layoutLifeGarden(richTimeline, 'graphql')).toEqual(rich)
    for (const seed of [1, 2, 3, 42]) {
      const timeline = buildLifeTimeline({ ...RICH, repos: shuffled(RICH.repos, seed) }, NOW)
      expect(layoutLifeGarden(timeline, 'graphql'), `seed ${seed}`).toEqual(rich)
    }
  })

  it('plants one per lane, keyed by the lowercased name, rooted in the middle of its root day', () => {
    expect(rich.plants).toHaveLength(richTimeline.lanes.length)
    for (const plant of rich.plants) {
      const lane = richTimeline.lanes[plant.lane]
      expect(plant.key).toBe(lane.repo.toLowerCase())
      expect(plant.x).toBe(lane.rootDay - richTimeline.startDay + 0.5)
      expect(plant.language).toBe(lane.language)
      expect([plant.startDay, plant.endDay]).toEqual([lane.startDay, lane.endDay])
    }
    expect(plantOf(rich, 'them/theirs').key).toBe('them/theirs')
    expect(rich.days).toBe(richTimeline.todayDay - richTimeline.startDay + 1)
    expect([rich.startDay, rich.todayDay, rich.rows]).toEqual([richTimeline.startDay, richTimeline.todayDay, LIFE_ROWS])
  })

  it('paints the back row first, then by x, then in lane order, and byKey indexes that order', () => {
    const order = rich.plants.map((p) => [p.row, p.x, p.lane])
    const sorted = [...order].sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2])
    expect(order).toEqual(sorted)
    rich.plants.forEach((plant, i) => expect(rich.byKey.get(plant.key)).toBe(i))
    expect(rich.byKey.size).toBe(rich.plants.length)
  })

  it(`packs roots closer than the gap into up to ${LIFE_ROWS} rows, then reuses the row rooted longest ago`, () => {
    // five repos a day apart, then one far away
    const repos = [0, 1, 2, 3, 4].map((n) => repo(`r${n}`, { createdAt: iso(plus('2020-01-01', n)) }))
    repos.push(repo('far', { createdAt: iso('2023-01-01') }))
    const layout = layoutLifeGarden(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    expect(['r0', 'r1', 'r2', 'r3', 'r4', 'far'].map((n) => plantOf(layout, `me/${n}`).row)).toEqual([0, 1, 2, 3, 0, 0])
    for (const plant of layout.plants) expect(plant.row).toBeLessThan(LIFE_ROWS)
  })

  it('keeps sparse roots in the front row', () => {
    const repos = ['2019-02-01', '2020-02-01', '2021-02-01', '2022-02-01'].map((day, i) => repo(`r${i}`, { createdAt: iso(day) }))
    const layout = layoutLifeGarden(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    expect(layout.plants.map((p) => p.row)).toEqual([0, 0, 0, 0])
  })

  it('places milestones inside the life, with the longest streak reaching to its last day', () => {
    const p = profile({
      repos: [repo('a', { createdAt: iso('2020-01-01'), activity: commitsOn({ '2020-01-01': 1 }) })],
      days: calendar('2020-01-01', TODAY, (day) => (day >= '2021-03-01' && day <= '2021-03-05' ? 2 : 0)),
      milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
    })
    const timeline = buildLifeTimeline(p, NOW)
    const layout = layoutLifeGarden(timeline, 'graphql')
    expect(layout.milestones.map((m) => m.index)).toEqual(timeline.milestones.map((_, i) => i))
    for (const m of layout.milestones) {
      expect(m.x).toBeGreaterThanOrEqual(0)
      expect(m.x).toBeLessThanOrEqual(layout.days)
      expect(m.kind).toBe(timeline.milestones[m.index].kind)
      expect(m.x).toBe(dayNumber(timeline.milestones[m.index].day) - timeline.startDay + 0.5)
    }
    const streak = layout.milestones.find((m) => m.kind === 'longest-streak')!
    expect(streak.x).toBe(dayNumber('2021-03-01') - timeline.startDay + 0.5)
    expect(streak.x1).toBe(dayNumber('2021-03-05') - timeline.startDay + 0.5)
    for (const m of layout.milestones) if (m.kind !== 'longest-streak') expect(m.x1).toBeNull()
  })

  it('bands years and language eras inside the life, and never past today', () => {
    expect(rich.years.map((y) => y.year)).toEqual(richTimeline.eras.map((e) => e.year))
    expect(rich.years[0].x0).toBe(0)
    expect(rich.years[rich.years.length - 1].x1).toBe(rich.days)
    for (let i = 1; i < rich.years.length; i++) expect(rich.years[i].x0).toBe(rich.years[i - 1].x1)
    expect(rich.languages.map((l) => l.language)).toEqual(richTimeline.languageEras.map((e) => e.language))
    for (const band of [...rich.years, ...rich.languages]) {
      expect(band.x0).toBeGreaterThanOrEqual(0)
      expect(band.x1).toBeLessThanOrEqual(rich.days)
      expect(band.x1).toBeGreaterThan(band.x0)
    }
  })

  it('sows each plant on the time-lapse at its first day, so roots without backdating come up in lane order', () => {
    for (const plant of rich.plants) expect(plant.appearAt).toBe(progressAtDay(richTimeline.clock, plant.startDay))
    const inLaneOrder = [...rich.plants].sort((a, b) => a.lane - b.lane).map((p) => p.appearAt)
    for (let i = 1; i < inLaneOrder.length; i++) expect(inLaneOrder[i]).toBeGreaterThanOrEqual(inLaneOrder[i - 1])
    for (const at of inLaneOrder) expect(at >= 0 && at <= 1).toBe(true)
  })

  it('leans plants near either end of the life inward', () => {
    const repos = [0, 1, 2, 3, 4, 5].map((n) => repo(`first${n}`, { createdAt: iso(plus('2019-01-10', 30 * n)) }))
    for (let n = 0; n < 6; n++) repos.push(repo(`last${n}`, { createdAt: iso(plus(TODAY, -30 * n)) }))
    const layout = layoutLifeGarden(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    for (let n = 0; n < 6; n++) {
      expect(plantOf(layout, `me/first${n}`).lean).toBeGreaterThanOrEqual(0)
      expect(plantOf(layout, `me/last${n}`).lean).toBeLessThanOrEqual(0)
    }
  })

  it('seeds shapes from days and language, never the name, and tells look-alike repos apart', () => {
    const renamed = buildLifeTimeline({ ...RICH, repos: RICH.repos.map((r) => (r.nameWithOwner === 'me/quiet' ? { ...r, nameWithOwner: 'me/Secret' } : r)) }, NOW)
    const a = plantOf(rich, 'me/quiet')
    const b = plantOf(layoutLifeGarden(renamed, 'graphql'), 'me/secret')
    expect([b.bend, b.lean, b.turn]).toEqual([a.bend, a.lean, a.turn])
    const twins = layoutLifeGarden(buildLifeTimeline(profile({ repos: [repo('x'), repo('y')] }), NOW), 'graphql')
    expect(twins.plants[0].turn).not.toBe(twins.plants[1].turn)
    for (const plant of rich.plants) {
      expect(plant.turn >= 0 && plant.turn < 1).toBe(true)
      expect(plant.bend >= -1 && plant.bend < 1).toBe(true)
      expect(plant.lean >= -1 && plant.lean < 1).toBe(true)
    }
  })
})

describe('life garden layout: plants', () => {
  it('grows taller with more counted commits on a token profile', () => {
    const busy = plantOf(rich, 'me/busy')
    const old = plantOf(rich, 'me/old')
    const quiet = plantOf(rich, 'me/quiet')
    expect(busy.height).toBe(1)
    expect(busy.height).toBeGreaterThan(old.height)
    expect(old.height).toBeGreaterThan(quiet.height)
    expect(quiet.height).toBeGreaterThanOrEqual(0.06)
    for (const plant of rich.plants) expect(plant.reach).toBeCloseTo(1 + 15 * plant.height, 12)
  })

  it('grows taller with more active days without a token', () => {
    const p = profile({
      source: 'rest',
      repos: [
        repo('long', { createdAt: iso('2019-01-01'), lastActiveAt: iso('2021-01-01') }),
        repo('short', { createdAt: iso('2020-01-01'), lastActiveAt: iso('2020-02-01') }),
        repo('blink', { createdAt: iso('2022-01-01') }),
      ],
    })
    const layout = layoutLifeGarden(buildLifeTimeline(p, NOW), 'rest')
    const [long, short, blink] = ['long', 'short', 'blink'].map((n) => plantOf(layout, `me/${n}`))
    expect(long.height).toBe(1)
    expect(long.height).toBeGreaterThan(short.height)
    expect(short.height).toBeGreaterThan(blink.height)
    for (const plant of layout.plants) {
      expect(plant.seedling).toBe(false)
      expect(plant.leaves).toHaveLength(1)
    }
  })

  it('draws a token profile repo GitHub counted no commits to as a seedling: short, leafless, its stars kept', () => {
    const copy = plantOf(rich, 'me/copy')
    expect(copy).toMatchObject({ seedling: true, height: 0.04, leaves: [], cutting: true })
    // a seedling with stars still blooms (drawn smaller), so the star signal stays
    expect(copy.tip).toBe('bloom')
    expect(copy.bloom).toBe(bloomOfStars(3))
    expect(copy.bloom).toBeGreaterThan(0)
    const bare = plantOf(layoutLifeGarden(buildLifeTimeline(profile({ repos: [repo('bare')] }), NOW), 'graphql'), 'me/bare')
    expect(bare).toMatchObject({ seedling: true, tip: 'bud', bloom: 0 })
  })

  it('heads a starred repo with a bloom sized by stars on a log scale, and an unstarred one with a bud', () => {
    expect(plantOf(rich, 'me/busy')).toMatchObject({ tip: 'bloom', bloom: Math.log10(901) / 4 })
    expect(plantOf(rich, 'me/quiet')).toMatchObject({ tip: 'bud', bloom: 0 })
    expect(bloomOfStars(0)).toBe(0)
    expect(bloomOfStars(9)).toBeCloseTo(0.25, 12)
    expect(bloomOfStars(9_999)).toBeCloseTo(1, 12)
    expect(bloomOfStars(1_000_000)).toBe(1)
  })

  it('draws an archived repo dry with a wilted head that keeps its star size', () => {
    const old = plantOf(rich, 'me/old')
    expect(old).toMatchObject({ dry: true, tip: 'wilted', bloom: bloomOfStars(40) })
    expect(old.bloom).toBeGreaterThan(0)
    const plain = plantOf(layoutLifeGarden(buildLifeTimeline(profile({ repos: [repo('gone', { isArchived: true })] }), NOW), 'graphql'), 'me/gone')
    expect(plain).toMatchObject({ dry: true, tip: 'wilted', bloom: 0 })
  })

  it('flags forks as cuttings, repos they only contributed to as visiting, and backdated history', () => {
    expect(plantOf(rich, 'me/copy').cutting).toBe(true)
    expect(plantOf(rich, 'me/busy').cutting).toBe(false)
    expect(plantOf(rich, 'them/theirs').visiting).toBe(true)
    expect(plantOf(rich, 'me/busy').visiting).toBe(false)
    for (const plant of rich.plants) expect(plant.backDays).toBe(0)
    // commits dated 40 days before the repo's creation
    const p = profile({ repos: [repo('imported', { createdAt: iso('2021-03-01'), activity: commitsOn({ [plus('2021-03-01', -40)]: 3, '2021-03-01': 1 }) })] })
    const timeline = buildLifeTimeline(p, NOW)
    const imported = layoutLifeGarden(timeline, 'graphql').plants[0]
    expect(imported.backDays).toBe(40)
    expect(imported.x).toBe(dayNumber('2021-03-01') - timeline.startDay + 0.5)
    expect(imported.startDay).toBe(dayNumber('2021-03-01') - 40)
  })

  it('cuts the stem into the spans, end to end from 0 to 1 by stem time', () => {
    for (const plant of rich.plants) {
      const lane = richTimeline.lanes[plant.lane]
      expect(plant.parts.map((p) => p.kind)).toEqual(lane.spans.map((s) => s.kind))
      expect(plant.parts[0].t0).toBe(0)
      expect(plant.parts[plant.parts.length - 1].t1).toBeCloseTo(1, 12)
      for (let i = 1; i < plant.parts.length; i++) expect(plant.parts[i].t0).toBe(plant.parts[i - 1].t1)
    }
  })

  it('puts a leaf in the middle of each active span, sides alternating, sized against the heaviest span', () => {
    const busy = plantOf(rich, 'me/busy')
    const lane = richTimeline.lanes[busy.lane]
    const active = lane.spans.filter((s) => s.kind === 'active')
    expect(busy.leaves).toHaveLength(active.length)
    busy.leaves.forEach((leaf, i) => {
      const span = active[i]
      expect(leaf.fromDay).toBe(span.fromDay)
      expect(leaf.side).toBe(i % 2 === 0 ? 1 : -1)
      expect(leaf.t).toBeCloseTo(((span.fromDay + span.toDay + 1) / 2 - lane.startDay) / (lane.endDay - lane.startDay + 1), 12)
    })
    let largest = 0
    for (const plant of rich.plants) {
      for (const leaf of plant.leaves) {
        expect(leaf.t > 0 && leaf.t < 1).toBe(true)
        expect(leaf.size >= 0 && leaf.size <= 1).toBe(true)
        largest = Math.max(largest, leaf.size)
      }
    }
    expect(largest).toBe(1)
  })

  it(`keeps the ${MAX_LEAVES_PER_PLANT} heaviest leaves of a plant with more active spans, in time order`, () => {
    // 20 active spans, 40 days apart, with 1..20 commits
    const activity: Record<string, number> = {}
    for (let i = 0; i < 20; i++) activity[plus('2020-01-01', 40 * i)] = i + 1
    const layout = layoutLifeGarden(buildLifeTimeline(profile({ repos: [repo('many', { createdAt: iso('2020-01-01'), activity: commitsOn(activity) })] }), NOW), 'graphql')
    const leaves = layout.plants[0].leaves
    expect(leaves).toHaveLength(MAX_LEAVES_PER_PLANT)
    expect(leaves.map((l) => l.fromDay)).toEqual(Array.from({ length: 16 }, (_, i) => dayNumber(plus('2020-01-01', 40 * (i + 4)))))
    expect(leaves[leaves.length - 1].size).toBe(1)
    expect(leaves.map((l) => l.side)).toEqual(Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 1 : -1)))
  })
})

describe('life garden layout: edge cases', () => {
  it('lays out a user with no repos: no plants, the years still banded', () => {
    const timeline = buildLifeTimeline(profile({ source: 'rest', createdAt: iso('2022-05-01') }), NOW)
    const layout = layoutLifeGarden(timeline, 'rest')
    expect(layout.plants).toEqual([])
    expect(layout.byKey.size).toBe(0)
    expect(layout.languages).toEqual([])
    expect(layout.years.map((y) => y.year)).toEqual([2022, 2023, 2024])
    expect(layout.days).toBe(dayNumber(TODAY) - dayNumber('2022-05-01') + 1)
  })

  it('lays out an account made today: one day wide, its repo in the middle of it', () => {
    const now = Date.parse(`${TODAY}T19:00:00Z`)
    const p = profile({ createdAt: `${TODAY}T18:00:00Z`, repos: [repo('fresh', { createdAt: `${TODAY}T18:30:00Z`, stars: 1 })] })
    const timeline = buildLifeTimeline(p, now)
    const layout = layoutLifeGarden(timeline, 'graphql')
    expect(layout.days).toBe(1)
    expect(layout.plants).toHaveLength(1)
    expect(layout.plants[0]).toMatchObject({ x: 0.5, row: 0, seedling: true, tip: 'bloom' })
    expect(layout.years).toEqual([{ year: 2024, x0: 0, x1: 1 }])
    for (const m of layout.milestones) expect(m.x).toBe(0.5)
  })

  it('grows a lone repo full height, and only seedlings on a token profile with no counted commits', () => {
    const p = profile({ source: 'rest', repos: [repo('a', { createdAt: iso('2024-06-15') })] })
    const layout = layoutLifeGarden(buildLifeTimeline(p, NOW), 'rest')
    expect(layout.plants[0].height).toBe(1)
    const none = layoutLifeGarden(buildLifeTimeline(profile({ repos: [repo('a'), repo('b')] }), NOW), 'graphql')
    for (const plant of none.plants) expect(plant.height).toBe(0.04)
  })
})

// ---------- geometry ----------

const VIEW: LifeViewport = { width: 1000, height: 600, top: 72, ground: 44, side: 28 }
const CAMERA: LifeCamera = { k: 2, tx: 30 }

function makePlant(over: Partial<LifePlant> = {}): LifePlant {
  return {
    lane: 0,
    key: 'me/a',
    x: 100.5,
    row: 0,
    height: 0.5,
    reach: 8.5,
    bend: 0,
    lean: 0,
    turn: 0.3,
    tip: 'bud',
    bloom: 0,
    dry: false,
    cutting: false,
    visiting: false,
    backDays: 0,
    seedling: false,
    parts: [{ kind: 'active', t0: 0, t1: 1 }],
    leaves: [],
    language: null,
    startDay: 0,
    endDay: 10,
    appearAt: 0,
    ...over,
  }
}

const close = (a: [number, number] | number[], b: [number, number] | number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))

describe('life garden geometry', () => {
  it('roots a plant on the horizon at its x, a row back a little higher and smaller', () => {
    const front = plantGeom(makePlant(), CAMERA, VIEW)
    expect(horizonY(VIEW)).toBe(556)
    expect([front.x0, front.y0, front.scale]).toEqual([30 + 100.5 * 2, 556, 1])
    const back = plantGeom(makePlant({ row: 2 }), CAMERA, VIEW)
    expect(back.y0).toBe(556 - 2 * ROW_LIFT_PX)
    expect(back.scale).toBeCloseTo(1 - 2 * ROW_SHRINK, 12)
    expect(rowScale(3)).toBeCloseTo(0.7, 12)
    // a straight plant: its head straight above its root, the share of the plot its height asks for
    expect([front.x2, front.y2]).toEqual([front.x0, 556 - (556 - 72) * 0.5])
    expect(back.y0 - back.y2).toBeCloseTo((556 - 72) * 0.5 * 0.8, 9)
  })

  it('never draws a stem shorter than 8 px', () => {
    const g = plantGeom(makePlant({ height: 0.001 }), CAMERA, VIEW)
    expect(g.y0 - g.y2).toBe(8)
  })

  it('zooms along x only: a plant moves but keeps its shape', () => {
    const plant = makePlant({ bend: 0.7, lean: -0.4 })
    const a = plantGeom(plant, CAMERA, VIEW)
    const b = plantGeom(plant, { k: 9, tx: -400 }, VIEW)
    const shift = b.x0 - a.x0
    close([b.cx - shift, b.x2 - shift, b.cy, b.y2, b.width, b.tipR], [a.cx, a.x2, a.cy, a.y2, a.width, a.tipR])
  })

  it('leans and bends a stem by its plant values', () => {
    const g = plantGeom(makePlant({ lean: 1, bend: 1 }), CAMERA, VIEW)
    const h = g.y0 - g.y2
    expect(g.x2 - g.x0).toBeCloseTo(0.18 * h, 9)
    // the control point sits off the chord, on the side the bend says
    const chordX = (g.x0 + g.x2) / 2
    expect(g.cx).toBeGreaterThan(chordX)
  })

  it('hangs a dry plant: the stem arcs over and the head points down', () => {
    const g = plantGeom(makePlant({ dry: true, tip: 'wilted', lean: 0.5 }), CAMERA, VIEW)
    const h = (556 - 72) * 0.5
    expect(g.y2).toBeCloseTo(556 - h * (1 - 0.35), 9)
    expect(g.x2).toBeGreaterThan(g.cx)
    expect(g.cy).toBeLessThan(g.y2)
    expect(Math.sin(tangentAt(g, 1))).toBeGreaterThan(0)
    // a plant leaning the other way hangs the other way
    const left = plantGeom(makePlant({ dry: true, tip: 'wilted', lean: -0.5 }), CAMERA, VIEW)
    expect(left.x2).toBeLessThan(left.cx)
  })

  it('sizes heads by stars, a wilted one too, a seedling smaller, a bud small', () => {
    const r = (over: Partial<LifePlant>) => plantGeom(makePlant(over), CAMERA, VIEW).tipR
    expect(r({ tip: 'bud' })).toBe(2.4)
    expect(r({ tip: 'bloom', bloom: 1 })).toBeCloseTo(10, 12)
    expect(r({ tip: 'bloom', bloom: 0.5 })).toBeGreaterThan(r({ tip: 'bloom', bloom: 0.1 }))
    expect(r({ tip: 'wilted', bloom: 0.8 })).toBeGreaterThan(r({ tip: 'wilted', bloom: 0 }))
    expect(r({ tip: 'bloom', bloom: 1, seedling: true })).toBeLessThan(r({ tip: 'bloom', bloom: 1 }))
    expect(r({ tip: 'bloom', bloom: 0, seedling: true })).toBe(2.4)
    expect(r({ tip: 'bloom', bloom: 1, row: 3 })).toBeCloseTo(7, 12)
  })

  it('draws a seedling stem thinner', () => {
    const plain = plantGeom(makePlant(), CAMERA, VIEW)
    const seedling = plantGeom(makePlant({ seedling: true }), CAMERA, VIEW)
    expect(seedling.width).toBeCloseTo(plain.width * 0.6, 12)
  })

  it('walks the stem from root to head, and cuts parts that trace it exactly', () => {
    const g = plantGeom(makePlant({ bend: 0.8, lean: 0.3 }), CAMERA, VIEW)
    expect(pointAt(g, 0)).toEqual([g.x0, g.y0])
    close(pointAt(g, 1), [g.x2, g.y2])
    close(subQuad(g, 0, 1), [g.x0, g.y0, g.cx, g.cy, g.x2, g.y2])
    for (const [a, b] of [
      [0, 0.3],
      [0.3, 0.75],
      [0.75, 1],
    ]) {
      const [sx, sy, cx, cy, ex, ey] = subQuad(g, a, b)
      const part = { ...g, x0: sx, y0: sy, cx, cy, x2: ex, y2: ey }
      close(pointAt(part, 0), pointAt(g, a))
      close(pointAt(part, 0.5), pointAt(g, (a + b) / 2))
      close(pointAt(part, 1), pointAt(g, b))
    }
    // out-of-range times clamp
    close(subQuad(g, -1, 2), subQuad(g, 0, 1))
    expect(Math.sin(tangentAt(g, 0))).toBeLessThan(0)
  })

  it('places a leaf on the stem, pointing off it by its side, sized by the row', () => {
    const g = plantGeom(makePlant({ row: 1 }), CAMERA, VIEW)
    const right = leafGeom(g, { t: 0.4, side: 1, size: 1, fromDay: 0 }, 0.5)
    close([right.x, right.y], pointAt(g, 0.4))
    expect(right.length).toBeCloseTo(13 * 0.9, 12)
    expect(right.width).toBeCloseTo(0.38 * right.length, 12)
    expect(right.angle).toBeCloseTo(tangentAt(g, 0.4) + 0.95, 12)
    const left = leafGeom(g, { t: 0.4, side: -1, size: 0, fromDay: 0 }, 0.5)
    expect(left.angle).toBeCloseTo(tangentAt(g, 0.4) - 0.95, 12)
    expect(left.length).toBeCloseTo(4 * 0.9, 12)
  })

  it('gives finite geometry for every plant of a real-shaped life', () => {
    const timeline: LifeTimeline = richTimeline
    for (const plant of rich.plants) {
      const g = plantGeom(plant, { k: 0.3, tx: 28 }, VIEW)
      for (const v of Object.values(g)) expect(Number.isFinite(v)).toBe(true)
      for (const leaf of plant.leaves) for (const v of Object.values(leafGeom(g, leaf, plant.turn))) expect(Number.isFinite(v)).toBe(true)
    }
    expect(timeline.lanes.length).toBe(rich.plants.length)
  })
})
