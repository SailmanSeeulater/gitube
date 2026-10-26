/**
 * The constellation's layout (PROFILE_SPEC.md section 5, view 3): placement that is pure and
 * deterministic (the same timeline, or the same repos, activity and milestones in any order, give
 * the same layout; a renamed repo, private or not, keeps its band, slot, y and links), the bands in
 * their documented order tiling the plot, stars where their part in the repo starts, sized by weight
 * and glowing by stars, growth along the time-lapse, and the links between repos active at the same
 * time with their caps. Then the recordings (kepano with a token, gaearon without), a user with no
 * repos and an account a day old.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  LINKS_PER_STAR,
  MAX_BANDS,
  MAX_LINKS,
  MAX_SLOTS,
  MIN_BAND_SHARE,
  MONTH_LANES,
  NO_LANGUAGE,
  OTHER_LANGUAGES,
  layoutConstellation,
  type ConstellationLayout,
  type LifeStar,
} from '../src/profile/constellationLayout'
import { constellationGeom } from '../src/profile/constellationGeometry'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { bloomOfStars, layoutLifeGarden } from '../src/profile/lifeGardenLayout'
import { axisOf } from '../src/profile/lifeView'
import { repoKey } from '../src/profile/privacy'
import { buildLifeTimeline, dayKey, dayNumber, type Lane, type LifeTimeline } from '../src/profile/timeline'
import type { ProfileData, ProfileRepo } from '../src/types'
import { GAEARON_NOW, KEPANO_NOW, VIEW, gaearonProfile, kepanoProfile } from './helpers/personScene'

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

/** The profile with its repos, each repo's activity and its milestones shuffled by seed. */
function shuffledProfile(p: ProfileData, seed: number): ProfileData {
  return {
    ...p,
    repos: shuffled(p.repos, seed).map((r, i) => ({ ...r, activity: shuffled(r.activity, seed * 31 + i) })),
    milestones: shuffled(p.milestones, seed + 7),
  }
}

/**
 * A token profile with a bit of everything: busy and quiet repos in three languages and none, an
 * archived one, a fork GitHub counted nothing in (a seedling), a repo they only contributed to, a
 * private one, and repos active at the same time.
 */
const RICH = profile({
  repos: [
    repo('busy', { createdAt: iso('2019-02-01'), stars: 900, language: 'Go', activity: monthly('2019-02', '2021-06', 6) }),
    repo('steady', { createdAt: iso('2019-03-04'), stars: 12, activity: monthly('2019-03', '2020-12', 3) }),
    repo('quiet', { createdAt: iso('2019-04-02'), activity: commitsOn({ '2019-04-02': 1 }) }),
    repo('old', { createdAt: iso('2019-05-06'), isArchived: true, stars: 40, language: 'Rust', activity: monthly('2019-05', '2019-11') }),
    repo('copy', { createdAt: iso('2019-06-03'), isFork: true, stars: 3, language: 'Go' }),
    { ...repo('theirs', { createdAt: iso('2015-01-01'), isOwn: false, language: 'Rust', activity: monthly('2020-01', '2020-08', 4) }), nameWithOwner: 'them/Theirs', firstActiveAt: iso('2020-01-01') },
    repo('Secret', { createdAt: iso('2020-02-03'), isPrivate: true, activity: monthly('2020-02', '2022-02', 2) }),
    repo('notes', { createdAt: iso('2021-03-01'), language: null, activity: monthly('2021-03', '2023-03', 1) }),
    repo('late', { createdAt: iso('2023-05-01'), stars: 150, activity: monthly('2023-05', '2024-05', 5) }),
  ],
  milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
})

const richTimeline = buildLifeTimeline(RICH, NOW)
const rich = layoutConstellation(richTimeline, 'graphql')
const starOf = (layout: ConstellationLayout, name: string): LifeStar => {
  const i = layout.byKey.get(repoKey(name))
  if (i === undefined) throw new Error(`no star ${name}`)
  return layout.stars[i]
}

/** A lane's weight, as the layout reads it: counted commits with a token, active days without. */
function weightOf(lane: Lane, source: ProfileData['source']): number {
  if (source === 'graphql') return lane.commits
  return lane.spans.filter((s) => s.kind === 'active').reduce((n, s) => n + s.days, 0)
}

