import { describe, expect, it } from 'vitest'
import { assignPalette, colorAt, rotateHue } from '../graph'
import { applyTheme } from './applyTheme'
import { defaultThemeCss, themeBootScript } from './boot'
import { blendHex, contrastRatio, deltaE2000, deltaE2000Lab, hexToLab, hexToOklch, hexToRgba, luminance, parseHex } from './colour'
import { readStoredThemeId, writeStoredThemeId } from './storage'
import {
  DEFAULT_THEME,
  DEFAULT_THEME_ID,
  LABEL_PLATE_FILL_ALPHA,
  LABEL_PLATE_RING_ALPHA,
  METRO_MIN_LINE_CONTRAST,
  METRO_MIN_MUTED_CONTRAST,
  METRO_MIN_STUB_CONTRAST,
  THEMES,
  THEME_IDS,
  THEME_STORAGE_KEY,
  buildTheme,
  getTheme,
  isThemeId,
  linkColour,
  linkColourDim,
  themeCssVariables,
  type Theme,
  type ThemeTokens,
} from './themes'
import indexCss from '../index.css?raw'

const HEX = /^#[0-9a-f]{6}$/

/** Every token a theme must define, and what kind of value it holds. */
const COLOUR_TOKENS = [
  'canvas',
  'panel',
  'panelBorder',
  'hover',
  'field',
  'text',
  'textDim',
  'muted',
  'accent',
  'accentText',
  'rootFill',
  'rootRing',
  'fallback',
  'badgeBg',
  'badgeText',
  'halo',
  'stationRing',
  'warn',
  'danger',
  'success',
] as const satisfies ReadonlyArray<keyof ThemeTokens>
const ALPHA_TOKENS = [
  'haloFillAlpha',
  'haloRingAlpha',
  'hoverRingAlpha',
  'linkAlpha',
  'linkDimAlpha',
  'dimAlpha',
  'metroLineAlpha',
  'metroMutedAlpha',
  'metroStubAlpha',
  'metroDimAlpha',
] as const satisfies ReadonlyArray<keyof ThemeTokens>
const TEXT_TOKENS = ['id', 'name', 'blurb', 'shadow'] as const satisfies ReadonlyArray<keyof ThemeTokens>

/** The smallest CIEDE2000 distance between any two of the colours. */
const minPairwiseDeltaE = (colours: readonly string[]): number => {
  const labs = colours.map(hexToLab)
  let min = Infinity
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) min = Math.min(min, deltaE2000Lab(labs[i], labs[j]))
  return min
}

const byId = (id: string): Theme => {
  const theme = THEMES.find((t) => t.id === id)
  if (!theme) throw new Error(`no theme ${id}`)
  return theme
}

describe('theme set', () => {
  it('has ten themes with unique ids, in THEME_IDS order', () => {
    expect(THEMES).toHaveLength(10)
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(10)
    expect(ids).toEqual([...THEME_IDS])
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(10)
  })

  it('has exactly two dark themes, Obsidian and Midnight; the other eight are light', () => {
    expect(THEMES.filter((t) => t.mode === 'dark').map((t) => t.id)).toEqual(['obsidian', 'midnight'])
    expect(THEMES.filter((t) => t.mode === 'light').map((t) => t.id)).toEqual([
      'paper',
      'slate',
      'sage',
      'sand',
      'rose',
      'sky',
      'contrast',
      'solar',
    ])
  })

  it('defaults to Obsidian, for unknown and missing ids too', () => {
    expect(DEFAULT_THEME_ID).toBe('obsidian')
    expect(DEFAULT_THEME).toBe(byId('obsidian'))
    for (const id of [undefined, null, '', 'neon', '__proto__', 'constructor', 'OBSIDIAN']) {
      expect(getTheme(id)).toBe(DEFAULT_THEME)
    }
    for (const theme of THEMES) expect(getTheme(theme.id)).toBe(theme)
  })

  it('recognises theme ids only', () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true)
    for (const value of ['neon', '', null, undefined, 3, {}, '__proto__', 'toString']) expect(isThemeId(value)).toBe(false)
  })
})

