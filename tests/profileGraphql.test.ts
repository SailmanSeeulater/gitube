/**
 * Person mode's tier 2 fetcher (src/api/profileGraphql.ts), and the token path of fetchProfile and
 * loadProfile (src/api/profile.ts). The GraphQL fixtures are real answers recorded on 2026-10-25
 * with a token without read:user, for public accounts that are not the token's owner (see each
 * file's _note): kepano's whole history (2013 to 2026), and sindresorhus's 2018 Q1, a quarter that
 * returns 100 repositories. They are replayed (tests/helpers/profileReplay.ts) by the window aliases
 * and bounds a request asks for, so a test may ask for any split of the recorded windows. Each recorded entry also holds a hash of
 * its query's selection (selectionHash: the query text with the window aliases folded away), and
 * the replay answers HTTP 400 to a request whose selection differs: a change to the queries' fields
 * fails these tests until the fixtures are recorded again with it.
 *
 * Synthesised inline, each where it is used: a window whose alias comes back null with an error,
 * or whose data comes back with an error on its path (built from kepano's recorded batches), what
 * that window's solo retry then meets, a slow, 502 or 504 batch or repositories query, GraphQL
 * primary and secondary rate limits, refusals and schema errors for a whole query, unknown errors,
 * an SSO FORBIDDEN inside one window, a core rate limit on the identity call, and the edge cases of
 * the fictional login quiet-sprout (private repos among them). The REST fallback replays the
 * gaearon fixture recorded for Phase 1; where kepano or quiet-sprout fall back, their REST answers
 * are synthesised as empty (no repos, no events).
 */
import { describe, expect, it, vi } from 'vitest'
import { describeFallback, fetchProfile, fetchProfileRest, loadProfile } from '../src/api/profile'
import {
  REPOS_QUERY,
  UseRest,
  WINDOWS_PER_QUERY,
  buildWindowQuery,
  fetchProfileGraphql,
  quarterWindows,
  windowErrorMarks,
} from '../src/api/profileGraphql'
import { profileCacheKey, type ProfileStore } from '../src/api/profileCache'
import type { CacheEntry } from '../src/api/cachePolicy'
import { personGrowEventData } from '../src/profile/analytics'
import { GitHubFetchError } from '../src/types'
import type { FetchProgress, ProfileData } from '../src/types'
import vercel from './fixtures/github/profile-vercel.json'
import {
  CORE_RESET,
  GAEARON_NOW,
  GQL_RESET,
  KEPANO,
  KEPANO_NOW,
  KEPANO_WINDOWS,
  SINDRE,
  SINDRE_NOW,
  SINDRE_WINDOWS,
  aliasesOf,
  emptyRest,
  gaearonRouter,
  graphqlCalls,
  isGraphql,
  kepanoRouter,
  makeFetch,
  recordedCollections,
  replayGraphql,
  restCalls,
  selectionHash,
  windowCalls,
  type Call,
  type RawWindowUser,
  type Route,
  type Router,
} from './helpers/profileReplay'

// GitHub stops a query after 10 s and the client gives up after 15. The timeout tests wait on a
// real timer, so this file shortens the limit (vi.mock is hoisted above the imports).
const TIMEOUT_MS = 300
vi.mock('../src/api/graphql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/graphql')>()),
  GRAPHQL_TIMEOUT_MS: 300,
}))

const TOKEN = 'ghp_TEST_TOKEN_not_a_real_one_0000'
const DAY_MS = 24 * 60 * 60 * 1000

async function expectFetchError(promise: Promise<unknown>): Promise<GitHubFetchError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(GitHubFetchError)
    return err as GitHubFetchError
  }
  throw new Error('expected the fetch to reject')
}

/** The day GitHub counts an instant on, worked out independently of pacificDay. */
const pacificDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

function yearTotals(days: ReadonlyArray<{ date: string; count: number }>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const day of days) totals[day.date.slice(0, 4)] = (totals[day.date.slice(0, 4)] ?? 0) + day.count
  return totals
}

let plainKepano: Promise<ProfileData> | null = null
/** kepano read from the recording with nothing in the way, once. */
function kepanoProfile(): Promise<ProfileData> {
  plainKepano ??= fetchProfileGraphql('kepano', { token: TOKEN, fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW })
  return plainKepano
}

// ---------- synthetic data (fictional login, no real person) ----------

