/**
 * Colour themes: the one source of every colour gitube paints, in the DOM and on the canvas.
 *
 * Ten themes, two dark and eight light. Obsidian, the default, is the original look token for
 * token. The token values come from the judge-corrected theme design (themes.json: palettes
 * designed in OKLCH and checked for WCAG contrast and CIEDE2000 distinctness on their own canvas).
 * That design also states rules for the colours the app derives from tokens (a link is its
 * branch's colour at linkAlpha, the hover ring is the text colour at hoverRingAlpha, and so on);
 * buildTheme turns those rules into computed values once per theme (Theme.derived), so nothing
 * mixes colours ad hoc at paint time.
 *
 * Pure data and functions: no DOM, no React (vite.config.ts imports this too). The DOM side is
 * applyTheme.ts, persistence is storage.ts, and the React hook is useTheme.ts.
 */
import { blendHex, hexToRgba } from './colour.ts'

export { blendHex, hexToRgba, parseHex } from './colour.ts'

export type ThemeMode = 'dark' | 'light'

/** Every theme id, in display order: the dark themes first. */
export const THEME_IDS = ['obsidian', 'midnight', 'paper', 'slate', 'sage', 'sand', 'rose', 'sky', 'contrast', 'solar'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME_ID: ThemeId = 'obsidian'

/** localStorage key of the chosen theme id. */
export { THEME_STORAGE_KEY } from '../storageKeys.ts'

/** Label plates (useLabelPlacer): canvas at this alpha behind the text... */
export const LABEL_PLATE_FILL_ALPHA = 0.92
/** ...ringed with the text colour at this alpha. */
export const LABEL_PLATE_RING_ALPHA = 0.25

/**
 * Person mode's earth tones, which no language palette provides: an archived repo's dry brown and
 * the horizon under every view. Lighter on dark canvases.
 */
export const EARTH_TONES: Readonly<Record<ThemeMode, { dry: string; horizon: string }>> = {
  dark: { dry: '#9a7652', horizon: '#8c6a4a' },
  light: { dry: '#8a6440', horizon: '#7a5838' },
}

/**
 * Metro view floors: the contrast on the canvas of a route colour drawn at the theme's
 * metroLineAlpha (a full route), metroStubAlpha (the dashed lead-in before a root) and
 * metroMutedAlpha (a muted route). Every base colour, the accent and the fallback clear them
 * (themes.test.ts), and graph/color.ts admits a cycled colour only if it does too.
 */
export const METRO_MIN_LINE_CONTRAST = 3
export const METRO_MIN_STUB_CONTRAST = 2
export const METRO_MIN_MUTED_CONTRAST = 1.8

type Twelve<T> = readonly [T, T, T, T, T, T, T, T, T, T, T, T]

/** The design tokens of one theme. Colours are '#rrggbb'; alphas are 0..1. */
export interface ThemeTokens {
  id: ThemeId
  name: string
  mode: ThemeMode
  /** one line on the theme's character (the picker's tooltip) */
  blurb: string
  /** graph canvas and page background */
  canvas: string
  /** floating panels (top bar, side panel, cards; drawn at 95% with a backdrop blur) */
  panel: string
  /** panel borders, dividers and the scrollbar thumb */
  panelBorder: string
  /** row and button hover, the active segment, small chips */
  hover: string
  /** inputs and segmented-control tracks */
  field: string
  text: string
  /** secondary text (counts, the commit author, legend labels) */
  textDim: string
  /** tertiary text (hints, timestamps) and commit SHAs on the canvas */
  muted: string
  /** links, selection, focus rings, the Grow chip, and the default branch's colour */
  accent: string
  /** text on a solid accent fill */
  accentText: string
  /** body of a root node (history cut off here) */
  rootFill: string
  /** dashed ring around a root node, and the outline of a hollow root fork */
  rootRing: string
  /** colour of a node or link whose owner branch has no palette entry */
  fallback: string
  /** '+N' badge on a collapsed link */
  badgeBg: string
  badgeText: string
  /** search halo around matching tips */
  halo: string
  haloFillAlpha: number
  haloRingAlpha: number
  /** the hovered node's ring is the text colour at this alpha */
  hoverRingAlpha: number
  /** links are their branch colour at linkAlpha, or linkDimAlpha outside the hover/selection */
  linkAlpha: number
  linkDimAlpha: number
  /** globalAlpha of nodes, labels and badges outside the hovered neighbourhood or selected reach */
  dimAlpha: number
  /**
   * Metro view: the station colour, drawn around a tip station and as the ring of an interchange.
   * It contrasts hard with the canvas (near-white on the dark themes, the text colour on the light
   * ones), so stations stay visible on any canvas.
   */
  stationRing: string
  /**
   * Metro routes are their branch colour at metroLineAlpha. Light themes draw them at full
   * strength, so every base colour keeps the 3:1 on the canvas its palette was designed for. On
   * the 'oklch' themes, dark ones included, colours cycled past the twelfth are filtered for
   * contrast at the theme's metro alphas (METRO_MIN_*_CONTRAST), so the 3:1 holds for them too.
   */
  metroLineAlpha: number
  /** a muted route (a deleted branch merged into a line), and every link while the nodes tween */
  metroMutedAlpha: number
  /** the dashed lead-in before a root (history cut off) */
  metroStubAlpha: number
  /** routes, lead-ins and run bars outside the hovered neighbourhood or selected reach */
  metroDimAlpha: number
  warn: string
  danger: string
  /**
   * good news on the pull request overlay: an approved review and passing checks (the split ring
   * round a tip, its glyphs and status lines). Readable as text on the panel and on the canvas.
   */
  success: string
  /** box-shadow of floating panels */
  shadow: string
  /** branch palette in assignment order (the default branch takes the accent instead) */
  branchColors: Twelve<string>
  /** names of branchColors, for people only */
  branchNames: Twelve<string>
  /**
   * How colours cycle past the twelfth branch. 'hsl': the original golden-angle HSL hue rotation
   * (Obsidian keeps it, so its colours stay bit for bit; distinct hues for small counts only).
   * 'oklch': farthest-point picks from an OKLCH grid of colours that clear 3:1 on the canvas,
   * clear the metro route, lead-in and muted floors (METRO_MIN_*_CONTRAST) at the theme's metro
   * alphas, keep dE 15 from the accent, are no darker (OKLCH L) than the darkest base colour less
   * 0.05 and, on light themes, keep 1.5:1 against stationRing (the ink of station rings and text);
   * each is as far (CIEDE2000) as possible from the 12 base colours and every earlier cycled
   * colour (see graph/color.ts colorAt). An HSL rotation would turn a light theme's dark blue into
   * a pale, unreadable yellow.
   */
  cycle: 'hsl' | 'oklch'
}

/** The design's derived rules, computed per theme by buildTheme. */
export interface ThemeDerived {
  /** the default branch's colour: accent */
  defaultBranchColour: string
  /** a link whose owner has no palette entry: fallback at linkAlpha, or linkDimAlpha when dimmed */
  fallbackLink: string
  fallbackLinkDim: string
  /** search halo: halo at haloFillAlpha (fill) and haloRingAlpha (ring) */
  searchHaloFill: string
  searchHaloRing: string
  /** ring around the hovered node: text at hoverRingAlpha */
  hoverRing: string
  /** ring around the node open in the inspector: accent */
  inspectedRing: string
  /** inside of a hollow fork node: canvas */
  forkNodeFill: string
  /** plate behind hover/inspect/drag labels and pinned labels drawn over another tip */
  labelPlateFill: string
  labelPlateRing: string
  /**
   * halo stroked behind canvas text that lines may run close to (metro labels and '+N' run
   * counts): canvas, so the text reads as cut out of the lines
   */
  textHalo: string
  /** metro view: the centre of an interchange, the inside of a hollow origin, a commit bead's core: canvas */
  stationCore: string
  /** metro run markers (the two bars across a line where commits are hidden, and the '+N'): badgeText */
  runMark: string
  /** selected panel row: accent at 0.10 over the panel, row text in accent */
  selectedRow: string
  /** accent chip (Grow): accent at 0.15 over the panel (0.25 on hover), text in accent */
  accentChip: string
  accentChipHover: string
  /** warn chip: warn at 0.10 (background) and 0.40 (border), text in warn */
  warnChipBg: string
  warnChipBorder: string
  /** inputs and segmented tracks: field */
  inputBg: string
  /** html { color-scheme }: mode */
  colorScheme: ThemeMode
  /** person mode (EARTH_TONES for the mode): an archived repo, and the horizon */
  dry: string
  horizon: string
}

export interface Theme extends ThemeTokens {
  derived: ThemeDerived
}

/**
 * What branch colour assignment needs from a theme: its colours, how it cycles, and what the
 * 'oklch' cycling filters candidates against (the metro alphas, the mode and the station ink).
 */
export type PaletteScheme = Pick<
  ThemeTokens,
  'accent' | 'branchColors' | 'canvas' | 'cycle' | 'metroLineAlpha' | 'metroStubAlpha' | 'metroMutedAlpha' | 'mode' | 'stationRing'
>

/** Generated from the judge-corrected themes.json; `cycle` is the app's addition (see ThemeTokens). */
const THEME_TOKENS = [
  {
    id: 'obsidian',
    name: 'Obsidian',
    mode: 'dark',
    blurb: 'The current look, bit for bit: graphite canvas, violet accent, soft neon branches.',
    canvas: '#1e1e1e',
    panel: '#252525',
    panelBorder: '#363636',
    hover: '#2e2e2e',
    field: '#202020',
    text: '#dcddde',
    textDim: '#b8b8b8',
    muted: '#999999',
    accent: '#a78bfa',
    accentText: '#1e1e1e',
    rootFill: '#5a5a5a',
    rootRing: '#8a8a8a',
    fallback: '#8b8b8b',
    badgeBg: '#2a2a2a',
    badgeText: '#b8b8b8',
    halo: '#a78bfa',
    haloFillAlpha: 0.22,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.35,
    linkDimAlpha: 0.07,
    dimAlpha: 0.2,
    stationRing: '#e8e8e8',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#d9b35b',
    danger: '#e06c75',
    success: '#63c55d',
    shadow: '0 10px 30px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.4)',
    branchColors: ['#f472b6', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#60a5fa', '#818cf8', '#e879f9', '#f87171', '#2dd4bf', '#c084fc'],
    branchNames: ['pink', 'orange', 'amber', 'lime', 'emerald', 'cyan', 'blue', 'indigo', 'fuchsia', 'red', 'teal', 'purple'],
    cycle: 'hsl',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    mode: 'dark',
    blurb: 'Deep ink-blue night with a lamplight-gold trunk; branches are cool jewel tones.',
    canvas: '#0a1222',
    panel: '#111a2c',
    panelBorder: '#243047',
    hover: '#1a263c',
    field: '#0c1425',
    text: '#e0e9f4',
    textDim: '#bdc8d8',
    muted: '#91a0b5',
    accent: '#f3c358',
    accentText: '#0a1222',
    rootFill: '#3f4858',
    rootRing: '#758196',
    fallback: '#7c8799',
    badgeBg: '#172135',
    badgeText: '#bdc8d8',
    halo: '#f3c358',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#ecf2fa',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#f08c3c',
    danger: '#f16f78',
    success: '#00bc74',
    shadow: '0 10px 30px rgba(2, 6, 18, 0.5), 0 1px 2px rgba(2, 6, 18, 0.5)',
    branchColors: ['#f97770', '#6de8e7', '#d27de6', '#d9f0a5', '#4baeed', '#ff9b51', '#47c58c', '#c9c2fc', '#fab2cd', '#738aed', '#a4f2cf', '#b4defc'],
    branchNames: ['coral', 'aqua', 'orchid', 'lime', 'azure', 'tangerine', 'jade', 'lavender', 'rose', 'periwinkle', 'mint', 'ice'],
    cycle: 'oklch',
  },
  {
    id: 'paper',
    name: 'Paper',
    mode: 'light',
    blurb: 'Warm white stock and printing inks; a vermilion seal marks the default branch.',
    canvas: '#faf9f6',
    panel: '#ffffff',
    panelBorder: '#e0ded8',
    hover: '#f2f0ec',
    field: '#fcfbf9',
    text: '#1d1a17',
    textDim: '#413c38',
    muted: '#68625c',
    accent: '#ba2e00',
    accentText: '#ffffff',
    rootFill: '#c0bdb8',
    rootRing: '#7d7a74',
    fallback: '#7d7a74',
    badgeBg: '#ffffff',
    badgeText: '#413c38',
    halo: '#ba2e00',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#1d1a17',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#915c08',
    danger: '#a3123f',
    success: '#277d23',
    shadow: '0 8px 24px rgba(40, 32, 20, 0.10), 0 1px 2px rgba(40, 32, 20, 0.10)',
    branchColors: ['#005182', '#a97416', '#752f71', '#158561', '#505ac8', '#86262e', '#868b52', '#c32e85', '#006169', '#7d4e2c', '#9468c2', '#295a2c'],
    branchNames: ['prussian', 'ochre', 'plum', 'viridian', 'ultramarine', 'oxblood', 'olive', 'magenta', 'teal', 'sepia', 'violet', 'forest'],
    cycle: 'oklch',
  },
  {
    id: 'slate',
    name: 'Slate',
    mode: 'light',
    blurb: 'Cool grey workspace, the Obsidian violet carried into daylight, crisp saturated branches.',
    canvas: '#edf0f4',
    panel: '#fafcfe',
    panelBorder: '#d2d8df',
    hover: '#e8ebf1',
    field: '#f1f4f7',
    text: '#11161f',
    textDim: '#313845',
    muted: '#565e6c',
    accent: '#6240d1',
    accentText: '#ffffff',
    rootFill: '#b2b8bf',
    rootRing: '#6f757d',
    fallback: '#6f757d',
    badgeBg: '#fafcfe',
    badgeText: '#313845',
    halo: '#6240d1',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#11161f',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#9a5b00',
    danger: '#c21725',
    success: '#007c2d',
    shadow: '0 8px 24px rgba(20, 28, 45, 0.10), 0 1px 2px rgba(20, 28, 45, 0.10)',
    branchColors: ['#d42975', '#d16100', '#a97f00', '#378a21', '#006f4f', '#028a9b', '#0066c8', '#1f3c86', '#af27b9', '#ac1922', '#6e401e', '#9a6ec9'],
    branchNames: ['pink', 'orange', 'gold', 'green', 'emerald', 'cyan', 'blue', 'navy', 'fuchsia', 'red', 'umber', 'lilac'],
    cycle: 'oklch',
  },
  {
    id: 'sage',
    name: 'Sage',
    mode: 'light',
    blurb: 'Pale herb-green linen, a forest-green trunk and a botanical, earthy palette.',
    canvas: '#ecf2e9',
    panel: '#f8fbf7',
    panelBorder: '#ced8c9',
    hover: '#f0f0e6',
    field: '#f0f5ed',
    text: '#141d16',
    textDim: '#313e34',
    muted: '#536255',
    accent: '#1b683e',
    accentText: '#ffffff',
    rootFill: '#b2baaf',
    rootRing: '#6f776c',
    fallback: '#6f776c',
    badgeBg: '#f8fbf7',
    badgeText: '#313e34',
    halo: '#1b683e',
    haloFillAlpha: 0.16,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#141d16',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#8a5f18',
    danger: '#a8372e',
    success: '#4d7800',
    shadow: '0 8px 24px rgba(24, 36, 26, 0.10), 0 1px 2px rgba(24, 36, 26, 0.10)',
    branchColors: ['#b25634', '#39659b', '#728431', '#763a64', '#a97e2c', '#368794', '#af3d60', '#8972b3', '#6b1d24', '#774826', '#42428c', '#5c571b'],
    branchNames: ['terracotta', 'slate blue', 'moss', 'plum', 'ochre', 'eucalyptus', 'berry', 'heather', 'beet', 'clay', 'iris', 'olive'],
    cycle: 'oklch',
  },
  {
    id: 'sand',
    name: 'Sand',
    mode: 'light',
    blurb: 'Sun-warmed dune beige with a turquoise trunk; desert clay, cactus and dusk colours.',
    canvas: '#f4e8d5',
    panel: '#fbf4e9',
    panelBorder: '#dccbb5',
    hover: '#f0e3cf',
    field: '#f6ecdb',
    text: '#2a1c10',
    textDim: '#4b392a',
    muted: '#6c5644',
    accent: '#006969',
    accentText: '#ffffff',
    rootFill: '#bdaf9d',
    rootRing: '#7c6b59',
    fallback: '#7c6b59',
    badgeBg: '#fbf4e9',
    badgeText: '#4b392a',
    halo: '#006969',
    haloFillAlpha: 0.16,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.5,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#2a1c10',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#8a5600',
    danger: '#af2b25',
    success: '#1f771c',
    shadow: '0 8px 24px rgba(60, 40, 15, 0.10), 0 1px 2px rgba(60, 40, 15, 0.10)',
    branchColors: ['#b8492e', '#3f7932', '#6b46a0', '#b17000', '#294793', '#86304a', '#7f7aa2', '#c74c8e', '#2176a8', '#6c411a', '#1c5434', '#817f24'],
    branchNames: ['adobe', 'cactus', 'dusk', 'saffron', 'indigo', 'rosewood', 'haze', 'sunset', 'denim', 'mesquite', 'juniper', 'yucca'],
    cycle: 'oklch',
  },
  {
    id: 'rose',
    name: 'Rose',
    mode: 'light',
    blurb: 'Blush-pink petals, a raspberry trunk and a garden of berry and floral colours.',
    canvas: '#fdf0f1',
    panel: '#fffafa',
    panelBorder: '#edd4d6',
    hover: '#f2e9e7',
    field: '#fef3f4',
    text: '#2b1920',
    textDim: '#4c363e',
    muted: '#735761',
    accent: '#b0175f',
    accentText: '#ffffff',
    rootFill: '#cab9bb',
    rootRing: '#857274',
    fallback: '#857274',
    badgeBg: '#fffafa',
    badgeText: '#4c363e',
    halo: '#b0175f',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#2b1920',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#935a11',
    danger: '#b3241f',
    success: '#167b26',
    shadow: '0 8px 24px rgba(60, 20, 35, 0.10), 0 1px 2px rgba(60, 20, 35, 0.10)',
    branchColors: ['#b97500', '#5849b2', '#3b8040', '#d45b3d', '#70306c', '#407bc5', '#778b20', '#9f55be', '#157171', '#933428', '#368ca7', '#255940'],
    branchNames: ['marigold', 'iris', 'fern', 'coral', 'plum', 'cornflower', 'leaf', 'orchid', 'teal', 'brick', 'lagoon', 'ivy'],
    cycle: 'oklch',
  },
  {
    id: 'sky',
    name: 'Sky',
    mode: 'light',
    blurb: 'Airy pale blue with an azure trunk and bright, clean kite colours.',
    canvas: '#edf7fd',
    panel: '#fafdff',
    panelBorder: '#c9dcea',
    hover: '#e6eaeb',
    field: '#f1f9fe',
    text: '#0e1e2f',
    textDim: '#293c51',
    muted: '#496076',
    accent: '#0061b0',
    accentText: '#ffffff',
    rootFill: '#b3c0ca',
    rootRing: '#697a88',
    fallback: '#697a88',
    badgeBg: '#fafdff',
    badgeText: '#293c51',
    halo: '#0061b0',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#0e1e2f',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#915c08',
    danger: '#be222a',
    success: '#007c2d',
    shadow: '0 8px 24px rgba(15, 35, 70, 0.10), 0 1px 2px rgba(15, 35, 70, 0.10)',
    branchColors: ['#dd5c00', '#1c882d', '#5403af', '#b08400', '#cc206f', '#008287', '#183060', '#719500', '#b71a18', '#b352ba', '#035e4d', '#806fcd'],
    branchNames: ['tangerine', 'kelly', 'violet', 'sun', 'cerise', 'lagoon', 'ink', 'lime', 'scarlet', 'orchid', 'spruce', 'heliotrope'],
    cycle: 'oklch',
  },
  {
    id: 'contrast',
    name: 'Contrast',
    mode: 'light',
    blurb: 'Pure white, true black text, hard borders and deep saturated branches for maximum legibility.',
    canvas: '#ffffff',
    panel: '#ffffff',
    panelBorder: '#1a1a1a',
    hover: '#d9d9d9',
    field: '#ededed',
    text: '#000000',
    textDim: '#1f1f1f',
    muted: '#3d3d3d',
    accent: '#063ad7',
    accentText: '#ffffff',
    rootFill: '#9a9a9a',
    rootRing: '#4a4a4a',
    fallback: '#555555',
    badgeBg: '#ffffff',
    badgeText: '#000000',
    halo: '#063ad7',
    haloFillAlpha: 0.16,
    haloRingAlpha: 1,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.65,
    linkDimAlpha: 0.14,
    dimAlpha: 0.25,
    stationRing: '#000000',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.15,
    warn: '#7a4702',
    danger: '#ac0311',
    success: '#03651a',
    shadow: '0 0 0 1px rgba(0, 0, 0, 0.9), 0 6px 16px rgba(0, 0, 0, 0.18)',
    branchColors: ['#bb0916', '#02721c', '#a70094', '#915b00', '#006c68', '#6c1bb9', '#062e6e', '#b84b00', '#5c6400', '#7b0f29', '#006e8c', '#024122'],
    branchNames: ['red', 'green', 'magenta', 'amber', 'teal', 'violet', 'navy', 'orange', 'olive', 'crimson', 'cyan', 'forest'],
    cycle: 'oklch',
  },
  {
    id: 'solar',
    name: 'Solar',
    mode: 'light',
    blurb: 'Solarized-style cream and blue-black, a burnt-amber sun for the trunk, Solarized accents deepened for contrast.',
    canvas: '#fdf6e3',
    panel: '#eee8d5',
    panelBorder: '#ddd5bd',
    hover: '#e3e0d3',
    field: '#f9f2df',
    text: '#073642',
    textDim: '#28474f',
    muted: '#53676d',
    accent: '#824d00',
    accentText: '#fdf6e3',
    rootFill: '#c9c2ad',
    rootRing: '#708285',
    fallback: '#708285',
    badgeBg: '#eee8d5',
    badgeText: '#28474f',
    halo: '#824d00',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.9,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.5,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#073642',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#9e3d00',
    danger: '#a8183a',
    success: '#006f1a',
    shadow: '0 8px 24px rgba(7, 54, 66, 0.10), 0 1px 2px rgba(7, 54, 66, 0.10)',
    branchColors: ['#268bd2', '#cb4b16', '#1f8a82', '#d33682', '#6f8000', '#6c71c4', '#742f22', '#1d4f7a', '#802651', '#2f6e4f', '#a66f6f', '#7a3d8f'],
    branchNames: ['blue', 'orange', 'cyan', 'magenta', 'green', 'violet', 'brick', 'navy', 'wine', 'pine', 'mauve', 'grape'],
    cycle: 'oklch',
  },
] as const satisfies readonly ThemeTokens[]

/** Computes a theme's derived colours from its tokens. */
export function buildTheme(t: ThemeTokens): Theme {
  return {
    ...t,
    derived: {
      defaultBranchColour: t.accent,
      fallbackLink: hexToRgba(t.fallback, t.linkAlpha),
      fallbackLinkDim: hexToRgba(t.fallback, t.linkDimAlpha),
      searchHaloFill: hexToRgba(t.halo, t.haloFillAlpha),
      searchHaloRing: hexToRgba(t.halo, t.haloRingAlpha),
      hoverRing: hexToRgba(t.text, t.hoverRingAlpha),
      inspectedRing: t.accent,
      forkNodeFill: t.canvas,
      labelPlateFill: hexToRgba(t.canvas, LABEL_PLATE_FILL_ALPHA),
      labelPlateRing: hexToRgba(t.text, LABEL_PLATE_RING_ALPHA),
      textHalo: t.canvas,
      stationCore: t.canvas,
      runMark: t.badgeText,
      selectedRow: blendHex(t.accent, t.panel, 0.1),
      accentChip: blendHex(t.accent, t.panel, 0.15),
      accentChipHover: blendHex(t.accent, t.panel, 0.25),
      warnChipBg: hexToRgba(t.warn, 0.1),
      warnChipBorder: hexToRgba(t.warn, 0.4),
      inputBg: t.field,
      colorScheme: t.mode,
      dry: EARTH_TONES[t.mode].dry,
      horizon: EARTH_TONES[t.mode].horizon,
    },
  }
}

/** All ten themes, dark first, in THEME_IDS order. */
export const THEMES: readonly Theme[] = THEME_TOKENS.map((tokens) => buildTheme(tokens))

const THEME_BY_ID: ReadonlyMap<string, Theme> = new Map(THEMES.map((theme) => [theme.id, theme]))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_BY_ID.has(value)
}

/** The theme with this id; the default theme (Obsidian) for an unknown or missing id. */
export function getTheme(id: string | null | undefined): Theme {
  return (id != null ? THEME_BY_ID.get(id) : undefined) ?? (THEME_BY_ID.get(DEFAULT_THEME_ID) as Theme)
}

/** Obsidian: the default theme and the original look. */
export const DEFAULT_THEME: Theme = getTheme(DEFAULT_THEME_ID)

/** A branch's link colour (its palette colour at linkAlpha). */
export function linkColour(theme: Pick<ThemeTokens, 'linkAlpha'>, branchColour: string): string {
  return hexToRgba(branchColour, theme.linkAlpha)
}

/** A dimmed branch link (its palette colour at linkDimAlpha). */
export function linkColourDim(theme: Pick<ThemeTokens, 'linkDimAlpha'>, branchColour: string): string {
  return hexToRgba(branchColour, theme.linkDimAlpha)
}

/**
 * The CSS custom properties a theme sets on the root element. src/index.css maps Tailwind's
 * --color-garden-* tokens (bg-garden-panel, text-garden-accent/70, ...) and --shadow-soft onto
 * these, so every DOM colour follows the active theme.
 */
export function themeCssVariables(theme: ThemeTokens): Record<string, string> {
  return {
    '--garden-canvas': theme.canvas,
    '--garden-panel': theme.panel,
    '--garden-border': theme.panelBorder,
    '--garden-hover': theme.hover,
    '--garden-field': theme.field,
    '--garden-text': theme.text,
    '--garden-text-dim': theme.textDim,
    '--garden-muted': theme.muted,
    '--garden-accent': theme.accent,
    '--garden-accent-text': theme.accentText,
    '--garden-raised': theme.badgeBg,
    '--garden-warn': theme.warn,
    '--garden-danger': theme.danger,
    '--garden-success': theme.success,
    '--garden-shadow': theme.shadow,
  }
}