describe.each(THEMES.map((theme) => [theme.id, theme] as const))('theme %s', (_id, theme) => {
  it('defines every token', () => {
    for (const key of COLOUR_TOKENS) expect(theme[key], key).toMatch(HEX)
    for (const key of ALPHA_TOKENS) {
      expect(theme[key], key).toBeGreaterThan(0)
      expect(theme[key], key).toBeLessThanOrEqual(1)
    }
    for (const key of TEXT_TOKENS) expect(theme[key].length, key).toBeGreaterThan(0)
    expect(theme.mode === 'dark' || theme.mode === 'light').toBe(true)
    expect(theme.cycle === 'hsl' || theme.cycle === 'oklch').toBe(true)
  })

  it('has 12 distinct branch colours and 12 names', () => {
    expect(theme.branchColors).toHaveLength(12)
    expect(theme.branchNames).toHaveLength(12)
    for (const colour of theme.branchColors) expect(colour).toMatch(HEX)
    expect(new Set(theme.branchColors).size).toBe(12)
    expect(theme.branchColors).not.toContain(theme.accent)
  })

  it('computes the derived rules from its tokens', () => {
    const d = theme.derived
    expect(d.defaultBranchColour).toBe(theme.accent)
    expect(d.inspectedRing).toBe(theme.accent)
    expect(d.forkNodeFill).toBe(theme.canvas)
    expect(d.inputBg).toBe(theme.field)
    expect(d.colorScheme).toBe(theme.mode)
    expect(d.hoverRing).toBe(hexToRgba(theme.text, theme.hoverRingAlpha))
    expect(d.searchHaloFill).toBe(hexToRgba(theme.halo, theme.haloFillAlpha))
    expect(d.searchHaloRing).toBe(hexToRgba(theme.halo, theme.haloRingAlpha))
    expect(d.fallbackLink).toBe(hexToRgba(theme.fallback, theme.linkAlpha))
    expect(d.fallbackLinkDim).toBe(hexToRgba(theme.fallback, theme.linkDimAlpha))
    expect(d.labelPlateFill).toBe(hexToRgba(theme.canvas, LABEL_PLATE_FILL_ALPHA))
    expect(d.labelPlateRing).toBe(hexToRgba(theme.text, LABEL_PLATE_RING_ALPHA))
    expect(d.textHalo).toBe(theme.canvas)
    expect(d.stationCore).toBe(theme.canvas)
    expect(d.runMark).toBe(theme.badgeText)
    expect(d.selectedRow).toBe(blendHex(theme.accent, theme.panel, 0.1))
    expect(d.accentChip).toBe(blendHex(theme.accent, theme.panel, 0.15))
    expect(d.accentChipHover).toBe(blendHex(theme.accent, theme.panel, 0.25))
    expect(d.warnChipBg).toBe(hexToRgba(theme.warn, 0.1))
    expect(d.warnChipBorder).toBe(hexToRgba(theme.warn, 0.4))
    expect(linkColour(theme, theme.branchColors[0])).toBe(hexToRgba(theme.branchColors[0], theme.linkAlpha))
    expect(linkColourDim(theme, theme.branchColors[0])).toBe(hexToRgba(theme.branchColors[0], theme.linkDimAlpha))
  })

  // A guard against a token typo, mirroring the design checker's hard checks (check.mts).
  it('keeps text, labels and branches readable on its own canvas and panels', () => {
    expect(luminance(theme.canvas) < 0.18).toBe(theme.mode === 'dark')
    expect(contrastRatio(theme.text, theme.canvas)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(theme.text, theme.panel)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(theme.text, theme.hover)).toBeGreaterThanOrEqual(7)
    expect(contrastRatio(theme.muted, theme.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.muted, theme.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.textDim, theme.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.accent, theme.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.accent, theme.canvas)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(theme.badgeText, theme.badgeBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.warn, theme.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.danger, theme.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.rootRing, theme.canvas)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(theme.fallback, theme.canvas)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(blendHex(theme.text, theme.canvas, theme.hoverRingAlpha), theme.canvas)).toBeGreaterThanOrEqual(3)
    for (const colour of theme.branchColors) expect(contrastRatio(colour, theme.canvas), colour).toBeGreaterThanOrEqual(3)
  })
})

