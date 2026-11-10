/**
 * Colour themes: the one source of every colour gitube paints, in the DOM and on the canvas.
 *
 * Twenty-six themes, eleven dark and fifteen light. Obsidian, the default, is the original look
 * token for token. The first ten themes' values come from the judge-corrected theme design
 * (themes.json: palettes designed in OKLCH and checked for WCAG contrast and CIEDE2000
 * distinctness on their own canvas). The sixteen after them (Coral and Reef among them) were
 * solved to the same rules: chrome picked in OKLCH, and the twelve branch colours found by a
 * max-min CIEDE2000 search inside each theme's lightness and chroma band (themes.test.ts holds
 * every theme to the floors).
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
export const THEME_IDS = [
  'obsidian', 'midnight', 'reef', 'fjord', 'ember', 'forest', 'plum', 'carbon', 'mocha',
  'aurora', 'dusk', 'coral', 'paper', 'slate', 'sage', 'sand', 'rose', 'sky',
  'contrast', 'solar', 'porcelain', 'lilac', 'tide', 'latte', 'dawn', 'citron',
] as const
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
  /** links, selection, focus rings, the Go chip, and the default branch's colour */
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
  /** accent chip (Go): accent at 0.15 over the panel (0.25 on hover), text in accent */
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

/** The first ten are generated from the judge-corrected themes.json; `cycle` is the app's addition (see ThemeTokens). */
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
    id: 'reef',
    name: 'Reef',
    mode: 'dark',
    blurb: "Coral's night dive: deep-sea teal with a living coral trunk and bright reef-fish branches.",
    canvas: '#02171c',
    panel: '#062025',
    panelBorder: '#1a383f',
    hover: '#102b31',
    field: '#041a1f',
    text: '#deebeb',
    textDim: '#b8cccd',
    muted: '#87a7a8',
    accent: '#ff8270',
    accentText: '#02171c',
    rootFill: '#405256',
    rootRing: '#5c6e71',
    fallback: '#6e7f81',
    badgeBg: '#0b252a',
    badgeText: '#b8cccd',
    halo: '#ff8270',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#e7f3f3',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#f4a000',
    danger: '#fe5c8e',
    success: '#2ccb5b',
    shadow: '0 10px 30px rgba(1, 10, 13, 0.5), 0 1px 2px rgba(1, 10, 13, 0.5)',
    branchColors: ['#00e3fe', '#6ea518', '#7f80ff', '#f0d0ff', '#d4a800', '#d85cb5', '#45eca4', '#ffd5b3', '#11a5f1', '#59a28f', '#dbe884', '#cc7c40'],
    branchNames: ['sky', 'green', 'indigo', 'mauve', 'gold', 'magenta', 'mint', 'sand', 'blue', 'teal', 'pistachio', 'orange'],
    cycle: 'oklch',
  },
  {
    id: 'fjord',
    name: 'Fjord',
    mode: 'dark',
    blurb: 'Polar slate-blue and frost: a calm, low-glare night with soft aurora pastels.',
    canvas: '#1e2733',
    panel: '#26303d',
    panelBorder: '#3c4959',
    hover: '#303b4a',
    field: '#212a36',
    text: '#e1e9f1',
    textDim: '#bdc9d5',
    muted: '#92a2b3',
    accent: '#86cedd',
    accentText: '#1e2733',
    rootFill: '#555d68',
    rootRing: '#727a85',
    fallback: '#7c848e',
    badgeBg: '#2b3543',
    badgeText: '#bdc9d5',
    halo: '#86cedd',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#eaf1f8',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#ffa914',
    danger: '#ff6a6c',
    success: '#4de271',
    shadow: '0 10px 30px rgba(13, 18, 23, 0.5), 0 1px 2px rgba(13, 18, 23, 0.5)',
    branchColors: ['#e67a73', '#dddf70', '#bf85cd', '#f8ceb2', '#17b991', '#bf9a1f', '#ffb6cb', '#ccc8f3', '#b9e4c6', '#98a670', '#8696f2', '#de8543'],
    branchNames: ['coral', 'pistachio', 'purple', 'apricot', 'emerald', 'gold', 'blush', 'lavender', 'mint', 'lime', 'indigo', 'orange'],
    cycle: 'oklch',
  },
  {
    id: 'ember',
    name: 'Ember',
    mode: 'dark',
    blurb: 'Warm charcoal with a glowing orange trunk, like coals under ash.',
    canvas: '#1b1511',
    panel: '#231c19',
    panelBorder: '#3c332f',
    hover: '#2f2723',
    field: '#1d1714',
    text: '#ece7e1',
    textDim: '#cec6bd',
    muted: '#a89e94',
    accent: '#ff9044',
    accentText: '#1b1511',
    rootFill: '#56504b',
    rootRing: '#716b66',
    fallback: '#817c77',
    badgeBg: '#28211e',
    badgeText: '#cec6bd',
    halo: '#ff9044',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#f5efe9',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#d0b400',
    danger: '#ff5a60',
    success: '#31ce5e',
    shadow: '0 10px 30px rgba(12, 9, 8, 0.5), 0 1px 2px rgba(12, 9, 8, 0.5)',
    branchColors: ['#00f9b6', '#8a7cfd', '#7da21f', '#00e3fe', '#f4d248', '#d861aa', '#d3cdff', '#59a28f', '#009ce4', '#ee5955', '#ffc4b9', '#af8b59'],
    branchNames: ['mint', 'indigo', 'lime', 'sky', 'straw', 'magenta', 'lavender', 'teal', 'blue', 'coral', 'salmon', 'amber'],
    cycle: 'oklch',
  },
  {
    id: 'forest',
    name: 'Forest',
    mode: 'dark',
    blurb: 'Night under the canopy: green-black, a new-leaf trunk and wildflower branches.',
    canvas: '#0c1911',
    panel: '#132218',
    panelBorder: '#283a2e',
    hover: '#1d2d23',
    field: '#0f1c14',
    text: '#e3eae1',
    textDim: '#c0cbbe',
    muted: '#96a593',
    accent: '#bee572',
    accentText: '#0c1911',
    rootFill: '#48544b',
    rootRing: '#646f66',
    fallback: '#757f77',
    badgeBg: '#18271d',
    badgeText: '#c0cbbe',
    halo: '#bee572',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#ecf2eb',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#f8a300',
    danger: '#ff5a60',
    success: '#00cf6f',
    shadow: '0 10px 30px rgba(5, 11, 8, 0.5), 0 1px 2px rgba(5, 11, 8, 0.5)',
    branchColors: ['#b56ce5', '#ea630c', '#2bd5ff', '#ffc1c9', '#3492ff', '#a98f57', '#ed576d', '#c7d2ff', '#55a294', '#3bf7b8', '#5ba917', '#f1d500'],
    branchNames: ['purple', 'orange', 'cyan', 'blush', 'blue', 'gold', 'coral', 'periwinkle', 'teal', 'mint', 'green', 'straw'],
    cycle: 'oklch',
  },
  {
    id: 'plum',
    name: 'Plum',
    mode: 'dark',
    blurb: 'Aubergine dark with a pink trunk; rich berry and jewel branches.',
    canvas: '#1e101f',
    panel: '#271828',
    panelBorder: '#412e42',
    hover: '#332234',
    field: '#211322',
    text: '#eee5ec',
    textDim: '#d0c2ce',
    muted: '#ad98ab',
    accent: '#fb90c1',
    accentText: '#1e101f',
    rootFill: '#584c58',
    rootRing: '#736773',
    fallback: '#867b86',
    badgeBg: '#2c1d2d',
    badgeText: '#d0c2ce',
    halo: '#fb90c1',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#f5edf4',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#f8a300',
    danger: '#ff5d50',
    success: '#31ce5e',
    shadow: '0 10px 30px rgba(13, 7, 14, 0.5), 0 1px 2px rgba(13, 7, 14, 0.5)',
    branchColors: ['#30ae40', '#009ce4', '#b8884e', '#93efff', '#cbd0ff', '#ffce2d', '#8a7cfd', '#16f7c3', '#c2f25a', '#ffc5b1', '#53a299', '#d47072'],
    branchNames: ['green', 'blue', 'amber', 'sky', 'periwinkle', 'straw', 'indigo', 'mint', 'pistachio', 'apricot', 'teal', 'coral'],
    cycle: 'oklch',
  },
  {
    id: 'carbon',
    name: 'Carbon',
    mode: 'dark',
    blurb: 'True black for OLED screens: neutral greys, one electric-blue trunk, vivid branches.',
    canvas: '#000000',
    panel: '#0f0f0f',
    panelBorder: '#292929',
    hover: '#1c1c1c',
    field: '#070707',
    text: '#eeeeee',
    textDim: '#c7c7c7',
    muted: '#9b9b9b',
    accent: '#52a9fe',
    accentText: '#000000',
    rootFill: '#434343',
    rootRing: '#626262',
    fallback: '#838383',
    badgeBg: '#151515',
    badgeText: '#c7c7c7',
    halo: '#52a9fe',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#f0f0f0',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#e79700',
    danger: '#ff5a60',
    success: '#18c151',
    shadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.5)',
    branchColors: ['#e0e100', '#eb5200', '#bf6d9d', '#3aac83', '#b08400', '#02f6f6', '#ffaaa9', '#8f6cff', '#53fd89', '#e9b8ff', '#769c00', '#009eb1'],
    branchNames: ['pistachio', 'orange', 'magenta', 'emerald', 'gold', 'aqua', 'salmon', 'violet', 'sage', 'mauve', 'lime', 'cyan'],
    cycle: 'oklch',
  },
  {
    id: 'mocha',
    name: 'Mocha',
    mode: 'dark',
    blurb: 'Dark roast and steamed milk: coffee browns, a caramel trunk and dusty pastel branches.',
    canvas: '#241b13',
    panel: '#2d231a',
    panelBorder: '#473a30',
    hover: '#392e25',
    field: '#271e16',
    text: '#ede7de',
    textDim: '#cec6b9',
    muted: '#a99f8e',
    accent: '#e6c183',
    accentText: '#241b13',
    rootFill: '#5c544c',
    rootRing: '#766f66',
    fallback: '#847d74',
    badgeBg: '#32281f',
    badgeText: '#cec6b9',
    halo: '#e6c183',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#f4efe7',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#ff8505',
    danger: '#ff5a60',
    success: '#3bd564',
    shadow: '0 10px 30px rgba(16, 12, 9, 0.5), 0 1px 2px rgba(16, 12, 9, 0.5)',
    branchColors: ['#a583df', '#5df8de', '#dc728d', '#509de8', '#2eabb2', '#d97d45', '#36b17b', '#c1d0f9', '#ecb9b1', '#f9b8f2', '#9d9e3d', '#c8d8ae'],
    branchNames: ['violet', 'aqua', 'rose', 'blue', 'cyan', 'orange', 'emerald', 'periwinkle', 'salmon', 'mauve', 'lime', 'pistachio'],
    cycle: 'oklch',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    mode: 'dark',
    blurb: 'Indigo polar night with a mint trunk and northern-lights branches.',
    canvas: '#101127',
    panel: '#171832',
    panelBorder: '#2d2f4f',
    hover: '#22233f',
    field: '#13142a',
    text: '#e4e8f2',
    textDim: '#c2c7d6',
    muted: '#979fb7',
    accent: '#73ecbc',
    accentText: '#101127',
    rootFill: '#4b4d60',
    rootRing: '#67697a',
    fallback: '#7a7d8d',
    badgeBg: '#1c1d38',
    badgeText: '#c2c7d6',
    halo: '#73ecbc',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#edf0f9',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#f4a000',
    danger: '#ff5a60',
    success: '#6ec52a',
    shadow: '0 10px 30px rgba(7, 8, 18, 0.5), 0 1px 2px rgba(7, 8, 18, 0.5)',
    branchColors: ['#f471aa', '#f59400', '#0795fd', '#d7ccff', '#fbdf12', '#9d75f5', '#a9eaff', '#ffc4b9', '#9d9459', '#ee5b48', '#00a8a2', '#8ada55'],
    branchNames: ['rose', 'amber', 'blue', 'lavender', 'straw', 'violet', 'sky', 'salmon', 'gold', 'coral', 'teal', 'green'],
    cycle: 'oklch',
  },
  {
    id: 'dusk',
    name: 'Dusk',
    mode: 'dark',
    blurb: 'Mauve twilight, quiet and low contrast, with a peach trunk like the last light.',
    canvas: '#23202a',
    panel: '#2c2834',
    panelBorder: '#44404e',
    hover: '#373340',
    field: '#26222d',
    text: '#ebe5ef',
    textDim: '#cbc4d1',
    muted: '#a59cac',
    accent: '#f8b287',
    accentText: '#23202a',
    rootFill: '#5b5761',
    rootRing: '#77737d',
    fallback: '#837f89',
    badgeBg: '#312d39',
    badgeText: '#cbc4d1',
    halo: '#f8b287',
    haloFillAlpha: 0.2,
    haloRingAlpha: 0.7,
    hoverRingAlpha: 0.45,
    linkAlpha: 0.38,
    linkDimAlpha: 0.08,
    dimAlpha: 0.2,
    stationRing: '#f3eef6',
    metroLineAlpha: 0.9,
    metroMutedAlpha: 0.45,
    metroStubAlpha: 0.6,
    metroDimAlpha: 0.1,
    warn: '#e3be00',
    danger: '#ff5a60',
    success: '#44dc6b',
    shadow: '0 10px 30px rgba(16, 14, 19, 0.5), 0 1px 2px rgba(16, 14, 19, 0.5)',
    branchColors: ['#02f6f6', '#bb82e3', '#9ca837', '#eb7289', '#ccd5ff', '#7cf4ab', '#76ab9c', '#fac8d6', '#709afb', '#00c3f5', '#cd9200', '#e4d8ab'],
    branchNames: ['aqua', 'purple', 'lime', 'rose', 'periwinkle', 'mint', 'glacier', 'blush', 'indigo', 'cyan', 'amber', 'straw'],
    cycle: 'oklch',
  },
  {
    id: 'coral',
    name: 'Coral',
    mode: 'light',
    blurb: 'Minimal and flat: warm white, quiet neutral chrome and a single coral trunk.',
    canvas: '#fef7f5',
    panel: '#ffffff',
    panelBorder: '#e9ddd9',
    hover: '#f7eeea',
    field: '#fffbf9',
    text: '#241714',
    textDim: '#4b3834',
    muted: '#735d5a',
    accent: '#d53d37',
    accentText: '#ffffff',
    rootFill: '#c5bdbb',
    rootRing: '#8d8380',
    fallback: '#8d8380',
    badgeBg: '#ffffff',
    badgeText: '#4b3834',
    halo: '#d53d37',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#241714',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#945f00',
    danger: '#c61e58',
    success: '#0c8300',
    shadow: '0 8px 24px rgba(36, 23, 20, 0.10), 0 1px 2px rgba(36, 23, 20, 0.10)',
    branchColors: ['#009957', '#0092d7', '#41328e', '#534400', '#005050', '#a475af', '#b77b00', '#732442', '#005512', '#752908', '#767f00', '#0f9293'],
    branchNames: ['emerald', 'blue', 'midnight', 'olive', 'deep teal', 'purple', 'amber', 'wine', 'forest', 'rust', 'lime', 'teal'],
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
    blurb: 'Blush pink, a raspberry trunk and a palette of berry and floral colours.',
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
  {
    id: 'porcelain',
    name: 'Porcelain',
    mode: 'light',
    blurb: 'Clean white and cobalt, like glazed tile: crisp, neutral and bright.',
    canvas: '#f8fafd',
    panel: '#ffffff',
    panelBorder: '#dde2e7',
    hover: '#eef1f5',
    field: '#fafcfe',
    text: '#141b25',
    textDim: '#343e4b',
    muted: '#596473',
    accent: '#1957d2',
    accentText: '#ffffff',
    rootFill: '#bdc0c5',
    rootRing: '#81868d',
    fallback: '#81868d',
    badgeBg: '#ffffff',
    badgeText: '#343e4b',
    halo: '#1957d2',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#141b25',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#945f00',
    danger: '#c92035',
    success: '#0c8300',
    shadow: '0 8px 24px rgba(20, 27, 37, 0.10), 0 1px 2px rgba(20, 27, 37, 0.10)',
    branchColors: ['#9a7d22', '#cc4a7c', '#00514a', '#b2320e', '#389469', '#0090a2', '#5b3f01', '#68313b', '#3e6200', '#711990', '#9c68e6', '#2788f5'],
    branchNames: ['gold', 'rose', 'deep teal', 'orange', 'emerald', 'cyan', 'umber', 'wine', 'forest', 'plum', 'violet', 'blue'],
    cycle: 'oklch',
  },
  {
    id: 'lilac',
    name: 'Lilac',
    mode: 'light',
    blurb: 'Pale violet haze with a purple trunk and spring-garden branches.',
    canvas: '#f5f1fe',
    panel: '#fcfbff',
    panelBorder: '#ddd7eb',
    hover: '#ece7f7',
    field: '#f7f4ff',
    text: '#1b1826',
    textDim: '#3e3a4d',
    muted: '#646075',
    accent: '#7a38bf',
    accentText: '#ffffff',
    rootFill: '#bcb9c6',
    rootRing: '#817e8c',
    fallback: '#817e8c',
    badgeBg: '#fcfbff',
    badgeText: '#3e3a4d',
    halo: '#7a38bf',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#1b1826',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#905c00',
    danger: '#c51b32',
    success: '#0b7c00',
    shadow: '0 8px 24px rgba(27, 24, 38, 0.10), 0 1px 2px rgba(27, 24, 38, 0.10)',
    branchColors: ['#3c7700', '#d56400', '#00919d', '#6f2f1f', '#ca4b85', '#004a70', '#534400', '#977e00', '#00523f', '#0083e0', '#8377ab', '#5d3459'],
    branchNames: ['green', 'orange', 'cyan', 'rust', 'rose', 'navy', 'olive', 'gold', 'pine', 'blue', 'violet', 'plum'],
    cycle: 'oklch',
  },
  {
    id: 'tide',
    name: 'Tide',
    mode: 'light',
    blurb: 'Pale aqua shallows with a deep marine trunk; sea-glass and driftwood colours.',
    canvas: '#e6f7f8',
    panel: '#f7fdfd',
    panelBorder: '#c7e1e2',
    hover: '#daeff0',
    field: '#ecf9fa',
    text: '#0a1e22',
    textDim: '#274248',
    muted: '#4d686f',
    accent: '#006a8b',
    accentText: '#ffffff',
    rootFill: '#adbfc0',
    rootRing: '#718487',
    fallback: '#718487',
    badgeBg: '#f7fdfd',
    badgeText: '#274248',
    halo: '#006a8b',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#0a1e22',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#905c00',
    danger: '#c92035',
    success: '#0b7c00',
    shadow: '0 8px 24px rgba(10, 30, 34, 0.10), 0 1px 2px rgba(10, 30, 34, 0.10)',
    branchColors: ['#940014', '#5f9200', '#6b1d96', '#d56400', '#03532d', '#9773d0', '#613b00', '#11957c', '#d75c61', '#9d7c00', '#89526c', '#254477'],
    branchNames: ['brick', 'green', 'plum', 'orange', 'pine', 'violet', 'umber', 'teal', 'coral', 'gold', 'magenta', 'navy'],
    cycle: 'oklch',
  },
  {
    id: 'latte',
    name: 'Latte',
    mode: 'light',
    blurb: 'Steamed milk and espresso: soft warm beige with a roasted-brown trunk.',
    canvas: '#f8eee6',
    panel: '#fbf8f5',
    panelBorder: '#e4d4c7',
    hover: '#f1e4da',
    field: '#f9f1ea',
    text: '#24170f',
    textDim: '#4b392d',
    muted: '#735f52',
    accent: '#814b2c',
    accentText: '#ffffff',
    rootFill: '#c1b6ae',
    rootRing: '#8a7e76',
    fallback: '#8a7e76',
    badgeBg: '#fbf8f5',
    badgeText: '#4b392d',
    halo: '#814b2c',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#24170f',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#816000',
    danger: '#c51b32',
    success: '#0b7c00',
    shadow: '0 8px 24px rgba(36, 23, 15, 0.10), 0 1px 2px rgba(36, 23, 15, 0.10)',
    branchColors: ['#009583', '#66209b', '#e24c64', '#008bc1', '#9d7c00', '#438107', '#7f78ad', '#054974', '#05523a', '#dd5b00', '#4f4502', '#68313f'],
    branchNames: ['teal', 'grape', 'coral', 'blue', 'gold', 'green', 'violet', 'navy', 'pine', 'orange', 'olive', 'wine'],
    cycle: 'oklch',
  },
  {
    id: 'dawn',
    name: 'Dawn',
    mode: 'light',
    blurb: 'Peach first light with an indigo trunk, the sky just before sunrise.',
    canvas: '#fff0e7',
    panel: '#fffbf8',
    panelBorder: '#edd6c7',
    hover: '#f9e6da',
    field: '#fff4ec',
    text: '#191928',
    textDim: '#3b3b50',
    muted: '#616177',
    accent: '#4947c5',
    accentText: '#ffffff',
    rootFill: '#c3b8b5',
    rootRing: '#878084',
    fallback: '#878084',
    badgeBg: '#fffbf8',
    badgeText: '#3b3b50',
    halo: '#4947c5',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#191928',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#905c00',
    danger: '#c92035',
    success: '#0b7c00',
    shadow: '0 8px 24px rgba(25, 25, 40, 0.10), 0 1px 2px rgba(25, 25, 40, 0.10)',
    branchColors: ['#a27900', '#009583', '#a10033', '#314e20', '#004e59', '#653815', '#008cb9', '#c84799', '#649029', '#aa6f5f', '#7b79ae', '#523865'],
    branchNames: ['gold', 'teal', 'brick', 'forest', 'marine', 'rust', 'blue', 'magenta', 'green', 'orange', 'indigo', 'plum'],
    cycle: 'oklch',
  },
  {
    id: 'citron',
    name: 'Citron',
    mode: 'light',
    blurb: 'Lemon-cream paper with an olive trunk; fresh citrus and garden colours.',
    canvas: '#faf8e1',
    panel: '#fffef6',
    panelBorder: '#e3e0bf',
    hover: '#f2efd4',
    field: '#fcfae8',
    text: '#1a1c0a',
    textDim: '#3c4027',
    muted: '#62664c',
    accent: '#516f21',
    accentText: '#ffffff',
    rootFill: '#c0bfa9',
    rootRing: '#868671',
    fallback: '#868671',
    badgeBg: '#fffef6',
    badgeText: '#3c4027',
    halo: '#516f21',
    haloFillAlpha: 0.14,
    haloRingAlpha: 0.85,
    hoverRingAlpha: 0.6,
    linkAlpha: 0.45,
    linkDimAlpha: 0.1,
    dimAlpha: 0.22,
    stationRing: '#1a1c0a',
    metroLineAlpha: 1,
    metroMutedAlpha: 0.55,
    metroStubAlpha: 0.7,
    metroDimAlpha: 0.12,
    warn: '#905c00',
    danger: '#c92035',
    success: '#007d70',
    shadow: '0 8px 24px rgba(26, 28, 10, 0.10), 0 1px 2px rgba(26, 28, 10, 0.10)',
    branchColors: ['#5f24a0', '#e25330', '#008db3', '#b0729b', '#69322f', '#b27f00', '#004f53', '#694500', '#796ce0', '#004f8b', '#208979', '#0d9b2c'],
    branchNames: ['grape', 'orange', 'cyan', 'magenta', 'brick', 'gold', 'marine', 'umber', 'indigo', 'navy', 'teal', 'green'],
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

/** Every theme, in THEME_IDS order: the dark ones first. */
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
 * --color-ui-* tokens (bg-ui-panel, text-ui-accent/70, ...) and --shadow-soft onto
 * these, so every DOM colour follows the active theme.
 */
export function themeCssVariables(theme: ThemeTokens): Record<string, string> {
  return {
    '--ui-canvas': theme.canvas,
    '--ui-panel': theme.panel,
    '--ui-border': theme.panelBorder,
    '--ui-hover': theme.hover,
    '--ui-field': theme.field,
    '--ui-text': theme.text,
    '--ui-text-dim': theme.textDim,
    '--ui-muted': theme.muted,
    '--ui-accent': theme.accent,
    '--ui-accent-text': theme.accentText,
    '--ui-raised': theme.badgeBg,
    '--ui-warn': theme.warn,
    '--ui-danger': theme.danger,
    '--ui-success': theme.success,
    '--ui-shadow': theme.shadow,
  }
}
