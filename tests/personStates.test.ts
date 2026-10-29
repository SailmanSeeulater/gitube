/**
 * Person mode's states as PersonApp renders them (react-dom/server, with the query cache set as a
 * fetch would leave it): a first fetch and a refetch; every fetch error, in person mode's words,
 * with the token button only where a token helps and the reset time where GitHub gave one; a
 * failed refetch that leaves the profile on show; the empty lives (no repos, in each tier, and every
 * repo hidden by the eyes); a profile of only repos they contributed to, in every view; the request
 * counter and the token nudge; and narrow windows: no set width without a cap at the window's
 * width, and the token field never opened under the side panel.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import PersonApp, { panelCoversTokenField } from '../src/PersonApp'
import personAppSource from '../src/PersonApp.tsx?raw'
import { formatClock } from '../src/components/gardenUtils'
import { profileQueryKey, type ProfileResult } from '../src/profile/useProfileData'
import { usePersonStore } from '../src/profile/usePersonStore'
import { LIFE_VIEWS } from '../src/profile/lifeViews'
import type { PersonView } from '../src/share/shareUrl'
import { GitHubFetchError, type FetchProgress, type ProfileData, type ProfileRepo } from '../src/types'
import { FAKE_TOKEN, setGarden, setPerson, textOf } from './helpers/personScene'

const noop = () => {}
const RESET = '2024-06-15T21:05:00Z'
const iso = (day: string) => `${day}T20:00:00Z`

/** Every person-mode source, to read its class names. */
const personSources = import.meta.glob<string>(['../src/PersonApp.tsx', '../src/profile/*.tsx'], { query: '?raw', import: 'default', eager: true })

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

/** A visitor without a token: two public repos. */
const PUBLIC: ProfileData = {
  login: 'octo',
  name: null,
  avatarUrl: 'https://avatars.githubusercontent.com/u/2?v=4',
  createdAt: iso('2018-04-01'),
  source: 'rest',
  repos: [
    repo('octo/site', { createdAt: iso('2018-05-01'), lastActiveAt: iso('2024-06-10'), language: 'HTML' }),
    repo('octo/tool', { createdAt: iso('2020-01-01'), lastActiveAt: iso('2021-01-01'), stars: 5 }),
  ],
  days: [],
  recent: [],
  recentFrom: '2024-05-16',
  milestones: [{ kind: 'joined', date: iso('2018-04-01'), label: 'joined GitHub' }],
  restrictedContributions: 0,
  truncated: false,
  lostWindows: [],
  landed: [],
  fallback: null,
}

/** A token run: only repos someone else owns, which GitHub counted their commits to. */
const VISITOR: ProfileData = {
  ...PUBLIC,
  login: 'helper',
  source: 'graphql',
  recentFrom: null,
  repos: [
    repo('big/framework', { createdAt: iso('2012-01-01'), firstActiveAt: iso('2021-03-02'), lastActiveAt: iso('2022-05-01'), isOwn: false, stars: 900, activity: [{ date: '2021-03-02', commits: 4 }, { date: '2022-05-01', commits: 1 }] }),
    repo('team/tool', { createdAt: iso('2019-06-01'), firstActiveAt: iso('2023-01-10'), lastActiveAt: iso('2023-01-12'), isOwn: false, language: 'Go', activity: [{ date: '2023-01-10', commits: 2 }, { date: '2023-01-12', commits: 3 }] }),
  ],
  days: [
    { date: '2021-03-02', count: 4 },
    { date: '2023-01-10', count: 2 },
  ],
}

interface Cached {
  /** the profile in the cache, as a fetch left it */
  profile?: ProfileData
  /** the last fetch failed with this */
  error?: GitHubFetchError
  /** a fetch is under way */
  fetching?: boolean
  cachedAt?: string | null
}

/**
 * PersonApp for login on the server, its query left as described: no data and nothing else is a
 * first fetch under way. Without retryOnMount a failed query shows its error rather than retrying.
 */
