import { describe, expect, it } from 'vitest'
import { gardenInk, leafColour } from '../src/components/gardenPaint'
import { colorAt } from '../src/graph/color'
import { dominantLanguage, languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { buildLifeTimeline, type LifeTimeline } from '../src/profile/timeline'
import { blendHex, contrastRatio } from '../src/theme/colour'
import { THEMES, getTheme } from '../src/theme/themes'
import type { ProfileData, ProfileRepo } from '../src/types'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')

const iso = (day: string) => `${day}T20:00:00Z`

function repo(name: string, language: string | null, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner: `me/${name}`,
    createdAt,
    firstActiveAt: createdAt,
    lastActiveAt: createdAt,
    isOwn: true,
    language,
    languageColor: '#3178c6',
    stars: 0,
    forks: 0,
    isFork: false,
    isArchived: false,
    isPrivate: false,
    activity: [],
    ...over,
  }
}

function timelineOf(repos: ProfileRepo[], source: ProfileData['source'] = 'graphql'): LifeTimeline {
  return buildLifeTimeline(
    {
      login: 'me',
      name: null,
      avatarUrl: '',
      createdAt: iso('2019-01-10'),
      source,
      repos,
      days: [],
      recent: [],
      recentFrom: null,
      milestones: [],
      restrictedContributions: 0,
      truncated: false,
      lostWindows: [],
      fallback: null,
    },
    NOW,
  )
}

/** Sixteen languages, Go by far the busiest. */
const LANGUAGES = ['Go', 'TypeScript', 'Rust', 'Python', 'C', 'C++', 'Java', 'Kotlin', 'Swift', 'Ruby', 'PHP', 'Lua', 'Haskell', 'Elixir', 'Zig', 'OCaml']
const MANY = timelineOf(LANGUAGES.map((language, i) => repo(`r${i}`, language, { activity: [{ date: '2020-01-02', commits: language === 'Go' ? 100 : 1 + i }] })))

describe.each(THEMES.map((theme) => [theme.id, theme] as const))('life ink in %s', (_id, theme) => {
  const ink = lifeInk(theme)

  it('reads every colour off the theme', () => {
    expect(ink).toEqual({
      canvas: theme.canvas,
      text: theme.text,
      muted: theme.muted,
      accent: theme.accent,
      fallback: theme.fallback,
      rootRing: theme.rootRing,
      eraBand: blendHex(theme.text, theme.canvas, 0.05),
      horizon: theme.derived.gardenRoot,
      dry: theme.derived.gardenWilt,
      garden: gardenInk(theme),
      hoverRing: theme.derived.hoverRing,
      inspectedRing: theme.derived.inspectedRing,
      textHalo: theme.derived.textHalo,
      labelPlateFill: theme.derived.labelPlateFill,
      labelPlateRing: theme.derived.labelPlateRing,
      dimAlpha: theme.dimAlpha,
    })
  })

  it('keeps the garden readable on its canvas', () => {
    for (const colour of [ink.dry, ink.horizon, ink.rootRing, ink.fallback, ink.accent]) {
      expect(contrastRatio(colour, ink.canvas), colour).toBeGreaterThanOrEqual(3)
    }
    expect(contrastRatio(ink.muted, ink.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink.text, ink.textHalo)).toBeGreaterThanOrEqual(7)
    // the year bands are decorative, but never louder than a whisper
    expect(contrastRatio(ink.eraBand, ink.canvas)).toBeLessThan(1.3)
  })

  it('colours sixteen languages, and their leaves, readably on the canvas', () => {
    const palette = languagePalette(MANY, theme)
    expect(Object.keys(palette).sort()).toEqual([...LANGUAGES].sort())
    expect(palette.Go).toBe(theme.accent)
    for (const language of LANGUAGES) {
      const colour = palette[language]
      expect(contrastRatio(colour, theme.canvas), `${language} ${colour}`).toBeGreaterThanOrEqual(3)
      const leaf = leafColour(colour, ink.garden)
      expect(contrastRatio(leaf, theme.canvas), `${language} leaf ${leaf}`).toBeGreaterThanOrEqual(3)
    }
    expect(new Set(Object.values(palette)).size).toBe(LANGUAGES.length)
  })
})

describe('life ink: languages', () => {
  it('names the language heaviest across its eras, and breaks a tie by name', () => {
    expect(dominantLanguage(MANY)).toBe('Go')
    const tie = timelineOf([
      repo('a', 'Rust', { activity: [{ date: '2020-01-02', commits: 5 }] }),
      repo('b', 'C', { activity: [{ date: '2021-01-02', commits: 5 }] }),
    ])
    expect(dominantLanguage(tie)).toBe('C')
  })

  it('falls back to the language of the most repos without eras, and to null without languages', () => {
    // a token profile GitHub counted no commits to: no language eras
    const seedlings = timelineOf([repo('a', 'Rust'), repo('b', 'Go'), repo('c', 'Go'), repo('d', null)])
    expect(seedlings.languageEras).toEqual([])
    expect(dominantLanguage(seedlings)).toBe('Go')
    const bare = timelineOf([repo('a', null)])
    expect(dominantLanguage(bare)).toBeNull()
    expect(dominantLanguage(timelineOf([]))).toBeNull()
  })

  it('gives an empty palette, and the fallback colour, to a life without languages', () => {
    const theme = getTheme('paper')
    for (const timeline of [timelineOf([]), timelineOf([repo('a', null)], 'rest')]) {
      const palette = languagePalette(timeline, theme)
      expect(palette).toEqual({})
      expect(languageColour(palette, null, theme)).toBe(theme.fallback)
      expect(languageColour(palette, 'Go', theme)).toBe(theme.fallback)
    }
  })

  it('keeps every language in its slot whatever order the repos come in', () => {
    const theme = getTheme('sage')
    const reversed = timelineOf(
      [...LANGUAGES].reverse().map((language, i) => repo(`q${i}`, language, { activity: [{ date: '2020-01-02', commits: language === 'Go' ? 100 : 1 }] })),
    )
    expect(languagePalette(reversed, theme)).toEqual(languagePalette(MANY, theme))
  })

  it('keeps every language in the same palette slot across themes', () => {
    const slots = (themeId: string) => {
      const theme = getTheme(themeId)
      const palette = languagePalette(MANY, theme)
      const order = [theme.accent, ...Array.from({ length: 15 }, (_, i) => colorAt(i, theme))]
      return Object.fromEntries(LANGUAGES.map((language) => [language, order.indexOf(palette[language])]))
    }
    const obsidian = slots('obsidian')
    expect(Object.values(obsidian).every((slot) => slot >= 0)).toBe(true)
    for (const theme of THEMES) expect(slots(theme.id), theme.id).toEqual(obsidian)
  })

  it('colours a repo without a language in the fallback, and reads only own entries', () => {
    const theme = getTheme('obsidian')
    const palette = languagePalette(MANY, theme)
    expect(languageColour(palette, 'Go', theme)).toBe(theme.accent)
    expect(languageColour(palette, null, theme)).toBe(theme.fallback)
    expect(languageColour(palette, 'constructor', theme)).toBe(theme.fallback)
    expect(languageColour(palette, '__proto__', theme)).toBe(theme.fallback)
    const odd = languagePalette(timelineOf([repo('a', '__proto__', { activity: [{ date: '2020-01-02', commits: 1 }] }), repo('b', 'Go')]), theme)
    expect(languageColour(odd, '__proto__', theme)).toBe(theme.accent)
  })
})
