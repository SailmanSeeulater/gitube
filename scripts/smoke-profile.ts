// The fetcher's imports reach the browser profile store (api/cachePolicy.ts), whose IndexedDB
// types come from the DOM library this Node project leaves out. It is never called here.
/// <reference lib="dom" />
/**
 * Live smoke test of person mode's tier 1 fetcher against the real GitHub API.
 *
 *   npx tsx scripts/smoke-profile.ts gaearon
 *   npx tsx scripts/smoke-profile.ts @gaearon --token-env GITHUB_TOKEN
 *
 * Anonymous by default: one profile costs 3 to 9 of the 60 hourly requests. --token-env NAME reads
 * a token from the environment variable NAME (the token itself is never printed). Prints the repo
 * count, the requests spent (from the final 'done' progress) and the span from the first repo's
 * creation to the last activity, then runs a few sanity checks. Nothing is cached: Node has no
 * IndexedDB, so the profile store is null and every run fetches. Exit codes: 0 all checks passed,
 * 1 a check failed or the fetch errored, 2 bad arguments, 3 GitHub rate limit hit (reports the
 * reset time; never retries).
 */
import { performance } from 'node:perf_hooks'
import { loadProfile } from '../src/api/profile'
import { parseLogin } from '../src/api/parseSubject'
import { GitHubFetchError } from '../src/types'
import type { FetchProgress, ProfileData } from '../src/types'

function usage(): never {
  console.error('usage: npx tsx scripts/smoke-profile.ts <login | @login | github.com/login> [--token-env NAME]')
  process.exit(2)
}

