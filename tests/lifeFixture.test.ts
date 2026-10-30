/**
 * Person mode end to end in its default view, life lines, on the recordings: kepano through the token tier (GraphQL, 2013 to
 * 2026) and gaearon through the tier without one (REST, 301 repos), each fetched by the real
 * fetcher, built as PersonApp builds it, painted in all ten themes with its labels, and shown in the
 * panel, inspector, legend and status strip; then a user with no repos and an account a day old.
 * PersonApp itself is rendered on the server with the profile already in the query cache.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import PersonApp from '../src/PersonApp'
import PersonInspector from '../src/profile/PersonInspector'
import PersonLegend, { dataLimits } from '../src/profile/PersonLegend'
import PersonPanel from '../src/profile/PersonPanel'
import PersonStatus from '../src/profile/PersonStatus'
import { dayDetail } from '../src/profile/dayIndex'
import { LIFE_MAX_K, fitLifeCamera, panLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { languagePalette } from '../src/profile/lifeInk'
import { profileQueryKey } from '../src/profile/useProfileData'
import { usePersonStore } from '../src/profile/usePersonStore'
import { dayKey, dayNumber } from '../src/profile/timeline'
import { THEMES, getTheme, type Theme } from '../src/theme/themes'
import type { ProfileData, ProfileRepo } from '../src/types'
import type { CtxEntry } from './helpers/recordingCtx'
import {
  FAKE_TOKEN,
  GAEARON_NOW,
  KEPANO_NOW,
  VIEW,
  gaearonProfile,
  load,
  kepanoProfile,
  paint,
  setApp,
  setPerson,
  textOf,
  type Loaded,
} from './helpers/personScene'

const noop = () => {}
const dark = getTheme('obsidian')
const light = getTheme('paper')

let kepano: ProfileData
let gaearon: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
})

beforeEach(() => {
  usePersonStore.getState().resetFor('nobody')
  setPerson({ tab: 'repos' })
  setApp({ panelOpen: true, rate: null, token: '', themeId: dark.id })
})

/** Every number a call was given or a property was set to. */
function numbersOf(log: CtxEntry[]): number[] {
  return log.flatMap((e) => (e.kind === 'call' ? e.args : [e.value])).filter((v): v is number => typeof v === 'number')
}

/** Paints g's lines as the canvas does, and checks what every frame must hold. */
function paintsCleanly(g: Loaded): void {
  const { rec } = paint(g)
  const first = rec.log.find((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name))
  expect(first).toMatchObject({ kind: 'call', name: 'fillRect', args: [0, 0, VIEW.width * 2, VIEW.height * 2] })
  expect(first?.kind === 'call' && first.style.fillStyle).toBe(g.theme.canvas)
  for (const n of numbersOf(rec.log)) expect(Number.isFinite(n)).toBe(true)
  expect(rec.calls('save')).toHaveLength(rec.calls('restore').length)
}

function panel(g: Loaded): string {
  return renderToStaticMarkup(
    h(PersonPanel, {
      profile: g.profile,
      timeline: g.timeline,
      colourOf: g.colourOf,
      name: g.name,
      privateCount: g.privateKeys.size,
      revealed: false,
      onReveal: noop,
      theme: g.theme,
    }),
  )
}

function inspector(g: Loaded): string {
  return renderToStaticMarkup(h(PersonInspector, { profile: g.profile, timeline: g.timeline, days: g.days, colourOf: g.colourOf, name: g.name }))
}

function legend(g: Loaded): string {
  return renderToStaticMarkup(h(PersonLegend, { profile: g.profile, timeline: g.timeline, colourOf: g.colourOf, theme: g.theme, hasPrivate: g.privateKeys.size > 0 }))
}

function status(g: Loaded, hasToken: boolean): string {
  return renderToStaticMarkup(h(PersonStatus, { profile: g.profile, timeline: g.timeline, cachedAt: null, hasToken, onRefresh: noop, onAddToken: noop }))
}

