/**
 * Guards the split: the optional parts stay out of the first download. Walks the static (value)
 * imports from src/main.tsx the way the bundler does and checks that no lazily loaded module is
 * reachable. One static import of, say, ThemePicker from an eager module would quietly pull it
 * (and everything only it uses) back into the entry chunk; this catches that before a build does.
 */
import { describe, expect, it } from 'vitest'
import { compile } from 'tailwindcss'
import appCss from '../index.css?raw'

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
  'profile/timeline.ts',
  'profile/lifeTypes.ts',
  'profile/privacy.ts',
  'profile/usePersonStore.ts',
  'profile/useProfileData.ts',
  'profile/usePersonAnalytics.ts',
  'profile/dayIndex.ts',
  // the life garden: its model, its canvas and its labels
  'profile/lifeGardenLayout.ts',
  'profile/lifeGeometry.ts',
  'profile/lifeCamera.ts',
  'profile/lifeGardenHit.ts',
  'profile/lifeInk.ts',
  'profile/lifeGardenPaint.ts',
  'profile/useLifeCanvas.ts',
  'profile/useLifeLabels.ts',
  'profile/lifePaint.ts',
  'profile/personRequests.ts',
  'profile/LifeGarden.tsx',
  // the panel, inspector, legend, status strip, error copy and icons
  'profile/PersonPanel.tsx',
  'profile/PersonInspector.tsx',
  'profile/PersonLegend.tsx',
  'profile/PersonStatus.tsx',
  'profile/personErrors.ts',
  'profile/personIcons.tsx',
  // the time-lapse: its clock, caption and controls (the recorder is export/video, through videoChunk)
  'profile/lifeTimelapse.ts',
  'profile/PersonTimelapse.tsx',
  // the poster (the encoder and the download are export/exporters, through exportersChunk)
  'profile/lifePoster.ts',
  // the views: their shared contract, axis, registry and canvas host, life lines and the constellation
  'profile/lifeView.ts',
  'profile/lifeAxis.ts',
  'profile/lifeViews.ts',
  'profile/LifeViewCanvas.tsx',
  'profile/lifeLinesLayout.ts',
  'profile/lifeLinesGeometry.ts',
  'profile/lifeLinesPaint.ts',
  'profile/lifeLinesHit.ts',
  'profile/constellationLayout.ts',
  'profile/constellationGeometry.ts',
  'profile/constellationPaint.ts',
  'profile/constellationHit.ts',
  // the console views (a terminal's look whatever the theme): phosphor, htop, the git log, the minimap and the helix
  'profile/phosphorLayout.ts',
  'profile/phosphorGeometry.ts',
  'profile/phosphorPaint.ts',
  'profile/phosphorHit.ts',
  'profile/phosphorView.ts',
  'profile/htopLayout.ts',
  'profile/htopGeometry.ts',
  'profile/htopPaint.ts',
  'profile/htopHit.ts',
  'profile/htopView.ts',
  'profile/gitLogLayout.ts',
  'profile/gitLogGeometry.ts',
  'profile/gitLogPaint.ts',
  'profile/gitLogHit.ts',
  'profile/gitLogView.ts',
  'profile/minimapLayout.ts',
  'profile/minimapPaint.ts',
  'profile/minimapHit.ts',
  'profile/minimapView.ts',
  'profile/helixLayout.ts',
  'profile/helixGeometry.ts',
  'profile/helixPaint.ts',
  'profile/helixHit.ts',
  'profile/helixView.ts',
  // ...and their fixed palettes, which only they (and the legend) read: no theme of the first download
  'theme/console/phosphor.ts',
  'theme/console/htop.ts',
  'theme/console/gitlog.ts',
  'theme/console/minimap.ts',
  'theme/console/helix.ts',
  // the GraphQL timeout both lazy clients share, and person mode's tier 2 fetcher
  'api/graphql.ts',
  'api/profileGraphql.ts',
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
  return staticReach('main.tsx')
}

/** Every module that entry (any module) reaches through static imports, itself included, with the path that first reached it. */
function staticReach(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>([[entry, [entry]]])
  const queue = [entry]
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
        'export/video.ts',
        'graph/metro.ts',
        'lazy/pullsPart.ts',
      ].sort(),
    )
  })
})

// ---------- person mode and the first download ----------

/** Person mode's own modules: PersonApp and everything under profile/. */
function isPersonModule(file: string): boolean {
  return file === 'PersonApp.tsx' || file.startsWith('profile/')
}

/** A console view's fixed palette (theme/console/): person mode's own, lazy, never a theme of the first download. */
function isConsolePalette(file: string): boolean {
  return file.startsWith('theme/console/')
}