const SPROUT_USER: Route = {
  body: { login: 'Quiet-Sprout', name: null, avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4', created_at: '2020-02-01T00:00:00Z', type: 'User' },
}

function repoNode(nameWithOwner: string, overrides: Record<string, unknown> = {}) {
  return {
    nameWithOwner,
    createdAt: '2020-03-01T12:00:00Z',
    pushedAt: '2020-03-01T12:00:00Z',
    isFork: false,
    isArchived: false,
    isPrivate: false,
    stargazerCount: 0,
    forkCount: 0,
    primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
    ...overrides,
  }
}

interface WindowPlan {
  days?: Array<[string, number]>
  repos?: Array<{ repo: ReturnType<typeof repoNode>; nodes: Array<[string, number]>; hasNextPage?: boolean }>
  firstPullRequestContribution?: unknown
  firstIssueContribution?: unknown
  firstRepositoryContribution?: unknown
  joinedGitHubContribution?: unknown
  restricted?: number
}

/** A window's user alias as GitHub shapes it. */
function windowUser(plan: WindowPlan = {}) {
  return {
    contributionsCollection: {
      contributionCalendar: { weeks: [{ contributionDays: (plan.days ?? []).map(([date, contributionCount]) => ({ date, contributionCount })) }] },
      commitContributionsByRepository: (plan.repos ?? []).map((r) => ({
        repository: r.repo,
        contributions: { nodes: r.nodes.map(([occurredAt, commitCount]) => ({ occurredAt, commitCount })), pageInfo: { hasNextPage: r.hasNextPage ?? false } },
      })),
      firstPullRequestContribution: plan.firstPullRequestContribution ?? null,
      firstIssueContribution: plan.firstIssueContribution ?? null,
      firstRepositoryContribution: plan.firstRepositoryContribution ?? null,
      joinedGitHubContribution: plan.joinedGitHubContribution ?? null,
      restrictedContributionsCount: plan.restricted ?? 0,
    },
  }
}

/**
 * quiet-sprout's GitHub: the identity, the repositories query (pages of own repos, by cursor 'cN'),
 * each window from windows(alias), and empty REST answers for the fallback. graphql answers a
 * GraphQL call first when it returns a route.
 */
function sproutRouter(plan: {
  years: number[]
  pages?: unknown[][]
  windows?: (alias: string) => WindowPlan | undefined
  graphql?: (call: Call) => Route | undefined
  user?: Route
}): Router {
  const user = plan.user ?? SPROUT_USER
  const login = (user.body as { login: string }).login
  const rest = emptyRest(login)
  return (call) => {
    if (call.url.pathname.toLowerCase() === `/users/${login.toLowerCase()}`) return user
    if (!isGraphql(call)) return rest(call)
    const override = plan.graphql?.(call)
    if (override) return override
    const variables = call.body?.variables ?? {}
    const aliases = aliasesOf(call)
    if (aliases.length === 0) {
      const pages = plan.pages ?? [[]]
      const page = variables.after ? Number(variables.after.slice(1)) : 0
      const more = page + 1 < pages.length
      return {
        body: {
          data: {
            rateLimit: { cost: 1, remaining: 4990, resetAt: '2026-10-25T10:00:00Z' },
            user: {
              contributionsCollection: { contributionYears: [...plan.years].reverse() },
              repositories: { nodes: pages[page] ?? [], pageInfo: { hasNextPage: more, endCursor: more ? `c${page + 1}` : null } },
            },
          },
        },
      }
    }
    const data: Record<string, unknown> = { rateLimit: { cost: 1, remaining: 4989, resetAt: '2026-10-25T10:00:00Z' } }
    for (const alias of aliases) data[alias] = windowUser(plan.windows?.(alias))
    return { body: { data } }
  }
}

// ---------- the query plan ----------

describe('quarterWindows', () => {
  it('cuts calendar quarters from January 1 of the first year up to now, never a future one', () => {
    const now = Date.parse('2024-08-15T12:34:56.789Z')
    expect(quarterWindows(2023, now)).toEqual([
      { alias: 'w2023q1', key: '2023q1', from: '2023-01-01T00:00:00.000Z', to: '2023-03-31T23:59:59.999Z' },
      { alias: 'w2023q2', key: '2023q2', from: '2023-04-01T00:00:00.000Z', to: '2023-06-30T23:59:59.999Z' },
      { alias: 'w2023q3', key: '2023q3', from: '2023-07-01T00:00:00.000Z', to: '2023-09-30T23:59:59.999Z' },
      { alias: 'w2023q4', key: '2023q4', from: '2023-10-01T00:00:00.000Z', to: '2023-12-31T23:59:59.999Z' },
      // a leap year's first quarter, and the current quarter ending at now (no 2024 Q4)
      { alias: 'w2024q1', key: '2024q1', from: '2024-01-01T00:00:00.000Z', to: '2024-03-31T23:59:59.999Z' },
      { alias: 'w2024q2', key: '2024q2', from: '2024-04-01T00:00:00.000Z', to: '2024-06-30T23:59:59.999Z' },
      { alias: 'w2024q3', key: '2024q3', from: '2024-07-01T00:00:00.000Z', to: '2024-08-15T12:34:56.789Z' },
    ])
  })

  it('ends each window 1 ms before the next one starts', () => {
    const windows = quarterWindows(2015, Date.parse('2026-10-25T09:00:00Z'))
    expect(windows).toHaveLength(12 * 4)
    for (let i = 1; i < windows.length; i++) expect(Date.parse(windows[i].from) - Date.parse(windows[i - 1].to)).toBe(1)
  })

  it('asks a quarter that starts exactly at now, and none after it', () => {
    const now = Date.parse('2025-04-01T00:00:00Z')
    expect(quarterWindows(2025, now).map((w) => [w.key, w.to])).toEqual([
      ['2025q1', '2025-03-31T23:59:59.999Z'],
      ['2025q2', '2025-04-01T00:00:00.000Z'],
    ])
    expect(quarterWindows(2026, now)).toEqual([])
  })
})

describe('buildWindowQuery', () => {
  it('asks each window as its own user(login) alias, its bounds as variables named after it', () => {
    const windows = quarterWindows(2019, Date.parse('2019-12-31T00:00:00Z'))
    const { query, variables } = buildWindowQuery('octocat', windows)
    expect(query.match(/user\(login: \$login\)/g)).toHaveLength(4)
    expect(query.match(/rateLimit \{ cost remaining resetAt \}/g)).toHaveLength(1)
    expect(query).toContain('w2019q3: user(login: $login) { contributionsCollection(from: $w2019q3_from, to: $w2019q3_to) { ...Window } }')
    // the login and the bounds never enter the query text
    expect(query).not.toContain('octocat')
    expect(query).not.toContain('2019-')
    expect(variables).toEqual({
      login: 'octocat',
      w2019q1_from: '2019-01-01T00:00:00.000Z',
      w2019q1_to: '2019-03-31T23:59:59.999Z',
      w2019q2_from: '2019-04-01T00:00:00.000Z',
      w2019q2_to: '2019-06-30T23:59:59.999Z',
      w2019q3_from: '2019-07-01T00:00:00.000Z',
      w2019q3_to: '2019-09-30T23:59:59.999Z',
      w2019q4_from: '2019-10-01T00:00:00.000Z',
      w2019q4_to: '2019-12-31T00:00:00.000Z',
    })
  })

  it('selects nameWithOwner and isPrivate for every repository: listed, counted, or named by a first* contribution', () => {
    const repoFields = (query: string) => /\nfragment RepoFields on Repository \{ (.+) \}$/.exec(query)?.[1].split(/\s+/) ?? []
    const { query } = buildWindowQuery('octocat', quarterWindows(2019, Date.parse('2019-12-31T00:00:00Z')))
    for (const q of [REPOS_QUERY, query]) expect(repoFields(q)).toEqual(expect.arrayContaining(['nameWithOwner', 'isPrivate']))
    expect(REPOS_QUERY).toContain('nodes { ...RepoFields }')
    expect(query).toContain('commitContributionsByRepository(maxRepositories: 100) { repository { ...RepoFields }')

    // Each first* union's created kind selects its repository's name and privacy: without both, a
    // milestone names no repo.
    const firstRepo = (field: string, kind: string, via: string) =>
      new RegExp(`${field} \\{ \\.\\.\\. on ${kind} \\{ occurredAt ${via}repository \\{ ([^{}]*) \\}`).exec(query)?.[1].trim().split(/\s+/) ?? []
    expect(firstRepo('firstPullRequestContribution', 'CreatedPullRequestContribution', 'pullRequest \\{ ')).toEqual(['nameWithOwner', 'isPrivate'])
    expect(firstRepo('firstIssueContribution', 'CreatedIssueContribution', 'issue \\{ ')).toEqual(['nameWithOwner', 'isPrivate'])
    expect(firstRepo('firstRepositoryContribution', 'CreatedRepositoryContribution', '')).toEqual(['nameWithOwner', 'isPrivate'])
  })
})

describe('windowErrorMarks', () => {
  it("marks the windows an error's path starts at, and nothing else", () => {
    const aliases = ['w2020q1', 'w2020q2', 'w2020q3']
    const marks = windowErrorMarks(
      [
        { type: 'FORBIDDEN', path: ['w2020q2', 'contributionsCollection', 'commitContributionsByRepository', 3, 'repository'] },
        { type: 'SERVICE_UNAVAILABLE', path: ['w2020q3'] },
        { path: ['rateLimit'] },
        { path: ['query', 'w2020q1', 'contributionsCollection'], extensions: { code: 'undefinedField' } },
        { path: ['w2021q1', 'contributionsCollection'] }, // not asked in this query
        { path: ['b0', 'associatedPullRequests'] },
        { message: 'no path at all' },
      ],
      aliases,
    )
    expect([...marks].sort()).toEqual(['w2020q2', 'w2020q3'])
    expect(windowErrorMarks([], aliases).size).toBe(0)
  })
})

describe('the recorded selections', () => {
  const windows = quarterWindows(2013, KEPANO_NOW).slice(0, 4)
  const windowsQuery = buildWindowQuery('kepano', windows).query
  const graphqlCall = (query: string, variables: Record<string, string>): Call => ({
    url: new URL('https://api.github.com/graphql'),
    method: 'POST',
    headers: new Headers(),
    body: { query, variables },
  })

  it('fold a batch of any windows to one selection, and match the queries the fetcher sends now', () => {
    const one = selectionHash(buildWindowQuery('kepano', windows.slice(0, 1)).query)
    expect(selectionHash(windowsQuery)).toBe(one)
    expect(selectionHash(buildWindowQuery('someone-else', windows.slice(1, 3)).query)).toBe(one)
    expect(selectionHash(REPOS_QUERY)).not.toBe(one)
    // one field fewer is another selection
    expect(selectionHash(windowsQuery.replace(' restrictedContributionsCount', ''))).not.toBe(one)
    for (const rec of [KEPANO, SINDRE]) {
      for (const entry of rec.graphql) {
        const isWindows = Object.keys(entry.variables).some((k) => k.endsWith('_from'))
        expect(entry.selection).toBe(isWindows ? one : selectionHash(REPOS_QUERY))
      }
    }
  })

  it('answers HTTP 400 to a query that selects other fields than the recording', () => {
    const reposVariables = KEPANO.graphql[0].variables
    expect(replayGraphql(KEPANO, KEPANO_WINDOWS, graphqlCall(REPOS_QUERY, reposVariables)).status).toBe(200)
    expect(replayGraphql(KEPANO, KEPANO_WINDOWS, graphqlCall(REPOS_QUERY.replace(' isPrivate', ''), reposVariables)).status).toBe(400)

    const { variables } = buildWindowQuery('kepano', windows)
    expect(variables).toEqual(KEPANO.graphql[1].variables)
    expect(replayGraphql(KEPANO, KEPANO_WINDOWS, graphqlCall(windowsQuery, variables)).status).toBe(200)
    const drifted = windowsQuery.replace('joinedGitHubContribution { occurredAt } ', '')
    expect(drifted).not.toBe(windowsQuery)
    expect(replayGraphql(KEPANO, KEPANO_WINDOWS, graphqlCall(drifted, variables))).toMatchObject({ status: 400, body: { message: expect.stringMatching(/record the fixture again/) } })
  })
})

// ---------- recorded profiles ----------

describe('fetchProfileGraphql on the recorded fixtures', () => {
  it('reads an account older than 3 years, all of it (kepano, 2013 to 2026)', async () => {
    const { fetch, calls, maxInFlight } = makeFetch(kepanoRouter())
    const progress: FetchProgress[] = []
    const profile = await fetchProfileGraphql('Kepano', { token: TOKEN, fetch, now: KEPANO_NOW, onProgress: (p) => progress.push(p) })

    expect(profile).toMatchObject({
      login: 'kepano',
      name: 'Steph Ango',
      avatarUrl: 'https://avatars.githubusercontent.com/u/10565871?v=4',
      createdAt: '2015-01-16T19:37:35Z',
      source: 'graphql',
      recent: [],
      recentFrom: null,
      truncated: false,
      lostWindows: [],
      fallback: null,
    })

    // The REST identity call, the repositories query, then one query per year, one after another.
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(['GET /users/Kepano', ...Array<string>(15).fill('POST /graphql')])
    expect(calls.every((c) => c.headers.get('authorization') === `token ${TOKEN}`)).toBe(true)
    expect(maxInFlight()).toBe(1)
    expect(graphqlCalls(calls)[0].body?.query).toBe(REPOS_QUERY)
    const batches = windowCalls(calls)
    expect(batches.map(aliasesOf)).toEqual(Array.from({ length: 14 }, (_, i) => [1, 2, 3, 4].map((q) => `w${2013 + i}q${q}`)))
    expect(WINDOWS_PER_QUERY).toBe(4)
    // January 1 of the first contribution year, 2013, two years before the account; the current
    // quarter's to is now; every other window ends 1 ms before the next starts.
    expect(batches[0].body?.variables).toMatchObject({ w2013q1_from: '2013-01-01T00:00:00.000Z', w2013q1_to: '2013-03-31T23:59:59.999Z' })
    expect(batches[13].body?.variables).toMatchObject({ w2026q4_from: '2026-10-01T00:00:00.000Z', w2026q4_to: new Date(KEPANO_NOW).toISOString() })

    // Days: the calendar from 2013-01-01 through today (GitHub's day), each day once, in order.
    expect(profile.days[0]).toEqual({ date: '2013-01-01', count: 0 })
    expect(profile.days[profile.days.length - 1].date).toBe('2026-10-25')
    for (let i = 1; i < profile.days.length; i++) {
      expect(Date.parse(profile.days[i].date) - Date.parse(profile.days[i - 1].date)).toBe(DAY_MS)
    }
    const recordedDays = recordedCollections(KEPANO).flatMap(([, c]) => c.contributionCalendar.weeks.flatMap((w) => w.contributionDays))
    expect(profile.days).toEqual(recordedDays.map((d) => ({ date: d.date, count: d.contributionCount })))
    // GitHub's own per-year totals for kepano read 147 for 2019 and 2322 for 2025 over a whole-year
    // window: a day's count can differ with the window's span (2019-04-08 reads 1 in its quarter, 3
    // in its year). PROFILE_SPEC.md section 2 lists this among the calendar's known limits.
    expect(yearTotals(profile.days)).toEqual({
      '2013': 22,
      '2014': 403,
      '2015': 503,
      '2016': 844,
      '2017': 609,
      '2018': 621,
      '2019': 145,
      '2020': 117,
      '2021': 73,
      '2022': 1156,
      '2023': 2299,
      '2024': 1906,
      '2025': 2323,
      '2026': 4523,
    })
    const restricted = recordedCollections(KEPANO).reduce((sum, [, c]) => sum + c.restrictedContributionsCount, 0)
    expect(restricted).toBe(10316)
    expect(profile.restrictedContributions).toBe(restricted)

    // Repos: the 39 own repos of the listing, and the 19 only contributed to, by first active day.
    const listing = (KEPANO.graphql[0].body.data.user as { repositories: { nodes: Array<{ nameWithOwner: string }> } }).repositories.nodes
    expect(profile.repos).toHaveLength(58)
    const own = profile.repos.filter((r) => r.isOwn)
    expect(new Set(own.map((r) => r.nameWithOwner))).toEqual(new Set(listing.map((r) => r.nameWithOwner)))
    for (const repo of own) expect(repo.firstActiveAt).toBe(repo.createdAt)
    expect(profile.repos.filter((r) => !r.isOwn)).toHaveLength(19)
    for (let i = 1; i < profile.repos.length; i++) {
      expect(Date.parse(profile.repos[i - 1].firstActiveAt)).toBeLessThanOrEqual(Date.parse(profile.repos[i].firstActiveAt))
    }
    expect(profile.repos.some((r) => r.isPrivate)).toBe(false)

    const minimal = profile.repos.find((r) => r.nameWithOwner === 'kepano/obsidian-minimal')!
    expect(minimal).toMatchObject({
      isOwn: true,
      createdAt: '2020-07-26T00:52:24Z',
      firstActiveAt: '2020-07-26T00:52:24Z',
      // its last push is later than its last counted day
      lastActiveAt: '2026-10-06T22:06:26Z',
      language: 'CSS',
      languageColor: '#663399',
      stars: 5452,
      forks: 282,
      isFork: false,
      isArchived: false,
    })
    // A repo they only contributed to roots at their first counted day and ends at their last one,
    // not at its own birth or its latest push (other people's).
    const releases = profile.repos.find((r) => r.nameWithOwner === 'obsidianmd/obsidian-releases')!
    expect(releases).toMatchObject({ isOwn: false, firstActiveAt: '2020-11-22T08:00:00Z', lastActiveAt: '2024-01-27T08:00:00Z' })
    expect(Date.parse(releases.createdAt)).toBeLessThan(Date.parse(releases.firstActiveAt))

    // Milestones as GitHub states them. All four of kepano's are restricted contributions, so none
    // names a repo; the first repo predates the account (backdated).
    expect(profile.milestones).toEqual([
      { kind: 'first-repo', date: '2013-01-31T18:14:17Z', label: 'First repository' },
      { kind: 'joined', date: '2015-01-16T19:37:35Z', label: 'Joined GitHub' },
      { kind: 'first-issue', date: '2015-09-18T18:51:23Z', label: 'First issue' },
      { kind: 'first-pr', date: '2017-07-10T15:33:20Z', label: 'First pull request' },
    ])

    // Progress: the user, the repos, each batch of windows, then done with every request counted.
    expect(progress.map((p) => p.stage)).toEqual(['user', 'repos', ...Array<string>(14).fill('windows'), 'done'])
    expect(progress.filter((p) => p.stage === 'windows').map((p) => [p.done, p.total])).toEqual(Array.from({ length: 14 }, (_, i) => [4 * (i + 1), 56]))
    expect(progress[2].message).toBe('Read contributions through 2013 Q4')
    const done = progress[progress.length - 1]
    expect(done.requestsUsed).toBe(16)
    // GraphQL points never reach the rate state: the budget it reports is the identity call's core one.
    expect(done.rateLimitRemaining).toBe(Number(KEPANO.user.headers['x-ratelimit-remaining']))
    expect(done.rateLimitResetAt).toBe(new Date(Number(KEPANO.user.headers['x-ratelimit-reset']) * 1000).toISOString())
  })

  it("counts each repo's commits per GitHub day, occurredAt read in US Pacific time", async () => {
    const profile = await kepanoProfile()
    const expected = new Map<string, number>()
    for (const [, collection] of recordedCollections(KEPANO)) {
      for (const entry of collection.commitContributionsByRepository) {
        for (const node of entry.contributions.nodes) {
          const key = `${entry.repository.nameWithOwner}|${pacificDate(node.occurredAt)}`
          expected.set(key, (expected.get(key) ?? 0) + node.commitCount)
        }
      }
    }
    const actual = new Map(profile.repos.flatMap((r) => r.activity.map((a) => [`${r.nameWithOwner}|${a.date}`, a.commits] as const)))
    expect(actual).toEqual(expected)
    for (const repo of profile.repos) {
      const dates = repo.activity.map((a) => a.date)
      expect(dates).toEqual([...dates].sort())
      expect(new Set(dates).size).toBe(dates.length)
    }
    // GitHub's own totalCommitContributions for kepano, year by year from 2020: 30 + 46 + 346 + 694 + 1105 + 839 + 1692
    expect([...actual.values()].reduce((a, b) => a + b, 0)).toBe(4752)
  })

  it('flags truncated for a quarter that returned 100 repositories (sindresorhus, 2018 Q1)', async () => {
    const router: Router = (call) => {
      if (call.url.pathname.toLowerCase() === '/users/sindresorhus') return SINDRE.user
      return isGraphql(call) ? replayGraphql(SINDRE, SINDRE_WINDOWS, call) : undefined
    }
    const { fetch, calls } = makeFetch(router)
    const profile = await fetchProfileGraphql('sindresorhus', { token: TOKEN, fetch, now: SINDRE_NOW })
    const recorded = (SINDRE_WINDOWS.get('w2018q1')!.user as RawWindowUser).contributionsCollection
    expect(recorded.commitContributionsByRepository).toHaveLength(100)
    // no repo of the quarter is paging: the repo cap alone sets it
    expect(recorded.commitContributionsByRepository.some((r) => r.contributions.pageInfo.hasNextPage)).toBe(false)
    expect(windowCalls(calls).map(aliasesOf)).toEqual([['w2018q1']])
    expect(profile.truncated).toBe(true)
    expect(profile.lostWindows).toEqual([])
    expect(profile.repos).toHaveLength(100)
    // The listing is synthesised empty, so these come from the window alone; all 100 are under his
    // name, which says they are his own (as for repos past the 500-repo cap).
    expect(profile.repos.every((r) => r.nameWithOwner.startsWith('sindresorhus/') && r.isOwn && r.firstActiveAt === r.createdAt)).toBe(true)
    expect(profile.days.map((d) => d.date)).toEqual(Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2018, 0, 1) + i * DAY_MS).toISOString().slice(0, 10)))
  })
})

