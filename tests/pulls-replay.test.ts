/**
 * The overlay against real repos, replayed from the local replay cache (replay-cache/, recorded with
 * the scratchpad's record-repo.mts; not checked in): what it asks GitHub for and what it marks. Each
 * test skips itself when the recordings are absent.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fetchPullIndex, lookupPull, resetLookupMemory } from '../src/api/pulls'
import { buildGraph } from '../src/graph'
import { headMoved, prMarks } from '../src/graph/pulls'
import type { RepoData } from '../src/types'
import { loadReplay } from './fixtures/replay'

const recordings = import.meta.glob<string>(['../replay-cache/*.json', '!../replay-cache/_*.json'], { query: '?raw', import: 'default' })

interface Recorded {
  status: number
  headers: Record<string, string>
  body: string
}

/** hex SHA-1, as record-repo.mts names the files (Web Crypto: Node has it too) */
async function sha1(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** fetch, answered from the recordings (keyed as record-repo.mts keys them), logging every call. */
function replayFetch() {
  const calls: Array<{ method: string; url: string }> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    calls.push({ method, url })
    const load = recordings[`../replay-cache/${await sha1(method === 'GET' || body === null ? url : `${url}\n${body}`)}.json`]
    if (!load) return new Response('{"message":"Not Found (not recorded)"}', { status: 404, headers: { 'content-type': 'application/json' } })
    const rec = JSON.parse(await load()) as Recorded
    return new Response(rec.status === 204 ? null : rec.body, { status: rec.status, headers: rec.headers })
  }
  return { fetch, calls }
}

const express = loadReplay('expressjs', 'express')
const vite = loadReplay('vitejs', 'vite')
const mordi = loadReplay('SailmanSeeulater', 'Mordi')
/** the repos whose pull request listing was recorded */
const listed = new Set<string>()
for (const slug of ['expressjs/express', 'vitejs/vite', 'SailmanSeeulater/Mordi']) {
  const key = await sha1(`https://api.github.com/repos/${slug}/pulls?state=open&per_page=100&sort=updated&direction=desc&page=1`)
  if (`../replay-cache/${key}.json` in recordings) listed.add(slug)
}
/** the repo's graph and its pull request listing were both recorded */
const hasPulls = (data: RepoData | null) => data !== null && listed.has(`${data.owner}/${data.repo}`)

const ref = (data: RepoData) => ({ owner: data.owner, repo: data.repo })

afterEach(() => resetLookupMemory())

describe.skipIf(!hasPulls(express))('expressjs/express (replayed)', () => {
  const data = express as RepoData

  it('without a token: 2 listing requests, 8 marked tips, master unmarked though forks name their heads master', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch })
    expect(gh.calls.map((c) => c.method + ' ' + new URL(c.url).pathname)).toEqual(Array(2).fill('GET /repos/expressjs/express/pulls'))
    const graph = buildGraph(data, 'skeleton')
    const marks = prMarks(graph, index)
    expect(marks.size).toBe(8)
    const master = data.branches.find((b) => b.isDefault)
    expect(marks.has(master?.tipSha ?? '')).toBe(false)
    expect(index.fromForks).toBe(125)
    for (const mark of marks.values()) expect([mark.review, mark.checks]).toEqual(['unknown', 'unknown'])
  })

  it('a lookup costs 3 requests, then 2 once the repo is known to have no commit statuses', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch })
    const prs = [...index.byBranch.values()].flat()
    const first = prs.find((p) => p.number === 7531) ?? prs[0]
    const found = await lookupPull(ref(data), first, { fetch: gh.fetch })
    expect(found.requests).toBe(3)
    expect(found.checks).toBe('failing')
    const second = prs.find((p) => p !== first) ?? prs[1]
    const again = await lookupPull(ref(data), second, { fetch: gh.fetch })
    expect(again.requests).toBe(2)
    expect(gh.calls).toHaveLength(2 + 3 + 2)
  })

  it('with a token: one GraphQL POST, the same 8 tips, review and checks known', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch, token: 'replay' })
    expect(gh.calls.map((c) => c.method)).toEqual(['POST'])
    const marks = prMarks(buildGraph(data, 'skeleton'), index)
    expect(marks.size).toBe(8)
    for (const mark of marks.values()) {
      expect(mark.review).not.toBe('unknown')
      expect(mark.checks).not.toBe('unknown')
    }
    expect(index.intoBase).toBe(127)
  })
})

describe.skipIf(!hasPulls(vite))('vitejs/vite (replayed)', () => {
  const data = vite as RepoData

  it('with a token: exactly 3 serial GraphQL POSTs, no core requests, 36 branches marked', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch, token: 'replay' })
    expect(gh.calls.map((c) => `${c.method} ${c.url}`)).toEqual(Array(3).fill('POST https://api.github.com/graphql'))
    expect(index.byBranch.size).toBe(36)
    const graph = buildGraph(data, 'skeleton')
    const tips = new Set(data.branches.filter((b) => index.byBranch.has(b.name)).map((b) => b.tipSha))
    expect(prMarks(graph, index).size).toBe(tips.size)
    // a stacked pull request (into another branch than main) and a draft are among them
    const all = [...index.byBranch.values()].flat()
    expect(all.some((p) => p.base !== data.defaultBranch)).toBe(true)
    expect(all.some((p) => p.draft)).toBe(true)
  })

  it('without a token: 3 listing pages, the same 36 branches', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch })
    expect(gh.calls).toHaveLength(3)
    expect(index.byBranch.size).toBe(36)
  })
})

describe.skipIf(!hasPulls(mordi))('SailmanSeeulater/Mordi (replayed)', () => {
  const data = mordi as RepoData

  it('1 request, 2 dependabot pull requests whose heads moved on since the graph was recorded', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch })
    expect(gh.calls).toHaveLength(1)
    expect(prMarks(buildGraph(data, 'skeleton'), index).size).toBe(2)
    const moved = [...index.byBranch.values()].flat().filter((p) => {
      const branch = data.branches.find((b) => b.name === p.head)
      return branch !== undefined && headMoved(branch, p)
    })
    expect(moved.length).toBeGreaterThanOrEqual(1)
  })

  it('with a token: a branch deleted since (a null ref) gets no mark', async () => {
    const gh = replayFetch()
    const index = await fetchPullIndex(ref(data), data, { fetch: gh.fetch, token: 'replay' })
    expect(gh.calls).toHaveLength(1)
    expect(index.byBranch.size).toBe(2)
    expect(index.byBranch.has('dependabot/npm_and_yarn/frontend/minor-and-patch-5296e42069')).toBe(false)
  })
})
