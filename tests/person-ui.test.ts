/**
 * Person mode's panel, inspector, legend, status strip and error copy, rendered to HTML
 * (react-dom/server) after setting the stores, as pulls-ui does: what each shows per tier, that
 * dates are GitHub's day keys as written, and that no private repo name reaches the markup while
 * names are hidden, in text or in any attribute. Also PersonApp's layouts, one per view, kept for a
 * switch back.
 */
import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { viewLayouts } from '../src/PersonApp'
import personAppSource from '../src/PersonApp.tsx?raw'
import ErrorCard from '../src/components/ErrorCard'
import { petalAngles } from '../src/components/gardenLook'
import { formatClock } from '../src/components/gardenUtils'
import * as icons from '../src/components/icons'
import PersonInspector, { inspectorCard } from '../src/profile/PersonInspector'
import PersonLegend, { GRAPHQL_FAILED, LEGEND_BLOOM_PETALS, LEGEND_WILTED_PETALS, dataLimits } from '../src/profile/PersonLegend'
import PersonPanel, { RepoRow, onRepoRowKey, type RepoRowProps } from '../src/profile/PersonPanel'
import PersonStatus from '../src/profile/PersonStatus'
import { LINKS_PER_STAR } from '../src/profile/constellationLayout'
import { buildDayIndex } from '../src/profile/dayIndex'
import { viewInk, type LifeViewDef } from '../src/profile/lifeView'
import { lifeInk } from '../src/profile/lifeInk'
import { LIFE_VIEWS } from '../src/profile/lifeViews'
import { accountType, emptyLifeNote, fallbackNote, personErrorCopy } from '../src/profile/personErrors'
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon } from '../src/profile/personIcons'
import { PRIVATE_REPO_LABEL, isRevealed, privateRepoKeys, repoNamer } from '../src/profile/privacy'
import { buildLifeTimeline, dayNumber } from '../src/profile/timeline'
import { usePersonStore, type PersonState } from '../src/profile/usePersonStore'
import type { PersonView } from '../src/share/shareUrl'
import { useGardenStore, type GardenState } from '../src/store/useGardenStore'
import { getTheme } from '../src/theme/themes'
import { GitHubFetchError, type ProfileData, type ProfileRepo } from '../src/types'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const RESET = '2024-06-15T21:05:00Z'
const noop = () => {}
const theme = getTheme('obsidian')
const colourOf = (language: string | null) => (language === null ? theme.fallback : theme.accent)

/** A timestamp on a day: 20:00 UTC is 12:00 or 13:00 the same day in Los Angeles. */
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

/**
 * A token owner looking at themselves. The first and most starred repo is private, so the derived
 * first-repo and top-repo milestones name it; one repo is listed twice, private only in its stale
 * copy; one is someone else's they contributed to; one GitHub counted no commits to; and one was
 * created at 23:30 on New Year's Eve in Los Angeles, which is already January 1 in UTC and in Tokyo.
 */