// ---------- merging, on quiet-sprout ----------

describe('fetchProfileGraphql: days, repos and milestones', () => {
  it('never yields a day after today in Pacific time, and ends the current quarter at now', async () => {
    // 03:00 UTC on 2024-05-15 is still the 14th in Pacific time.
    const now = Date.parse('2024-05-15T03:00:00Z')
    const { fetch, calls } = makeFetch(
      sproutRouter({
        years: [2024],
        windows: (alias) =>
          alias === 'w2024q2'
            ? { days: [['2024-05-13', 1], ['2024-05-14', 2], ['2024-05-15', 3], ['2024-06-30', 0]] }
            : { days: [['2024-03-31', 4]] },
      }),
    )
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now })
    expect(windowCalls(calls).map(aliasesOf)).toEqual([['w2024q1', 'w2024q2']])
    expect(windowCalls(calls)[0].body?.variables.w2024q2_to).toBe('2024-05-15T03:00:00.000Z')
    expect(profile.days).toEqual([
      { date: '2024-03-31', count: 4 },
      { date: '2024-05-13', count: 1 },
      { date: '2024-05-14', count: 2 },
    ])
  })

  it("buckets commits by GitHub's day across a daylight saving change, never by UTC date", async () => {
    const repo = repoNode('Quiet-Sprout/garden')
    const { fetch } = makeFetch(
      sproutRouter({
        years: [2024],
        pages: [[repo]],
        windows: (alias) =>
          alias === 'w2024q1'
            ? {
                repos: [
                  {
                    repo,
                    nodes: [
                      ['2024-03-11T07:00:00Z', 4], // midnight PDT: the 11th
                      ['2024-03-10T08:00:00Z', 2], // midnight PST: the 10th
                      ['2024-03-10T06:59:59Z', 1], // 22:59 on the 9th in Pacific time, the 10th in UTC
                    ],
                  },
                ],
              }
            : undefined,
      }),
    )
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-03-20T12:00:00Z') })
    expect(profile.repos[0].activity).toEqual([
      { date: '2024-03-09', commits: 1 },
      { date: '2024-03-10', commits: 2 },
      { date: '2024-03-11', commits: 4 },
    ])
  })

  it('merges own repos with the ones only contributed to, summing activity across windows', async () => {
    const garden = repoNode('Quiet-Sprout/garden', { createdAt: '2020-03-01T12:00:00Z', pushedAt: '2024-05-01T10:00:00Z', stargazerCount: 7 })
    const idle = repoNode('Quiet-Sprout/idle', { createdAt: '2021-06-01T00:00:00Z', pushedAt: null, primaryLanguage: null, isArchived: true })
    const fork = repoNode('Quiet-Sprout/fork', { createdAt: '2022-01-10T00:00:00Z', pushedAt: '2021-12-01T00:00:00Z', isFork: true })
    // pushed long after their last commit here: someone else's pushes
    const big = repoNode('other-org/big-project', { createdAt: '2016-01-01T00:00:00Z', pushedAt: '2024-05-14T00:00:00Z', stargazerCount: 900, forkCount: 40 })
    // their own, but not in the listing (as past the 500-repo cap)
    const beyond = repoNode('quiet-sprout/beyond-cap', { createdAt: '2023-12-01T00:00:00Z', pushedAt: '2024-01-02T00:00:00Z' })
    const { fetch } = makeFetch(
      sproutRouter({
        years: [2024],
        pages: [[garden, idle, fork]],
        windows: (alias) =>
          alias === 'w2024q1'
            ? { repos: [{ repo: garden, nodes: [['2024-02-03T08:00:00Z', 2]] }, { repo: beyond, nodes: [['2024-01-02T08:00:00Z', 1]] }] }
            : {
                repos: [
                  { repo: big, nodes: [['2024-04-20T07:00:00Z', 1], ['2024-04-02T07:00:00Z', 3]] },
                  { repo: garden, nodes: [['2024-04-02T07:00:00Z', 5]] },
                ],
              },
      }),
    )
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-05-15T12:00:00Z') })
    expect(profile.repos.map((r) => r.nameWithOwner)).toEqual([
      'Quiet-Sprout/garden',
      'Quiet-Sprout/idle',
      'Quiet-Sprout/fork',
      'quiet-sprout/beyond-cap',
      'other-org/big-project',
    ])
    const [gardenRepo, idleRepo, forkRepo, beyondRepo, bigRepo] = profile.repos
    expect(gardenRepo).toEqual({
      nameWithOwner: 'Quiet-Sprout/garden',
      createdAt: '2020-03-01T12:00:00Z',
      firstActiveAt: '2020-03-01T12:00:00Z',
      lastActiveAt: '2024-05-01T10:00:00Z',
      isOwn: true,
      language: 'TypeScript',
      languageColor: '#3178c6',
      stars: 7,
      forks: 0,
      isFork: false,
      isArchived: false,
      isPrivate: false,
      activity: [
        { date: '2024-02-03', commits: 2 },
        { date: '2024-04-02', commits: 5 },
      ],
    })
    // An own repo GitHub counted nothing for still shows, as a span from birth to last push.
    expect(idleRepo).toMatchObject({ isOwn: true, activity: [], lastActiveAt: '2021-06-01T00:00:00Z', language: null, languageColor: null, isArchived: true })
    // A fork's pushedAt can predate its creation.
    expect(forkRepo).toMatchObject({ isFork: true, lastActiveAt: '2022-01-10T00:00:00Z' })
    expect(beyondRepo).toMatchObject({ isOwn: true, firstActiveAt: '2023-12-01T00:00:00Z', lastActiveAt: '2024-01-02T08:00:00Z' })
    expect(bigRepo).toMatchObject({
      isOwn: false,
      createdAt: '2016-01-01T00:00:00Z',
      firstActiveAt: '2024-04-02T07:00:00Z',
      lastActiveAt: '2024-04-20T07:00:00Z',
      stars: 900,
      forks: 40,
      activity: [
        { date: '2024-04-02', commits: 3 },
        { date: '2024-04-20', commits: 1 },
      ],
    })
  })

  it('flags truncated for a window whose contributions still page', async () => {
    const repo = repoNode('Quiet-Sprout/garden')
    const { fetch } = makeFetch(
      sproutRouter({ years: [2024], pages: [[repo]], windows: () => ({ repos: [{ repo, nodes: [['2024-02-03T08:00:00Z', 1]], hasNextPage: true }] }) }),
    )
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-02-10T12:00:00Z') })
    expect(profile.truncated).toBe(true)
    expect(profile.lostWindows).toEqual([])
  })

  it('leaves truncated false for a window of 99 repositories, and sets it at 100', async () => {
    const read = (count: number) => {
      const repos = Array.from({ length: count }, (_, i) => repoNode(`other-org/repo-${i}`))
      const { fetch } = makeFetch(
        sproutRouter({ years: [2024], windows: () => ({ repos: repos.map((repo) => ({ repo, nodes: [['2024-01-02T08:00:00Z', 1]] as Array<[string, number]> })) }) }),
      )
      return fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-02-10T12:00:00Z') })
    }
    const ninetyNine = await read(99)
    expect(ninetyNine.repos).toHaveLength(99)
    expect(ninetyNine.truncated).toBe(false)
    expect(ninetyNine.lostWindows).toEqual([])
    expect((await read(100)).truncated).toBe(true)
  })

  it('marks private repos private, own or seen only in a window, and names no first* repo whose privacy is not stated', async () => {
    const garden = repoNode('Quiet-Sprout/garden')
    // private: their own, in the listing (a token owner looking at themselves)
    const diary = repoNode('Quiet-Sprout/diary', { isPrivate: true, createdAt: '2023-01-05T00:00:00Z', pushedAt: '2024-01-10T00:00:00Z' })
    // private: someone else's, seen only in a window (a viewer with access to it)
    const vault = repoNode('secret-org/vault', { isPrivate: true, createdAt: '2019-01-01T00:00:00Z', pushedAt: '2024-02-08T00:00:00Z' })
    const { fetch } = makeFetch(
      sproutRouter({
        years: [2024],
        pages: [[garden, diary]],
        windows: (alias) =>
          alias === 'w2024q1'
            ? {
                repos: [
                  { repo: diary, nodes: [['2024-01-10T08:00:00Z', 2]] },
                  { repo: vault, nodes: [['2024-02-01T08:00:00Z', 3]] },
                ],
                firstRepositoryContribution: { occurredAt: '2024-01-03T10:00:00Z', repository: { nameWithOwner: 'Quiet-Sprout/diary', isPrivate: true } },
                // its repository came back without isPrivate: its privacy is unknown, so it is not named
                firstIssueContribution: { occurredAt: '2024-01-15T10:00:00Z', issue: { repository: { nameWithOwner: 'mystery-org/unknown' } } },
              }
            : undefined,
      }),
    )
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-02-10T12:00:00Z') })
    expect(profile.repos.map((r) => [r.nameWithOwner, r.isOwn, r.isPrivate])).toEqual([
      ['Quiet-Sprout/garden', true, false],
      ['Quiet-Sprout/diary', true, true],
      ['secret-org/vault', false, true],
    ])
    expect(profile.repos[2]).toMatchObject({ firstActiveAt: '2024-02-01T08:00:00Z', activity: [{ date: '2024-02-01', commits: 3 }] })
    expect(profile.milestones).toEqual([
      { kind: 'joined', date: '2020-02-01T00:00:00Z', label: 'Joined GitHub' },
      { kind: 'first-repo', date: '2024-01-03T10:00:00Z', label: 'First repository' },
      { kind: 'first-issue', date: '2024-01-15T10:00:00Z', label: 'First issue' },
    ])
    expect(JSON.stringify(profile)).not.toContain('mystery-org/unknown')
  })

  it('names no repo for a restricted or private first contribution, and keeps the earliest of each', async () => {
    const { fetch } = makeFetch(
      sproutRouter({
        years: [2023, 2024],
        windows: (alias) => {
          if (alias === 'w2023q2') {
            return {
              restricted: 5,
              // a private repo the viewer may read (a collaborator's token): still no name
              firstPullRequestContribution: { occurredAt: '2023-05-02T10:00:00Z', pullRequest: { repository: { nameWithOwner: 'secret-org/hidden', isPrivate: true } } },
              firstRepositoryContribution: { occurredAt: '2023-04-10T09:00:00Z' }, // RestrictedContribution: its date alone
              firstIssueContribution: { occurredAt: '2023-06-01T10:00:00Z', issue: { repository: { nameWithOwner: 'other-org/big-project', isPrivate: false } } },
            }
          }
          if (alias === 'w2023q3') {
            // a later one in another window never wins
            return { restricted: 7, firstIssueContribution: { occurredAt: '2023-08-01T10:00:00Z', issue: { repository: { nameWithOwner: 'other-org/later', isPrivate: false } } } }
          }
          if (alias === 'w2020q1') return { joinedGitHubContribution: { occurredAt: '2020-02-01T00:00:00Z' } }
          return undefined
        },
      }),
    )
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-02-10T12:00:00Z') })
    expect(profile.milestones).toEqual([
      // no joinedGitHubContribution in the windows read (they start in 2023): the account's creation
      { kind: 'joined', date: '2020-02-01T00:00:00Z', label: 'Joined GitHub' },
      { kind: 'first-repo', date: '2023-04-10T09:00:00Z', label: 'First repository' },
      { kind: 'first-pr', date: '2023-05-02T10:00:00Z', label: 'First pull request' },
      { kind: 'first-issue', date: '2023-06-01T10:00:00Z', label: 'First issue', repo: 'other-org/big-project' },
    ])
    expect(JSON.stringify(profile)).not.toContain('secret-org/hidden')
    expect(profile.restrictedContributions).toBe(12)
  })

  it('reads no windows for a user who never contributed', async () => {
    const { fetch, calls } = makeFetch(sproutRouter({ years: [], pages: [[repoNode('Quiet-Sprout/garden')]] }))
    const progress: FetchProgress[] = []
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-02-10T12:00:00Z'), onProgress: (p) => progress.push(p) })
    expect(windowCalls(calls)).toEqual([])
    expect(profile.days).toEqual([])
    expect(profile.repos).toHaveLength(1)
    expect(profile.milestones).toEqual([{ kind: 'joined', date: '2020-02-01T00:00:00Z', label: 'Joined GitHub' }])
    expect(progress.map((p) => p.stage)).toEqual(['user', 'repos', 'done'])
  })

  it('pages the own repos up to 500, oldest first, and flags truncated past them', async () => {
    const pages = Array.from({ length: 6 }, (_, p) =>
      Array.from({ length: 100 }, (_, i) => repoNode(`Quiet-Sprout/repo-${p * 100 + i}`, { createdAt: new Date(Date.UTC(2020, 2, 1) + (p * 100 + i) * DAY_MS).toISOString() })),
    )
    const { fetch, calls } = makeFetch(sproutRouter({ years: [2024], pages }))
    const progress: FetchProgress[] = []
    const profile = await fetchProfileGraphql('quiet-sprout', { token: TOKEN, fetch, now: Date.parse('2024-02-10T12:00:00Z'), onProgress: (p) => progress.push(p) })
    const repoCalls = graphqlCalls(calls).filter((c) => aliasesOf(c).length === 0)
    expect(repoCalls.map((c) => c.body?.variables.after ?? null)).toEqual([null, 'c1', 'c2', 'c3', 'c4'])
    expect(profile.repos).toHaveLength(500)
    expect(profile.repos[499].nameWithOwner).toBe('Quiet-Sprout/repo-499')
    expect(profile.truncated).toBe(true)
    expect(progress.some((p) => p.stage === 'repos' && /cap of 500/.test(p.message))).toBe(true)
  })
})