// The metro view paints its own stations, routes and run markers (RepoGraph's paintNode/paintMetro, the
// label halo, the metro legend); these keep them readable on every canvas.
describe.each(THEMES.map((theme) => [theme.id, theme] as const))('metro view in %s', (_id, theme) => {
  const d = theme.derived
  /**
   * every colour a route is drawn in: the branch colours (on the 'oklch' themes the first 96,
   * cycled ones included), the default branch's and the fallback. Obsidian's legacy HSL cycling
   * fails these floors past the twelfth colour (worst #2422ee, 1.83:1 at full strength), so only
   * its base palette is held to them.
   */
  const routeColours =
    theme.cycle === 'oklch'
      ? [...Array.from({ length: 96 }, (_, i) => colorAt(i, theme)), d.defaultBranchColour, theme.fallback]
      : [...theme.branchColors, d.defaultBranchColour, theme.fallback]
  /** contrast on the canvas of a colour drawn at this alpha over it */
  const onCanvas = (colour: string, alpha: number) => contrastRatio(blendHex(colour, theme.canvas, alpha), theme.canvas)

  it('rings stations in a colour that stands off the canvas, the station core and the panel', () => {
    expect(contrastRatio(theme.stationRing, theme.canvas)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(theme.stationRing, d.stationCore)).toBeGreaterThanOrEqual(3) // an interchange's ring around its centre
    expect(contrastRatio(theme.stationRing, theme.panel)).toBeGreaterThanOrEqual(3) // the legend's station glyphs
    // light on the dark canvases, dark on the light ones
    expect(luminance(theme.stationRing) > luminance(theme.canvas)).toBe(theme.mode === 'dark')
  })

  it('draws run markers and labels as readable text on a canvas-coloured halo', () => {
    expect(contrastRatio(d.runMark, theme.canvas)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(d.runMark, d.textHalo)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.text, d.textHalo)).toBeGreaterThanOrEqual(7)
  })

  it('orders its line alphas: dimmed below muted and lead-ins, those below full routes', () => {
    for (const alpha of [theme.metroMutedAlpha, theme.metroStubAlpha]) {
      expect(alpha).toBeGreaterThan(theme.metroDimAlpha)
      expect(alpha).toBeLessThan(theme.metroLineAlpha)
    }
    expect(theme.metroLineAlpha).toBeLessThanOrEqual(1)
  })

  // A full route at 3:1 on the canvas is also what makes a run marker's break show: the break is a
  // canvas-coloured (textHalo) cut across the route (RepoGraph's paintMetro, strokeRunBars).
  it('keeps full routes at 3:1, muted routes and lead-ins visible, and dimmed routes faint', () => {
    expect([METRO_MIN_LINE_CONTRAST, METRO_MIN_STUB_CONTRAST, METRO_MIN_MUTED_CONTRAST]).toEqual([3, 2, 1.8])
    for (const colour of routeColours) {
      expect(onCanvas(colour, theme.metroLineAlpha), colour).toBeGreaterThanOrEqual(METRO_MIN_LINE_CONTRAST)
      expect(onCanvas(colour, theme.metroStubAlpha), colour).toBeGreaterThanOrEqual(METRO_MIN_STUB_CONTRAST)
      expect(onCanvas(colour, theme.metroMutedAlpha), colour).toBeGreaterThanOrEqual(METRO_MIN_MUTED_CONTRAST)
      expect(onCanvas(colour, theme.metroDimAlpha), colour).toBeLessThan(1.4)
    }
  })

  it.skipIf(theme.cycle !== 'oklch')('draws no live route fainter than the muted trunk', () => {
    // a live branch must not read as a merged or deleted one (a muted route, the accent at metroMutedAlpha)
    const mutedTrunk = onCanvas(theme.accent, theme.metroMutedAlpha)
    for (let i = 0; i < 96; i++) {
      const colour = colorAt(i, theme)
      expect(onCanvas(colour, theme.metroLineAlpha), `${i} ${colour}`).toBeGreaterThan(mutedTrunk)
    }
  })
})

// The pull request overlay (components/prMark.ts) splits a ring round a tip into a review half and a
// checks half, each in success (approved / passing), warn (running), danger (changes / failing) or
// muted (waiting / no checks / not looked up). The status words beside the glyphs use them as text.
describe.each(THEMES.map((theme) => [theme.id, theme] as const))('pull request marks in %s', (_id, theme) => {
  it('reads success as text on the panel and the canvas', () => {
    expect(contrastRatio(theme.success, theme.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(theme.success, theme.canvas)).toBeGreaterThanOrEqual(4.5)
  })

  it('draws every arc colour at 3:1 on the canvas', () => {
    for (const key of ['success', 'warn', 'danger', 'muted'] as const) {
      expect(contrastRatio(theme[key], theme.canvas), key).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps success apart from the other states, the accent and muted (CIEDE2000)', () => {
    expect(deltaE2000(theme.success, theme.warn)).toBeGreaterThanOrEqual(25)
    expect(deltaE2000(theme.success, theme.danger)).toBeGreaterThanOrEqual(30)
    expect(deltaE2000(theme.success, theme.accent)).toBeGreaterThanOrEqual(15)
    expect(deltaE2000(theme.success, theme.muted)).toBeGreaterThanOrEqual(15)
  })

  // Under red-green colour vision deficiency success and warn merge (Machado deuteranopia dE 1-14,
  // protanopia 1-9), and success and danger come close too, so the ring never tells checks apart by
  // colour alone: failing is broken in the middle, running lit only from 12 to 3 o'clock (see
  // prMark.test.ts). The one review pair with no shape of its own is approved (success) against no
  // review yet (muted): it must survive the simulation.
  it('keeps approved apart from no review yet under deuteranopia and protanopia (CIEDE2000 >= 10)', () => {
    for (const cvd of ['deuteranopia', 'protanopia'] as const) {
      expect(deltaE2000(simulateCvd(theme.success, cvd), simulateCvd(theme.muted, cvd)), cvd).toBeGreaterThanOrEqual(10)
    }
  })

  // A half not looked up yet is drawn in the outline the tip has without a pull request: the branch
  // colour (organic) or the station colour (metro), at full strength. Both must stand on the canvas.
  it('draws a ring not looked up yet at 3:1 on the canvas: the station colour, the accent and every branch colour', () => {
    expect(contrastRatio(theme.stationRing, theme.canvas), 'stationRing').toBeGreaterThanOrEqual(3)
    expect(contrastRatio(theme.accent, theme.canvas), 'accent').toBeGreaterThanOrEqual(3)
    expect(contrastRatio(theme.derived.defaultBranchColour, theme.canvas), 'default branch').toBeGreaterThanOrEqual(3)
    theme.branchColors.forEach((colour, i) => expect(contrastRatio(colour, theme.canvas), theme.branchNames[i]).toBeGreaterThanOrEqual(3))
  })
})

/**
 * A colour as seen with full deuteranopia or protanopia: Machado, Oliveira and Fernandes (2009),
 * severity 1, applied in linear RGB.
 */
function simulateCvd(hex: string, cvd: 'deuteranopia' | 'protanopia'): string {
  const M =
    cvd === 'deuteranopia'
      ? [
          [0.367322, 0.860646, -0.227968],
          [0.280085, 0.672501, 0.047413],
          [-0.01182, 0.04294, 0.968881],
        ]
      : [
          [0.152286, 1.052583, -0.204868],
          [0.114503, 0.786281, 0.099216],
          [-0.003882, -0.048116, 1.051998],
        ]
  const rgb = parseHex(hex)
  if (!rgb) throw new Error(`not a colour: ${hex}`)
  const lin = rgb.map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const out = M.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]).map((v) => {
    const c = Math.min(1, Math.max(0, v))
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, '0')
  })
  return `#${out.join('')}`
}