/** PersonApp on the server, with profile already in the query cache under the key its tier gives it. */
function personApp(profile: ProfileData, token: string, theme: Theme): string {
  setApp({ token, themeId: theme.id })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(profileQueryKey(profile.login, token), { profile, cachedAt: null })
  return renderToStaticMarkup(
    h(
      QueryClientProvider,
      { client },
      h(PersonApp, { login: profile.login, request: 0, view: null, focusInput: false, onRepo: noop, onUser: noop }),
    ),
  )
}

/** What each line shows of its lane: its stars, dry when archived, a branch stub for a fork, dotted without counted commits, its active runs. */
function expectLinesFollowLanes(g: Loaded): void {
  expect(g.layout.lines).toHaveLength(g.timeline.lanes.length)
  for (const line of g.layout.lines) {
    const lane = g.timeline.lanes[line.lane]
    expect(line.key).toBe(lane.repo.toLowerCase())
    expect(line.stars).toBe(lane.stars)
    expect(line.dry).toBe(lane.isArchived)
    expect(line.branch).toBe(lane.isFork)
    expect(line.visiting).toBe(!lane.isOwn)
    const uncounted = g.profile.source === 'graphql' && !lane.detailed
    expect(line.uncounted).toBe(uncounted)
    expect(line.parts.map((part) => part.kind)).toEqual(lane.spans.map((span) => span.kind))
    expect(line.x).toBeGreaterThanOrEqual(0)
    expect(line.x).toBeLessThanOrEqual(g.layout.days)
  }
}

describe('kepano, with a token (GraphQL)', () => {
  it('draws a line per repo, each as its lane says', () => {
    const g = load(kepano, KEPANO_NOW, dark)
    expect(kepano.source).toBe('graphql')
    expect(g.timeline.start.slice(0, 4)).toBe('2013')
    expectLinesFollowLanes(g)
    expect(g.layout.lines.some((l) => l.dry)).toBe(true)
    // the starred repos GitHub counted no commits to (forks) keep their stars, as uncounted repos
    expect(g.layout.lines.some((l) => l.uncounted && l.stars > 0)).toBe(true)
    expect(g.layout.lines.some((l) => l.visiting)).toBe(true)
    expect(g.layout.years[0].year).toBe(2013)
    expect(g.layout.milestones.length).toBe(g.timeline.milestones.length)
  })

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s: paints the whole life, every number finite', (_id, theme) => {
    paintsCleanly(load(kepano, KEPANO_NOW, theme))
  })

  it('labels the lines with their names, the owner left off', () => {
    const g = load(kepano, KEPANO_NOW, light)
    const top = g.layout.lines.findIndex((l) => l.key === 'kepano/obsidian-skills')
    const { rec } = paint(g, { hover: { kind: 'repo', key: 'kepano/obsidian-skills' } })
    const texts = rec.calls('fillText').map((c) => String(c.args[0]))
    expect(top).toBeGreaterThanOrEqual(0)
    expect(texts).toContain('obsidian-skills')
    expect(texts.some((text) => text.startsWith('kepano/'))).toBe(false)
  })

  it('shows the panel, a repo and a day in the inspector, the legend and the strip', () => {
    const g = load(kepano, KEPANO_NOW, dark)
    const list = textOf(panel(g))
    expect(list).toContain(`${g.timeline.lanes.length} repos`)
    expect(list).toContain('kepano/obsidian-minimal')
    // nothing private here: no lock, no toggle (the legend's limits still speak of private repos)
    expect(list).not.toMatch(/private repo(?!s)/)

    setPerson({ hover: { kind: 'repo', key: 'kepano/obsidian-minimal' } })
    const lane = g.timeline.lanes.find((l) => l.repo === 'kepano/obsidian-minimal')!
    const repo = textOf(inspector(g))
    expect(repo).toContain(`born ${lane.born}`)
    expect(repo).toContain(`${lane.commits} commits on ${lane.activeDays} days`)
    expect(repo).toContain(`${lane.stars} stars`)

    const busiest = kepano.days.reduce((a, b) => (b.count > a.count ? b : a))
    setPerson({ hover: { kind: 'day', day: dayNumber(busiest.date), milestone: null } })
    const day = textOf(inspector(g))
    expect(day).toContain(busiest.date)
    expect(day).toContain(`${busiest.count} contributions`)
    expect(dayDetail(g.days, dayNumber(busiest.date)).repos.length).toBeGreaterThan(0)

    const limits = textOf(legend(g))
    for (const limit of dataLimits(kepano)) expect(limits).toContain(limit)
    expect(limits).toContain('default branch')
    expect(limits).toContain('read:user')

    const strip = textOf(status(g, true))
    expect(strip).toContain(`${g.timeline.lanes.length} repos`)
    expect(strip).toContain('2013–2026')
    expect(strip).toMatch(/\d+ contributions/)
    expect(strip).not.toContain('add a token')
  })

  it('renders in PersonApp, in a dark and a light theme', () => {
    for (const theme of [dark, light]) {
      const html = personApp(kepano, FAKE_TOKEN, theme)
      expect(html).toContain(`aria-label="life lines of kepano: ${kepano.repos.length} repos, 2013 to 2026"`)
      expect(textOf(html)).toContain('what GitHub\'s data leaves out')
      expect(textOf(html)).toMatch(/\d+ contributions/)
      expect(html).not.toContain('person mode coming soon')
    }
  })
})

