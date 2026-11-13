import { describe, expect, it } from 'vitest'
import { parseRateLimit, fetchRateLimit } from '../src/api/rateLimit'
import { parseRepoFile, serializeRepoFile } from '../src/export/repoFile'
import { SAMPLES, findSample, sampleFile } from '../src/samples/samples'

/** public/samples/*.json as text, keyed '../public/samples/<file>' */
const shipped = import.meta.glob<string>('../public/samples/*.json', { query: '?raw', import: 'default', eager: true })

describe('snapshot samples', () => {
  it('ships a readable gitube file for every sample, under public/', () => {
    expect(Object.keys(shipped)).toHaveLength(SAMPLES.length)
    for (const sample of SAMPLES) {
      const path = `../public/${sampleFile(sample)}`
      expect(shipped[path], path).toBeTypeOf('string')
      const file = parseRepoFile(shipped[path])
      expect(file.data.owner.toLowerCase()).toBe(sample.owner.toLowerCase())
      expect(file.data.repo.toLowerCase()).toBe(sample.repo.toLowerCase())
      expect(file.data.branches.some((b) => b.isDefault)).toBe(true)
      // a sample is a whole map, never one cut to someone's hourly budget
      expect(file.data.budgetCut).toBeUndefined()
    }
  })

  it('serves samples by a relative path, so a subpath deploy still finds them', () => {
    expect(sampleFile({ owner: 'junegunn', repo: 'fzf' })).toBe('samples/junegunn__fzf.json')
    expect(sampleFile(SAMPLES[0]).startsWith('/')).toBe(false)
  })

  it('finds a sample by name, ignoring case, and nothing else', () => {
    expect(findSample('JuneGunn', 'FZF')).toMatchObject({ owner: 'junegunn', repo: 'fzf' })
    expect(findSample('junegunn', 'fzf.vim')).toBeNull()
  })
})

describe('a saved file', () => {
  it("leaves out a fetch's budget cut", () => {
    const text = serializeRepoFile({
      owner: 'o',
      repo: 'r',
      defaultBranch: 'main',
      branches: [],
      commits: {},
      truncated: false,
      truncatedAt: [],
      budgetCut: { compared: 1, skipped: 5, resetAt: null },
    })
    expect(text).not.toContain('budgetCut')
  })
})

describe('the hourly budget (GET /rate_limit)', () => {
  const body = { resources: { core: { limit: 60, remaining: 58, reset: 1760000000, used: 2 } }, rate: {} }

  it('reads the core budget', () => {
    expect(parseRateLimit(body)).toEqual({ remaining: 58, limit: 60, resetAt: new Date(1760000000 * 1000).toISOString() })
  })

  it('says nothing for an answer not shaped as documented', () => {
    for (const odd of [null, {}, { resources: {} }, { resources: { core: { remaining: 'many' } } }]) {
      expect(parseRateLimit(odd)).toBeNull()
    }
  })

  it('sends the token only when there is one, and gives null on a failed answer', async () => {
    const seen: Headers[] = []
    const ok: typeof globalThis.fetch = async (_input, init) => {
      seen.push(new Headers(init?.headers))
      return new Response(JSON.stringify(body), { status: 200 })
    }
    expect(await fetchRateLimit('', { fetch: ok })).toMatchObject({ remaining: 58 })
    expect(seen[0].has('authorization')).toBe(false)
    await fetchRateLimit('ghp_test', { fetch: ok })
    expect(seen[1].get('authorization')).toBe('Bearer ghp_test')

    const refused: typeof globalThis.fetch = async () => new Response('{}', { status: 401 })
    expect(await fetchRateLimit('bad', { fetch: refused })).toBeNull()
    const offline: typeof globalThis.fetch = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await fetchRateLimit('', { fetch: offline })).toBeNull()
  })
})