describe('branch colours stay distinct (CIEDE2000)', () => {
  // Obsidian keeps the original palette bit for bit, including two close pairs the design records
  // as legacy exceptions; every new theme clears dE 12 on every pair and dE 10 from its accent.
  const legacy = new Set(['obsidian:fuchsia/purple', 'obsidian:emerald/teal'])
  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s', (_id, theme) => {
    const colours = theme.branchColors
    for (let i = 0; i < 12; i++) {
      for (let j = i + 1; j < 12; j++) {
        const pair = `${theme.id}:${theme.branchNames[i]}/${theme.branchNames[j]}`
        if (legacy.has(pair)) continue
        expect(deltaE2000(colours[i], colours[j]), pair).toBeGreaterThanOrEqual(12)
      }
      if (theme.id !== 'obsidian') expect(deltaE2000(colours[i], theme.accent), theme.branchNames[i]).toBeGreaterThanOrEqual(10)
    }
  })
})

describe('Obsidian is the original look', () => {
  const o = byId('obsidian')
  it('matches the colour constants it replaces', () => {
    // src/index.css @theme, before themes
    expect(o.canvas).toBe('#1e1e1e')
    expect(o.panel).toBe('#252525')
    expect(o.panelBorder).toBe('#363636')
    expect(o.text).toBe('#dcddde')
    expect(o.muted).toBe('#999999')
    expect(o.accent).toBe('#a78bfa')
    expect(o.hover).toBe('#2e2e2e')
    expect(o.badgeBg).toBe('#2a2a2a') // --color-ui-raised and RepoGraph's BADGE_BG
    expect(o.textDim).toBe('#b8b8b8')
    expect(o.warn).toBe('#d9b35b')
    expect(o.danger).toBe('#e06c75')
    expect(o.shadow).toBe('0 10px 30px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.4)')
    expect(o.mode).toBe('dark')
    // inputs were bg-ui-bg/70 over the panel
    expect(o.field).toBe(blendHex(o.canvas, o.panel, 0.7))
    expect(o.field).toBe('#202020')
    // graphUtils.ts
    expect(o.rootFill).toBe('#5a5a5a')
    expect(o.rootRing).toBe('#8a8a8a')
    expect(o.fallback).toBe('#8b8b8b')
    expect(o.dimAlpha).toBe(0.2)
    // RepoGraph.tsx
    expect(o.badgeText).toBe('#b8b8b8')
    expect(o.derived.searchHaloFill).toBe('rgba(167, 139, 250, 0.22)')
    expect(o.derived.searchHaloRing).toBe('rgba(167, 139, 250, 0.7)')
    expect(o.derived.hoverRing).toBe('rgba(220, 221, 222, 0.45)')
    expect(o.derived.fallbackLink).toBe('rgba(139, 139, 139, 0.35)')
    expect(o.derived.fallbackLinkDim).toBe('rgba(139, 139, 139, 0.07)')
    expect(linkColour(o, '#f472b6')).toBe('rgba(244, 114, 182, 0.35)')
    expect(linkColourDim(o, '#f472b6')).toBe('rgba(244, 114, 182, 0.07)')
    expect(o.derived.forkNodeFill).toBe('#1e1e1e')
    // useLabelPlacer.ts
    expect(o.derived.labelPlateFill).toBe('rgba(30, 30, 30, 0.92)')
    expect(o.derived.labelPlateRing).toBe('rgba(220, 221, 222, 0.25)')
    // the metro view (RepoGraph.tsx paintNode/paintMetro, useLabelPlacer's halo, Legend), before themes
    expect(o.stationRing).toBe('#e8e8e8') // STATION_WHITE: tip outlines, interchange rings
    expect(o.metroLineAlpha).toBe(0.9) // METRO_ALPHA
    expect(o.metroMutedAlpha).toBe(0.45) // METRO_MUTED_ALPHA, and the tween's straight links
    expect(o.metroStubAlpha).toBe(0.6) // the dashed lead-in before a root
    expect(o.metroDimAlpha).toBe(0.1) // METRO_DIM_ALPHA: dimmed routes, lead-ins and run bars
    expect(o.derived.stationCore).toBe('#1e1e1e') // CANVAS_BG: interchange centres, hollow origins, bead cores
    expect(o.derived.textHalo).toBe('#1e1e1e') // CANVAS_BG: label and '+N' halos
    expect(o.derived.runMark).toBe('#b8b8b8') // BADGE_TEXT: run bars and the '+N'
  })

  it('keeps the original twelve branch colours in order, and the HSL cycling past them', () => {
    expect([...o.branchColors]).toEqual([
      '#f472b6',
      '#fb923c',
      '#fbbf24',
      '#a3e635',
      '#34d399',
      '#22d3ee',
      '#60a5fa',
      '#818cf8',
      '#e879f9',
      '#f87171',
      '#2dd4bf',
      '#c084fc',
    ])
    expect(o.cycle).toBe('hsl')
    for (let i = 12; i < 60; i++) expect(colorAt(i, o)).toBe(rotateHue(o.branchColors[i % 12], Math.floor(i / 12) * 137.508))
    // and assignPalette without a theme is Obsidian's
    const names = Array.from({ length: 30 }, (_, i) => `b${String(i).padStart(2, '0')}`)
    expect(assignPalette([...names, 'main'], 'main')).toEqual(assignPalette([...names, 'main'], 'main', o))
  })

  it('is the only theme on the legacy HSL cycling', () => {
    expect(THEMES.filter((t) => t.cycle === 'hsl').map((t) => t.id)).toEqual(['obsidian'])
  })
})