/** Every day two lanes are both active on, by brute force. */
function sharedDays(a: Lane, b: Lane): number[] {
  const days: number[] = []
  for (const x of a.spans) {
    if (x.kind !== 'active') continue
    for (const y of b.spans) {
      if (y.kind !== 'active') continue
      for (let d = Math.max(x.fromDay, y.fromDay); d <= Math.min(x.toDay, y.toDay); d++) days.push(d)
    }
  }
  return days.sort((p, q) => p - q)
}

/** A star's slot in its band, read back from its y (the jitter keeps it inside the slot's middle half). */
function slotOf(layout: ConstellationLayout, star: LifeStar): number {
  const band = layout.bands[star.band]
  const slots = Math.min(MAX_SLOTS, Math.max(1, Math.ceil(Math.sqrt(band.count))))
  return Math.floor(((star.y - band.y0) / (band.y1 - band.y0)) * slots)
}

/** The links by repo key, so layouts of different lane orders compare. */
function linksByKey(layout: ConstellationLayout, rename: (key: string) => string = (k) => k) {
  return layout.links
    .map((link) => {
      const [a, b] = [rename(layout.stars[link.a].key), rename(layout.stars[link.b].key)].sort()
      return `${a} ${b} ${link.strength} ${link.fromDay}`
    })
    .sort()
}