interface Check {
  name: string
  ok: boolean
  detail: string
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function checkProfile(profile: ProfileData, requestsUsed: number | null): Check[] {
  const checks: Check[] = []
  checks.push({
    name: 'requests within 3 to 9',
    ok: requestsUsed !== null && requestsUsed >= 3 && requestsUsed <= 9,
    detail: `${requestsUsed ?? '?'} requests`,
  })
  let unordered = 0
  for (let i = 1; i < profile.repos.length; i++) if (profile.repos[i - 1].createdAt > profile.repos[i].createdAt) unordered += 1
  checks.push({ name: 'repos oldest first', ok: unordered === 0, detail: `${unordered} out of order` })
  const backwards = profile.repos.filter((r) => Date.parse(r.lastActiveAt) < Date.parse(r.createdAt)).length
  checks.push({ name: 'every span ends at or after its birth', ok: backwards === 0, detail: `${backwards} backwards` })
  const names = new Set(profile.repos.map((r) => r.nameWithOwner))
  checks.push({ name: 'repo names unique', ok: names.size === profile.repos.length, detail: `${names.size} names` })
  checks.push({
    name: 'at most 500 repos, truncated only at the cap',
    ok: profile.repos.length <= 500 && (!profile.truncated || profile.repos.length === 500),
    detail: `${profile.repos.length} repos, truncated ${profile.truncated}`,
  })
  const from = profile.recentFrom
  const badDays = profile.recent.filter((r) => !DAY_KEY.test(r.date) || from === null || r.date < from).length
  checks.push({
    name: 'recent days are day keys from recentFrom on',
    ok: from !== null && DAY_KEY.test(from) && badDays === 0,
    detail: `recentFrom ${from ?? 'null'}, ${badDays} bad`,
  })
  checks.push({
    name: 'tier 1 shape',
    ok:
      profile.source === 'rest' &&
      profile.days.length === 0 &&
      profile.fallback === null &&
      profile.restrictedContributions === 0 &&
      profile.repos.every((r) => r.isOwn && r.activity.length === 0),
    detail: `source ${profile.source}`,
  })
  return checks
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  let input: string | undefined
  let tokenEnv: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token-env') {
      tokenEnv = args[i + 1]
      if (!tokenEnv) usage()
      i += 1
    } else if (input === undefined) {
      input = args[i]
    } else {
      usage()
    }
  }
  if (!input) usage()
  const login = parseLogin(input)
  if (!login) {
    console.error(`cannot parse "${input}" as a GitHub login`)
    return 2
  }
  let token: string | undefined
  if (tokenEnv !== undefined) {
    token = process.env[tokenEnv]?.trim() || undefined
    if (!token) {
      console.error(`--token-env ${tokenEnv}: that environment variable is empty or unset`)
      return 2
    }
  }

  console.log(`user       ${login}`)
  console.log(`auth       ${token ? `token (from ${tokenEnv})` : 'anonymous'}`)

  // Holder object: TS cannot see assignments made inside the onProgress closure.
  const seen: { last: FetchProgress | null } = { last: null }
  let lastStage = ''
  const t0 = performance.now()
  let profile: ProfileData
  try {
    const loaded = await loadProfile(login, {
      token,
      store: null,
      onProgress: (p) => {
        seen.last = p
        const stageChanged = p.stage !== lastStage
        lastStage = p.stage
        if (stageChanged || p.stage === 'events' || p.message.startsWith('Repo cap')) {
          console.error(`  [${p.stage} ${p.done}/${p.total} req=${p.requestsUsed} left=${p.rateLimitRemaining ?? '?'}] ${p.message}`)
        }
      },
    })
    profile = loaded.profile
  } catch (err) {
    const elapsed = Math.round(performance.now() - t0)
    if (err instanceof GitHubFetchError) {
      if (err.code === 'rate_limited') {
        const reset = err.resetAt ?? seen.last?.rateLimitResetAt ?? null
        console.error(`RATE LIMITED after ${elapsed} ms (${seen.last?.requestsUsed ?? 0} requests this run).`)
        console.error(`  resets at: ${reset ? `${reset} (${new Date(reset).toLocaleString()})` : 'unknown'}`)
        console.error(`  ${err.message}`)
        return 3
      }
      console.error(`FETCH FAILED [${err.code}] after ${elapsed} ms: ${err.message}`)
      return 1
    }
    throw err
  }
  const fetchMs = Math.round(performance.now() - t0)

  const done = seen.last?.stage === 'done' ? seen.last : null
  const forks = profile.repos.filter((r) => r.isFork).length
  const archived = profile.repos.filter((r) => r.isArchived).length
  const pushes = profile.recent.reduce((sum, r) => sum + r.pushes, 0)
  const recentRepos = new Set(profile.recent.map((r) => r.repo)).size

  // The span: the first repo's birth to the latest activity of any repo.
  let first: ProfileData['repos'][number] | null = null
  let last: ProfileData['repos'][number] | null = null
  for (const repo of profile.repos) {
    if (first === null || Date.parse(repo.createdAt) < Date.parse(first.createdAt)) first = repo
    if (last === null || Date.parse(repo.lastActiveAt) > Date.parse(last.lastActiveAt)) last = repo
  }

  console.log('')
  console.log(`login      ${profile.login}${profile.name ? ` (${profile.name})` : ''}`)
  console.log(`joined     ${profile.createdAt.slice(0, 10)}`)
  console.log(`repos      ${profile.repos.length} (${forks} forks, ${archived} archived)${profile.truncated ? ', truncated at the cap' : ''}`)
  console.log(
    `span       ${
      first && last
        ? `${first.createdAt.slice(0, 10)} -> ${last.lastActiveAt.slice(0, 10)} (first created ${first.nameWithOwner}, last active ${last.nameWithOwner})`
        : 'none (no public repos)'
    }`,
  )
  console.log(`recent     ${pushes} pushes to ${recentRepos} repos since ${profile.recentFrom ?? '?'}`)
  console.log(
    `requests   ${done?.requestsUsed ?? '?'} used, ${done?.rateLimitRemaining ?? '?'} remaining, resets ${done?.rateLimitResetAt ?? '?'}`,
  )
  console.log(`elapsed    ${fetchMs} ms`)

  const checks = checkProfile(profile, done?.requestsUsed ?? null)
  console.log('')
  let failed = 0
  for (const check of checks) {
    if (!check.ok) failed += 1
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.name}  (${check.detail})`)
  }
  console.log('')
  console.log(failed === 0 ? `all ${checks.length} checks passed` : `${failed} of ${checks.length} checks FAILED`)
  return failed === 0 ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error('unexpected failure:', err)
    process.exitCode = 1
  },
)