/** The tests, by their path from the repo root: Tailwind reads them too for the one stylesheet. */
const testSources = new Map<string, string>(
  Object.entries(import.meta.glob<string>('../../tests/**/*.ts', { query: '?raw', import: 'default', eager: true })).map(([key, text]) => [
    key.replace(/^\.\.\/\.\.\//, ''),
    text,
  ]),
)

/** Person mode's tests: those that import its modules, or the helpers only they use. */
function isPersonTest(path: string, text: string): boolean {
  const helpers = /helpers\/(?:personScene|profileReplay|recordingCtx)/
  return (path.startsWith('tests/helpers/') && helpers.test(path)) || /from '\.\.\/src\/(?:profile\/|PersonApp)/.test(text) || helpers.test(text)
}

/** Every word Tailwind may take for a class name: the text split where no class name can go, with trailing punctuation off too. */
function words(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split(/[\s'"`{}<>;=]+/)) {
    if (!raw) continue
    out.add(raw)
    const bare = raw.replace(/^[(*!]+/, '').replace(/[.,:;!?)*]+$/, '')
    if (bare) out.add(bare)
  }
  return out
}

/** The string literals in code: quoted ones, and a template's text outside its ${} parts. */
function literals(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)) out.push(m[1] ?? m[2])
  for (const m of code.matchAll(/`([^`]*)`/g)) out.push(m[1].replace(/\$\{[^}]*\}/g, ' '))
  return out
}

/** The class names a module writes: in className strings and expressions, and in the constants those name. */
function classNames(text: string): string[] {
  const strings: string[] = []
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    if (m[1] !== undefined) {
      strings.push(m[1])
      continue
    }
    // the expression, up to its closing brace
    let depth = 1
    let end = m.index + m[0].length
    for (; end < text.length && depth > 0; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}') depth--
    }
    const expression = text.slice(m.index + m[0].length, end - 1)
    strings.push(...literals(expression))
    for (const [id] of expression.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      const constant = new RegExp(`\\bconst ${id}\\s*=\\s*([^\\n]*(?:\\n\\s+['"\`][^\\n]*)*)`).exec(text)
      if (constant) strings.push(...literals(constant[1]))
    }
  }
  return strings.flatMap((s) => s.split(/\s+/)).filter(Boolean)
}

/** Source without its comments, which the bundler drops. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
}

/** The names a module value-imports from every module whose specifier from matches: 'default' for a default import. */
function namedImports(text: string, from: RegExp): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/^import\s+(?!type\s)([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (!from.test(m[2])) continue
    const braces = /\{([^}]*)\}/.exec(m[1])
    for (const part of braces?.[1].split(',') ?? []) {
      const name = part.trim()
      if (name && !name.startsWith('type ')) out.push(name.split(/\s+as\s+/)[0])
    }
    if (m[1].replace(braces?.[0] ?? '', '').replace(/,/g, '').trim()) out.push('default')
  }
  return out
}

/** Tailwind's own stylesheet, read from disk: Vitest serves a .css import other than src/index.css as ''. */
async function tailwindCss(): Promise<string> {
  const fsModule = 'node:fs/promises'
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFile: (path: URL, encoding: 'utf8') => Promise<string> }
  return fs.readFile(new URL('../../node_modules/tailwindcss/index.css', import.meta.url), 'utf8')
}

/** A Tailwind compiler for the app's stylesheet, as the build runs it. */
async function tailwind() {
  const content = await tailwindCss()
  return compile(appCss, { base: '/', loadStylesheet: async (_id, base) => ({ path: 'tailwindcss/index.css', base, content }) })
}