/** Everything a constellation layout promises, checked against its timeline. */
function expectValid(layout: ConstellationLayout, timeline: LifeTimeline, source: ProfileData['source']): void {
  const { lanes } = timeline
  // the shared axis
  const { startDay, todayDay, days, years, languages, milestones } = layout
  expect({ startDay, todayDay, days, years, languages, milestones }).toEqual(axisOf(timeline))

  // one star per lane, keyed by its repo, where the person's part in it starts
  expect(layout.stars).toHaveLength(lanes.length)
  expect(new Set(layout.stars.map((s) => s.lane)).size).toBe(lanes.length)
  layout.stars.forEach((star, i) => {
    const lane = lanes[star.lane]
    expect(star.key).toBe(repoKey(lane.repo))
    expect(star.x).toBe(lane.rootDay - timeline.startDay + 0.5)
    expect([star.startDay, star.endDay, star.language, star.stars]).toEqual([lane.startDay, lane.endDay, lane.language, lane.stars])
    expect([star.dry, star.twin, star.visiting, star.seedling]).toEqual([lane.isArchived, lane.isFork, !lane.isOwn, source === 'graphql' && !lane.detailed])
    expect(star.glow).toBe(bloomOfStars(lane.stars))
    expect(layout.byKey.get(star.key)).toBe(i)
  })
  expect(layout.byKey.size).toBe(layout.stars.length)

  // paint order: the smallest, then the faintest, then lane order
  const order = layout.stars.map((s) => [s.size, s.glow, s.lane])
  expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]))

  // the bands tile the plot, top to bottom, in the documented order, and hold their stars
  const { bands } = layout
  if (lanes.length === 0) expect(bands).toEqual([])
  else {
    expect(bands[0].y0).toBe(0)
    expect(bands[bands.length - 1].y1).toBe(1)
  }
  bands.forEach((band, i) => {
    expect(band.y1).toBeGreaterThan(band.y0)
    if (i > 0) expect(band.y0).toBe(bands[i - 1].y1)
    expect(band.count).toBe(layout.stars.filter((s) => s.band === i).length)
    expect(band.count).toBeGreaterThan(0)
  })
  const named = bands.filter((b) => b.kind === 'language')
  expect(named.length).toBeLessThanOrEqual(MAX_BANDS)
  expect(bands.map((b) => b.kind).join(' ')).toMatch(/^(language ?)*(other ?)?(none)?$/)
  const weight = new Map<string, number>()
  const count = new Map<string, number>()
  for (const lane of lanes) {
    if (lane.language === null) continue
    weight.set(lane.language, (weight.get(lane.language) ?? 0) + weightOf(lane, source))
    count.set(lane.language, (count.get(lane.language) ?? 0) + 1)
  }
  const ranked = [...weight.keys()].sort((a, b) => weight.get(b)! - weight.get(a)! || count.get(b)! - count.get(a)! || (a < b ? -1 : 1))
  const kept = ranked.length > MAX_BANDS ? ranked.slice(0, MAX_BANDS - 1) : ranked
  expect(named.map((b) => b.language)).toEqual(kept)
  expect(named.map((b) => b.label)).toEqual(kept)
  expect(bands.some((b) => b.kind === 'other')).toBe(ranked.length > MAX_BANDS)
  expect(bands.some((b) => b.kind === 'none')).toBe(lanes.some((lane) => lane.language === null))
  for (const band of bands) if (band.kind !== 'language') expect([band.language, band.label]).toEqual([null, band.kind === 'other' ? OTHER_LANGUAGES : NO_LANGUAGE])
  for (const star of layout.stars) {
    const band = bands[star.band]
    const lane = lanes[star.lane]
    if (lane.language === null) expect(band.kind).toBe('none')
    else if (kept.includes(lane.language)) expect([band.kind, band.language]).toEqual(['language', lane.language])
    else expect(band.kind).toBe('other')
    // inside its band, in the middle half of its slot
    expect(star.y).toBeGreaterThan(band.y0)
    expect(star.y).toBeLessThan(band.y1)
  }

  // size follows weight: 0 for a seedling, 1 for the heaviest, never out of order
  const weighed = layout.stars.filter((s) => !s.seedling).map((s) => ({ size: s.size, weight: weightOf(lanes[s.lane], source) }))
  for (const star of layout.stars) {
    expect(star.size >= 0 && star.size <= 1).toBe(true)
    if (star.seedling) expect(star.size).toBe(0)
  }
  if (weighed.some((s) => s.weight > 0)) expect(Math.max(...weighed.map((s) => s.size))).toBe(1)
  weighed.sort((a, b) => a.weight - b.weight)
  for (let i = 1; i < weighed.length; i++) {
    if (weighed[i].weight === weighed[i - 1].weight) expect(weighed[i].size).toBe(weighed[i - 1].size)
    else expect(weighed[i].size).toBeGreaterThan(weighed[i - 1].size)
  }

  // growth: from nothing at the first day to whole by the last, never shrinking
  for (const star of layout.stars) {
    const { growthDays: d, growthShares: s } = star
    expect(d.length).toBe(s.length)
    expect(d.length).toBeGreaterThanOrEqual(2)
    expect(d[0]).toBe(star.startDay)
    expect(s[0]).toBe(0)
    expect(s[s.length - 1]).toBe(1)
    for (let i = 1; i < d.length; i++) {
      expect(d[i]).toBeGreaterThan(d[i - 1])
      expect(s[i]).toBeGreaterThanOrEqual(s[i - 1])
    }
  }

  // links: between two stars active on a day both share, fromDay the first such day, capped
  expect(layout.links.length).toBeLessThanOrEqual(Math.min(MAX_LINKS, LINKS_PER_STAR * layout.stars.length))
  const pairs = new Set<string>()
  layout.links.forEach((link, i) => {
    expect(link.a).toBeLessThan(link.b)
    expect(link.b).toBeLessThan(layout.stars.length)
    expect(link.strength).toBeGreaterThanOrEqual(1)
    if (i > 0) {
      const prev = layout.links[i - 1]
      expect(prev.a < link.a || (prev.a === link.a && prev.b < link.b)).toBe(true)
    }
    pairs.add(`${link.a} ${link.b}`)
    const [a, b] = [layout.stars[link.a], layout.stars[link.b]]
    const shared = sharedDays(lanes[a.lane], lanes[b.lane])
    expect(shared.length).toBeGreaterThan(0)
    expect(link.fromDay).toBe(shared[0])
    if (source === 'graphql') expect([a.seedling, b.seedling]).toEqual([false, false])
  })
  expect(pairs.size).toBe(layout.links.length)

  // nothing that JSON cannot carry: no NaN, no Infinity, nothing undefined
  const plain = { ...layout, byKey: [...layout.byKey] }
  expect(JSON.parse(JSON.stringify(plain))).toEqual(plain)
}