const TOKEN: ProfileData = {
  login: 'Me',
  name: 'Me Myself',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
  createdAt: iso('2019-01-10'),
  source: 'graphql',
  repos: [
    repo('Me/Secret-Plans', {
      createdAt: iso('2019-02-01'),
      stars: 40,
      isPrivate: true,
      activity: [
        { date: '2019-02-01', commits: 3 },
        { date: '2019-02-02', commits: 2 },
      ],
    }),
    repo('Me/open', {
      createdAt: iso('2020-03-01'),
      stars: 2,
      forks: 1,
      activity: [
        { date: '2020-03-02', commits: 5 },
        { date: '2020-06-10', commits: 1 },
      ],
    }),
    repo('me/mixed', { createdAt: iso('2021-05-01'), lastActiveAt: iso('2021-05-01'), isPrivate: true, activity: [{ date: '2021-05-03', commits: 1 }] }),
    repo('Me/Mixed', { createdAt: iso('2021-05-01'), lastActiveAt: iso('2023-01-01'), isPrivate: false, activity: [{ date: '2021-05-03', commits: 1 }] }),
    repo('other/lib', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2021-07-04'), isOwn: false, language: 'Go', activity: [{ date: '2021-07-04', commits: 4 }] }),
    repo('Me/quiet', { createdAt: iso('2022-02-02'), lastActiveAt: iso('2022-03-01'), stars: 3, language: null }),
    repo('Me/old-tool', { createdAt: iso('2019-06-01'), isArchived: true, stars: 7, activity: [{ date: '2019-06-01', commits: 2 }] }),
    repo('Me/new-year', { createdAt: '2020-01-01T07:30:00Z', activity: [{ date: '2019-12-31', commits: 1 }] }),
  ],
  days: [
    { date: '2019-02-01', count: 4 },
    { date: '2019-02-02', count: 2 },
    { date: '2019-02-03', count: 0 },
    { date: '2020-03-02', count: 5 },
    { date: '2020-03-03', count: 2 },
  ],
  recent: [],
  recentFrom: null,
  milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
  restrictedContributions: 12,
  truncated: true,
  lostWindows: ['2022q3'],
  landed: [],
  fallback: null,
}

/** A visitor without a token: public repos, and pushes from recentFrom on. */
const PUBLIC: ProfileData = {
  login: 'octo',
  name: null,
  avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
  createdAt: iso('2018-04-01'),
  source: 'rest',
  repos: [
    repo('octo/site', { createdAt: iso('2018-05-01'), lastActiveAt: iso('2024-06-10'), language: 'HTML' }),
    repo('octo/tool', { createdAt: iso('2020-01-01'), lastActiveAt: iso('2021-01-01'), stars: 5, isArchived: true }),
  ],
  days: [],
  recent: [
    { date: '2024-06-10', repo: 'octo/site', pushes: 3 },
    { date: '2024-06-12', repo: 'octo/site', pushes: 1 },
  ],
  recentFrom: '2024-05-16',
  milestones: [{ kind: 'joined', date: iso('2018-04-01'), label: 'joined GitHub' }],
  restrictedContributions: 0,
  truncated: false,
  lostWindows: [],
  landed: [],
  fallback: null,
}

/** A token run GraphQL could not fill: REST's public profile, though the visitor has a token set. */
const FALLBACK: ProfileData = {
  ...PUBLIC,
  fallback: { message: 'GitHub GraphQL rate limit exceeded while reading contributions.', limit: 'graphql', resetAt: RESET },
}

/** Every private name of TOKEN, lowercased: Me/Secret-Plans, and Mixed through its stale copy. */
const PRIVATE_NAMES = ['me/secret-plans', 'me/mixed']

/** No private name, in any case and any part of the markup: text, title, aria-label, href, data-*. */
function expectNoPrivateName(html: string): void {
  const lower = html.toLowerCase()
  for (const name of PRIVATE_NAMES) expect(lower).not.toContain(name)
  expect(lower).not.toContain('secret')
}

/** The markup's text, tags and attributes taken out, entities read back. */
function textOf(html: string): string {
  return html
    // the markers react-dom/server puts between neighbouring text nodes
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

function setup(profile: ProfileData, revealed = false) {
  const timeline = buildLifeTimeline(profile, NOW)
  const keys = privateRepoKeys(profile)
  return { profile, timeline, keys, days: buildDayIndex(profile, timeline), name: repoNamer(keys, revealed) }
}

function panel(profile: ProfileData, revealed = false): string {
  const { timeline, keys, name } = setup(profile, revealed)
  return renderToStaticMarkup(
    h(PersonPanel, { profile, timeline, colourOf, name, privateCount: keys.size, revealed, onReveal: noop, theme }),
  )
}

function inspector(profile: ProfileData, revealed = false): string {
  const { timeline, days, name } = setup(profile, revealed)
  return renderToStaticMarkup(h(PersonInspector, { profile, timeline, days, colourOf, name }))
}

/** The legend of a view; the life garden's when view is left out. */
function legend(profile: ProfileData, view?: PersonView): string {
  const { timeline, keys } = setup(profile)
  return renderToStaticMarkup(h(PersonLegend, { profile, timeline, colourOf, theme, hasPrivate: keys.size > 0, view }))
}

const VIEWS: PersonView[] = ['garden', 'lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap', 'helix']

function status(profile: ProfileData, over: { cachedAt?: string | null; hasToken?: boolean } = {}): string {
  const { timeline } = setup(profile)
  return renderToStaticMarkup(
    h(PersonStatus, { profile, timeline, cachedAt: over.cachedAt ?? null, hasToken: over.hasToken ?? false, onRefresh: noop, onAddToken: noop }),
  )
}

/**
 * Server rendering reads a store's initial state (useSyncExternalStore's server snapshot), so the
 * state a test sets goes into both, as pulls-ui does. (Each test file has its own copy of the stores.)
 */
function syncPerson(): void {
  Object.assign(usePersonStore.getInitialState(), usePersonStore.getState())
}

function setPerson(partial: Partial<PersonState>): void {
  usePersonStore.setState(partial)
  syncPerson()
}

function setGarden(partial: Partial<GardenState>): void {
  useGardenStore.setState(partial)
  Object.assign(useGardenStore.getInitialState(), partial)
}

const hoverRepo = (key: string) => setPerson({ hover: { kind: 'repo', key } })
const hoverDay = (day: string, milestone: number | null = null) => setPerson({ hover: { kind: 'day', day: dayNumber(day), milestone } })

// Far from Los Angeles, so a date read in the viewer's time zone would show the wrong day.
beforeAll(() => {
  vi.stubEnv('TZ', 'Asia/Tokyo')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  usePersonStore.getState().resetFor('me')
  setPerson({ tab: 'repos' })
  setGarden({ panelOpen: true, rate: null })
})

describe('personErrorCopy', () => {
  it('words not_found for a user, with no token action', () => {
    const error = new GitHubFetchError('SailmanSeeulater was not found. Check the spelling.', 'not_found')
    for (const hasToken of [false, true]) {
      const copy = personErrorCopy(error, 'SailmanSeeulater', hasToken)
      expect(copy).toEqual({ title: 'user not found', hint: 'GitHub has no user called SailmanSeeulater. check the spelling.', tokenAction: false })
    }
    // the card shows the user wording, and no token button when PersonApp passes none
    const copy = personErrorCopy(error, 'SailmanSeeulater', false)
    const html = renderToStaticMarkup(h(ErrorCard, { code: 'not_found', message: error.message, title: copy.title, hint: copy.hint }))
    expect(html).toContain('user not found')
    expect(html).not.toContain('repo not found')
    expect(html).not.toContain('add a token')
  })

  it('keeps the token pitch for a rate limit without a token, and drops it with one', () => {
    const primary = new GitHubFetchError('GitHub API rate limit exceeded while looking up me.', 'rate_limited', RESET)
    expect(personErrorCopy(primary, 'me', false)).toEqual({ tokenAction: true })
    const withToken = personErrorCopy(primary, 'me', true)
    expect(withToken.tokenAction).toBe(false)
    expect(withToken.title).toBeUndefined()
    expect(withToken.hint).toBe(`resets at ${formatClock(RESET)}. this token's 5000 requests an hour are used up.`)
    expect(withToken.hint).not.toMatch(/add a token|anonymous/)
  })

  it('never offers a token for a secondary rate limit', () => {
    const secondary = new GitHubFetchError('GitHub API secondary rate limit exceeded while looking up me.', 'rate_limited', RESET)
    for (const hasToken of [false, true]) {
      const copy = personErrorCopy(secondary, 'me', hasToken)
      expect(copy.title).toBe('GitHub asked for a short pause')
      expect(copy.hint).toContain(`try again after ${formatClock(RESET)}`)
      expect(copy.tokenAction).toBe(false)
    }
    expect(personErrorCopy(new GitHubFetchError('GitHub API secondary rate limit exceeded.', 'rate_limited'), 'me', false).hint).toContain('wait a minute')
  })

  it('words unauthorized for a user, with the token action only when there is a token', () => {
    const error = new GitHubFetchError('GitHub rejected the token.', 'unauthorized')
    const withToken = personErrorCopy(error, 'me', true)
    expect(withToken.tokenAction).toBe(true)
    expect(withToken.title).toBeUndefined()
    expect(withToken.hint).not.toContain('repo')
    expect(personErrorCopy(error, 'me', false)).toEqual({ title: 'GitHub refused the request', hint: 'press Grow to try again in a while.', tokenAction: false })
  })

  it('words not_a_user by the account type the identity call names, never offering a token', () => {
    const said = (login: string, type: string) => new GitHubFetchError(`${login} is a GitHub ${type} account, not a user.`, 'not_a_user')
    expect(accountType(said('vercel', 'Organization').message)).toBe('Organization')
    expect(accountType(said('helper-bot', 'Bot').message)).toBe('Bot')
    expect(accountType('why')).toBeNull()
    for (const hasToken of [false, true]) {
      // an organization keeps the card's own words, which are an organization's
      expect(personErrorCopy(said('vercel', 'Organization'), 'vercel', hasToken)).toEqual({ tokenAction: false })
      expect(personErrorCopy(said('helper-bot', 'Bot'), 'helper-bot', hasToken)).toEqual({
        title: "that's a bot",
        hint: 'person mode shows people: try a repo it works on as owner/repo.',
        tokenAction: false,
      })
      // a type GitHub may add: never called an organization
      const other = personErrorCopy(said('someone', 'Mannequin'), 'someone', hasToken)
      expect(other.title).toBe("that's not a user account")
      expect(other.tokenAction).toBe(false)
    }
    // the bot's card: its own words, no organization, no token button
    const copy = personErrorCopy(said('helper-bot', 'Bot'), 'helper-bot', false)
    const html = textOf(renderToStaticMarkup(h(ErrorCard, { code: 'not_a_user', title: copy.title, hint: copy.hint })))
    expect(html).toContain("that's a bot")
    expect(html).not.toContain('organization')
    expect(html).not.toContain('add a token')
  })

  it('keeps the words of the network and abort cards, which fit a person as they are', () => {
    for (const code of ['network', 'aborted'] as const) {
      for (const hasToken of [false, true]) expect(personErrorCopy(new GitHubFetchError('why', code), 'me', hasToken)).toEqual({ tokenAction: false })
    }
    const offline = textOf(renderToStaticMarkup(h(ErrorCard, { code: 'network', message: 'Network error while looking up me: fetch failed' })))
    expect(offline).toContain("couldn't reach GitHub")
    expect(offline).toContain('press Grow again')
    expect(offline).not.toMatch(/repo/)
    expect(textOf(renderToStaticMarkup(h(ErrorCard, { code: 'aborted' })))).toContain('press Grow to start again')
  })

  it("keeps the card's own copy for every other code", () => {
    for (const code of ['not_a_user', 'network', 'aborted', 'unknown', 'invalid_url', 'empty_repo'] as const) {
      expect(personErrorCopy(new GitHubFetchError('why', code), 'me', false)).toEqual({ tokenAction: false })
    }
  })
})

describe('fallbackNote', () => {
  const fallback = (limit: 'graphql' | 'secondary' | null, resetAt: string | null) => ({ message: 'GitHub GraphQL rate limit exceeded while reading contributions.', limit, resetAt })

  it('says why REST filled a token run, in set words from the limit and its reset', () => {
    expect(fallbackNote(fallback('graphql', RESET)).text).toBe(`GraphQL limit reached until ${formatClock(RESET)}; showing the public profile`)
    expect(fallbackNote(fallback('graphql', null)).text).toBe('GraphQL limit reached; showing the public profile')
    expect(fallbackNote(fallback('secondary', RESET)).text).toBe(`GraphQL paused by a secondary rate limit until ${formatClock(RESET)}; showing the public profile`)
    expect(fallbackNote(fallback(null, null)).text).toBe('GraphQL failed; showing the public profile')
  })

  it("keeps GitHub's words for the title, without anything slashed in them", () => {
    const { text, title } = fallbackNote({
      message: 'GitHub refused the GraphQL query while listing repos: Resource not accessible on me/secret-plans, see https://github.com/me/secret-plans',
      limit: null,
      resetAt: null,
    })
    expect(text).not.toContain('Resource')
    expect(title).toContain('GitHub said: GitHub refused the GraphQL query while listing repos: Resource not accessible on')
    expectNoPrivateName(title)
  })
})

describe('emptyLifeNote', () => {
  const lanesOf = (profile: ProfileData) => buildLifeTimeline(profile, NOW).lanes
  const none = new Set<string>()

  it('says nothing while any repo is drawn', () => {
    expect(emptyLifeNote(PUBLIC, lanesOf(PUBLIC), none, false)).toBeNull()
    expect(emptyLifeNote(TOKEN, lanesOf(TOKEN), new Set(['me/open']), true)).toBeNull()
  })

  it('words a life with no repos by its tier, nudging toward a token only without one', () => {
    const empty: ProfileData = { ...PUBLIC, repos: [], recent: [] }
    expect(emptyLifeNote(empty, [], none, false)).toEqual({
      title: 'octo has no public repos yet',
      hint: 'with a token, repos they contributed to show too.',
      action: { kind: 'token', label: 'add a token' },
    })
    // a token is set: REST filled it because GraphQL failed, so no nudge, and no hint the strip already gives
    expect(emptyLifeNote(empty, [], none, true)).toEqual({ title: 'octo has no public repos yet' })
    // (the note reads the lanes, not the profile's repos: no lanes is no repos)
    expect(emptyLifeNote(FALLBACK, [], none, true)).toEqual({ title: 'octo has no public repos yet' })
    expect(emptyLifeNote(FALLBACK, [], none, false)).toEqual({ title: 'octo has no public repos yet' })
    const graphql = emptyLifeNote(TOKEN, [], none, true)
    expect(graphql?.title).toBe('Me has no repos to show yet')
    expect(graphql?.hint).toContain('counted no commits')
    expect(graphql?.action).toBeUndefined()
  })

  it('offers to show every repo once the eyes hid them all', () => {
    const lanes = lanesOf(PUBLIC)
    expect(emptyLifeNote(PUBLIC, lanes, new Set(['octo/site']), false)).toBeNull()
    expect(emptyLifeNote(PUBLIC, lanes, new Set(['octo/site', 'octo/tool']), false)).toEqual({
      title: 'all 2 repos are hidden',
      hint: 'hidden with the eye in the repo list.',
      action: { kind: 'show-all', label: 'show all' },
    })
    // a token profile's lanes, every one hidden by its key: private ones say nothing of their names
    const tokenLanes = lanesOf(TOKEN)
    const note = emptyLifeNote(TOKEN, tokenLanes, new Set(tokenLanes.map((lane) => lane.repo.toLowerCase())), true)
    expect(note?.title).toBe('all 7 repos are hidden')
    expectNoPrivateName(JSON.stringify(note))
    const one: ProfileData = { ...PUBLIC, repos: [PUBLIC.repos[0]] }
    expect(emptyLifeNote(one, lanesOf(one), new Set(['octo/site']), false)).toMatchObject({ title: 'its only repo is hidden', action: { label: 'show it' } })
  })
})

describe('PersonStatus', () => {
  it('shows the fallback note in the idle strip, with the raw message only in its title', () => {
    const message = 'GitHub GraphQL rate limit exceeded while reading contributions.'
    const html = status({ ...PUBLIC, fallback: { message, limit: 'graphql', resetAt: RESET } }, { hasToken: true })
    expect(textOf(html)).toContain(`GraphQL limit reached until ${formatClock(RESET)}; showing the public profile`)
    expect(textOf(html)).not.toContain(message)
    expect(html).toMatch(new RegExp(`title="[^"]*GitHub said: ${message}"`))
    expect(textOf(html)).toContain('try again')
    // a token is set: no nudge to add one
    expect(html).not.toContain('add a token')
  })

  it('counts repos, years and (with a token) contributions, and names what was cut short', () => {
    const text = textOf(status(TOKEN, { hasToken: true }))
    // Mixed's two copies are one repo
    expect(text).toContain('7 repos')
    expect(text).toContain('2019–2024')
    expect(text).toContain('13 contributions')
    expect(text).toContain('profile truncated')
    expect(status(TOKEN, { hasToken: true })).toContain('2022q3')
    expect(text).not.toContain('requests left')
  })

  it("counts the pull requests landed in other people's repos, with a token, by repo", () => {
    const landed: ProfileData = {
      ...TOKEN,
      repos: [...TOKEN.repos, repo('Up/tool', { isOwn: false, createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-01-01'), lastActiveAt: iso('2022-01-01') })],
      landed: [
        { day: '2021-07-04', repo: 'other/lib' },
        { day: '2021-08-01', repo: 'Other/Lib' },
        { day: '2022-01-01', repo: 'Up/tool' },
      ],
    }
    const text = textOf(status(landed, { hasToken: true }))
    expect(text).toContain('8 repos')
    expect(text).toContain('3 prs landed in 2 repos')
    expect(textOf(status({ ...TOKEN, landed: [{ day: '2021-07-04', repo: 'other/lib' }] }, { hasToken: true }))).toContain('1 pr landed in 1 repo')
    // none landed, or no token: nothing said
    expect(textOf(status(TOKEN, { hasToken: true }))).not.toContain('landed')
    expect(textOf(status(PUBLIC))).not.toContain('landed')
  })

  it('nudges toward a token with a button that says what a token adds, never with one set', () => {
    const nudge = /<button[^>]*title="([^"]*)"[^>]*>add a token for commits<\/button>/.exec(status(PUBLIC))
    expect(nudge?.[1]).toContain('the commits GitHub counted')
    expect(nudge?.[1]).toContain('from 60 requests to 5000')
    for (const profile of [TOKEN, FALLBACK]) expect(status(profile, { hasToken: true })).not.toContain('add a token')
    // cached or truncated, a token still adds commit counts
    expect(textOf(status({ ...PUBLIC, truncated: true }, { cachedAt: '2024-06-15T18:00:00Z' }))).toContain('add a token for commits')
  })

  it('counts the core budget left as the repo garden does: from the store, only for a live fetch', () => {
    setGarden({ rate: { limit: 5000, remaining: 4990, resetAt: RESET } })
    const live = status(TOKEN, { hasToken: true })
    expect(live).toContain('title="GitHub API requests remaining this hour"')
    expect(textOf(live)).toContain('4990 requests left')
    expect(textOf(status(TOKEN, { hasToken: true, cachedAt: '2024-06-15T18:00:00Z' }))).not.toContain('requests left')
  })

  it('nudges a visitor without a token, and shows the cache and the budget', () => {
    const text = textOf(status(PUBLIC))
    expect(text).toContain('2 repos')
    expect(text).toContain('2018–2024')
    expect(text).not.toContain('contribution')
    expect(text).toContain('add a token for commits')
    expect(text).not.toContain('truncated')
    expect(text).not.toContain('cached')
    const cached = textOf(status(PUBLIC, { cachedAt: '2024-06-15T18:00:00Z' }))
    expect(cached).toContain('cached')
    expect(cached).toContain('refresh')
    setGarden({ rate: { limit: 60, remaining: 51, resetAt: RESET } })
    expect(textOf(status(PUBLIC))).toContain('51 requests left')
    // a cached profile used no requests: the budget is not its story
    expect(textOf(status(PUBLIC, { cachedAt: '2024-06-15T18:00:00Z' }))).not.toContain('requests left')
  })

  it('says how long ago a cached copy was fetched, not only the time of day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    try {
      // 09:00 UTC is 18:00 in Tokyo, where the viewer is
      const html = status(PUBLIC, { cachedAt: '2024-06-15T09:00:00Z' })
      expect(textOf(html)).toContain('cached 10h ago')
      expect(html).toContain('title="Shown from this browser&#x27;s cache (fetched 10h ago at 18:00), so it used no GitHub requests."')
      // a copy from yesterday: the time alone would read as this morning
      expect(status(PUBLIC, { cachedAt: '2024-06-14T20:00:00Z' })).toContain('fetched 23h ago at 05:00')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('PersonLegend', () => {
  it('lists every limit of the token tier, with what was cut short and the quarters lost', () => {
    const limits = dataLimits(TOKEN)
    expect(limits.join(' ')).toMatch(/default branch.*gh-pages.*email linked to the account.*not in forks/)
    expect(limits.join(' ')).toMatch(/read:user.*12 contributions here/)
    expect(limits.join(' ')).toContain('US Pacific time')
    expect(limits.join(' ')).toContain('differ from the count on their github.com profile')
    expect(limits.join(' ')).toMatch(/fetch cap \(500 repos, or 100 repos in one quarter\)/)
    expect(limits.join(' ')).toContain('GitHub did not answer for 2022q3')
    const text = textOf(legend(TOKEN))
    for (const limit of limits) expect(text).toContain(limit)
  })

  it('lists every limit of the tier without a token', () => {
    const limits = dataLimits(PUBLIC)
    expect(limits.join(' ')).toContain('no commit counts without a token')
    expect(limits.join(' ')).toContain('from its creation to its last push')
    expect(limits.join(' ')).toContain('pushes per repo per day from 2024-05-16')
    expect(limits.join(' ')).toContain('about 30 days')
    expect(limits.join(' ')).toContain('public repos')
    expect(limits.join(' ')).toContain('US Pacific time')
    expect(limits.join(' ')).not.toMatch(/default branch|read:user|cap|did not answer/)
    expect(dataLimits({ ...PUBLIC, truncated: true }).join(' ')).toContain('over 500 repos: only the oldest 500 are shown')
    const text = textOf(legend(PUBLIC))
    for (const limit of limits) expect(text).toContain(limit)
  })

  it('explains the glyphs the profile has, and its languages', () => {
    /** The glyph grid's labels. */
    const labels = (html: string) => [...html.matchAll(/<span class="text-\[12px\] text-garden-text-dim">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(labels(legend(TOKEN))).toEqual(['stars', 'no stars', 'active span', 'archived', 'fork', 'milestone', 'contributed', 'seedling', 'private repo'])
    expect(labels(legend(PUBLIC))).toEqual(['stars', 'no stars', 'active span', 'archived', 'fork', 'milestone'])
    const token = textOf(legend(TOKEN))
    expect(token).toContain('height: the commits GitHub counted')
    for (const language of ['TypeScript', 'Go', 'no language']) expect(token).toContain(language)
    expect(textOf(legend(PUBLIC))).toContain('height: how long it was active')
  })

  it("words the limits by the view's own measure, in every tier", () => {
    /** What a repo is measured by in each view: with counted commits, and in their place without them. */
    const MEASURES: Record<PersonView, { counted: string; uncounted: string }> = {
      garden: { counted: "a plant's height", uncounted: "a plant's height is how long the repo was active" },
      lines: { counted: "a line's thickness", uncounted: 'every line is drawn one thickness, and its thick run is how long the repo was active' },
      constellation: { counted: "a star's size", uncounted: "a star's size is how long the repo was active" },
      phosphor: { counted: "a stack's height", uncounted: "a stack's height is how long the repo was active" },
      htop: { counted: "a meter's brightness", uncounted: "every active stretch of a meter is lit full, and a meter's length is how long the repo was active" },
      gitlog: { counted: "a branch's run of commits", uncounted: "a branch has a commit at its start and at its last push, and its length is how long the repo was active" },
      minimap: { counted: "a token's length", uncounted: "a token's length is how long the repo was active" },
      helix: { counted: "a thread's thickness", uncounted: 'every thread is wound one thickness, and its thick run is how long the repo was active' },
    }
    for (const view of VIEWS) {
      const own = MEASURES[view]
      const token = dataLimits(TOKEN, view)
      const rest = dataLimits(PUBLIC, view)
      const fallback = dataLimits(FALLBACK, view)
      expect(token.join(' '), view).toContain(`and not in forks: ${own.counted} counts only those.`)
      expect(rest.join(' '), view).toContain(`no commit counts without a token: ${own.uncounted}, from its creation to its last push.`)
      expect(fallback.join(' '), view).toContain(`no commit counts: ${GRAPHQL_FAILED}. ${own.uncounted}, from its creation to its last push.`)
      for (const [profile, limits] of [
        [TOKEN, token],
        [PUBLIC, rest],
        [FALLBACK, fallback],
      ] as const) {
        // no other view's measure, and only the measure differs from the garden's limits
        for (const other of VIEWS) if (other !== view) expect(limits.join(' '), `${view} ${profile.source}`).not.toContain(MEASURES[other].counted)
        const garden = dataLimits(profile, 'garden')
        expect(limits.filter((limit, i) => limit !== garden[i]), `${view} ${profile.source}`).toHaveLength(view === 'garden' ? 0 : 1)
        // the view's legend lists them, and no plant outside the garden
        const html = legend(profile, view)
        for (const limit of limits) expect(textOf(html), `${view} ${profile.source}`).toContain(limit)
        if (view !== 'garden') expect(html, `${view} ${profile.source}`).not.toContain('plant')
      }
    }
    // left out, the view is the life garden
    expect(dataLimits(PUBLIC)).toEqual(dataLimits(PUBLIC, 'garden'))
    expect(dataLimits(TOKEN)).toEqual(dataLimits(TOKEN, 'garden'))
  })

  it("shows each language in the colour the view paints it: the theme's in a life view, a console view's own, none on phosphor or the helix", () => {
    for (const profile of [TOKEN, PUBLIC]) {
      const { timeline } = setup(profile)
      for (const view of VIEWS) {
        const html = legend(profile, view)
        const where = `${view} ${profile.source}`
        const swatches = [...html.matchAll(/<span class="h-2 w-2 shrink-0 rounded-full" style="background:([^"]+)"><\/span>([^<]*)<\/li>/g)].map(
          (m) => [m[2], m[1]] as const,
        )
        if (view === 'phosphor' || view === 'helix') {
          // one green (one amber) for every repo: no language swatch would match the screen
          expect(swatches, where).toEqual([])
          expect(textOf(html), where).toContain(view === 'phosphor' ? 'one green for every repo' : 'one amber for every repo')
          continue
        }
        expect(swatches.length, where).toBeGreaterThan(0)
        const def = LIFE_VIEWS[view]
        const layout = def.layout(timeline, profile.source)
        const items = def.scene.items(layout)
        const ink = viewInk(lifeInk(theme), def)
        let checked = 0
        for (const [language, colour] of swatches) {
          const shown = language === 'no language' ? null : language
          // a live repo of that language, as the canvas colours it (an archived one is drawn dry)
          const i = items.findIndex((item) => timeline.lanes[item.lane].language === shown && !timeline.lanes[item.lane].isArchived)
          if (i < 0) continue
          expect(colour, `${where} ${language}`).toBe(def.scene.itemColour(layout, i, ink, colourOf))
          checked++
        }
        expect(checked, where).toBeGreaterThan(0)
      }
    }
  })

  it('lists the landed PR glyph in every view, only while a lane has one', () => {
    const landed: ProfileData = { ...TOKEN, landed: [{ day: '2021-08-01', repo: 'other/lib' }] }
    for (const view of VIEWS) {
      expect(legend(TOKEN, view)).not.toContain('landed PR')
      const html = legend(landed, view)
      expect(html).toContain('landed PR')
      expect(html).toContain('merged into a repo they do not own')
    }
    expect(legend(PUBLIC)).not.toContain('landed PR')
  })

  it('says what links two stars: the months they share, and the two each star shares the most with', () => {
    /** The glyph grid's hints by label, entities read back. */
    const hints = (html: string) =>
      new Map(
        [...html.matchAll(/<li class="[^"]*" title="([^"]*)">[\s\S]*?<span class="text-\[12px\] text-garden-text-dim">([^<]*)<\/span><\/li>/g)].map(
          (m) => [m[2], textOf(m[1])] as const,
        ),
      )
    for (const profile of [TOKEN, PUBLIC]) {
      expect(hints(legend(profile, 'constellation')).get('active together')).toBe(
        'a faint line links repos active in the same months: each star to at most the two it shares the most months with, and in a busy month only its busiest repos',
      )
    }
    // "the two": the partners each star picks
    expect(LINKS_PER_STAR).toBe(2)
    expect(legend(TOKEN, 'constellation')).not.toContain('closest')
  })
})

describe('PersonInspector', () => {
  it('shows nothing with nothing hovered or selected', () => {
    expect(inspector(TOKEN)).toBe('')
  })

  it('shows a repo: name, born, active spans, commits and stars', () => {
    hoverRepo('me/open')
    const html = inspector(TOKEN)
    const text = textOf(html)
    expect(text).toContain('Me/open')
    expect(text).toContain('born 2020-03-01')
    expect(text).toContain('2 active spans')
    expect(text).toContain('2020-03-01 – 2020-03-02')
    expect(text).toContain('2020-06-10 · 1 commit')
    expect(text).toContain('6 commits on 2 days')
    expect(text).toContain('2 stars · 1 fork')
    expect(html).toContain('href="https://github.com/Me/open"')
    // hovered, not pinned: no close button
    expect(html).not.toContain('aria-label="Close"')
  })

  it('counts the pull requests landed in a repo, with their first and last day', () => {
    const landed: ProfileData = {
      ...TOKEN,
      landed: [
        { day: '2021-08-01', repo: 'other/lib' },
        { day: '2021-07-04', repo: 'other/lib' },
        { day: '2021-07-04', repo: 'Other/Lib' },
      ],
    }
    hoverRepo('other/lib')
    expect(textOf(inspector(landed))).toContain('3 prs landed · first 2021-07-04 · last 2021-08-01')
    expect(textOf(inspector({ ...TOKEN, landed: [{ day: '2021-08-01', repo: 'other/lib' }] }))).toContain('1 pr landed on 2021-08-01')
    expect(textOf(inspector(TOKEN))).not.toContain('landed')
  })

  it('lists the pull requests landed on a day, by repo, names masked', () => {
    const landed: ProfileData = {
      ...TOKEN,
      repos: [...TOKEN.repos, repo('Hush/vault', { isOwn: false, isPrivate: true, createdAt: iso('2015-01-01'), firstActiveAt: iso('2020-03-03'), lastActiveAt: iso('2020-03-03') })],
      landed: [
        { day: '2020-03-03', repo: 'Hush/vault' },
        { day: '2020-03-03', repo: 'other/lib' },
        { day: '2020-03-03', repo: 'hush/VAULT' },
      ],
    }
    hoverDay('2020-03-03')
    const html = inspector(landed)
    const text = textOf(html)
    expect(text).toContain('2 contributions')
    expect(text).toContain(`${PRIVATE_REPO_LABEL} 2 prs landed`)
    expect(text).toContain('other/lib 1 pr landed')
    expect(text).not.toContain('no commits to a repo listed here')
    expectNoPrivateName(html)
    expect(html.toLowerCase()).not.toContain('hush/vault')
    expect(textOf(inspector(landed, true))).toContain('Hush/vault 2 prs landed')
  })

  it('prints days as GitHub keys them, in no other time zone', () => {
    // the viewer is in Tokyo, where this instant is already January 1
    expect(new Date('2020-01-01T07:30:00Z').getTimezoneOffset()).toBe(-540)
    hoverRepo('me/new-year')
    expect(textOf(inspector(TOKEN))).toContain('born 2019-12-31')
  })

  it('shows where the person arrived in a repo they only contributed to', () => {
    hoverRepo('other/lib')
    const text = textOf(inspector(TOKEN))
    expect(text).toContain('contributed')
    expect(text).toContain('born 2015-01-01')
    expect(text).toContain('first contributed 2021-07-04')
  })

  it('says GitHub counted no commits to a repo without detail, and how an archived one ended', () => {
    hoverRepo('me/quiet')
    const quiet = textOf(inspector(TOKEN))
    expect(quiet).toContain('GitHub counted no commits to it')
    expect(quiet).toContain('no language')
    expect(quiet).not.toContain('0 commits')
    hoverRepo('me/old-tool')
    expect(textOf(inspector(TOKEN))).toContain('archived, last active 2019-06-01')
  })

  it('shows pushes, not commits, without a token', () => {
    hoverRepo('octo/site')
    const text = textOf(inspector(PUBLIC))
    expect(text).toContain('commits are not counted without a token')
    expect(text).not.toMatch(/\d commits? on/)
    expect(text).toContain('4 pushes since 2024-05-16')
    expect(text).toContain('born 2018-05-01')
    expect(text).toContain('1 active span')
  })

  it('hides a private name, with no link, until revealed; revealed, it keeps its lock and still no link', () => {
    hoverRepo('me/secret-plans')
    const hidden = inspector(TOKEN)
    expect(textOf(hidden)).toContain(PRIVATE_REPO_LABEL)
    expect(textOf(hidden)).toContain('40 stars')
    expect(hidden).not.toContain('href=')
    expectNoPrivateName(hidden)
    const shown = inspector(TOKEN, true)
    expect(textOf(shown)).toContain('Me/Secret-Plans')
    expect(shown).toContain('title="private repo"')
    expect(shown).not.toContain('href=')
    // a repo private only in its stale copy is private too
    hoverRepo('me/mixed')
    expectNoPrivateName(inspector(TOKEN))
  })

  it('pins the selected repo with a close button', () => {
    setPerson({ selected: 'me/open' })
    const html = inspector(TOKEN)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Close"')
    expect(textOf(html)).toContain('Me/open')
  })

  it('lets the pointer through a card that follows the hover; only the pinned card takes it', () => {
    /** The card's own classes, on its outermost element. */
    const cardClass = (html: string) => /^<div[^>]*class="([^"]*)"/.exec(html)?.[1].split(' ') ?? []
    hoverRepo('me/open')
    expect(cardClass(inspector(TOKEN))).toContain('pointer-events-none')
    hoverDay('2020-03-02')
    expect(cardClass(inspector(TOKEN))).toContain('pointer-events-none')
    setPerson({ hover: null, selected: 'me/open' })
    const pinned = inspector(TOKEN)
    expect(pinned).toContain('role="dialog"')
    expect(cardClass(pinned)).not.toContain('pointer-events-none')
    expect(cardClass(pinned)).toContain('absolute')
  })

  it('keeps the pinned repo over a plain day, and gives way to a milestone or another repo', () => {
    const { timeline } = setup(TOKEN)
    const first = timeline.milestones.findIndex((m) => m.kind === 'first-repo')
    setPerson({ selected: 'me/open' })
    // crossing the ground to reach the card: a day with contributions, and one with nothing
    for (const day of ['2020-03-03', '2023-08-08']) {
      hoverDay(day)
      const html = inspector(TOKEN)
      expect(html).toContain('role="dialog"')
      expect(textOf(html)).toContain('6 commits on 2 days')
      expect(textOf(html)).not.toContain(day)
    }
    hoverDay('2019-02-01', first)
    const milestone = inspector(TOKEN)
    expect(milestone).not.toContain('role="dialog"')
    expect(textOf(milestone)).toContain('first repo')
    hoverRepo('other/lib')
    const other = inspector(TOKEN)
    expect(other).not.toContain('role="dialog"')
    expect(textOf(other)).toContain('first contributed 2021-07-04')
    // the selected repo's own plant: still the pinned card
    hoverRepo('me/open')
    expect(inspector(TOKEN)).toContain('role="dialog"')
  })

  it("shows a day: the calendar's count, commits by repo and the milestones there, names masked", () => {
    const { timeline } = setup(TOKEN)
    const first = timeline.milestones.findIndex((m) => m.kind === 'first-repo')
    hoverDay('2019-02-01', first)
    const html = inspector(TOKEN)
    const text = textOf(html)
    expect(text).toContain('2019-02-01 fri')
    expect(text).toContain('4 contributions')
    expect(text).toContain(`${PRIVATE_REPO_LABEL} 3 commits`)
    expect(text).toContain('first repo')
    expect(text).toContain('most starred repo: 40 stars')
    expect(text).toContain('rooted this day')
    expectNoPrivateName(html)
    expect(textOf(inspector(TOKEN, true))).toContain('Me/Secret-Plans 3 commits')
  })

  it('says when a token day has contributions but no commits to a repo', () => {
    hoverDay('2020-03-03')
    const text = textOf(inspector(TOKEN))
    expect(text).toContain('2 contributions')
    expect(text).toContain('no commits to a repo listed here')
    hoverDay('2019-02-03')
    expect(textOf(inspector(TOKEN))).toContain('0 contributions')
  })

  it('shows pushes on a recent day without a token, and no detail before recentFrom', () => {
    hoverDay('2024-06-10')
    const recent = textOf(inspector(PUBLIC))
    expect(recent).toContain('octo/site 3 pushes')
    hoverDay('2024-06-11')
    expect(textOf(inspector(PUBLIC))).toContain('no public pushes')
    hoverDay('2024-01-02')
    const before = textOf(inspector(PUBLIC))
    expect(before).toContain('no day detail before 2024-05-16 without a token')
    expect(before).not.toContain('no public pushes')
  })
})

describe('inspectorCard', () => {
  const day = { kind: 'day' as const, day: dayNumber('2020-03-03'), milestone: null }
  const milestone = { kind: 'day' as const, day: dayNumber('2019-02-01'), milestone: 1 }
  const pinned = { kind: 'repo', key: 'me/open', pinned: true }

  it('shows the hover with nothing selected, and the selection with nothing hovered', () => {
    expect(inspectorCard(null, null)).toBeNull()
    expect(inspectorCard(day, null)).toEqual(day)
    expect(inspectorCard(milestone, null)).toEqual(milestone)
    expect(inspectorCard({ kind: 'repo', key: 'other/lib' }, null)).toEqual({ kind: 'repo', key: 'other/lib', pinned: false })
    expect(inspectorCard(null, 'me/open')).toEqual(pinned)
  })

  it('keeps the selection over a plain day, and gives way to a repo or a milestone', () => {
    expect(inspectorCard(day, 'me/open')).toEqual(pinned)
    expect(inspectorCard(milestone, 'me/open')).toEqual(milestone)
    expect(inspectorCard({ kind: 'repo', key: 'other/lib' }, 'me/open')).toEqual({ kind: 'repo', key: 'other/lib', pinned: false })
    expect(inspectorCard({ kind: 'repo', key: 'me/open' }, 'me/open')).toEqual(pinned)
  })
})

describe('PersonPanel', () => {
  it('lists repos with names hidden by default, behind a toggle that says so', () => {
    const html = panel(TOKEN)
    expectNoPrivateName(html)
    const text = textOf(html)
    expect(text).toContain('2 private repos: names hidden')
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>(?:(?!<\/button>).)*private repos/)
    expect(text).toContain('Me/open')
    expect(text).toContain(PRIVATE_REPO_LABEL)
    expect(html).toContain('aria-label="Hide private repo"')
    expect(text).toContain('7 repos')
    expect(html).toContain('href="https://github.com/Me"')
    expect(text).toContain('on GitHub since 2019-01-10')
  })

  it('shows the names once revealed, still with no link to a private repo', () => {
    const html = panel(TOKEN, true)
    expect(html).toContain('Me/Secret-Plans')
    expect(textOf(html)).toContain('names shown on this screen')
    expect(html).toMatch(/aria-pressed="true"/)
    expect(html.toLowerCase()).not.toContain('github.com/me/secret-plans')
  })

  it('stays hidden when the toggle was turned on for another login', () => {
    const { timeline, keys } = setup(TOKEN)
    const revealed = isRevealed('someone-else', TOKEN.login)
    const html = renderToStaticMarkup(
      h(PersonPanel, { profile: TOKEN, timeline, colourOf, name: repoNamer(keys, revealed), privateCount: keys.size, revealed, onReveal: noop, theme }),
    )
    expectNoPrivateName(html)
  })

  it('locks the toggle while a recording runs or a poster is made, revealed or not, and says why', () => {
    const { timeline, keys } = setup(TOKEN)
    /** the privacy toggle's opening tag */
    const toggle = (html: string) => /<button[^>]*aria-pressed="(?:true|false)"[^>]*>(?=(?:(?!<\/button>).)*private repos)/.exec(html)?.[0] ?? ''
    for (const revealed of [false, true]) {
      const props = { profile: TOKEN, timeline, colourOf, name: repoNamer(keys, revealed), privateCount: keys.size, revealed, onReveal: noop, theme }
      const locked = toggle(renderToStaticMarkup(h(PersonPanel, { ...props, revealLocked: true })))
      expect(locked).toMatch(/\sdisabled=""/)
      expect(locked).toContain('Waits until the recording or poster is done')
      expect(locked).toContain(`aria-pressed="${revealed}"`)
      for (const free of [renderToStaticMarkup(h(PersonPanel, props)), renderToStaticMarkup(h(PersonPanel, { ...props, revealLocked: false }))]) {
        const tag = toggle(free)
        expect(tag).toContain('aria-pressed=')
        expect(tag).not.toMatch(/\sdisabled=""/)
        expect(tag).toContain('Shows private repo names on this screen only')
      }
    }
  })

  it('has no toggle without private repos', () => {
    const text = textOf(panel(PUBLIC))
    expect(text).not.toContain('private repo')
    expect(text).toContain('2 repos')
  })

  it('searches only what is shown, so a hidden name cannot be guessed', () => {
    setPerson({ search: 'secret' })
    expect(textOf(panel(TOKEN))).toContain('no repos match · clear search')
    expect(panel(TOKEN)).toMatch(/<button type="button"[^>]*>clear search<\/button>/)
    setPerson({ search: 'PRIVATE' })
    expect(textOf(panel(TOKEN))).toContain('2 of 7 repos')
    setPerson({ search: 'go' })
    expect(textOf(panel(TOKEN))).toContain('other/lib')
    setPerson({ search: 'secret' })
    expect(textOf(panel(TOKEN, true))).toContain('1 of 7 repos')
  })

  it('marks hidden and selected rows', () => {
    usePersonStore.getState().toggleHidden('Me/open')
    usePersonStore.getState().select('me/quiet')
    syncPerson()
    const text = textOf(panel(TOKEN))
    expect(text).toContain('show 1 hidden')
    expect(text).toContain('clear selection')
    expect(panel(TOKEN)).toContain('aria-label="Show Me/open"')
  })

  it('lists the milestones by GitHub day, with private names masked', () => {
    setPerson({ tab: 'milestones' })
    const html = panel(TOKEN)
    const text = textOf(html)
    expect(text).toContain('2019-01-10 joined GitHub')
    expect(text).toContain(`2019-02-01 first repo ${PRIVATE_REPO_LABEL}`)
    expect(text).toContain('most starred repo: 40 stars')
    expectNoPrivateName(html)
  })

  it('works for a user with no public repos, and an account made today', () => {
    const empty: ProfileData = { ...PUBLIC, repos: [], recent: [], createdAt: '2024-06-15T16:00:00Z', milestones: [] }
    const text = textOf(panel(empty))
    expect(text).toContain('no public repos')
    expect(text).toContain('0 repos')
    expect(textOf(status(empty))).toContain('0 repos · 2024')
    setPerson({ tab: 'milestones' })
    expect(textOf(panel(empty))).toContain('no milestones yet')
    expect(inspector(empty)).toBe('')
  })

  it('collapses to its open button', () => {
    setGarden({ panelOpen: false })
    const html = panel(TOKEN)
    expect(html).toContain('aria-label="Open panel"')
    expect(html).not.toContain('<aside')
  })
})

describe('a repo row from the keyboard', () => {
  type Props = Record<string, unknown> & { children?: ReactNode }

  /** The first element of a tree, as a component returns it (not rendered), that passes test. */
  function find(node: ReactNode, test: (element: ReactElement<Props>) => boolean): ReactElement<Props> {
    const walk = (at: ReactNode): ReactElement<Props> | null => {
      if (Array.isArray(at)) {
        for (const child of at) {
          const found = walk(child)
          if (found) return found
        }
        return null
      }
      if (!isValidElement<Props>(at)) return null
      return test(at) ? at : walk(at.props.children)
    }
    const found = walk(node)
    if (!found) throw new Error('no such element')
    return found
  }

  const ROW = { node: 'row' }
  const EYE = { node: 'eye button' }

  /**
   * A key pressed with focus on the row or on its eye button, as the browser runs it: the keydown
   * bubbles from the button to the row; then Enter or Space on a focused button clicks it, unless
   * the keydown's default was prevented, and the click bubbles to the row unless stopped.
   */
  function press(key: string, on: 'row' | 'eye'): { calls: string[]; prevented: boolean } {
    const { timeline, name } = setup(TOKEN)
    const lane = timeline.lanes.find((l) => l.repo === 'Me/open')!
    const calls: string[] = []
    const props: RepoRowProps = {
      lane,
      shown: name(lane.repo),
      colour: theme.accent,
      selected: false,
      hidden: false,
      hovered: false,
      onSelect: () => calls.push('select'),
      onToggleHidden: () => calls.push('hide'),
      onHover: noop,
    }
    const tree = RepoRow(props)
    const row = find(tree, (element) => element.props.role === 'button')
    const eye = find(tree, (element) => element.type === 'button')
    expect(eye.props['aria-label']).toBe('Hide Me/open')
    let prevented = false
    const keyDown = row.props.onKeyDown as (event: object) => void
    keyDown({ key, target: on === 'row' ? ROW : EYE, currentTarget: ROW, preventDefault: () => (prevented = true) })
    if (on === 'eye' && !prevented && (key === 'Enter' || key === ' ')) {
      let stopped = false
      const click = eye.props.onClick as (event: object) => void
      click({ stopPropagation: () => (stopped = true) })
      if (!stopped) (row.props.onClick as () => void)()
    }
    return { calls, prevented }
  }

  it('hides the repo on Enter or Space at its eye button, and does not select it', () => {
    for (const key of ['Enter', ' ']) expect(press(key, 'eye')).toEqual({ calls: ['hide'], prevented: false })
  })

  it('selects on Enter or Space at the row itself, and lets every other key be', () => {
    for (const key of ['Enter', ' ']) expect(press(key, 'row')).toEqual({ calls: ['select'], prevented: true })
    for (const key of ['a', 'Tab', 'ArrowDown']) expect(press(key, 'row')).toEqual({ calls: [], prevented: false })
  })

  it('leaves a key from inside the row alone, whatever it is', () => {
    const selected: string[] = []
    const preventDefault = vi.fn()
    const inner = { node: 'inner' }
    for (const key of ['Enter', ' ', 'a']) onRepoRowKey({ key, target: inner, currentTarget: ROW, preventDefault } as never, () => selected.push(key))
    expect(selected).toEqual([])
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

describe('a GraphQL fallback profile', () => {
  it('never says a token is missing: one is set, and GraphQL failed', () => {
    hoverRepo('octo/site')
    const repoCard = inspector(FALLBACK)
    expect(textOf(repoCard)).toContain('no commit counts: GraphQL failed, so this is the public profile; try again from the status strip')
    expect(textOf(repoCard)).toContain('4 pushes since 2024-05-16')
    hoverDay('2024-01-02')
    const dayCard = inspector(FALLBACK)
    expect(textOf(dayCard)).toContain('no day detail before 2024-05-16: GraphQL failed, so this is the public profile')

    const limits = dataLimits(FALLBACK)
    expect(limits.join(' ')).toContain('no commit counts: GraphQL failed, so this is the public profile; try again from the status strip.')
    expect(limits.join(' ')).toContain('from its creation to its last push')
    expect(limits.join(' ')).toContain('pushes per repo per day from 2024-05-16')
    expect(limits.join(' ')).toContain('come only over GraphQL')
    const key = legend(FALLBACK)
    for (const limit of limits) expect(textOf(key)).toContain(limit)

    const strip = status(FALLBACK, { hasToken: true })
    expect(textOf(strip)).toContain('showing the public profile')
    for (const html of [repoCard, dayCard, key, strip, panel(FALLBACK)]) expect(html).not.toMatch(/without a token|need a token|add a token/)
  })
})

describe('privacy across the views', () => {
  it('puts no private name in any markup while hidden, whatever is hovered or selected', () => {
    const { timeline } = setup(TOKEN)
    const hovers = [
      ...timeline.lanes.map((lane) => ({ kind: 'repo' as const, key: lane.repo.toLowerCase() })),
      ...timeline.milestones.map((m, i) => ({ kind: 'day' as const, day: dayNumber(m.day), milestone: i })),
      ...TOKEN.days.map((d) => ({ kind: 'day' as const, day: dayNumber(d.date), milestone: null })),
    ]
    for (const hover of hovers) {
      setPerson({ hover, selected: 'me/secret-plans' })
      expectNoPrivateName(inspector(TOKEN))
    }
    for (const tab of ['repos', 'milestones'] as const) {
      setPerson({ tab })
      expectNoPrivateName(panel(TOKEN))
    }
    for (const view of VIEWS) expectNoPrivateName(legend(TOKEN, view))
    expectNoPrivateName(status(TOKEN, { hasToken: true }))
  })
})

describe("PersonApp's layouts", () => {
  const code = personAppSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

  it('lays each view out once per timeline, and reuses that layout on every switch back to it', () => {
    const { profile, timeline } = setup(TOKEN)
    const counted = (def: LifeViewDef) => ({ ...def, layout: vi.fn(def.layout) })
    const defs = Object.fromEntries(VIEWS.map((view) => [view, counted(LIFE_VIEWS[view])])) as Record<PersonView, ReturnType<typeof counted>>
    const layoutOf = viewLayouts(timeline, profile.source)
    const first = new Map(VIEWS.map((view) => [view, layoutOf(defs[view])]))
    for (const view of ['constellation', 'garden', 'constellation', 'lines', 'garden', 'constellation'] as PersonView[]) {
      expect(layoutOf(defs[view]), view).toBe(first.get(view))
    }
    for (const view of VIEWS) {
      expect(defs[view].layout, view).toHaveBeenCalledTimes(1)
      expect(defs[view].layout, view).toHaveBeenCalledWith(timeline, 'graphql')
      // the view's own layout of this timeline, as it would make it again
      expect(first.get(view), view).toEqual(LIFE_VIEWS[view].layout(timeline, profile.source))
    }
    // a new timeline (a new profile) lays the view out again, from its own source
    const next = setup(PUBLIC)
    const again = viewLayouts(next.timeline, next.profile.source)(defs.constellation)
    expect(again).not.toBe(first.get('constellation'))
    expect(defs.constellation.layout).toHaveBeenCalledTimes(2)
    expect(defs.constellation.layout).toHaveBeenLastCalledWith(next.timeline, 'rest')
  })

  it('keeps one set of layouts per timeline, whatever the view, and lays a view out nowhere else', () => {
    // the set is made per profile and timeline, never per view, so a switch keeps it
    expect(code).toContain('const layoutOf = useMemo(() => (profile && timeline ? viewLayouts(timeline, profile.source) : null), [profile, timeline])')
    expect(code).toContain('const layout = useMemo(() => layoutOf?.(def) ?? null, [layoutOf, def])')
    expect(code).toContain('const def = LIFE_VIEWS[view]')
    // a view's layout is called in viewLayouts only, and viewLayouts is used once
    expect(code.match(/\.layout\(/g)).toHaveLength(1)
    expect(code.match(/\bviewLayouts\(/g)).toHaveLength(2)
    expect(code.match(/new Map<LifeViewDef, LifeViewModel>\(\)/g)).toHaveLength(1)
  })
})

describe('copies kept equal to what they copy', () => {
  it('draws the copied icons exactly as the eager set does', () => {
    const pairs = [
      [EyeIcon, icons.EyeIcon],
      [EyeOffIcon, icons.EyeOffIcon],
      [ChevronLeftIcon, icons.ChevronLeftIcon],
      [ChevronRightIcon, icons.ChevronRightIcon],
    ] as const
    for (const [copy, original] of pairs) {
      expect(renderToStaticMarkup(h(copy))).toBe(renderToStaticMarkup(h(original)))
      expect(renderToStaticMarkup(h(copy, { size: 11 }))).toBe(renderToStaticMarkup(h(original, { size: 11 })))
    }
  })

  it("puts the legend's petals where petalAngles does", () => {
    expect(LEGEND_BLOOM_PETALS).toEqual(petalAngles('bloom', 0.1))
    expect(LEGEND_WILTED_PETALS).toEqual(petalAngles('wilted', 0.5))
  })
})
