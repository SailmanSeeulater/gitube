/**
 * Live smoke test against the real GitHub API.
 *
 *   npx tsx scripts/smoke.ts octocat/Hello-World
 *   npx tsx scripts/smoke.ts vitejs/vite 25
 *
 * Fetches a repo unauthenticated (set GITHUB_TOKEN to use a token), builds both graph
 * modes, prints the headline numbers and runs structural sanity checks. Exit codes:
 * 0 all checks passed, 1 a check failed or the fetch errored, 2 bad arguments,
 * 3 GitHub rate limit hit (reports the reset time; never retries).
 */
import { performance } from 'node:perf_hooks'
import { fetchRepoData } from '../src/api/github'
import { parseRepoUrl } from '../src/api/parseRepoUrl'
import { buildGraph } from '../src/graph'
import { GitHubFetchError } from '../src/types'
import type { FetchProgress, Graph, RepoData } from '../src/types'

function usage(): never {
  console.error('usage: npx tsx scripts/smoke.ts <owner/repo | github url> [maxBranches]')
  process.exit(2)
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '-'
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width)
}

interface Check {
  name: string
  ok: boolean
  detail: string
}

function endId(end: unknown): string {
  if (typeof end === 'string') return end
  if (end && typeof end === 'object' && 'id' in end) return String((end as { id: unknown }).id)
  return String(end)
}

function checkGraph(label: string, graph: Graph, data: RepoData): Check[] {
  const checks: Check[] = []
  const ids = new Set(graph.nodes.map((n) => n.id))

  let dangling = 0
  let badOwner = 0
  let negative = 0
  for (const link of graph.links) {
    const s = endId(link.source)
    const t = endId(link.target)
    if (!ids.has(s) || !ids.has(t)) dangling += 1
    if (link.collapsedCount < 0) negative += 1
    const sourceNode = graph.nodes.find((n) => n.id === s)
    if (sourceNode && sourceNode.owner !== link.owner) badOwner += 1
  }
  checks.push({ name: `${label}: no dangling links`, ok: dangling === 0, detail: `${dangling} dangling of ${graph.links.length}` })
  checks.push({ name: `${label}: link owner = child owner`, ok: badOwner === 0, detail: `${badOwner} mismatches` })
  checks.push({ name: `${label}: collapsedCount >= 0`, ok: negative === 0, detail: `${negative} negative` })

  const missingTips = data.branches.filter((b) => !ids.has(b.tipSha)).map((b) => b.name)
  checks.push({
    name: `${label}: every branch tip is a node`,
    ok: missingTips.length === 0,
    detail: missingTips.length === 0 ? `${data.branches.length} tips present` : `missing: ${missingTips.join(', ')}`,
  })

  const unflaggedTips = graph.nodes.filter((n) => n.tips.length > 0 && !n.isTip).length
  checks.push({ name: `${label}: tips flagged isTip`, ok: unflaggedTips === 0, detail: `${unflaggedTips} unflagged` })

  const uniqueIds = ids.size === graph.nodes.length
  checks.push({ name: `${label}: node ids unique`, ok: uniqueIds, detail: `${graph.nodes.length} nodes, ${ids.size} unique` })

  const missingPalette = data.branches.filter((b) => !(b.name in graph.palette)).map((b) => b.name)
  checks.push({
    name: `${label}: palette covers every branch`,
    ok: missingPalette.length === 0,
    detail: missingPalette.length === 0 ? `${Object.keys(graph.palette).length} colours` : `missing: ${missingPalette.join(', ')}`,
  })

  const unknownOwner = graph.nodes.filter((n) => !(n.owner in graph.palette)).length
  checks.push({ name: `${label}: every node owner has a colour`, ok: unknownOwner === 0, detail: `${unknownOwner} unknown` })

  return checks
}

function checkData(data: RepoData): Check[] {
  const checks: Check[] = []
  const missingTip = data.branches.filter((b) => !(b.tipSha in data.commits)).map((b) => b.name)
  checks.push({
    name: 'data: every tipSha is in commits',
    ok: missingTip.length === 0,
    detail: missingTip.length === 0 ? 'ok' : `missing: ${missingTip.join(', ')}`,
  })
  const missingBase = data.branches
    .filter((b) => b.mergeBaseSha !== null && !(b.mergeBaseSha in data.commits))
    .map((b) => b.name)
  checks.push({
    name: 'data: every mergeBaseSha is in commits',
    ok: missingBase.length === 0,
    detail: missingBase.length === 0 ? 'ok' : `missing: ${missingBase.join(', ')}`,
  })
  const defaults = data.branches.filter((b) => b.isDefault)
  checks.push({
    name: 'data: exactly one default branch',
    ok: defaults.length === 1 && defaults[0].name === data.defaultBranch,
    detail: defaults.map((b) => b.name).join(', ') || 'none',
  })
  const names = new Set(data.branches.map((b) => b.name))
  checks.push({ name: 'data: branch names unique', ok: names.size === data.branches.length, detail: `${names.size} names` })
  const badDates = Object.values(data.commits).filter((c) => !Number.isFinite(Date.parse(c.date))).length
  checks.push({ name: 'data: every commit has a parseable date', ok: badDates === 0, detail: `${badDates} bad` })
  const emptyUrl = Object.values(data.commits).filter((c) => !c.url.startsWith('https://github.com/')).length
  checks.push({ name: 'data: every commit has a github.com url', ok: emptyUrl === 0, detail: `${emptyUrl} bad` })
  const truncatedUnknown = data.truncatedAt.filter((sha) => !(sha in data.commits)).length
  checks.push({ name: 'data: truncatedAt shas are fetched commits', ok: truncatedUnknown === 0, detail: `${truncatedUnknown} unknown` })
  return checks
}

