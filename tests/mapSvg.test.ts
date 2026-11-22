import { describe, expect, it } from 'vitest'
import { assignPalette, buildGraph } from '../src/graph'
import { coralLayout } from '../src/graph/coral'
import { metroLayout } from '../src/graph/metro'
import { ago, escapeXml, mapSvg, posterLines, posterSvg, type MapSvgInput } from '../src/export/mapSvg'
import { DEFAULT_THEME, getTheme } from '../src/theme/themes'
import type { RepoData } from '../src/types'
import { makeRepo } from './fixtures/repos'

const NOW = new Date('2026-11-21T12:00:00Z')

function repo(): RepoData {
  const data = makeRepo({
    commits: [['aaa1'], ['aaa2', 'aaa1'], ['aaa3', 'aaa2'], ['aaa4', 'aaa3'], ['aaa5', 'aaa4'], ['bbb1', 'aaa2'], ['ccc1', 'aaa3']],
    branches: [
      { name: 'main', tip: 'aaa5', isDefault: true },
      { name: 'feat/<b>&"x"', tip: 'bbb1' },
      { name: 'fix/cache', tip: 'ccc1' },
    ],
  })
  data.owner = 'octo'
  data.repo = 'map'
  data.language = 'Go'
  data.tags = [{ name: 'v1.0', sha: 'aaa4' }]
  return data
}

function input(data = repo(), engine: 'metro' | 'coral' = 'metro'): MapSvgInput {
  const graph = buildGraph(data, 'skeleton')
  const layout = engine === 'metro' ? metroLayout(graph, data, { labels: true }) : coralLayout(graph, data, { now: NOW.getTime() })
  const palette = assignPalette(
    data.branches.map((b) => b.name),
    data.defaultBranch,
    DEFAULT_THEME,
  )
  return { layout, nodes: graph.nodes, palette, theme: DEFAULT_THEME, data, now: NOW, layoutName: engine, viewMode: 'skeleton' }
}

/** Every element opened is closed, in order: the markup is well formed. */
function wellFormed(svg: string): boolean {
  const stack: string[] = []
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return false
    } else stack.push(name)
  }
  return stack.length === 0
}

describe('map SVG', () => {
  it('draws every line, station and release of the layout, well formed and escaped', () => {
    const inp = input()
    const { svg, width, height } = mapSvg(inp)
    expect(wellFormed(svg)).toBe(true)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(`width="${width}" height="${height}"`)
    expect(svg.match(/<polyline /g)).toHaveLength(inp.layout.routes.length)
    // the branch name is shown as text, never as markup
    expect(svg).not.toContain('feat/<b>')
    expect(svg).toContain('feat/&lt;b&gt;&amp;&quot;x&quot;')
    // the release: its capsule station and its pill
    expect(svg).toContain('>v1.0</text>')
    expect(svg).toContain(`fill="${DEFAULT_THEME.stationRing}"`)
    expect(svg).toContain('octo/map')
    expect(svg).toContain('gitube.latesailor.dev')
  })

  it('draws in the theme it is given', () => {
    const paper = getTheme('paper')
    const { svg } = mapSvg({ ...input(), theme: paper })
    expect(svg).toContain(`fill="${paper.canvas}"`)
    expect(svg).not.toContain(`fill="${DEFAULT_THEME.canvas}"`)
  })

  it('names the tips itself on a coral, whose layout places no labels', () => {
    const inp = input(repo(), 'coral')
    expect(inp.layout.labels).toHaveLength(0)
    const { svg } = mapSvg(inp)
    expect(wellFormed(svg)).toBe(true)
    expect(svg).toContain('>fix/cache</text>')
  })

  it('makes a poster with a title, the numbers, a key of the lines and the date', () => {
    const { svg, width } = posterSvg(input())
    expect(wellFormed(svg)).toBe(true)
    expect(width).toBeGreaterThanOrEqual(1400)
    expect(svg).toContain('octo/</tspan>map')
    expect(svg).toContain('Go  ·  3 lines  ·  7 commits  ·  1 release  ·  drawn as a metro map')
    expect(svg).toContain('>LINES</text>')
    expect(svg).toContain('21 November 2026')
    expect(svg).not.toContain('more lines')
  })

  it('keys the default line first, then the others by when they last moved', () => {
    const data = repo()
    data.branches[1].tipDate = '2026-11-18T00:00:00Z'
    data.branches[2].tipDate = '2026-11-20T00:00:00Z'
    data.branches[0].tipDate = '2025-01-01T00:00:00Z'
    const lines = posterLines(input(data))
    expect(lines.map((l) => l.name)).toEqual(['main', 'fix/cache', 'feat/<b>&"x"'])
    expect(lines[0].detail).toMatch(/^the main line · moved 2 years ago$/)
    expect(lines[1].detail).toBe('1 ahead · moved 1 day ago')
  })

  it('caps the key and says how many lines it left out', () => {
    const commits: Array<[string, ...string[]]> = [['aaa1']]
    const branches: Array<{ name: string; tip: string; isDefault?: boolean }> = [{ name: 'main', tip: 'aaa1', isDefault: true }]
    for (let i = 0; i < 30; i++) {
      const sha = `b${i.toString(16).padStart(3, '0')}`
      commits.push([sha, 'aaa1'])
      branches.push({ name: `line-${i}`, tip: sha })
    }
    const data = makeRepo({ commits, branches })
    const { svg } = posterSvg(input(data))
    expect(svg).toContain('and 7 more lines')
  })

  it('says how long ago, in words', () => {
    expect(ago('2026-11-21T08:00:00Z', NOW)).toBe('today')
    expect(ago('2026-11-20T08:00:00Z', NOW)).toBe('1 day ago')
    expect(ago('2026-10-01T00:00:00Z', NOW)).toBe('2 months ago')
    expect(ago('2023-11-01T00:00:00Z', NOW)).toBe('3 years ago')
    expect(ago('not a date', NOW)).toBe('')
  })

  it('escapes the five XML characters', () => {
    expect(escapeXml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
  })
})