describe('branch palettes per theme', () => {
  // DEFAULT_MAX_BRANCHES: the most branches a repo shows
  const names = Array.from({ length: 200 }, (_, i) => `feature/${String(i).padStart(3, '0')}`)

  it.each(THEMES.map((theme) => [theme.id, theme] as const))('%s: accent for the default branch, then its own colours', (_id, theme) => {
    const palette = assignPalette([...names, 'main'], 'main', theme)
    expect(palette.main).toBe(theme.accent)
    expect(names.slice(0, 12).map((n) => palette[n])).toEqual([...theme.branchColors])
    const values = names.map((n) => palette[n])
    expect(new Set(values).size).toBe(values.length)
    expect(values).not.toContain(theme.accent)
    for (const value of values) expect(value).toMatch(HEX)
  })

  it.each(THEMES.filter((t) => t.cycle === 'oklch').map((theme) => [theme.id, theme] as const))(
    '%s: colours past the twelfth clear 3:1 on the canvas and keep away from the trunk',
    (_id, theme) => {
      for (let i = 12; i < 200; i++) {
        const colour = colorAt(i, theme)
        expect(contrastRatio(colour, theme.canvas), `${i} ${colour}`).toBeGreaterThanOrEqual(3)
        expect(deltaE2000(colour, theme.accent), `${i} ${colour}`).toBeGreaterThanOrEqual(10)
      }
    },
  )

  it.each(THEMES.filter((t) => t.cycle === 'oklch').map((theme) => [theme.id, theme] as const))(
    '%s: colours past the twelfth stay apart from the base palette and from each other',
    (_id, theme) => {
      const cols = Array.from({ length: 200 }, (_, i) => colorAt(i, theme))
      expect(new Set(cols).size).toBe(200)
      expect(minPairwiseDeltaE(cols.slice(0, 40))).toBeGreaterThanOrEqual(10)
      expect(minPairwiseDeltaE(cols)).toBeGreaterThanOrEqual(5)
      // a repo with 24 branches besides the default one: every branch reads as its own colour
      const others = Array.from({ length: 24 }, (_, i) => `topic-${String(i).padStart(2, '0')}`)
      const palette = assignPalette([...others, 'main'], 'main', theme)
      expect(minPairwiseDeltaE(others.map((name) => palette[name]))).toBeGreaterThanOrEqual(10)
    },
  )

  it.each(THEMES.filter((t) => t.cycle === 'oklch').map((theme) => [theme.id, theme] as const))(
    '%s: cycled colours stay out of the ink',
    (_id, theme) => {
      // no darker than the base palette's band (0.005 covers the hex rounding of the grid L), and on
      // light themes clear of stationRing, the ink of station rings, interchanges and text
      const floorL = Math.min(...theme.branchColors.map((h) => hexToOklch(h)[0])) - 0.05
      for (let i = 12; i < 200; i++) {
        const c = colorAt(i, theme)
        expect(hexToOklch(c)[0], `${i} ${c}`).toBeGreaterThanOrEqual(floorL - 0.005)
        if (theme.mode === 'light') expect(contrastRatio(c, theme.stationRing), `${i} ${c}`).toBeGreaterThanOrEqual(1.5)
      }
    },
  )

  it.each(THEMES.filter((t) => t.cycle === 'oklch').map((theme) => [theme.id, theme] as const))(
    '%s: a cycled colour does not depend on which indices were asked for first',
    (_id, theme) => {
      // fresh scheme objects: new cache keys, so each starts cold
      const ascending = { ...theme }
      const warm = [colorAt(20, ascending), colorAt(150, ascending)]
      const jumped = { ...theme }
      const late = colorAt(150, jumped)
      expect([colorAt(20, jumped), late]).toEqual(warm)

      const cold = buildTheme({ ...theme })
      const filled = buildTheme({ ...theme })
      for (let i = 12; i < 30; i++) colorAt(i, filled)
      expect(colorAt(30, cold)).toBe(colorAt(30, filled))
      expect(colorAt(30, cold)).toBe(colorAt(30, theme))
    },
  )

  it('is stable: same names in any order, same colours; a theme switch keeps each branch in its slot', () => {
    const shuffled = [...names].reverse()
    for (const theme of THEMES) {
      const a = assignPalette([...names, 'main'], 'main', theme)
      const b = assignPalette(['main', ...shuffled, names[3]], 'main', theme)
      expect(b).toEqual(a)
      expect(assignPalette([...names, 'main'], 'main', theme)).toEqual(a) // deterministic (and cached) on repeat
    }
    const slot = (theme: Theme, name: string) => {
      const palette = assignPalette([...names, 'main'], 'main', theme)
      return theme.branchColors.indexOf(palette[name] as (typeof theme.branchColors)[number])
    }
    for (const theme of THEMES) expect(slot(theme, names[5])).toBe(5)
  })

  it('does not depend on the theme object identity', () => {
    const copy = buildTheme({ ...byId('paper') })
    expect(assignPalette([...names, 'main'], 'main', copy)).toEqual(assignPalette([...names, 'main'], 'main', byId('paper')))
  })
})

