/**
 * Guards the split: the optional parts stay out of the first download. Walks the static (value)
 * imports from src/main.tsx the way the bundler does and checks that no lazily loaded module is
 * reachable. One static import of, say, ThemePicker from an eager module would quietly pull it
 * (and everything only it uses) back into the entry chunk; this catches that before a build does.
 */
import { describe, expect, it } from 'vitest'

/** Modules only the lazy chunks may use (paths relative to src/). */
const LAZY_ONLY = [
  'components/ThemePicker.tsx',
  'components/ExportMenu.tsx',
  'components/TimelapseBar.tsx',
  'components/GardenBattle.tsx',
  'components/ContributorsTab.tsx',
  'components/WeedsTab.tsx',
  'graph/metro.ts',
  'graph/score.ts',
  'graph/battle.ts',
  'audio/musicBox.ts',
  'export/video.ts',
  'export/image.ts',
  'export/gardenFile.ts',
  'export/exporters.ts',
  // the pull request overlay's network client and inspector block (its ring and row glyphs are eager)
  'lazy/pullsPart.ts',
  'api/pulls.ts',
  'components/PrBlock.tsx',
  // person mode (?user=)
  'PersonApp.tsx',
  'api/profile.ts',
  'api/profileCache.ts',
  'profile/analytics.ts',
]

/** specifier ('./x', '../y/z') taken from the module at path from ('components/A.tsx'), relative to src/ */
function join(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const step of specifier.split('/')) {
    if (step === '..') parts.pop()
    else if (step !== '.') parts.push(step)
  }
  return parts.join('/')
}

/** Every source module under src/ (not the tests), keyed by its path relative to src/. */
const sources = new Map<string, string>(
  Object.entries(
    import.meta.glob<string>(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
    // keys are relative to this file: '../App.tsx', and './parts.ts' for its neighbours
  ).map(([key, text]) => [join('lazy/parts.test.ts', key), text]),
)

/** './x' from 'components/A.tsx' -> 'components/x.tsx' (or .ts, or x/index.ts), as a key of sources */
function resolve(from: string, specifier: string): string | null {
  const base = join(from, specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) if (sources.has(candidate)) return candidate
  return null
}

/** Relative imports and re-exports that survive compilation (not `import type`, not all-`type` braces). */
function staticImports(file: string): string[] {
  const out: string[] = []
  const text = sources.get(file) ?? ''
  for (const m of text.matchAll(/^(?:import|export)\s+(type\s)?([^'";]*?)\s*from\s*['"](\.[^'"]+)['"]/gm)) {
    if (m[1]) continue
    const braces = /\{([^}]*)\}/.exec(m[2])
    const onlyTypes =
      braces !== null &&
      !m[2].replace(braces[0], '').replace(/,/g, '').trim() &&
      braces[1].split(',').every((name) => name.trim() === '' || name.trim().startsWith('type '))
    if (onlyTypes) continue
    const target = resolve(file, m[3])
    if (target) out.push(target)
  }
  for (const m of text.matchAll(/^import\s+['"](\.[^'"]+)['"]/gm)) {
    const target = resolve(file, m[1])
    if (target) out.push(target)
  }
  return out
}

/** Every module the entry reaches through static imports, with the path that first reached it. */
function eagerModules(): Map<string, string[]> {
  const seen = new Map<string, string[]>([['main.tsx', ['main.tsx']]])
  const queue = ['main.tsx']
  while (queue.length > 0) {
    const file = queue.shift() as string
    for (const next of staticImports(file)) {
      if (seen.has(next)) continue
      seen.set(next, [...(seen.get(file) ?? []), next])
      queue.push(next)
    }
  }
  return seen
}

describe('lazy parts', () => {
  it('reads the source tree', () => {
    expect(sources.has('main.tsx')).toBe(true)
    for (const file of LAZY_ONLY) expect(sources.has(file), file).toBe(true)
    // the walk follows the app's real imports
    const eager = eagerModules()
    for (const file of ['App.tsx', 'RepoApp.tsx', 'components/Garden.tsx', 'theme/themes.ts', 'api/github.ts', 'lazy/parts.ts']) {
      expect(eager.has(file), file).toBe(true)
    }
  })

  it('keeps every lazy module out of the first download', () => {
    const eager = eagerModules()
    const leaks = LAZY_ONLY.filter((file) => eager.has(file)).map((file) => (eager.get(file) ?? []).join(' -> '))
    expect(leaks).toEqual([])
  })

  it('loads each lazy entry through a dynamic import in lazy/parts.ts', () => {
    const parts = sources.get('lazy/parts.ts') ?? ''
    const dynamic = [...parts.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((m) => resolve('lazy/parts.ts', m[1]))
    expect(dynamic.sort()).toEqual(
      [
        'PersonApp.tsx',
        'components/ContributorsTab.tsx',
        'components/ExportMenu.tsx',
        'components/GardenBattle.tsx',
        'components/ThemePicker.tsx',
        'components/TimelapseBar.tsx',
        'components/WeedsTab.tsx',
        'export/exporters.ts',
        'graph/metro.ts',
        'lazy/pullsPart.ts',
      ].sort(),
    )
  })
})