describe('gaearon, without a token (REST)', () => {
  it('draws a line per repo, each as long as the repo was active', () => {
    const g = load(gaearon, GAEARON_NOW, light)
    expect(gaearon.source).toBe('rest')
    expect(g.layout.lines).toHaveLength(301)
    expectLinesFollowLanes(g)
    expect(g.layout.lines.some((l) => l.uncounted)).toBe(false)
    expect(g.layout.lines.some((l) => l.dry)).toBe(true)
    // tier 1: one span per repo, from its creation to its last push
    for (const lane of g.timeline.lanes) expect(lane.detailed).toBe(false)
  })

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s: paints the whole life, every number finite', (_id, theme) => {
    paintsCleanly(load(gaearon, GAEARON_NOW, theme))
  })

  it('says what a profile without a token leaves out: commits, and days before the recent pushes', () => {
    const g = load(gaearon, GAEARON_NOW, dark)
    const pushed = gaearon.recent.reduce((a, b) => (b.pushes > a.pushes ? b : a))
    const lane = g.timeline.lanes.find((l) => l.repo.toLowerCase() === pushed.repo.toLowerCase())!
    setPerson({ hover: { kind: 'repo', key: lane.repo.toLowerCase() } })
    const repo = textOf(inspector(g))
    expect(repo).toContain('commits are not counted without a token')
    expect(repo).not.toMatch(/\b0 commits\b/)
    expect(repo).toMatch(/\d+ push(es)? since 2026-10-02/)

    setPerson({ hover: { kind: 'day', day: dayNumber(pushed.date), milestone: null } })
    expect(textOf(inspector(g))).toMatch(/\d+ push(es)?/)
    setPerson({ hover: { kind: 'day', day: dayNumber('2026-09-01'), milestone: null } })
    expect(textOf(inspector(g))).toContain('no day detail before 2026-10-02 without a token')

    const limits = textOf(legend(g))
    for (const limit of dataLimits(gaearon)) expect(limits).toContain(limit)
    expect(limits).toContain('no commit counts without a token')
    expect(textOf(status(g, false))).toContain('add a token for commits')
  })

  it('renders in PersonApp, in a dark and a light theme', () => {
    for (const theme of [dark, light]) {
      const html = personApp(gaearon, '', theme)
      expect(html).toContain('aria-label="life lines of gaearon: 301 repos')
      expect(textOf(html)).toContain('add a token for commits')
    }
  })
})

/** A hand-made profile on today's clock. */
function made(over: Partial<ProfileData>): ProfileData {
  return {
    login: 'newcomer',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/9',
    createdAt: '2026-10-24T18:00:00Z',
    source: 'rest',
    repos: [],
    days: [],
    recent: [],
    recentFrom: '2026-09-25',
    milestones: [{ kind: 'joined', date: '2026-10-24T18:00:00Z', label: 'joined GitHub' }],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    landed: [],
    fallback: null,
    ...over,
  }
}