// ---------- partial answers and the halving ladder ----------

describe('fetchProfileGraphql: partial answers and timeouts', () => {
  /** A batch answered from the recording, with alias set to null and error added. */
  function withError(call: Call, alias: string, error: Record<string, unknown>): Route {
    const answer = replayGraphql(KEPANO, KEPANO_WINDOWS, call) as { headers: Record<string, string>; body: { data: Record<string, unknown> } }
    return { headers: answer.headers, body: { data: { ...answer.body.data, [alias]: null }, errors: [error] } }
  }

  const BUG = {
    type: 'SERVICE_UNAVAILABLE',
    path: ['w2022q3', 'contributionsCollection', 'commitContributionsByRepository'],
    message: 'Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.',
  }

  it('keeps the windows that came back when one errors, asks that one again alone, then counts it lost', async () => {
    const { fetch, calls } = makeFetch(kepanoRouter((call, aliases) => (aliases.includes('w2022q3') ? withError(call, 'w2022q3', BUG) : undefined)))
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    const asked = windowCalls(calls).map(aliasesOf)
    expect(asked.slice(9, 12)).toEqual([['w2022q1', 'w2022q2', 'w2022q3', 'w2022q4'], ['w2022q3'], ['w2023q1', 'w2023q2', 'w2023q3', 'w2023q4']])
    expect(calls).toHaveLength(17)
    expect(profile.source).toBe('graphql')
    expect(profile.lostWindows).toEqual(['2022q3'])
    expect(profile.truncated).toBe(true)

    // Everything but that quarter is as without the error.
    const plain = await kepanoProfile()
    const inQ3 = (date: string) => date >= '2022-07-01' && date <= '2022-09-30'
    expect(profile.days.some((d) => inQ3(d.date))).toBe(false)
    expect(profile.days).toEqual(plain.days.filter((d) => !inQ3(d.date)))
    for (const repo of profile.repos) {
      const before = plain.repos.find((r) => r.nameWithOwner === repo.nameWithOwner)!
      expect(repo.activity).toEqual(before.activity.filter((a) => !inQ3(a.date)))
    }
    expect(profile.restrictedContributions).toBe(plain.restrictedContributions - 434)
  })

  it('keeps a window whose retry answers', async () => {
    const { fetch, calls } = makeFetch(
      kepanoRouter((call, aliases) => (aliases.includes('w2022q3') && aliases.length > 1 ? withError(call, 'w2022q3', BUG) : undefined)),
    )
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).map(aliasesOf)).toContainEqual(['w2022q3'])
    expect(profile).toEqual(await kepanoProfile())
  })

  /**
   * A batch answered from the recording, with alias's data there but one field of its collection
   * nulled and error added: what GitHub sends when the field that failed is nullable.
   */
  function withFieldError(call: Call, alias: string, field: string, error: Record<string, unknown>): Route {
    const answer = replayGraphql(KEPANO, KEPANO_WINDOWS, call) as { headers: Record<string, string>; body: { data: Record<string, unknown> } }
    const user = structuredClone(answer.body.data[alias]) as { contributionsCollection: Record<string, unknown> }
    user.contributionsCollection[field] = null
    return { headers: answer.headers, body: { data: { ...answer.body.data, [alias]: user }, errors: [error] } }
  }

  // kepano's first pull request is in 2017 Q3, the only window whose firstPullRequestContribution is set.
  const PR_ERROR = {
    type: 'FORBIDDEN',
    path: ['w2017q3', 'contributionsCollection', 'firstPullRequestContribution', 'pullRequest'],
    message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.',
  }
  const BATCH_2017 = ['w2017q1', 'w2017q2', 'w2017q3', 'w2017q4']

  it('asks a window whose data came back with an error on its path again alone, and keeps it whole when that answers', async () => {
    const { fetch, calls } = makeFetch(
      kepanoRouter((call, aliases) => (aliases.length > 1 && aliases.includes('w2017q3') ? withFieldError(call, 'w2017q3', 'firstPullRequestContribution', PR_ERROR) : undefined)),
    )
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).map(aliasesOf).slice(4, 6)).toEqual([BATCH_2017, ['w2017q3']])
    expect(profile).toEqual(await kepanoProfile())
  })

  it('keeps the data of a window whose error repeats on the retry, but lists it in lostWindows', async () => {
    const { fetch, calls } = makeFetch(
      kepanoRouter((call, aliases) => (aliases.includes('w2017q3') ? withFieldError(call, 'w2017q3', 'firstPullRequestContribution', PR_ERROR) : undefined)),
    )
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).map(aliasesOf).slice(4, 6)).toEqual([BATCH_2017, ['w2017q3']])
    expect(calls).toHaveLength(17)
    expect(profile.source).toBe('graphql')
    expect(profile.lostWindows).toEqual(['2017q3'])
    expect(profile.truncated).toBe(true)
    // Its calendar, commits and restricted count stand; only the first pull request the error
    // nulled is missing.
    const plain = await kepanoProfile()
    expect(profile.days).toEqual(plain.days)
    expect(profile.repos).toEqual(plain.repos)
    expect(profile.restrictedContributions).toBe(plain.restrictedContributions)
    expect(plain.milestones.some((m) => m.kind === 'first-pr')).toBe(true)
    expect(profile.milestones).toEqual(plain.milestones.filter((m) => m.kind !== 'first-pr'))
  })

  it('loses one window to an SSO FORBIDDEN inside it, not the profile (no fallback)', async () => {
    const sso = {
      type: 'FORBIDDEN',
      path: ['w2023q2', 'contributionsCollection', 'commitContributionsByRepository', 3, 'repository'],
      message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.',
    }
    const { fetch, calls } = makeFetch(kepanoRouter((call, aliases) => (aliases.includes('w2023q2') ? withError(call, 'w2023q2', sso) : undefined), true))
    const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(profile.source).toBe('graphql')
    expect(profile.fallback).toBeNull()
    expect(profile.lostWindows).toEqual(['2023q2'])
    expect(profile.truncated).toBe(true)
    expect(restCalls(calls).map((c) => c.url.pathname)).toEqual(['/users/kepano'])
  })

  it.each([502, 504])('retries a %i batch in halves, down to one window', async (status) => {
    const { fetch, calls } = makeFetch(
      kepanoRouter((_call, aliases) => (aliases[0]?.startsWith('w2013') && aliases.length > 1 ? { status, body: { message: 'We couldn\'t respond to your request in time.' } } : undefined)),
    )
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).slice(0, 8).map(aliasesOf)).toEqual([
      ['w2013q1', 'w2013q2', 'w2013q3', 'w2013q4'],
      ['w2013q1', 'w2013q2'],
      ['w2013q1'],
      ['w2013q2'],
      ['w2013q3', 'w2013q4'],
      ['w2013q3'],
      ['w2013q4'],
      ['w2014q1', 'w2014q2', 'w2014q3', 'w2014q4'],
    ])
    expect(profile).toEqual(await kepanoProfile())
  })

  it('retries a batch that times out in halves', async () => {
    const { fetch, calls } = makeFetch(kepanoRouter((_call, aliases) => (aliases.length === 4 && aliases[0] === 'w2025q1' ? { hang: true } : undefined)))
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).map(aliasesOf).slice(12, 15)).toEqual([
      ['w2025q1', 'w2025q2', 'w2025q3', 'w2025q4'],
      ['w2025q1', 'w2025q2'],
      ['w2025q3', 'w2025q4'],
    ])
    expect(profile).toEqual(await kepanoProfile())
  })

  it('fails over to REST when one window still times out alone', async () => {
    const hangs = (aliases: string[]) => aliases.includes('w2013q1')
    const direct = makeFetch(kepanoRouter((_call, aliases) => (hangs(aliases) ? { hang: true } : undefined)))
    const started = Date.now()
    const err = await expectFetchError(fetchProfileGraphql('kepano', { token: TOKEN, fetch: direct.fetch, now: KEPANO_NOW }))
    expect(err).toBeInstanceOf(UseRest)
    expect(err.message).toMatch(/did not answer the contributions query in time, even one quarter at a time/)
    expect(windowCalls(direct.calls).map(aliasesOf)).toEqual([['w2013q1', 'w2013q2', 'w2013q3', 'w2013q4'], ['w2013q1', 'w2013q2'], ['w2013q1']])
    expect(Date.now() - started).toBeGreaterThanOrEqual(3 * TIMEOUT_MS - 50)

    const { fetch, calls } = makeFetch(kepanoRouter((_call, aliases) => (hangs(aliases) ? { hang: true } : undefined), true))
    const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(profile.source).toBe('rest')
    expect(profile.fallback).toEqual({ message: err.message, limit: null, resetAt: null })
    expect(restCalls(calls).map((c) => c.url.pathname)).toEqual(['/users/kepano', '/users/kepano/repos', '/users/kepano/events/public'])
  })

  const GATEWAY_TIMEOUT: Route = { status: 504, body: { message: "We couldn't respond to your request in time." } }

  it('asks a repositories query that answers 504 once more, and reads on when it answers', async () => {
    let failures = 0
    const { fetch, calls } = makeFetch(kepanoRouter((_call, aliases) => (aliases.length === 0 && failures++ === 0 ? GATEWAY_TIMEOUT : undefined)))
    const profile = await fetchProfileGraphql('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(calls).toHaveLength(17)
    expect(graphqlCalls(calls).slice(0, 2).map((c) => c.body?.query)).toEqual([REPOS_QUERY, REPOS_QUERY])
    expect(profile).toEqual(await kepanoProfile())
  })

  it('falls back to REST when the repositories query answers 504 twice', async () => {
    const { fetch, calls } = makeFetch(kepanoRouter((_call, aliases) => (aliases.length === 0 ? GATEWAY_TIMEOUT : undefined), true))
    const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(profile.source).toBe('rest')
    expect(profile.fallback).toEqual({ message: 'GitHub did not answer the repositories query in time (HTTP 504, twice).', limit: null, resetAt: null })
    expect(graphqlCalls(calls)).toHaveLength(2)
    expect(windowCalls(calls)).toEqual([])
  })
})