describe('colour helpers', () => {
  it('hexToRgba expands 3/6/8 digit hex, clamps alpha and passes non-hex through', () => {
    expect(hexToRgba('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
    expect(hexToRgba('#a78bfa', 0.35)).toBe('rgba(167, 139, 250, 0.35)')
    expect(hexToRgba('a78bfaff', 1)).toBe('rgba(167, 139, 250, 1)')
    expect(hexToRgba(' #A78BFA ', 0.2)).toBe('rgba(167, 139, 250, 0.2)')
    expect(hexToRgba('#000', 7)).toBe('rgba(0, 0, 0, 1)')
    expect(hexToRgba('#000', -1)).toBe('rgba(0, 0, 0, 0)')
    expect(hexToRgba('rgb(1, 2, 3)', 0.2)).toBe('rgb(1, 2, 3)')
    expect(hexToRgba('#12345', 0.2)).toBe('#12345')
  })

  it('parseHex reads 3, 4, 6 and 8 digits and rejects the rest', () => {
    expect(parseHex('#abc')).toEqual([170, 187, 204])
    expect(parseHex('#abcd')).toEqual([170, 187, 204])
    expect(parseHex('#1e1e1e')).toEqual([30, 30, 30])
    expect(parseHex('1e1e1e80')).toEqual([30, 30, 30])
    for (const bad of ['', '#', '#12', '#12345', '#1234567', '#123456789', 'red', 'rgb(0,0,0)', '#ggg']) expect(parseHex(bad)).toBeNull()
  })

  it('blendHex composites like the canvas and CSS do', () => {
    expect(blendHex('#ffffff', '#000000', 0.5)).toBe('#808080')
    expect(blendHex('#ffffff', '#000000', 0)).toBe('#000000')
    expect(blendHex('#ffffff', '#000000', 1)).toBe('#ffffff')
    expect(blendHex('#ffffff', '#000000', 2)).toBe('#ffffff')
    expect(blendHex('#a78bfa', '#252525', 0.1)).toBe('#322f3a')
  })

  it('contrastRatio and deltaE2000 agree with known values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(deltaE2000('#123456', '#123456')).toBe(0)
    expect(deltaE2000('#000000', '#ffffff')).toBeCloseTo(100, 0)
    for (const [a, b] of [['#a78bfa', '#f472b6'], ['#1e1e1e', '#fbfaf7'], ['#22d3ee', '#2dd4bf']]) {
      expect(deltaE2000Lab(hexToLab(a), hexToLab(b))).toBe(deltaE2000(a, b))
    }
  })
})

describe('CSS variables', () => {
  it('give every theme the same set of --ui-* properties, all defined', () => {
    const keys = Object.keys(themeCssVariables(DEFAULT_THEME)).sort()
    for (const theme of THEMES) {
      const vars = themeCssVariables(theme)
      expect(Object.keys(vars).sort()).toEqual(keys)
      for (const [name, value] of Object.entries(vars)) {
        expect(name).toMatch(/^--ui-[a-z-]+$/)
        expect(value.length, name).toBeGreaterThan(0)
      }
    }
  })

  it('cover exactly what src/index.css reads, and index.css holds no colour of its own', () => {
    const provided = new Set(Object.keys(themeCssVariables(DEFAULT_THEME)))
    const read = new Set([...indexCss.matchAll(/var\((--ui-[a-z-]+)\)/g)].map((m) => m[1]))
    expect([...read].sort()).toEqual([...provided].sort())
    expect(indexCss).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
})

describe('theme storage', () => {
  const fake = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial))
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    }
  }
  const throwing = {
    getItem: (): string | null => {
      throw new Error('SecurityError')
    },
    setItem: (): void => {
      throw new Error('QuotaExceededError')
    },
  }

  it('reads the saved theme, falling back to Obsidian', () => {
    expect(THEME_STORAGE_KEY).toBe('gitube:theme')
    expect(readStoredThemeId(fake())).toBe('obsidian') // first visit
    expect(readStoredThemeId(fake({ [THEME_STORAGE_KEY]: 'paper' }))).toBe('paper')
    expect(readStoredThemeId(fake({ [THEME_STORAGE_KEY]: 'neon' }))).toBe('obsidian')
    expect(readStoredThemeId(throwing)).toBe('obsidian')
    expect(readStoredThemeId(null)).toBe('obsidian')
    expect(readStoredThemeId()).toBe('obsidian') // node: no localStorage at all
  })

  it('writes the choice under gitube:theme and survives storage that throws', () => {
    const storage = fake()
    writeStoredThemeId('midnight', storage)
    expect(storage.data.get('gitube:theme')).toBe('midnight')
    expect(readStoredThemeId(storage)).toBe('midnight')
    expect(() => writeStoredThemeId('sky', throwing)).not.toThrow()
    expect(() => writeStoredThemeId('sky', null)).not.toThrow()
    expect(() => writeStoredThemeId('sky')).not.toThrow()
  })
})