describe('constellation layout: determinism', () => {
  it('is valid on a profile with a bit of everything', () => {
    expectValid(rich, richTimeline, 'graphql')
  })

  it('gives the same layout for the same timeline, and for the same repos, activity and milestones in any order', () => {
    expect(layoutConstellation(richTimeline, 'graphql')).toEqual(rich)
    for (let seed = 1; seed <= 20; seed++) {
      const timeline = buildLifeTimeline(shuffledProfile(RICH, seed), NOW)
      expect(layoutConstellation(timeline, 'graphql'), `seed ${seed}`).toEqual(rich)
    }
  })

  it('keeps a renamed repo, public or private, in its band and slot, at its y, with its links', () => {
    for (const [from, to] of [
      ['me/steady', 'me/zz-renamed'],
      ['me/Secret', 'me/Other-Secret'],
    ]) {
      const renamed = buildLifeTimeline({ ...RICH, repos: RICH.repos.map((r) => (r.nameWithOwner === from ? { ...r, nameWithOwner: to } : r)) }, NOW)
      const layout = layoutConstellation(renamed, 'graphql')
      const a = starOf(rich, from)
      const b = starOf(layout, to)
      expect({ ...b, key: a.key }).toEqual(a)
      expect(slotOf(layout, b)).toBe(slotOf(rich, a))
      expect(layout.bands).toEqual(rich.bands)
      expect(linksByKey(layout)).toEqual(linksByKey(rich, (key) => (key === repoKey(from) ? repoKey(to) : key)))
      expect(linksByKey(rich).some((link) => link.split(' ').includes(repoKey(from)))).toBe(true)
    }
  })

  it('seeds a star from its days, language and flags, never its name, and tells look-alike repos apart', () => {
    const twins = layoutConstellation(buildLifeTimeline(profile({ repos: [repo('x'), repo('y'), repo('z')] }), NOW), 'graphql')
    const ys = twins.stars.map((s) => s.y)
    expect(new Set(ys).size).toBe(3)
    const named = layoutConstellation(buildLifeTimeline(profile({ repos: [repo('aaa'), repo('bbb'), repo('ccc')] }), NOW), 'graphql')
    expect(named.stars.map((s) => s.y).sort()).toEqual([...ys].sort())
  })
})