// ---------- the solo retry of a window that errored ----------

describe('fetchProfile: what the solo retry of a window meets', () => {
  // In kepano's last batch, w2026q2 comes back null with an error on its path; its retry alone is
  // answered by retry (undefined: from the recording). REST answers empty for the fallback.
  function retryRouter(retry: () => Route | undefined): Router {
    const error = {
      type: 'SERVICE_UNAVAILABLE',
      path: ['w2026q2', 'contributionsCollection', 'commitContributionsByRepository'],
      message: 'Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug.',
    }
    return kepanoRouter((call, aliases) => {
      if (aliases.length > 1 && aliases.includes('w2026q2')) {
        const answer = replayGraphql(KEPANO, KEPANO_WINDOWS, call) as { headers: Record<string, string>; body: { data: Record<string, unknown> } }
        return { headers: answer.headers, body: { data: { ...answer.body.data, w2026q2: null }, errors: [error] } }
      }
      return aliases.length === 1 && aliases[0] === 'w2026q2' ? retry() : undefined
    }, true)
  }
  const LAST_BATCH = [['w2026q1', 'w2026q2', 'w2026q3', 'w2026q4'], ['w2026q2']]
  const SAML = 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.'

  const fallbacks: Array<[string, Route, 'graphql' | 'secondary' | null, RegExp]> = [
    [
      'a RATE_LIMITED error',
      { body: { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit already exceeded for user ID 1.' }] } },
      'graphql',
      /^GitHub GraphQL rate limit exceeded while reading contributions\./,
    ],
    [
      'a 403 secondary limit',
      { status: 403, body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }, headers: { 'retry-after': '60' } },
      'secondary',
      /^GitHub secondary rate limit hit while reading contributions\. Retry after /,
    ],
    ['a 401', { status: 401, body: { message: 'Bad credentials' } }, null, /rejected the credentials \(401\) while reading contributions/],
    ['a 403 refusal', { status: 403, body: { message: 'Resource not accessible by personal access token' } }, null, /refused the request \(403\) while reading contributions/],
    ['FORBIDDEN for the whole query', { body: { data: null, errors: [{ type: 'FORBIDDEN', message: SAML }] } }, null, /refused the GraphQL query while reading contributions: Resource protected/],
  ]

  it.each(fallbacks)('falls back to REST on %s', async (_label, route, limit, message) => {
    const { fetch, calls } = makeFetch(retryRouter(() => route))
    const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).map(aliasesOf).slice(-2)).toEqual(LAST_BATCH)
    expect(profile.source).toBe('rest')
    expect(profile.fallback?.limit).toBe(limit)
    expect(profile.fallback?.message).toMatch(message)
    expect(restCalls(calls).map((c) => c.url.pathname)).toEqual(['/users/kepano', '/users/kepano/repos', '/users/kepano/events/public'])
  })

  it('ends the fetch on a network error, with no fallback', async () => {
    const { fetch, calls } = makeFetch(
      retryRouter(() => {
        throw new TypeError('fetch failed')
      }),
    )
    const err = await expectFetchError(fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW }))
    expect(err.code).toBe('network')
    expect(err).not.toBeInstanceOf(UseRest)
    expect(windowCalls(calls).map(aliasesOf).slice(-2)).toEqual(LAST_BATCH)
    expect(restCalls(calls).map((c) => c.url.pathname)).toEqual(['/users/kepano'])
  })

  it('ends the fetch on an abort during the retry', async () => {
    const controller = new AbortController()
    const { fetch, calls } = makeFetch(
      retryRouter(() => {
        controller.abort()
        return { hang: true }
      }),
    )
    const err = await expectFetchError(fetchProfile('kepano', { token: TOKEN, fetch, signal: controller.signal, now: KEPANO_NOW }))
    expect(err.code).toBe('aborted')
    expect(windowCalls(calls).map(aliasesOf).slice(-2)).toEqual(LAST_BATCH)
    expect(restCalls(calls).map((c) => c.url.pathname)).toEqual(['/users/kepano'])
  })

  const noAnswer: Array<[string, Route]> = [
    ['times out', { hang: true }],
    ['answers 504', { status: 504, body: { message: "We couldn't respond to your request in time." } }],
  ]

  it.each(noAnswer)('loses that window alone when the retry %s', async (_label, route) => {
    const { fetch, calls } = makeFetch(retryRouter(() => route))
    const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
    expect(windowCalls(calls).map(aliasesOf).slice(-2)).toEqual(LAST_BATCH)
    expect(profile.source).toBe('graphql')
    expect(profile.fallback).toBeNull()
    expect(profile.lostWindows).toEqual(['2026q2'])
    expect(profile.truncated).toBe(true)
    expect(restCalls(calls).map((c) => c.url.pathname)).toEqual(['/users/kepano'])
    const plain = await kepanoProfile()
    const inQ2 = (date: string) => date >= '2026-04-01' && date <= '2026-06-30'
    expect(profile.days.some((d) => inQ2(d.date))).toBe(false)
    expect(profile.days).toEqual(plain.days.filter((d) => !inQ2(d.date)))
  })
})