function personApp(login: string, token: string, cached: Cached = {}, view: PersonView | null = null): string {
  setGarden({ token })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, retryOnMount: false } } })
  const key = profileQueryKey(login, token)
  if (cached.profile) client.setQueryData<ProfileResult>(key, { profile: cached.profile, cachedAt: cached.cachedAt ?? null })
  if (cached.error || cached.fetching) {
    const query = client.getQueryCache().build(client, { queryKey: key })
    if (cached.error) query.setState({ status: 'error', error: cached.error, errorUpdatedAt: 1, fetchFailureCount: 1 })
    if (cached.fetching) query.setState({ fetchStatus: 'fetching' })
  }
  return renderToStaticMarkup(
    h(QueryClientProvider, { client }, h(PersonApp, { login, request: 0, view, focusInput: false, onRepo: noop, onUser: noop })),
  )
}

/** The error card's markup, to its own closing tag, or '' without one. */
function card(html: string): string {
  const start = html.indexOf('<div role="alert"')
  if (start < 0) return ''
  let depth = 0
  for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === '</div>' ? -1 : 1
    if (depth === 0) return html.slice(start, start + m.index + m[0].length)
  }
  return html.slice(start)
}

/** Its buttons' words. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])
}

const PROGRESS: FetchProgress = {
  stage: 'repos',
  done: 100,
  total: 100,
  message: 'Listed 100 repos',
  requestsUsed: 2,
  rateLimitRemaining: 54,
  rateLimitResetAt: RESET,
}

beforeEach(() => {
  usePersonStore.getState().resetFor('nobody')
  setPerson({ tab: 'repos' })
  setGarden({ panelOpen: true, rate: null, token: '', progress: null })
})

describe('loading', () => {
  it('grows a first fetch with its login, and the strip says the stage', () => {
    const html = personApp('Ghost-X', '', { fetching: true })
    const text = textOf(html)
    expect(text).toContain('growing Ghost-X…')
    expect(text).toContain('starting')
    expect(text).toContain('growing') // the Grow button, busy
    expect(card(html)).toBe('')
    expect(html).not.toContain('<aside')
    expect(html).not.toContain('<canvas')
  })

  it('keeps the profile on show through a refetch, with the progress and the core budget in the strip', () => {
    setGarden({ progress: PROGRESS })
    const html = personApp('octo', '', { profile: PUBLIC, fetching: true })
    const text = textOf(html)
    expect(html).toContain('aria-label="life garden of octo: 2 repos')
    expect(html).toContain('<aside')
    expect(text).not.toContain('growing octo…')
    expect(text).toContain('listing repos')
    expect(text).toContain('2 requests')
    expect(text).toContain(`54 left · resets ${formatClock(RESET)}`)
    // the idle strip, with its nudge, waits for the fetch to end
    expect(text).not.toContain('add a token for commits')
  })
})

describe('a fetch that failed', () => {
  it('says a missing user is not found, by the login typed, with no token button', () => {
    for (const token of ['', FAKE_TOKEN]) {
      const html = card(personApp('Ghost-X', token, { error: new GitHubFetchError('Ghost-X was not found. Check the spelling.', 'not_found') }))
      expect(textOf(html)).toContain('user not found')
      expect(textOf(html)).toContain('GitHub has no user called Ghost-X. check the spelling.')
      expect(html).not.toContain('repo not found')
      expect(buttons(html)).toEqual([])
    }
  })

  it('names an organization and a bot for what they are, with no token button', () => {
    const org = card(personApp('vercel', '', { error: new GitHubFetchError('vercel is a GitHub Organization account, not a user.', 'not_a_user') }))
    expect(textOf(org)).toContain("that's an organization")
    expect(textOf(org)).toContain('try one of its repos as owner/repo')
    const bot = card(personApp('helper-bot', FAKE_TOKEN, { error: new GitHubFetchError('helper-bot is a GitHub Bot account, not a user.', 'not_a_user') }))
    expect(textOf(bot)).toContain("that's a bot")
    expect(textOf(bot)).not.toContain('organization')
    for (const html of [org, bot]) expect(buttons(html)).toEqual([])
  })

  it('offers a token for a rate limit without one, with the reset time', () => {
    const error = new GitHubFetchError('GitHub API rate limit exceeded while looking up octo.', 'rate_limited', RESET)
    const html = card(personApp('octo', '', { error }))
    expect(textOf(html)).toContain('GitHub rate limit reached')
    expect(textOf(html)).toContain(`resets at ${formatClock(RESET)}`)
    expect(textOf(html)).toContain('a personal access token allows 5000')
    expect(buttons(html)).toEqual(['add a token'])
  })

  it("says the token's own budget ran out for a rate limit with one, with the reset time and no token button", () => {
    const error = new GitHubFetchError('GitHub API rate limit exceeded while looking up octo.', 'rate_limited', RESET)
    const html = card(personApp('octo', FAKE_TOKEN, { error }))
    expect(textOf(html)).toContain(`resets at ${formatClock(RESET)}. this token's 5000 requests an hour are used up.`)
    expect(textOf(html)).not.toContain('anonymous')
    expect(buttons(html)).toEqual([])
    // a pause, not a budget: no token lifts it, with or without one
    const secondary = new GitHubFetchError('GitHub API secondary rate limit exceeded while looking up octo.', 'rate_limited', RESET)
    for (const token of ['', FAKE_TOKEN]) {
      const pause = card(personApp('octo', token, { error: secondary }))
      expect(textOf(pause)).toContain('GitHub asked for a short pause')
      expect(buttons(pause)).toEqual([])
    }
  })

  it('offers to edit a token GitHub rejected, and words a refusal without one', () => {
    const bad = new GitHubFetchError('GitHub rejected the credentials (401) while looking up octo. The token is invalid or expired.', 'unauthorized')
    const html = card(personApp('octo', FAKE_TOKEN, { error: bad }))
    expect(textOf(html)).toContain('GitHub rejected the token')
    expect(textOf(html)).toContain('it may be expired or revoked')
    expect(textOf(html)).not.toContain('repo')
    expect(buttons(html)).toEqual(['edit token'])
    const refused = card(personApp('octo', '', { error: new GitHubFetchError('GitHub refused the request (403) while looking up octo: no', 'unauthorized') }))
    expect(textOf(refused)).toContain('GitHub refused the request')
    expect(buttons(refused)).toEqual([])
  })

  it('says the network failed (offline included) or the fetch was cancelled, and to grow again', () => {
    const offline = card(personApp('octo', '', { error: new GitHubFetchError('Network error while looking up octo: fetch failed', 'network') }))
    expect(textOf(offline)).toContain("couldn't reach GitHub")
    expect(textOf(offline)).toContain('press Grow again')
    const cancelled = card(personApp('octo', '', { error: new GitHubFetchError('Fetch aborted while looking up octo', 'aborted') }))
    expect(textOf(cancelled)).toContain('fetch cancelled')
    for (const html of [offline, cancelled]) expect(buttons(html)).toEqual([])
  })

  it('shows no card while the next fetch runs', () => {
    const html = personApp('octo', '', { error: new GitHubFetchError('Network error', 'network'), fetching: true })
    expect(card(html)).toBe('')
    expect(textOf(html)).toContain('growing octo…')
  })

  it('leaves the profile on show after a failed refetch, under a card that can be closed', () => {
    const error = new GitHubFetchError('GitHub API rate limit exceeded while looking up octo.', 'rate_limited', RESET)
    const html = personApp('octo', '', { profile: PUBLIC, error })
    expect(html).toContain('aria-label="life garden of octo: 2 repos')
    const shown = card(html)
    expect(textOf(shown)).toContain('GitHub rate limit reached')
    expect(shown).toContain('aria-label="Dismiss"')
    // the card comes after the panel, so where the two meet it is the one on top
    expect(html.indexOf('role="alert"')).toBeGreaterThan(html.indexOf('<aside'))
    // with nothing behind it, the card is the page: it stays
    expect(card(personApp('octo', '', { error }))).not.toContain('aria-label="Dismiss"')
  })
})

describe('a life with nothing to draw', () => {
  const empty: ProfileData = { ...PUBLIC, repos: [] }

  it('says a user without a token has no public repos, and offers a token', () => {
    const html = personApp('octo', '', { profile: empty })
    const text = textOf(html)
    expect(html).toContain('aria-label="life garden of octo: 0 repos')
    expect(text).toContain('octo has no public repos yet')
    expect(text).toContain('with a token, repos they contributed to show too.')
    expect(buttons(html)).toContain('add a token')
    expect(text).toContain('no public repos')
  })

  it('offers no token once one is set: after a fallback, and in the token tier', () => {
    const fallback: ProfileData = { ...empty, fallback: { message: 'GitHub GraphQL rate limit exceeded.', limit: 'graphql', resetAt: RESET } }
    const html = personApp('octo', FAKE_TOKEN, { profile: fallback })
    expect(textOf(html)).toContain('octo has no public repos yet')
    expect(textOf(html)).toContain('showing the public profile')
    expect(html).not.toContain('add a token')
    const graphql = personApp('octo', FAKE_TOKEN, { profile: { ...empty, source: 'graphql', recentFrom: null } })
    expect(textOf(graphql)).toContain('octo has no repos to show yet')
    expect(graphql).not.toContain('add a token')
  })

  it('says when the eyes hid every repo, and offers to show them', () => {
    setPerson({ hidden: new Set(['octo/site', 'octo/tool']) })
    const html = personApp('octo', '', { profile: PUBLIC })
    expect(textOf(html)).toContain('all 2 repos are hidden')
    expect(buttons(html)).toContain('show all')
    // the panel still lists them, dimmed, with its own way back
    expect(textOf(html)).toContain('show 2 hidden')
    setPerson({ hidden: new Set(['octo/site']) })
    expect(textOf(personApp('octo', '', { profile: PUBLIC }))).not.toContain('are hidden')
  })

  it('says nothing over a life with a repo on show', () => {
    const text = textOf(personApp('octo', '', { profile: PUBLIC }))
    expect(text).not.toContain('no public repos')
    expect(text).not.toContain('are hidden')
  })
})

describe('a profile of only repos they contributed to', () => {
  it('shows in every view, with each repo marked and no empty note', () => {
    for (const view of ['garden', 'lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap'] as const) {
      const html = personApp('helper', FAKE_TOKEN, { profile: VISITOR }, view)
      const title = LIFE_VIEWS[view].title
      expect(html).toContain(`aria-label="${title} of helper: 2 repos, 2018 to `)
      const text = textOf(html)
      expect(text.match(/\bcontributed\b/g)?.length).toBeGreaterThanOrEqual(2)
      expect(text).not.toContain('no repos')
      expect(text).toContain('6 contributions')
      expect(html).not.toContain('add a token')
    }
  })
})

describe('very old and very young lives', () => {
  it('spans an account from the first weeks of GitHub, and a life whose counted commits predate the account', () => {
    // one of GitHub's first accounts, with a repo a year from 2008 on and the 500-repo cap reached
    const repos = Array.from({ length: 17 }, (_, i) => repo(`pioneer/r${2008 + i}`, { createdAt: iso(`${2008 + i}-03-01`), lastActiveAt: iso(`${2008 + i}-09-01`), language: i % 2 ? 'Ruby' : 'C' }))
    const pioneer: ProfileData = { ...PUBLIC, login: 'pioneer', createdAt: iso('2007-10-20'), repos, truncated: true, milestones: [{ kind: 'joined', date: iso('2007-10-20'), label: 'joined GitHub' }] }
    for (const view of ['garden', 'lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap'] as const) {
      const html = personApp('pioneer', '', { profile: pioneer }, view)
      expect(html).toMatch(/aria-label="[a-z ]+ of pioneer: 17 repos, 2007 to 20\d\d"/)
      const text = textOf(html)
      expect(text).toMatch(/2007–20\d\d/)
      expect(text).toContain('profile truncated')
      expect(text).toContain('over 500 repos: only the oldest 500 are shown.')
    }
    // backdated commits: GitHub's calendar starts before the account did, and so does the life
    const early: ProfileData = {
      ...VISITOR,
      login: 'backdated',
      createdAt: iso('2015-06-01'),
      days: [{ date: '1999-12-31', count: 3 }, ...VISITOR.days],
      truncated: true,
      lostWindows: ['2001q2'],
      landed: [],
    }
    const html = personApp('backdated', FAKE_TOKEN, { profile: early })
    expect(textOf(html)).toMatch(/1999–20\d\d/)
    expect(textOf(html)).toContain('on GitHub since 2015-06-01')
    expect(html).toContain('GitHub did not answer for 2001q2')
  })

  it('shows an account made today: one day, no repos, its year alone', () => {
    const today = new Date().toISOString()
    const newborn: ProfileData = { ...PUBLIC, login: 'newborn', createdAt: today, repos: [], milestones: [{ kind: 'joined', date: today, label: 'joined GitHub' }] }
    const html = personApp('newborn', '', { profile: newborn })
    expect(html).toMatch(/aria-label="life garden of newborn: 0 repos, 20\d\d"/)
    expect(textOf(html)).toContain('newborn has no public repos yet')
  })
})

describe('the request counter and the token nudge', () => {
  it('shows the core budget left for a live fetch, in either tier, and none for a cached copy', () => {
    setGarden({ rate: { limit: 60, remaining: 51, resetAt: RESET } })
    expect(textOf(personApp('octo', '', { profile: PUBLIC }))).toContain('51 requests left')
    expect(textOf(personApp('octo', '', { profile: PUBLIC, cachedAt: '2024-06-15T18:00:00Z' }))).not.toContain('requests left')
    setGarden({ rate: { limit: 5000, remaining: 4990, resetAt: RESET } })
    expect(textOf(personApp('helper', FAKE_TOKEN, { profile: VISITOR }))).toContain('4990 requests left')
  })

  it('nudges toward a token without one, and never with one', () => {
    expect(buttons(personApp('octo', '', { profile: PUBLIC }))).toContain('add a token for commits')
    const fallback: ProfileData = { ...PUBLIC, fallback: { message: 'GitHub GraphQL rate limit exceeded.', limit: 'graphql', resetAt: RESET } }
    for (const html of [personApp('octo', FAKE_TOKEN, { profile: fallback }), personApp('helper', FAKE_TOKEN, { profile: VISITOR })]) {
      expect(html).not.toContain('add a token')
    }
  })

  it('opens the token field from every nudge through one path, which keeps it clear of the panel', () => {
    const code = personAppSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    expect(code).toContain('if (open && panelCoversTokenField(window.innerWidth)) useGardenStore.getState().setPanelOpen(false)')
    expect(code).toContain('const openToken = useCallback(() => showToken(true), [showToken])')
    expect(code).toContain('const toggleToken = useCallback(() => showToken(!tokenOpen), [showToken, tokenOpen])')
    expect(code.match(/setTokenOpen\(true\)/g)).toBeNull()
    // the strip's nudge, the error card's button and the empty life's all take openToken
    expect(code).toMatch(/<PersonStatus\s[^>]*onAddToken=\{openToken\}/)
    expect(code).toContain('onAddToken={errorCopy.tokenAction ? openToken : undefined}')
    expect(code).toMatch(/<EmptyLife\s[^>]*onAddToken=\{openToken\}/)
  })
})

describe('narrow windows', () => {
  it('folds the panel away for the token field only where the panel would cover it', () => {
    // a phone, a small tablet, and the widest window the 380px field and the 300px panel still overlap in
    for (const width of [320, 375, 600, 715]) expect(panelCoversTokenField(width), String(width)).toBe(true)
    for (const width of [716, 1024, 1280]) expect(panelCoversTokenField(width), String(width)).toBe(false)
  })

  it('caps every set width at the window, so nothing scrolls the page sideways', () => {
    const wide: string[] = []
    let seen = 0
    for (const [file, text] of Object.entries(personSources)) {
      // every string the source writes, quoted or templated (with its ${} parts), that sets a width over 240px
      for (const m of text.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)) {
        const width = /(?:^|[\s'"`])w-\[(\d+)px\]/.exec(m[0])
        if (!width || Number(width[1]) <= 240) continue
        seen++
        if (!/max-w-\[/.test(m[0])) wide.push(`${file}: ${m[0].slice(0, 80)}`)
      }
    }
    // the panel (300px), the inspector (340px) and the time-lapse controls (460px) at least
    expect(seen).toBeGreaterThanOrEqual(3)
    expect(wide).toEqual([])
    // and the page itself clips what lies past its edges
    expect(personAppSource).toContain('<div className="relative h-full w-full overflow-hidden bg-garden-bg text-garden-text">')
  })

  it('keeps the panel collapsible, and the canvas clear of it while it is open', () => {
    expect(personApp('octo', '', { profile: PUBLIC })).toContain('aria-label="Collapse panel"')
    setGarden({ panelOpen: false })
    const folded = personApp('octo', '', { profile: PUBLIC })
    expect(folded).toContain('aria-label="Open panel"')
    expect(folded).not.toContain('<aside')
  })
})