describe('applyTheme', () => {
  /** A minimal stand-in for the document (the tests run in node). */
  const fakeDocument = (current: string | undefined, withMeta: boolean) => {
    const props = new Map<string, string>()
    const attrs = new Set<string>()
    const log: string[] = []
    const dataset: Record<string, string> = current === undefined ? {} : { theme: current }
    const style = { colorScheme: '', setProperty: (name: string, value: string) => void props.set(name, value) }
    const root = {
      style,
      dataset,
      setAttribute: (name: string) => void (attrs.add(name), log.push(`+${name}`)),
      removeAttribute: (name: string) => void (attrs.delete(name), log.push(`-${name}`)),
    }
    let meta: { name: string; content: string } | null = withMeta ? { name: 'theme-color', content: '' } : null
    const doc = {
      documentElement: root,
      head: { appendChild: (el: { name: string; content: string }) => void (meta = el) },
      body: { getBoundingClientRect: () => void log.push(`flush (switching: ${attrs.has('data-theme-switching')})`) },
      querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
      createElement: () => ({ name: '', content: '' }),
    }
    return { doc: doc as unknown as Document, props, attrs, log, style, dataset, meta: () => meta }
  }

  it('sets the variables, color-scheme, data-theme and theme-color', () => {
    const paper = byId('paper')
    const fake = fakeDocument(undefined, true)
    applyTheme(paper, fake.doc)
    expect(Object.fromEntries(fake.props)).toEqual(themeCssVariables(paper))
    expect(fake.style.colorScheme).toBe('light')
    expect(fake.dataset.theme).toBe('paper')
    expect(fake.meta()?.content).toBe(paper.canvas)
    expect(fake.log).toEqual([]) // the first application is not a switch
  })

  it('creates the theme-color meta when the page has none', () => {
    const fake = fakeDocument(undefined, false)
    applyTheme(byId('midnight'), fake.doc)
    expect(fake.meta()).toEqual({ name: 'theme-color', content: byId('midnight').canvas })
  })

  it('restyles a switch with transitions held off, then lets them go', () => {
    const fake = fakeDocument('obsidian', true)
    applyTheme(byId('sky'), fake.doc)
    expect(fake.log).toEqual(['+data-theme-switching', 'flush (switching: true)', '-data-theme-switching'])
    expect(fake.attrs.size).toBe(0)
    const again = fakeDocument('sky', true)
    applyTheme(byId('sky'), again.doc) // same theme: nothing to switch
    expect(again.log).toEqual([])
  })
})