// ---------- fetchProfile: what falls back and what does not ----------

describe('fetchProfile with a token', () => {
  const limited403: Route = {
    status: 403,
    body: { message: 'API rate limit exceeded for user ID 1.', documentation_url: 'https://docs.github.com/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api' },
    headers: { 'x-ratelimit-remaining': '0' },
  }
  const GQL_RESET_ISO = new Date(Number(GQL_RESET) * 1000).toISOString()

  async function restBaseline(): Promise<ProfileData> {
    return fetchProfileRest('gaearon', { token: TOKEN, fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW })
  }

  it('falls back to REST on a primary GraphQL rate limit, with limit graphql', async () => {
    const { fetch, calls } = makeFetch(gaearonRouter(() => limited403))
    const progress: FetchProgress[] = []
    const profile = await fetchProfile('gaearon', { token: TOKEN, fetch, now: GAEARON_NOW, onProgress: (p) => progress.push(p) })

    expect(profile.source).toBe('rest')
    expect(profile.fallback).toEqual({
      message: `GitHub GraphQL rate limit exceeded while listing repos. Retry after ${GQL_RESET_ISO}.`,
      limit: 'graphql',
      resetAt: GQL_RESET_ISO,
    })
    // Otherwise the tier 1 profile, from one identity call shared by both tiers.
    const { fallback, ...rest } = profile
    const { fallback: none, ...baseline } = await restBaseline()
    expect(fallback).not.toBeNull()
    expect(none).toBeNull()
    expect(rest).toEqual(baseline)
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /users/gaearon',
      'POST /graphql',
      ...Array<string>(4).fill('GET /users/gaearon/repos'),
      ...Array<string>(3).fill('GET /users/gaearon/events/public'),
    ])
    expect(progress.some((p) => /GraphQL failed, reading the public profile over REST/.test(p.message))).toBe(true)
    expect(progress[progress.length - 1]).toMatchObject({ stage: 'done', requestsUsed: 9 })
  })

  it('reads a RATE_LIMITED error the same way, its reset from rateLimit or the headers', async () => {
    const rateLimited = (data: unknown): Route => ({
      body: { data, errors: [{ type: 'RATE_LIMITED', code: 'graphql_rate_limit', message: 'API rate limit already exceeded for user ID 1.' }] },
    })
    const fromBody = await fetchProfile('gaearon', {
      token: TOKEN,
      fetch: makeFetch(gaearonRouter(() => rateLimited({ rateLimit: { cost: 1, remaining: 0, resetAt: '2026-10-25T10:05:00Z' } }))).fetch,
      now: GAEARON_NOW,
    })
    expect(fromBody.fallback).toMatchObject({ limit: 'graphql', resetAt: '2026-10-25T10:05:00Z' })
    const fromHeaders = await fetchProfile('gaearon', { token: TOKEN, fetch: makeFetch(gaearonRouter(() => rateLimited(null))).fetch, now: GAEARON_NOW })
    expect(fromHeaders.fallback).toMatchObject({ limit: 'graphql', resetAt: GQL_RESET_ISO })
  })

  it('falls back on a secondary limit, with limit secondary', async () => {
    const before = Date.now()
    const secondary: Route = {
      status: 403,
      body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' },
      headers: { 'retry-after': '60' },
    }
    const profile = await fetchProfile('gaearon', { token: TOKEN, fetch: makeFetch(gaearonRouter(() => secondary)).fetch, now: GAEARON_NOW })
    expect(profile.source).toBe('rest')
    expect(profile.fallback?.limit).toBe('secondary')
    expect(profile.fallback?.message).toMatch(/^GitHub secondary rate limit hit while listing repos\. Retry after /)
    // retry-after wins over the hourly reset
    const wait = Date.parse(profile.fallback?.resetAt ?? '') - before
    expect(wait).toBeGreaterThanOrEqual(59_000)
    expect(wait).toBeLessThanOrEqual(61_000)

    const tooMany = await fetchProfile('gaearon', { token: TOKEN, fetch: makeFetch(gaearonRouter(() => ({ status: 429, body: { message: 'Too Many Requests' } }))).fetch, now: GAEARON_NOW })
    expect(tooMany.fallback?.limit).toBe('secondary')
  })

  it('names no login in a limit message, so a login cannot flip which limit it reads as', async () => {
    const user = (login: string): Route => ({ body: { ...(SPROUT_USER.body as object), login } })
    for (const login of ['secondary-fan', 'graphql-fan']) {
      const primary = await fetchProfile(login, { token: TOKEN, fetch: makeFetch(sproutRouter({ years: [2024], user: user(login), graphql: () => limited403 })).fetch, now: GAEARON_NOW })
      expect(primary.fallback?.limit, login).toBe('graphql')
      expect(primary.fallback?.message, login).not.toContain(login)
      const refused = await fetchProfile(login, {
        token: TOKEN,
        fetch: makeFetch(sproutRouter({ years: [2024], user: user(login), graphql: () => ({ status: 401, body: { message: 'Bad credentials' } }) })).fetch,
        now: GAEARON_NOW,
      })
      expect(refused.fallback?.limit, login).toBeNull()
    }
  })

  it('falls back on a refusal: a 401, a 403 that is not a limit, or FORBIDDEN for the whole query', async () => {
    const refusals: Array<[string, Route, RegExp]> = [
      ['401', { status: 401, body: { message: 'Bad credentials' } }, /rejected the credentials \(401\) while listing repos/],
      ['403', { status: 403, body: { message: 'Resource not accessible by personal access token' } }, /refused the request \(403\) while listing repos/],
      [
        'SAML',
        { body: { data: null, errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.' }] } },
        /refused the GraphQL query while listing repos: Resource protected by organization SAML enforcement/,
      ],
    ]
    for (const [label, route, message] of refusals) {
      const { fetch, calls } = makeFetch(gaearonRouter(() => route))
      const profile = await fetchProfile('gaearon', { token: TOKEN, fetch, now: GAEARON_NOW })
      expect(profile.source, label).toBe('rest')
      expect(profile.repos, label).toHaveLength(301)
      expect(profile.fallback?.limit, label).toBeNull()
      expect(profile.fallback?.resetAt, label).toBeNull()
      expect(profile.fallback?.message, label).toMatch(message)
      expect(graphqlCalls(calls), label).toHaveLength(1)
    }
  })

  it('falls back on a schema error or anything unknown, never reading /graphql as the user missing', async () => {
    const cases: Array<[string, Route, RegExp]> = [
      [
        'schema',
        {
          body: {
            errors: [
              {
                path: ['query', 'user', 'contributionsCollection', 'contributionYears'],
                extensions: { code: 'undefinedField', typeName: 'ContributionsCollection', fieldName: 'contributionYears' },
                locations: [{ line: 1, column: 120 }],
                message: "Field 'contributionYears' doesn't exist on type 'ContributionsCollection'",
              },
            ],
          },
        },
        /did not accept the GraphQL query while listing repos/,
      ],
      ['404', { status: 404, body: { message: 'Not Found' } }, /GraphQL API answered HTTP 404 while listing repos/],
      ['422', { status: 422, body: { message: 'Unprocessable' } }, /answered HTTP 422/],
      ['user null', { body: { data: { user: null }, errors: [{ type: 'NOT_FOUND', path: ['user'], message: "Could not resolve to a User with the login of 'gaearon'." }] } }, /could not answer the GraphQL query/],
      ['no data', { body: { data: { user: null } } }, /no data came back/],
    ]
    for (const [label, route, message] of cases) {
      const profile = await fetchProfile('gaearon', { token: TOKEN, fetch: makeFetch(gaearonRouter(() => route)).fetch, now: GAEARON_NOW })
      expect(profile.source, label).toBe('rest')
      expect(profile.fallback?.limit, label).toBeNull()
      expect(profile.fallback?.message, label).toMatch(message)
    }
  })

  it('falls back when a windows query is refused or not accepted as a whole, asking no window again', async () => {
    const cases: Array<[string, string, Route, RegExp]> = [
      [
        // SSO met part-way through the history: an answer with no data and an error with no path
        'SAML',
        'w2016q1',
        {
          body: {
            data: null,
            errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.' }],
          },
        },
        /^GitHub refused the GraphQL query while reading contributions: Resource protected by organization SAML enforcement/,
      ],
      [
        // a field the schema does not know fails the first windows query, before any data
        'schema',
        'w2013q1',
        {
          body: {
            errors: [
              {
                path: ['fragment Window', 'contributionCalendar', 'weeks', 'contributionDays', 'contributionLevel'],
                extensions: { code: 'undefinedField', typeName: 'ContributionCalendarDay', fieldName: 'contributionLevel' },
                locations: [{ line: 2, column: 90 }],
                message: "Field 'contributionLevel' doesn't exist on type 'ContributionCalendarDay'",
              },
            ],
          },
        },
        /^GitHub did not accept the GraphQL query while reading contributions: Field 'contributionLevel' doesn't exist/,
      ],
    ]
    for (const [label, failing, route, message] of cases) {
      const { fetch, calls } = makeFetch(kepanoRouter((_call, aliases) => (aliases.includes(failing) ? route : undefined), true))
      const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW })
      expect(profile.source, label).toBe('rest')
      expect(profile.fallback, label).toEqual({ message: expect.stringMatching(message), limit: null, resetAt: null })
      expect(profile.lostWindows, label).toEqual([])
      // No window of it is asked again alone: the query failed, not one of its windows.
      const lastYear = Number(failing.slice(1, 5))
      expect(windowCalls(calls).map((c) => aliasesOf(c)), label).toEqual(
        Array.from({ length: lastYear - 2013 + 1 }, (_, i) => [1, 2, 3, 4].map((q) => `w${2013 + i}q${q}`)),
      )
    }
  })

  it('falls back on a limit met part-way through the windows, every request counted', async () => {
    const limited: Route = { body: { data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit already exceeded for user ID 1.' }] } }
    const { fetch, calls } = makeFetch(kepanoRouter((_call, aliases) => (aliases.includes('w2016q1') ? limited : undefined), true))
    const progress: FetchProgress[] = []
    const profile = await fetchProfile('kepano', { token: TOKEN, fetch, now: KEPANO_NOW, onProgress: (p) => progress.push(p) })
    expect(profile.source).toBe('rest')
    expect(profile.fallback).toEqual({
      message: `GitHub GraphQL rate limit exceeded while reading contributions. Retry after ${GQL_RESET_ISO}.`,
      limit: 'graphql',
      resetAt: GQL_RESET_ISO,
    })
    expect(windowCalls(calls).map((c) => aliasesOf(c)[0])).toEqual(['w2013q1', 'w2014q1', 'w2015q1', 'w2016q1'])
    // identity, repositories, 4 window batches, then REST's repos and events pages
    expect(progress[progress.length - 1]).toMatchObject({ stage: 'done', requestsUsed: 8 })
  })

  it('does not fall back on a core rate limit from the identity call', async () => {
    const coreLimited: Route = { status: 403, body: { message: 'API rate limit exceeded for user ID 1.' }, headers: { 'x-ratelimit-remaining': '0' } }
    const { fetch, calls } = makeFetch((call) => (isGraphql(call) ? undefined : coreLimited))
    const err = await expectFetchError(fetchProfile('gaearon', { token: TOKEN, fetch, now: GAEARON_NOW }))
    expect(err).not.toBeInstanceOf(UseRest)
    expect(err.code).toBe('rate_limited')
    expect(err.message).toBe(`GitHub API rate limit exceeded while looking up gaearon. Retry after ${new Date(Number(CORE_RESET) * 1000).toISOString()}.`)
    expect(describeFallback(err).limit).toBeNull()
    expect(calls.map((c) => c.url.pathname)).toEqual(['/users/gaearon'])
  })

  it('does not fall back on not_found or not_a_user: the identity call decides', async () => {
    const org = makeFetch((call) => (call.url.pathname.toLowerCase() === '/users/vercel' ? vercel.user : undefined))
    const orgErr = await expectFetchError(fetchProfile('vercel', { token: TOKEN, fetch: org.fetch, now: GAEARON_NOW }))
    expect(orgErr.code).toBe('not_a_user')
    expect(org.calls).toHaveLength(1)

    const missing = makeFetch(() => undefined)
    const missingErr = await expectFetchError(fetchProfile('No-Such-Sprout', { token: TOKEN, fetch: missing.fetch, now: GAEARON_NOW }))
    expect(missingErr.code).toBe('not_found')
    expect(missingErr.message).toBe('No-Such-Sprout was not found. Check the spelling.')
    expect(missing.calls).toHaveLength(1)

    // fetchProfileGraphql settles them the same way, before any GraphQL request
    const direct = makeFetch((call) => (call.url.pathname.toLowerCase() === '/users/vercel' ? vercel.user : undefined))
    expect((await expectFetchError(fetchProfileGraphql('vercel', { token: TOKEN, fetch: direct.fetch }))).code).toBe('not_a_user')
    expect(graphqlCalls(direct.calls)).toEqual([])
  })

  it('does not fall back on an abort or a network error', async () => {
    const controller = new AbortController()
    const aborting = makeFetch(
      kepanoRouter((_call, aliases) => {
        if (aliases.includes('w2015q1')) controller.abort()
        return undefined
      }, true),
    )
    const abortErr = await expectFetchError(fetchProfile('kepano', { token: TOKEN, fetch: aborting.fetch, signal: controller.signal, now: KEPANO_NOW }))
    expect(abortErr.code).toBe('aborted')
    expect(restCalls(aborting.calls).map((c) => c.url.pathname)).toEqual(['/users/kepano'])

    const failing: typeof globalThis.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.endsWith('/graphql')) throw new TypeError('fetch failed')
      return makeFetch(gaearonRouter(() => undefined)).fetch(input, init)
    }
    const networkErr = await expectFetchError(fetchProfile('gaearon', { token: TOKEN, fetch: failing, now: GAEARON_NOW }))
    expect(networkErr.code).toBe('network')
    expect(networkErr).not.toBeInstanceOf(UseRest)
  })

  it('needs a token for GraphQL, and without one is tier 1 alone', async () => {
    const { fetch, calls } = makeFetch(gaearonRouter(() => limited403))
    const err = await expectFetchError(fetchProfileGraphql('gaearon', { token: '  ', fetch }))
    expect(err).toBeInstanceOf(UseRest)
    expect(calls).toHaveLength(0)
    const profile = await fetchProfile('gaearon', { fetch, now: GAEARON_NOW })
    expect(profile.source).toBe('rest')
    expect(profile.fallback).toBeNull()
    expect(graphqlCalls(calls)).toEqual([])
  })

  it('never puts the token in a fallback message', async () => {
    const echo: Route = { status: 403, body: { message: `token ${TOKEN} is not allowed here` } }
    const profile = await fetchProfile('gaearon', { token: TOKEN, fetch: makeFetch(gaearonRouter(() => echo)).fetch, now: GAEARON_NOW })
    expect(profile.fallback?.message).toContain('[REDACTED]')
    expect(JSON.stringify(profile)).not.toContain(TOKEN)
  })
})