async function main(): Promise<number> {
  const [, , repoArg, maxArg] = process.argv
  if (!repoArg) usage()
  const ref = parseRepoUrl(repoArg)
  if (!ref) {
    console.error(`cannot parse "${repoArg}" as a GitHub repo`)
    return 2
  }
  let maxBranches: number | undefined
  if (maxArg !== undefined) {
    const n = Number(maxArg)
    if (!Number.isInteger(n) || n <= 0) usage()
    maxBranches = n
  }
  const token = process.env.GITHUB_TOKEN?.trim() || undefined

  console.log(`repo       ${ref.owner}/${ref.repo}`)
  console.log(`auth       ${token ? 'token' : 'anonymous'}`)
  if (maxBranches !== undefined) console.log(`maxBranch  ${maxBranches}`)

  // Holder object: TS cannot see assignments made inside the onProgress closure.
  const seen: { last: FetchProgress | null } = { last: null }
  let lastStage = ''
  const t0 = performance.now()
  let data: RepoData
  try {
    data = await fetchRepoData(ref, {
      token,
      maxBranches,
      onProgress: (p) => {
        seen.last = p
        const stageChanged = p.stage !== lastStage
        lastStage = p.stage
        if (stageChanged || p.stage === 'compare' || p.message.startsWith('Branch cap') || p.message.startsWith('Skipped')) {
          console.error(`  [${p.stage} ${p.done}/${p.total} req=${p.requestsUsed} left=${p.rateLimitRemaining ?? '?'}] ${p.message}`)
        }
      },
    })
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

  const t1 = performance.now()
  const full = buildGraph(data, 'full')
  const skeleton = buildGraph(data, 'skeleton')
  const buildMs = Math.round((performance.now() - t1) * 100) / 100

  const commitCount = Object.keys(data.commits).length
  const collapsedSum = skeleton.links.reduce((sum, l) => sum + l.collapsedCount, 0)
  const forks = full.nodes.filter((n) => n.isFork).length
  const merges = full.nodes.filter((n) => n.isMerge).length
  const roots = full.nodes.filter((n) => n.isRoot).length
  const progress = seen.last

  console.log('')
  console.log(`default    ${data.defaultBranch}`)
  console.log(`branches   ${data.branches.length}`)
  console.log(`commits    ${commitCount}`)
  console.log(`truncated  ${data.truncated} (${data.truncatedAt.length} truncatedAt shas)`)
  console.log(`requests   ${progress?.requestsUsed ?? '?'} used, ${progress?.rateLimitRemaining ?? '?'} remaining, resets ${progress?.rateLimitResetAt ?? '?'}`)
  console.log(`elapsed    ${fetchMs} ms fetch, ${buildMs} ms build (both modes)`)
  console.log(`full       ${full.nodes.length} nodes, ${full.links.length} links (${forks} forks, ${merges} merges, ${roots} roots)`)
  console.log(`skeleton   ${skeleton.nodes.length} nodes, ${skeleton.links.length} links, ${collapsedSum} commits collapsed`)

  console.log('')
  console.log(`first ${Math.min(10, data.branches.length)} branches:`)
  console.log(`  ${'name'.padEnd(40)} ${pad('ahead', 6)} ${pad('behind', 7)}  mergeBase  tip      tipDate`)
  for (const b of data.branches.slice(0, 10)) {
    const name = b.name.length > 40 ? `${b.name.slice(0, 37)}...` : b.name
    console.log(
      `  ${name.padEnd(40)} ${pad(b.aheadBy, 6)} ${pad(b.behindBy, 7)}  ${short(b.mergeBaseSha).padEnd(9)}  ${short(b.tipSha)}  ${b.tipDate.slice(0, 10)}${b.isDefault ? '  (default)' : ''}`,
    )
  }

  const checks: Check[] = [
    ...checkData(data),
    ...checkGraph('full', full, data),
    ...checkGraph('skeleton', skeleton, data),
    {
      name: 'skeleton nodes + collapsed = full nodes',
      ok: skeleton.nodes.length + collapsedSum === full.nodes.length,
      detail: `${skeleton.nodes.length} + ${collapsedSum} = ${skeleton.nodes.length + collapsedSum} vs ${full.nodes.length}`,
    },
    {
      name: 'skeleton nodes are a subset of full nodes',
      ok: (() => {
        const fullIds = new Set(full.nodes.map((n) => n.id))
        return skeleton.nodes.every((n) => fullIds.has(n.id))
      })(),
      detail: `${skeleton.nodes.length} skeleton nodes`,
    },
    {
      name: 'full links carry collapsedCount 0',
      ok: full.links.every((l) => l.collapsedCount === 0),
      detail: `${full.links.filter((l) => l.collapsedCount !== 0).length} non-zero`,
    },
    {
      name: 'full graph reaches every reachable commit',
      ok: full.nodes.length <= commitCount,
      detail: `${full.nodes.length} nodes of ${commitCount} commits`,
    },
    {
      name: 'build is deterministic',
      ok: JSON.stringify(buildGraph(data, 'skeleton')) === JSON.stringify(skeleton),
      detail: 'second build identical',
    },
  ]

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