describe('person mode and the first download', () => {
  const person = [...sources].filter(([file]) => isPersonModule(file))

  it('lists every person module as lazy', () => {
    expect(person.length).toBeGreaterThan(20)
    expect(person.map(([file]) => file).filter((file) => !LAZY_ONLY.includes(file))).toEqual([])
    // the console views' palettes too, which live under theme/ but belong to person mode alone
    const consoles = [...sources.keys()].filter(isConsolePalette)
    expect(consoles.length).toBeGreaterThanOrEqual(4)
    expect(consoles.filter((file) => !LAZY_ONLY.includes(file))).toEqual([])
  })

  it('reaches person modules only from PersonApp, each by its own file, never a directory index', () => {
    const strays: string[] = []
    for (const file of sources.keys()) {
      for (const target of staticImports(file)) if (isPersonModule(target) && !isPersonModule(file)) strays.push(`${file} -> ${target}`)
    }
    for (const [file, text] of person) {
      for (const m of text.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
        const target = resolve(file, m[1])
        if (target === null || target.endsWith('/index.ts')) strays.push(`${file} -> ${m[1]}`)
      }
    }
    expect(strays).toEqual([])
  })

  it('reaches the recorder, the exporters and metro only through their chunks in lazy/parts.ts', () => {
    // a value import of one would put it (and the image code it shares) into person mode's chunk; types are fine
    const chunked = ['export/video.ts', 'export/exporters.ts', 'export/image.ts', 'export/gardenFile.ts', 'graph/metro.ts']
    const direct = person.flatMap(([file]) => staticImports(file).filter((target) => chunked.includes(target)).map((target) => `${file} -> ${target}`))
    expect(direct).toEqual([])
    // nor by way of another module
    const reached = staticReach('PersonApp.tsx')
    expect(chunked.filter((file) => reached.has(file)).map((file) => (reached.get(file) ?? []).join(' -> '))).toEqual([])
  })

  it('writes no class name that the rest of the app does not', () => {
    const known = new Set<string>()
    for (const [file, text] of sources) if (!isPersonModule(file)) for (const word of words(text)) known.add(word)
    const novel = person.flatMap(([file, text]) => classNames(text).filter((name) => !known.has(name)).map((name) => `${file}: ${name}`))
    expect(person.flatMap(([, text]) => classNames(text)).length).toBeGreaterThan(100)
    expect(novel).toEqual([])
  })

  it('adds no rule to the stylesheet of the first download, from its modules or its tests', async () => {
    // the check can see one: a utility no source writes (spelled in two parts, or Tailwind would read it here)
    const probe = await tailwind()
    const before = probe.build([])
    expect(probe.build([['re', 'size'].join('')])).not.toBe(before)

    const known = new Set<string>()
    for (const [file, text] of sources) if (!isPersonModule(file)) for (const word of words(text)) known.add(word)
    const scanned = [
      ...person.map(([file, text]) => [`src/${file}`, text] as const),
      ...[...testSources].filter(([path, text]) => isPersonTest(path, text)),
    ]
    expect(scanned.length).toBeGreaterThan(person.length + 10)
    /** each word only person mode writes, with the first file that writes it */
    const novel = new Map<string, string>()
    for (const [file, text] of scanned) for (const word of words(text)) if (!known.has(word) && !novel.has(word)) novel.set(word, file)

    const compiler = await tailwind()
    const css = compiler.build([...known])
    if (compiler.build([...novel.keys()]) === css) return
    // something adds a rule: find what, one word at a time
    const finder = await tailwind()
    let last = finder.build([...known])
    const added: string[] = []
    for (const [word, file] of novel) {
      const next = finder.build([word])
      if (next !== last) added.push(`${file}: ${word}`)
      last = next
    }
    expect(added).toEqual([])
  }, 60_000)

  it("keeps person mode's words out of the first download", () => {
    const said = [/user not found/, /private repo(?!s)/, /names hidden/, /life garden/, /showing the public profile/, /add a token for commits/, /data leaves out/]
    const found: string[] = []
    for (const file of eagerModules().keys()) {
      const text = withoutComments(sources.get(file) ?? '')
      for (const words of said) if (words.test(text)) found.push(`${file}: ${words.source}`)
    }
    expect(found).toEqual([])
  })

  it('takes no new name from the state libraries, and from the theme only what the first download exports', () => {
    const state = /^(?:@tanstack\/react-query|zustand)(?:\/|$)/
    const byPackage = (text: string) =>
      [...text.matchAll(/^import\s+(?!type\s)[^'";]*?from\s*['"]((?:@tanstack\/react-query|zustand)[^'"]*)['"]/gm)].flatMap((m) =>
        namedImports(m[0], state).map((name) => `${m[1]} ${name}`),
      )
    const used = new Set([...sources].filter(([file]) => !isPersonModule(file)).flatMap(([, text]) => byPackage(text)))
    const taken = person.flatMap(([, text]) => byPackage(text))
    expect(taken.length).toBeGreaterThan(0)
    expect(taken.filter((name) => !used.has(name))).toEqual([])
    expect(taken.filter((name) => name.includes('/') && !name.startsWith('@tanstack/react-query '))).toEqual([])

    // the console palettes (theme/console/) are lazy and person mode's own, so any name of theirs is fine...
    const theme = person.flatMap(([file, text]) => namedImports(text, /(?:^|\/)theme\/(?!console\/)/).map((name) => `${file}: ${name}`))
    expect(theme.filter((entry) => !/: (?:blendHex|getTheme|THEMES|useTheme)$/.test(entry))).toEqual([])
    expect(person.flatMap(([, text]) => namedImports(text, /(?:^|\/)theme\/console\//)).length).toBeGreaterThan(0)
    // ...as long as only person mode reads them, and they take no value from any module, the eager themes included
    const consoles = [...sources.keys()].filter(isConsolePalette)
    const readers = [...sources.keys()].filter((file) => !isPersonModule(file) && staticImports(file).some(isConsolePalette))
    expect(readers).toEqual([])
    expect(consoles.flatMap((file) => staticImports(file).map((target) => `${file} -> ${target}`))).toEqual([])
    // it renames the theme chunk, and gardenUtils passes it on
    expect(person.flatMap(([file, text]) => (namedImports(text, /./).includes('hexToRgba') ? [file] : []))).toEqual([])
  })
})