// ---------- the grow rule and the cache ----------

describe('grow data and the cache with a token', () => {
  it("grow data: source graphql, or rest after a fallback; neither names the login (a token is set)", async () => {
    const graphql = await kepanoProfile()
    expect(personGrowEventData(graphql, false, true)).toEqual({ mode: 'person', source: 'graphql', cached: false, token: true })
    expect(personGrowEventData(graphql, true, true)).toEqual({ mode: 'person', source: 'graphql', cached: true, token: true })

    const fallback = await fetchProfile('gaearon', {
      token: TOKEN,
      fetch: makeFetch(gaearonRouter(() => ({ status: 401, body: { message: 'Bad credentials' } }))).fetch,
      now: GAEARON_NOW,
    })
    expect(fallback.fallback).not.toBeNull()
    const event = personGrowEventData(fallback, false, true)
    expect(event).toEqual({ mode: 'person', source: 'rest', cached: false, token: true })
    expect('login' in event).toBe(false)
  })

  function memoryStore(): ProfileStore & { map: Map<string, CacheEntry<ProfileData>> } {
    const map = new Map<string, CacheEntry<ProfileData>>()
    return {
      map,
      get: async (key) => map.get(key),
      put: async (entry) => void map.set(entry.key, entry),
      all: async () => [...map.values()],
      delete: async (key) => void map.delete(key),
    }
  }

  it('caches a GraphQL profile under graphql and serves it within 24 h with no requests, never without the token', async () => {
    const store = memoryStore()
    const { fetch, calls } = makeFetch(kepanoRouter(undefined, true))
    const first = await loadProfile('kepano', { token: TOKEN, fetch, store, now: KEPANO_NOW })
    expect(first.cachedAt).toBeNull()
    expect(first.profile.source).toBe('graphql')
    expect(calls).toHaveLength(16)
    expect([...store.map.keys()]).toEqual([profileCacheKey('kepano', 'graphql')])

    const second = await loadProfile('KEPANO', { token: TOKEN, fetch, store, now: KEPANO_NOW + 60 * 60 * 1000 })
    expect(calls).toHaveLength(16)
    expect(second.cachedAt).toBe(new Date(KEPANO_NOW).toISOString())
    expect(second.profile).toEqual(first.profile)

    // Without a token the graphql entry is not read: REST fetches (synthesised, empty here).
    const anon = await loadProfile('kepano', { fetch, store, now: KEPANO_NOW + 2 * 60 * 60 * 1000 })
    expect(anon.cachedAt).toBeNull()
    expect(anon.profile.source).toBe('rest')
    expect(calls).toHaveLength(19)
    expect(graphqlCalls(calls.slice(16))).toEqual([])
  })

  it('does not cache a profile REST filled after a fallback: the next token run asks GraphQL again', async () => {
    const store = memoryStore()
    const { fetch, calls } = makeFetch(gaearonRouter(() => ({ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0' } })))
    const first = await loadProfile('gaearon', { token: TOKEN, fetch, store, now: GAEARON_NOW })
    expect(first.profile.source).toBe('rest')
    expect(first.profile.fallback?.limit).toBe('graphql')
    expect(store.map.size).toBe(0)
    await loadProfile('gaearon', { token: TOKEN, fetch, store, now: GAEARON_NOW + 1000 })
    expect(graphqlCalls(calls)).toHaveLength(2)
    expect(store.map.size).toBe(0)
  })
})