describe('first paint (index.html boot)', () => {
  /** Runs the boot script against a minimal fake document. */
  const boot = (saved: string | null | Error) => {
    const props = new Map<string, string>()
    const attrs = new Map<string, string>()
    const style = { colorScheme: '', setProperty: (name: string, value: string) => void props.set(name, value) }
    const meta = { content: '', setAttribute: (_name: string, value: string) => void (meta.content = value) }
    const window = {
      localStorage: {
        getItem: (key: string) => {
          if (saved instanceof Error) throw saved
          return key === THEME_STORAGE_KEY ? saved : null
        },
      },
    }
    const document = {
      documentElement: { style, setAttribute: (name: string, value: string) => void attrs.set(name, value) },
      querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? meta : null),
    }
    new Function('window', 'document', themeBootScript())(window, document)
    return { props, attrs, scheme: style.colorScheme, meta: meta.content }
  }

  it('applies a saved theme before the app loads', () => {
    for (const theme of THEMES.filter((t) => t.id !== DEFAULT_THEME_ID)) {
      const result = boot(theme.id)
      expect(Object.fromEntries(result.props)).toEqual(themeCssVariables(theme))
      expect(result.scheme).toBe(theme.mode)
      expect(result.attrs.get('data-theme')).toBe(theme.id)
      expect(result.meta).toBe(theme.canvas)
    }
  })

  it('leaves the Obsidian defaults alone on a first visit, for unknown ids and when storage throws', () => {
    for (const saved of [null, 'obsidian', 'neon', '__proto__', 'hasOwnProperty', new Error('SecurityError')]) {
      const result = boot(saved)
      expect(result.props.size).toBe(0)
      expect(result.scheme).toBe('')
      expect(result.attrs.get('data-theme')).toBe('obsidian')
    }
  })

  it('ships the default theme as CSS for the very first paint', () => {
    const css = defaultThemeCss()
    expect(css.startsWith(':root{')).toBe(true)
    for (const [name, value] of Object.entries(themeCssVariables(DEFAULT_THEME))) expect(css).toContain(`${name}:${value}`)
    expect(css).toContain('color-scheme:dark')
  })
})

// The point of the theme module: every UI and canvas colour comes from it. Source files outside
// src/theme (tests aside) may not spell a colour.
describe('no stray colour literals', () => {
  const sources = import.meta.glob(['../**/*.{ts,tsx,css}', '!../theme/**', '!../**/*.test.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const html = import.meta.glob('/index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

  const HEX_LITERAL = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i
  const FUNCTION_LITERAL = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*[\d.]/i

  it('finds the sources it scans, and its patterns catch colours', () => {
    expect(Object.keys(sources)).toContain('../components/RepoGraph.tsx')
    expect(Object.keys(sources)).toContain('../components/useLabelPlacer.ts')
    expect(Object.keys(sources)).toContain('../graph/color.ts')
    expect(Object.keys(sources)).toContain('../index.css')
    expect(Object.keys(sources).some((path) => path.includes('/theme/'))).toBe(false)
    expect(Object.keys(html)).toHaveLength(1)
    for (const sample of ["'#1e1e1e'", 'fill="#fff"', '#A78BFA80', '#abcd']) expect(sample).toMatch(HEX_LITERAL)
    for (const sample of ["'#' + id", '#12345', '#root', '#1234567']) expect(sample).not.toMatch(HEX_LITERAL)
    for (const sample of ["'rgba(167, 139, 250, 0.22)'", 'rgb(0 0 0)', 'hsl(210 40% 50%)', 'oklch(0.7 0.1 30)']) {
      expect(sample).toMatch(FUNCTION_LITERAL)
    }
    expect('`rgba(${r}, ${g}, ${b}, ${a})`').not.toMatch(FUNCTION_LITERAL)
  })

  it.each(Object.entries({ ...sources, ...html }))('%s', (_path, text) => {
    expect(text).not.toMatch(HEX_LITERAL)
    expect(text).not.toMatch(FUNCTION_LITERAL)
  })
})
