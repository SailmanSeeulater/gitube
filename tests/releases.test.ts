import { describe, expect, it } from 'vitest'
import { buildGraph } from '../src/graph'
import { coralLayout } from '../src/graph/coral'
import { metroLayout } from '../src/graph/metro'
import { parseRepoFile, serializeRepoFile } from '../src/export/repoFile'
import { RELEASE_MAX_CHARS, releaseText } from '../src/components/releases'
import { isTagName } from '../src/api/tagName'
import type { RepoData } from '../src/types'
import { makeRepo } from './fixtures/repos'

/** A straight trunk of five commits with a feature branch, and two releases mid-trunk. */
function taggedRepo(): RepoData {
  const data = makeRepo({
    commits: [['aaa1'], ['aaa2', 'aaa1'], ['aaa3', 'aaa2'], ['aaa4', 'aaa3'], ['aaa5', 'aaa4'], ['bbb1', 'aaa2']],
    branches: [
      { name: 'main', tip: 'aaa5', isDefault: true },
      { name: 'feature', tip: 'bbb1' },
    ],
  })
  data.tags = [
    { name: 'v2.0', sha: 'aaa4' },
    { name: 'v2.0-rc1', sha: 'aaa4' },
    { name: 'v1.0', sha: 'aaa3' },
  ]
  return data
}

describe('releases', () => {
  it('puts every tag on its commit, newest listed first', () => {
    const graph = buildGraph(taggedRepo(), 'full')
    const tags = Object.fromEntries(graph.nodes.filter((n) => n.tags).map((n) => [n.id, n.tags]))
    expect(tags).toEqual({ aaa4: ['v2.0', 'v2.0-rc1'], aaa3: ['v1.0'] })
  })

  it('keeps a tagged commit as a station in skeleton view instead of folding it into a run', () => {
    const plain = buildGraph({ ...taggedRepo(), tags: undefined }, 'skeleton')
    const tagged = buildGraph(taggedRepo(), 'skeleton')
    expect(plain.nodes.map((n) => n.id)).not.toContain('aaa3')
    expect(tagged.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['aaa3', 'aaa4']))
    // the run between them is split, and no commit is lost from the counts
    const hidden = (g: typeof plain) => g.links.reduce((sum, l) => sum + l.collapsedCount, 0)
    expect(hidden(plain) - hidden(tagged)).toBe(2)
  })

  it('ignores a tag on a commit the data does not hold', () => {
    const data = taggedRepo()
    data.tags = [{ name: 'ghost', sha: 'fff9' }]
    expect(buildGraph(data, 'full').nodes.some((n) => n.tags)).toBe(false)
  })

  it('draws a release as a station on the metro map and the coral', () => {
    const data = taggedRepo()
    const graph = buildGraph(data, 'skeleton')
    for (const layout of [metroLayout(graph, data), coralLayout(graph, data, { now: Date.parse('2026-11-01') })]) {
      expect(layout.positions.has('aaa3')).toBe(true)
      expect(layout.stations.get('aaa3')).toBe('stop')
    }
  })

  it('names a release by its first tag, cut short, with a count of the others', () => {
    expect(releaseText(['v1.0'])).toBe('v1.0')
    expect(releaseText(['v2.0', 'v2.0-rc1'])).toBe('v2.0 +1')
    const long = releaseText(['release-candidate-2026-11-21'])
    expect(long).toHaveLength(RELEASE_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })

  it('accepts only tag names the map can show', () => {
    expect(isTagName('v1.2.3')).toBe(true)
    expect(isTagName('release/2026 spring')).toBe(true)
    expect(isTagName('')).toBe(false)
    expect(isTagName('a'.repeat(101))).toBe(false)
    expect(isTagName('bad\nname')).toBe(false)
    expect(isTagName(42)).toBe(false)
  })

  it('saves tags in a file and drops the ones that name no commit in it', () => {
    const data = makeRepo({
      commits: [['aaa1'], ['aaa2', 'aaa1']],
      branches: [{ name: 'main', tip: 'aaa2', isDefault: true }],
    })
    data.tags = [{ name: 'v1.0', sha: 'aaa1' }]
    expect(parseRepoFile(serializeRepoFile(data)).data.tags).toEqual([{ name: 'v1.0', sha: 'aaa1' }])

    const file = JSON.parse(serializeRepoFile(data))
    file.data.tags = [{ name: 'v1.0', sha: 'aaa1' }, { name: 'ghost', sha: 'fff9' }, { name: 'x\u0007', sha: 'aaa2' }, 'junk']
    expect(parseRepoFile(JSON.stringify(file)).data.tags).toEqual([{ name: 'v1.0', sha: 'aaa1' }])
    // a file saved before tags were kept opens without any
    delete file.data.tags
    expect(parseRepoFile(JSON.stringify(file)).data.tags).toBeUndefined()
  })
})