describe('constellation layout: bands and slots', () => {
  it(`orders languages by weight, then repo count, then name; past ${MAX_BANDS} the rest share a band, and none comes last`, () => {
    // ten languages: L0 the heaviest; L8 and L9 the lightest; two repos without a language
    const repos: ProfileRepo[] = []
    for (let i = 0; i < 10; i++) repos.push(repo(`l${i}`, { createdAt: iso(plus('2020-01-01', 10 * i)), language: `L${i}`, activity: commitsOn({ [plus('2020-01-01', 10 * i)]: 100 - 10 * i }) }))
    // L3 ties L2 on weight with one more repo; it goes first
    repos.push(repo('l3b', { createdAt: iso('2021-01-01'), language: 'L3', activity: commitsOn({ '2021-01-01': 10 }) }))
    repos.push(repo('bare1', { createdAt: iso('2021-02-01'), language: null, activity: commitsOn({ '2021-02-01': 500 }) }))
    repos.push(repo('bare2', { createdAt: iso('2021-03-01'), language: null, activity: commitsOn({ '2021-03-01': 500 }) }))
    const timeline = buildLifeTimeline(profile({ repos }), NOW)
    const layout = layoutConstellation(timeline, 'graphql')
    expectValid(layout, timeline, 'graphql')
    expect(layout.bands.map((b) => b.label)).toEqual(['L0', 'L1', 'L3', 'L2', 'L4', 'L5', 'L6', OTHER_LANGUAGES, NO_LANGUAGE])
    expect(layout.bands.map((b) => b.count)).toEqual([1, 1, 2, 1, 1, 1, 1, 3, 2])
    expect(starOf(layout, 'me/l9').band).toBe(7)
    expect(starOf(layout, 'me/bare1').band).toBe(8)
  })

  it(`keeps ${MAX_BANDS} named bands when there are exactly ${MAX_BANDS} languages, and sizes bands by the square root of their count`, () => {
    const repos: ProfileRepo[] = []
    for (let i = 0; i < 8; i++) {
      for (let k = 0; k <= (i === 0 ? 15 : 0); k++) repos.push(repo(`l${i}-${k}`, { createdAt: iso(plus('2020-01-01', 20 * i + k)), language: `L${i}`, activity: commitsOn({ [plus('2020-01-01', 20 * i + k)]: 5 }) }))
    }
    const layout = layoutConstellation(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    expect(layout.bands.map((b) => b.kind)).toEqual(new Array(8).fill('language'))
    // 16 repos against 1: four times the height
    const height = (i: number) => layout.bands[i].y1 - layout.bands[i].y0
    expect(height(0) / height(1)).toBeCloseTo(4, 9)
    for (let i = 2; i < 8; i++) expect(height(i)).toBeCloseTo(height(1), 12)
  })

  it(`gives a band of one repo at least ${MIN_BAND_SHARE} of the plot before renormalising`, () => {
    const repos: ProfileRepo[] = [repo('lonely', { language: 'Rust', activity: commitsOn({ '2020-01-01': 1 }) })]
    for (let k = 0; k < 400; k++) repos.push(repo(`many${k}`, { createdAt: iso(plus('2020-01-02', k)), activity: commitsOn({ [plus('2020-01-02', k)]: 9 }) }))
    const layout = layoutConstellation(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    const rust = layout.bands.find((b) => b.language === 'Rust')!
    // sqrt(1) / (sqrt(1) + sqrt(400)) is under the floor, so it gets the floor, renormalised
    expect(rust.y1 - rust.y0).toBeCloseTo(MIN_BAND_SHARE / (MIN_BAND_SHARE + 20 / 21), 12)
  })

  it('fills slots in lane order: roots close together take the next slot, and reuse the one rooted longest ago when all are taken', () => {
    // four repos a day apart (two slots), then one far later
    const repos = [0, 1, 2, 3].map((n) => repo(`r${n}`, { createdAt: iso(plus('2020-01-01', n)), activity: commitsOn({ [plus('2020-01-01', n)]: 1 }) }))
    repos.push(repo('far', { createdAt: iso('2023-01-01'), activity: commitsOn({ '2023-01-01': 1 }) }))
    const layout = layoutConstellation(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    expect(layout.bands).toHaveLength(1)
    // five repos: three slots
    expect(['r0', 'r1', 'r2', 'r3', 'far'].map((n) => slotOf(layout, starOf(layout, `me/${n}`)))).toEqual([0, 1, 2, 0, 0])
  })

  it(`never makes more than ${MAX_SLOTS} slots`, () => {
    const repos = Array.from({ length: 100 }, (_, n) => repo(`r${n}`, { createdAt: iso(plus('2020-01-01', n)), activity: commitsOn({ [plus('2020-01-01', n)]: 1 }) }))
    const layout = layoutConstellation(buildLifeTimeline(profile({ repos }), NOW), 'graphql')
    const slots = new Set(layout.stars.map((s) => slotOf(layout, s)))
    expect(slots).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]))
  })

  it('spreads the stars a day roots past its band\'s slots evenly through each shared slot, by their turn, whatever their names', () => {
    // thirty repos ten days apart, then sixteen on one day: seven slots, so two days' worth share them
    const crowdOf = (names: (k: number) => string, privateFrom = 16) => {
      const repos = Array.from({ length: 30 }, (_, n) => repo(`early${n}`, { createdAt: iso(plus('2020-01-01', 10 * n)), activity: commitsOn({ [plus('2020-01-01', 10 * n)]: 1 }) }))
      for (let k = 0; k < 16; k++) repos.push(repo(names(k), { createdAt: iso('2021-06-01'), isPrivate: k >= privateFrom, activity: commitsOn({ '2021-06-01': 1 }) }))
      const timeline = buildLifeTimeline(profile({ repos }), NOW)
      const layout = layoutConstellation(timeline, 'graphql')
      expectValid(layout, timeline, 'graphql')
      return { layout, crowd: layout.stars.filter((s) => s.x === dayNumber('2021-06-01') - timeline.startDay + 0.5) }
    }
    const { layout, crowd } = crowdOf((k) => `same${String(k).padStart(2, '0')}`)
    expect(crowd).toHaveLength(16)
    const band = layout.bands[0]
    const slot = (band.y1 - band.y0) / MAX_SLOTS
    // every slot taken once, then 0 and 1 a third time and the rest a second
    const bySlot = new Map<number, number[]>()
    for (const star of crowd) bySlot.set(slotOf(layout, star), [...(bySlot.get(slotOf(layout, star)) ?? []), star.y])
    expect([...bySlot.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const [s, ys] of bySlot) {
      const n = s < 2 ? 3 : 2
      expect(ys).toHaveLength(n)
      // evenly through the slot's middle half, about its centre
      ys.sort((p, q) => p - q).forEach((y, k) => expect(y).toBeCloseTo(band.y0 + slot * (s + 0.5 + ((k + 0.5) / n - 0.5) * 0.5), 12))
    }
    // the same places whatever the names, and whichever of them are private
    expect(crowdOf((k) => `zz${15 - k}`, 8).crowd.map((s) => s.y).sort()).toEqual(crowd.map((s) => s.y).sort())
  })
})

describe('constellation layout: stars', () => {
  it('sizes stars by counted commits with a token, the heaviest 1, a seedling 0', () => {
    const busy = starOf(rich, 'me/busy')
    expect(busy.size).toBe(1)
    expect(busy.size).toBeGreaterThan(starOf(rich, 'me/steady').size)
    expect(starOf(rich, 'me/steady').size).toBeGreaterThan(starOf(rich, 'me/quiet').size)
    expect(starOf(rich, 'me/quiet').size).toBeGreaterThan(0)
    expect(starOf(rich, 'me/copy')).toMatchObject({ seedling: true, size: 0, twin: true, glow: bloomOfStars(3) })
    const lanes = richTimeline.lanes
    expect(starOf(rich, 'me/steady').size).toBeCloseTo(Math.sqrt(lanes[starOf(rich, 'me/steady').lane].commits / lanes[busy.lane].commits), 12)
  })

  it('sizes stars by active days without a token', () => {
    const p = profile({
      source: 'rest',
      repos: [
        repo('long', { createdAt: iso('2019-01-01'), lastActiveAt: iso('2021-01-01') }),
        repo('short', { createdAt: iso('2020-01-01'), lastActiveAt: iso('2020-02-01') }),
        repo('blink', { createdAt: iso('2022-01-01') }),
      ],
    })
    const timeline = buildLifeTimeline(p, NOW)
    const layout = layoutConstellation(timeline, 'rest')
    expectValid(layout, timeline, 'rest')
    const [long, short, blink] = ['long', 'short', 'blink'].map((n) => starOf(layout, `me/${n}`))
    expect(long.size).toBe(1)
    expect(long.size).toBeGreaterThan(short.size)
    expect(short.size).toBeGreaterThan(blink.size)
    for (const star of layout.stars) expect(star.seedling).toBe(false)
  })

  it('glows by stars on the garden blooms scale, and flags archived, forked and contributed repos', () => {
    expect(starOf(rich, 'me/busy').glow).toBe(Math.log10(901) / 4)
    expect(starOf(rich, 'me/quiet').glow).toBe(0)
    expect(starOf(rich, 'me/old')).toMatchObject({ dry: true, glow: bloomOfStars(40) })
    expect(starOf(rich, 'them/theirs')).toMatchObject({ visiting: true, language: 'Rust' })
    expect(starOf(rich, 'me/busy')).toMatchObject({ dry: false, twin: false, visiting: false })
  })

  it('places every star at the same x as the garden places its plant, so one camera serves both', () => {
    const garden = layoutLifeGarden(richTimeline, 'graphql')
    for (const star of rich.stars) expect(star.x).toBe(garden.plants[garden.byKey.get(star.key)!].x)
    expect([rich.startDay, rich.days]).toEqual([garden.startDay, garden.days])
  })

  it('grows a star by its share of commits over each active span with a token, and by days without', () => {
    // two runs of activity: 30 commits in March, then 10 in September
    const p = profile({ repos: [repo('two', { createdAt: iso('2020-03-01'), activity: commitsOn({ '2020-03-01': 10, '2020-03-11': 20, '2020-09-01': 10 }) })] })
    const timeline = buildLifeTimeline(p, NOW)
    const star = layoutConstellation(timeline, 'graphql').stars[0]
    const spans = timeline.lanes[0].spans.filter((s) => s.kind === 'active')
    expect(spans).toHaveLength(2)
    expect(star.growthDays).toEqual([spans[0].fromDay, spans[0].toDay + 1, spans[1].fromDay, spans[1].toDay + 1])
    expect(star.growthShares).toEqual([0, 0.75, 0.75, 1])

    const rest = profile({ source: 'rest', repos: [repo('one', { createdAt: iso('2020-03-01'), lastActiveAt: iso('2020-03-20') })] })
    const one = layoutConstellation(buildLifeTimeline(rest, NOW), 'rest').stars[0]
    expect(one.growthDays).toEqual([dayNumber('2020-03-01'), dayNumber('2020-03-21')])
    expect(one.growthShares).toEqual([0, 1])
  })
})

describe('constellation layout: links', () => {
  /** A REST profile of own repos, each active from its first day to its last (inclusive). */
  function restOf(spans: Array<[string, string]>, over: (i: number) => Partial<ProfileRepo> = () => ({})): ProfileData {
    return profile({
      source: 'rest',
      repos: spans.map(([from, to], i) => repo(`r${String(i).padStart(3, '0')}`, { createdAt: iso(from), lastActiveAt: iso(to), ...over(i) })),
    })
  }
  const pairsOf = (layout: ConstellationLayout) =>
    layout.links.map((link) => [layout.stars[link.a].key, layout.stars[link.b].key].sort().join(' ')).sort()

  it('links repos active on the same days, with the months they share and their first shared day', () => {
    const p = restOf([
      ['2020-01-10', '2020-04-20'],
      ['2020-03-05', '2020-06-30'],
    ])
    const layout = layoutConstellation(buildLifeTimeline(p, NOW), 'rest')
    expect(layout.links).toEqual([{ a: 0, b: 1, strength: 2, fromDay: dayNumber('2020-03-05') }])
  })

  it('does not link repos active in the same month on different days', () => {
    const p = restOf([
      ['2020-01-02', '2020-01-05'],
      ['2020-01-20', '2020-01-25'],
    ])
    expect(layoutConstellation(buildLifeTimeline(p, NOW), 'rest').links).toEqual([])
  })

  it('links nothing to a seedling of a token profile', () => {
    const p = profile({
      repos: [
        repo('a', { createdAt: iso('2020-01-01'), activity: monthly('2020-01', '2020-12') }),
        repo('seedling', { createdAt: iso('2020-02-01'), lastActiveAt: iso('2020-11-01') }),
        repo('b', { createdAt: iso('2020-03-01'), activity: monthly('2020-03', '2020-10') }),
      ],
    })
    const layout = layoutConstellation(buildLifeTimeline(p, NOW), 'graphql')
    expect(pairsOf(layout)).toEqual(['me/a me/b'])
  })

  it(`lets each star pick its ${LINKS_PER_STAR} strongest partners and keeps every pick`, () => {
    // a and b run all year; c and d each half of it, overlapping two months
    const p = restOf([
      ['2020-01-01', '2020-12-31'],
      ['2020-01-02', '2020-12-30'],
      ['2020-01-03', '2020-06-30'],
      ['2020-05-01', '2020-10-31'],
    ])
    const layout = layoutConstellation(buildLifeTimeline(p, NOW), 'rest')
    // c and d share two months, each one's weakest partner: neither picks the other
    expect(pairsOf(layout)).toEqual(['me/r000 me/r001', 'me/r000 me/r002', 'me/r000 me/r003', 'me/r001 me/r002', 'me/r001 me/r003'])

    // a hub active with four repos one after another: each picks the hub, the hub picks two, all kept
    const hub = restOf([
      ['2020-01-01', '2021-12-31'],
      ['2020-02-01', '2020-03-31'],
      ['2020-06-01', '2020-08-31'],
      ['2020-11-01', '2021-01-31'],
      ['2021-04-01', '2021-05-31'],
    ])
    const hubbed = layoutConstellation(buildLifeTimeline(hub, NOW), 'rest')
    expect(pairsOf(hubbed)).toEqual(['me/r000 me/r001', 'me/r000 me/r002', 'me/r000 me/r003', 'me/r000 me/r004'])
  })

  it(`counts only each month's ${MONTH_LANES} heaviest lanes`, () => {
    // thirty repos active the same few days in one month; the six lightest are left out
    const spans: Array<[string, string]> = Array.from({ length: 30 }, (_, i) => ['2020-05-01', i > 5 ? '2020-05-20' : '2020-05-10'] as [string, string])
    const layout = layoutConstellation(buildLifeTimeline(restOf(spans), NOW), 'rest')
    const linked = new Set(layout.links.flatMap((link) => [layout.stars[link.a].key, layout.stars[link.b].key]))
    expect(linked.size).toBe(MONTH_LANES)
    for (let i = 0; i <= 5; i++) expect(linked.has(`me/r00${i}`)).toBe(false)
  })

  it(`keeps the ${MAX_LINKS} strongest links in all, the earliest first among equals`, () => {
    // 600 repos two days each, one after another, each sharing one day (and so one month) with the next
    const spans: Array<[string, string]> = Array.from({ length: 600 }, (_, i) => [plus('2019-02-01', 2 * i), plus('2019-02-01', 2 * i + 2)])
    const timeline = buildLifeTimeline(restOf(spans), NOW)
    const layout = layoutConstellation(timeline, 'rest')
    expect(layout.links).toHaveLength(MAX_LINKS)
    for (const link of layout.links) expect(link.strength).toBe(1)
    const kept = layout.links.map((link) => Math.min(layout.stars[link.a].lane, layout.stars[link.b].lane)).sort((a, b) => a - b)
    expect(kept).toEqual(Array.from({ length: MAX_LINKS }, (_, i) => i))
    for (const link of layout.links) expect(Math.abs(layout.stars[link.a].lane - layout.stars[link.b].lane)).toBe(1)
  })
})

describe('constellation layout: edge cases', () => {
  it('lays out a user with no repos: no stars, bands or links, the axis still there', () => {
    const timeline = buildLifeTimeline(profile({ source: 'rest', createdAt: iso('2022-05-01') }), NOW)
    const layout = layoutConstellation(timeline, 'rest')
    expectValid(layout, timeline, 'rest')
    expect([layout.stars, layout.bands, layout.links]).toEqual([[], [], []])
    expect(layout.years.map((y) => y.year)).toEqual([2022, 2023, 2024])
    expect(layout.days).toBe(dayNumber(TODAY) - dayNumber('2022-05-01') + 1)
  })

  it('lays out an account made today: one day wide, its repo in the middle of it', () => {
    const now = Date.parse(`${TODAY}T19:00:00Z`)
    const p = profile({ createdAt: `${TODAY}T18:00:00Z`, repos: [repo('fresh', { createdAt: `${TODAY}T18:30:00Z`, stars: 1 })] })
    const timeline = buildLifeTimeline(p, now)
    const layout = layoutConstellation(timeline, 'graphql')
    expectValid(layout, timeline, 'graphql')
    expect(layout.days).toBe(1)
    expect(layout.stars[0]).toMatchObject({ x: 0.5, seedling: true, size: 0, glow: bloomOfStars(1) })
    expect(layout.stars[0].growthDays).toEqual([dayNumber(TODAY), dayNumber(TODAY) + 1])
  })
})

describe('constellation layout: the recordings', () => {
  let kepano: ProfileData
  let gaearon: ProfileData
  beforeAll(async () => {
    ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
  })

  it('lays out kepano (a token, GraphQL) validly and the same in any order', () => {
    const timeline = buildLifeTimeline(kepano, KEPANO_NOW)
    const layout = layoutConstellation(timeline, kepano.source)
    expect(kepano.source).toBe('graphql')
    expectValid(layout, timeline, 'graphql')
    expect(layout.stars.length).toBeGreaterThan(40)
    expect(layout.links.length).toBeGreaterThan(20)
    expect(layout.stars.some((s) => s.seedling)).toBe(true)
    for (const seed of [3, 11]) expect(layoutConstellation(buildLifeTimeline(shuffledProfile(kepano, seed), KEPANO_NOW), 'graphql'), `seed ${seed}`).toEqual(layout)
  })

  it('lays out gaearon (no token, REST, 301 repos) validly and the same in any order', () => {
    const timeline = buildLifeTimeline(gaearon, GAEARON_NOW)
    const layout = layoutConstellation(timeline, gaearon.source)
    expect(gaearon.source).toBe('rest')
    expectValid(layout, timeline, 'rest')
    expect(layout.stars).toHaveLength(301)
    expect(layout.bands.some((b) => b.kind === 'other')).toBe(true)
    expect(layout.bands[layout.bands.length - 1].kind).toBe('none')
    for (const seed of [5]) expect(layoutConstellation(buildLifeTimeline(shuffledProfile(gaearon, seed), GAEARON_NOW), 'rest'), `seed ${seed}`).toEqual(layout)
  })

  it("hides none of gaearon's stars behind another at its x, though a day roots more forks than his JavaScript band has slots", () => {
    const layout = layoutConstellation(buildLifeTimeline(gaearon, GAEARON_NOW), 'rest')
    // eight JavaScript forks on 2016-02-04 against seven slots
    const perDay = new Map<string, number>()
    for (const star of layout.stars) perDay.set(`${star.band} ${star.x}`, (perDay.get(`${star.band} ${star.x}`) ?? 0) + 1)
    expect(Math.max(...perDay.values())).toBeGreaterThan(MAX_SLOTS)
    // on a laptop screen, no two stars at one x closer than a core's radius
    const g = constellationGeom(layout, fitLifeCamera(layout.days, VIEW), VIEW)
    let sameX = 0
    for (let i = 0; i < layout.stars.length; i++) {
      for (let j = i + 1; j < layout.stars.length; j++) {
        if (layout.stars[i].x !== layout.stars[j].x) continue
        sameX++
        expect(Math.abs(g.y[i] - g.y[j]), `${i} ${j}`).toBeGreaterThanOrEqual(Math.max(g.r[i], g.r[j]))
      }
    }
    expect(sameX).toBeGreaterThan(MAX_SLOTS)
  })
})
