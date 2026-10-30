/**
 * The order of person mode's lanes gives no hidden name away (PROFILE_SPEC.md section 2, "Privacy
 * rule"). Lanes rooted on one instant are told apart somehow, and that order shows: in the panel's
 * rows, a day's repo list, life lines' tracks, and which repo a milestone picks.
 * So a private repo renamed to the other end of the alphabet, or two private names swapped, must
 * change nothing a visitor can see while the names are hidden.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import PersonInspector from '../src/profile/PersonInspector'
import PersonPanel from '../src/profile/PersonPanel'
import { repoKey } from '../src/profile/privacy'
import { usePersonStore, type PersonState } from '../src/profile/usePersonStore'
import { dayKey, dayNumber } from '../src/profile/timeline'
import { getTheme } from '../src/theme/themes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { load, setApp, setPerson, type Loaded } from './helpers/personScene'

const theme = getTheme('obsidian')
const noop = () => {}

/** 2024-06-15 12:00 in Los Angeles. */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`
const commitsOn = (entries: Record<string, number>) => Object.entries(entries).map(([date, commits]) => ({ date, commits }))

/** The instant three private repos and a public fork were all created at. */
const BORN = iso('2021-03-03')

function repo(nameWithOwner: string, over: Partial<ProfileRepo>): ProfileRepo {
  const createdAt = over.createdAt ?? BORN
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

/**
 * What each private repo is, whatever it is called. All three are alike in every field a view seeds
 * from, so their twin seeds go by their order; one and two tie on stars (the most starred repo)
 * and with the public fork on their first day (a day's repo list); all three are the first repo. Three
 * is private only in a stale copy, so only the merge makes its lane private.
 */
const ONE: Partial<ProfileRepo> = { isPrivate: true, stars: 5, activity: commitsOn({ '2021-03-03': 2, '2021-03-10': 3 }) }
const TWO: Partial<ProfileRepo> = { isPrivate: true, stars: 5, activity: commitsOn({ '2021-03-03': 2, '2021-04-20': 1 }) }
const THREE: Partial<ProfileRepo> = { isPrivate: true, activity: commitsOn({ '2021-03-03': 1 }) }

/** The profile with its three private repos called names, in the order given. */
function profileWith(names: [string, string, string]): ProfileData {
  return {
    login: 'me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2019-01-10'),
    source: 'graphql',
    repos: [
      repo(names[0], ONE),
      repo(names[1], TWO),
      repo(names[2], { ...THREE, isPrivate: false }),
      repo(names[2].toUpperCase(), THREE),
      // public, rooted on the same instant: a fork, so the first-repo milestone is a private one's
      repo('me/fork', { isFork: true, activity: commitsOn({ '2021-03-03': 2 }) }),
      // public, and rooted earlier: a repo they contributed to
      repo('other/lib', { isOwn: false, createdAt: iso('2015-05-05'), firstActiveAt: iso('2020-06-01'), activity: commitsOn({ '2020-06-01': 4 }) }),
    ],
    days: [],
    recent: [],
    recentFrom: null,
    milestones: [],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    landed: [],
    fallback: null,
  }
}

const BASE: [string, string, string] = ['me/apple', 'me/kiwi', 'me/plum']
const VARIANTS: Array<[string, [string, string, string]]> = [
  ['apple renamed to the other end of the alphabet', ['me/zest', 'me/kiwi', 'me/plum']],
  ['apple and kiwi swapped', ['me/kiwi', 'me/apple', 'me/plum']],
  ['apple and plum swapped', ['me/plum', 'me/kiwi', 'me/apple']],
]

beforeEach(() => {
  usePersonStore.getState().resetFor('me')
  setPerson({ tab: 'repos', hover: null, selected: null, hidden: new Set(), search: '', revealFor: null })
  setApp({ panelOpen: true, token: 'not-a-token', themeId: theme.id })
})

/** Where a repo's lane is: what the views tie a repo to, in place of its name. */
function positionOf(g: Loaded, name: string): number {
  return g.timeline.lanes.findIndex((lane) => repoKey(lane.repo) === repoKey(name))
}

/** The panel's markup, on one tab. */
function panel(g: Loaded, tab: PersonState['tab']): string {
  setPerson({ tab, hover: null, selected: null })
  const { profile, timeline, colourOf, name, privateKeys } = g
  return renderToStaticMarkup(h(PersonPanel, { profile, timeline, colourOf, name, privateCount: privateKeys.size, revealed: false, onReveal: noop, theme }))
}

/** The inspector's markup with the store in state. */
function inspector(g: Loaded, state: Partial<PersonState>): string {
  setPerson({ hover: null, selected: null, ...state })
  const { profile, timeline, days, colourOf, name } = g
  return renderToStaticMarkup(h(PersonInspector, { profile, timeline, days, colourOf, name }))
}

/** Everything a visitor can see while the names are hidden, with repos as lane positions. */
function seen(g: Loaded) {
  const { timeline, layout, days, name } = g
  const lanes = timeline.lanes.map(({ repo: shown, ...rest }) => ({ ...rest, name: name(shown).text }))
  const dayRepos = [...days.repos]
    .sort((a, b) => a[0] - b[0])
    .map(([day, repos]) => [dayKey(day), repos.map((r) => [positionOf(g, r.repo), name(r.repo).text, r.n, r.unit])])
  const lines = layout.lines.map(({ key, ...rest }) => ({ ...rest, position: positionOf(g, key) }))
  const milestones = timeline.milestones.map(({ repo: shown, ...rest }) => ({ ...rest, position: shown ? positionOf(g, shown) : null }))
  const views = [
    panel(g, 'repos'),
    panel(g, 'milestones'),
    // every day with something on it, and every lane hovered, then pinned
    ...[...days.repos.keys()].sort((a, b) => a - b).map((day) => inspector(g, { hover: { kind: 'day', day, milestone: null } })),
    ...timeline.milestones.map((m, i) => inspector(g, { hover: { kind: 'day', day: dayNumber(m.day), milestone: i } })),
    ...timeline.lanes.map((lane) => inspector(g, { hover: { kind: 'repo', key: repoKey(lane.repo) } })),
    ...timeline.lanes.map((lane) => inspector(g, { selected: repoKey(lane.repo) })),
  ]
  return { lanes, dayRepos, lines, milestones, views }
}

describe('lane order and hidden names', () => {
  const base = load(profileWith(BASE), NOW, theme)

  it('is a case where name order would show: private lanes tie on their root, their day and their stars', () => {
    const { lanes } = base.timeline
    // public before private on the shared instant
    expect(lanes.map((lane) => (lane.isPrivate ? 'private' : lane.repo))).toEqual(['other/lib', 'me/fork', 'private', 'private', 'private'])
    expect(new Set(lanes.slice(1).map((lane) => lane.rootDay)).size).toBe(1)
    // one day lists the fork and all three, two of them tied
    expect(base.days.repos.get(dayNumber('2021-03-03'))?.map((r) => r.n)).toEqual([2, 2, 2, 1])
    expect(base.timeline.milestones.filter((m) => m.repo !== undefined).map((m) => m.kind)).toEqual(['first-repo', 'top-repo'])
  })

  for (const [label, names] of VARIANTS) {
    it(`shows the same panel, day lists, lines and milestones with ${label}`, () => {
      const expected = seen(base)
      const other = seen(load(profileWith(names), NOW, theme))
      expect(other.lanes).toEqual(expected.lanes)
      expect(other.dayRepos).toEqual(expected.dayRepos)
      expect(other.lines).toEqual(expected.lines)
      expect(other.milestones).toEqual(expected.milestones)
      expect(other.views).toEqual(expected.views)
    })
  }

  it('shows the same whatever order the repos come in', () => {
    const expected = seen(base)
    const profile = profileWith(BASE)
    expect(seen(load({ ...profile, repos: [...profile.repos].reverse() }, NOW, theme))).toEqual(expected)
  })
})