/** 2026-10-25 12:00 in Los Angeles. */
const NOW = Date.parse('2026-10-25T19:00:00Z')

function repo(nameWithOwner: string, createdAt: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  return {
    nameWithOwner,
    createdAt,
    firstActiveAt: createdAt,
    lastActiveAt: createdAt,
    isOwn: true,
    language: null,
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

describe('a user with no repos', () => {
  const empty = made({ createdAt: '2019-03-01T18:00:00Z', milestones: [{ kind: 'joined', date: '2019-03-01T18:00:00Z', label: 'joined GitHub' }] })
  const emptyToken = { ...empty, source: 'graphql' as const, recentFrom: null, days: [{ date: '2026-10-25', count: 0 }] }

  it('draws an empty life over the years since joining, in every theme', () => {
    for (const profile of [empty, emptyToken]) {
      const g = load(profile, NOW, dark)
      expect(g.layout.lines).toEqual([])
      expect(g.layout.years.map((y) => y.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026])
      expect(languagePalette(g.timeline, dark)).toEqual({})
      expect(g.colourOf(null)).toBe(dark.fallback)
      for (const theme of THEMES) paintsCleanly(load(profile, NOW, theme))
      // no labels to place, and nothing to draw for them
      const { rec, measured } = paint(g)
      expect(measured).toEqual([])
      expect(rec.calls('fillText').map((c) => String(c.args[0])).every((t) => /^(\d{4}|today)$/.test(t))).toBe(true)
    }
  })

  it('says so in the panel and the strip, and renders in PersonApp', () => {
    expect(textOf(panel(load(empty, NOW, dark)))).toContain('no public repos')
    expect(textOf(panel(load(emptyToken, NOW, dark)))).toContain('no repos')
    expect(textOf(status(load(empty, NOW, dark), false))).toContain('0 repos')
    expect(personApp(empty, '', light)).toContain('aria-label="life lines of newcomer: 0 repos, 2019 to 2026"')
  })
})

describe('an account a day old', () => {
  const young = made({ repos: [repo('newcomer/hello', '2026-10-25T16:00:00Z', { lastActiveAt: '2026-10-25T17:00:00Z', language: 'Go' })] })

  it('centres the short life at the closest zoom, and holds it there', () => {
    const g = load(young, NOW, dark)
    expect(g.layout.days).toBe(2)
    const camera = fitLifeCamera(g.layout.days, VIEW)
    expect(camera.k).toBe(LIFE_MAX_K)
    expect(camera.tx + (g.layout.days * camera.k) / 2).toBeCloseTo(VIEW.width / 2)
    expect(zoomLifeCamera(camera, 0.5, 300, g.layout.days, VIEW)).toEqual(camera)
    expect(zoomLifeCamera(camera, 2, 300, g.layout.days, VIEW)).toEqual(camera)
    expect(panLifeCamera(camera, 200, g.layout.days, VIEW)).toEqual(camera)
    expect(g.layout.lines).toHaveLength(1)
    expect(g.layout.lines[0].x).toBe(1.5)
    for (const theme of THEMES) paintsCleanly(load(young, NOW, theme))
  })

  it('shows its one day in the panel, the inspector and PersonApp', () => {
    const g = load(young, NOW, dark)
    const list = textOf(panel(g))
    expect(list).toContain('on GitHub since 2026-10-24')
    expect(list).toContain('newcomer/hello')
    setPerson({ hover: { kind: 'repo', key: 'newcomer/hello' } })
    expect(textOf(inspector(g))).toContain('born 2026-10-25')
    setPerson({ hover: { kind: 'day', day: dayNumber('2026-10-25'), milestone: null } })
    expect(textOf(inspector(g))).toContain(dayKey(g.timeline.todayDay))
    expect(personApp(young, '', dark)).toContain('aria-label="life lines of newcomer: 1 repo, 2026"')
  })
})
