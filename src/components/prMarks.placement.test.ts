/**
 * The pull request marks never move a label: RepoGraph hands them to its node paint only, never to the
 * label placer (its node radii, rings, hard nodes and lines) or the hit areas, so the placer sees the
 * same discs with or without them, and marks arriving later cannot re-place anything. Checked on
 * RepoGraph's source, since the canvas does not run under Node: each memo that feeds the placer must
 * neither read prMarks nor list it as a dependency, and paintNode must list it.
 */
import { describe, expect, it } from 'vitest'
import graphSource from './RepoGraph.tsx?raw'
import app from '../RepoApp.tsx?raw'

/** The text of `const name = useMemo(` / `useCallback(` up to its closing `)` at the same depth. */
function declaration(source: string, name: string): string {
  const start = source.search(new RegExp(`const ${name} = use(?:Memo|Callback)[<(]`))
  if (start < 0) throw new Error(`no ${name} in RepoGraph.tsx`)
  let depth = 0
  for (let i = source.indexOf('(', start); i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error(`unbalanced ${name}`)
}

/** The argument object of useLabelPlacer({ ... }). */
function placerArgs(source: string): string {
  const start = source.indexOf('useLabelPlacer({')
  const end = source.indexOf('})', start)
  return source.slice(start, end)
}

describe('pull request marks and label placement', () => {
  it('keep out of everything the label placer reads', () => {
    for (const name of ['labelRadius', 'labelRing', 'labelHard', 'labelLines', 'thornOf', 'labelHidden', 'paintPointerArea']) {
      expect(declaration(graphSource, name), name).not.toMatch(/prMark/)
    }
    // (its own `marks` are the metro run counts drawn this frame, not these)
    expect(placerArgs(graphSource)).not.toMatch(/prMark|\bmark\b/)
  })

  it('reach the node paint, which redraws when they change', () => {
    const paint = declaration(graphSource, 'paintNode')
    expect(paint).toMatch(/prMarks\.get\(id\)/)
    const deps = paint.slice(paint.lastIndexOf('['))
    expect(deps).toMatch(/\bprMarks\b/)
    // paint and its dependency list are the only places RepoGraph uses them, beside the prop itself
    const uses = graphSource.split('\n').filter((line) => /\bprMarks\b/.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line))
    expect(uses.map((line) => line.trim())).toEqual([
      'prMarks?: ReadonlyMap<string, PrMark> | null',
      'prMarks = null,',
      'const mark = node.isTip && prMarks ? prMarks.get(id) : undefined',
      expect.stringMatching(/^\[index, colours, .*\bprMarks\],$/),
    ])
  })

  it('are drawn neither during the time-lapse nor in a battle', () => {
    expect(app).toContain('prMarks={timelapseOpen ? null : marks}')
    const battle = app.slice(app.indexOf('<VsView'), app.indexOf('/>', app.indexOf('<VsView')))
    expect(battle).not.toMatch(/prMarks|pulls/i)
  })
})
