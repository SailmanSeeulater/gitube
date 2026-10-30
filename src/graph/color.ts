/**
 * Branch colour assignment.
 *
 * Pure and deterministic: for a given theme, the same set of branch names always yields the same
 * palette, whatever order the names arrive in, so colours do not jump between refetches or when a
 * branch is toggled on and off. Switching theme maps every branch to the same slot of the new
 * theme's palette (slots depend on the names only).
 */
import { blendHex, contrastRatio, deltaE2000Lab, hexToLab, hexToOklch, hexToRgb, oklchToHex, rgbToHex, type Lab, type Rgb } from '../theme/colour'
import {
  DEFAULT_THEME,
  METRO_MIN_LINE_CONTRAST,
  METRO_MIN_MUTED_CONTRAST,
  METRO_MIN_STUB_CONTRAST,
  type PaletteScheme,
} from '../theme/themes'

/** The default theme's (Obsidian's) accent, the default branch's colour. */
export const ACCENT_COLOR: string = DEFAULT_THEME.accent

/** The default theme's (Obsidian's) twelve branch colours. */
export const BRANCH_COLORS: readonly string[] = DEFAULT_THEME.branchColors

/** Lightness bounds keep shifted colours visible on a dark canvas without washing out. */
const MIN_LIGHTNESS = 0.3
const MAX_LIGHTNESS = 0.85
/** 'hsl' cycling: hue offset per cycle beyond the first twelve colours (the golden angle). */
const CYCLE_HUE_STEP = 137.508
/** 'oklch' cycling: every candidate clears this contrast against the canvas... */
const CYCLE_MIN_CONTRAST = 3
/** ...and keeps at least this CIEDE2000 distance from the accent (the default branch, the trunk). */
const CYCLE_MIN_ACCENT_DE = 15
/** ...and is no darker (OKLCH L) than the darkest base colour minus this, so cycled colours stay in the palette's band... */
const CYCLE_L_MARGIN = 0.05
/**
 * ...and, on light themes only, keeps this contrast against stationRing: the ink of station rings,
 * interchanges and text there, which a near-black branch would melt into.
 */
const CYCLE_MIN_RING_CONTRAST = 1.5
/** The OKLCH grid the 'oklch' candidates are drawn from: L 0.25..0.92 by 0.05, four chromas, h by 10 degrees. */
const POOL_L_MIN = 0.25
const POOL_L_MAX = 0.92
const POOL_L_STEP = 0.05
const POOL_CHROMAS = [0.05, 0.1, 0.15, 0.2] as const
const POOL_HUE_STEP = 10

/** Code-point order: locale independent, hence deterministic everywhere. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Map branch names to colours. The default branch always gets the theme's accent; every other
 * name is sorted and takes the next colour from the theme's branchColors. Past twelve names the
 * colours come from colorAt: on the 'oklch' themes each one is chosen greedily to be as far
 * (CIEDE2000) as possible from the 12 base colours and every earlier cycled colour, among
 * candidates that clear 3:1 on the canvas, clear the metro route, lead-in and muted floors at the
 * theme's metro alphas, keep dE 15 from the accent, are no darker than the darkest base colour
 * (less a small margin) and, on light themes, keep 1.5:1 against the station ink. Obsidian's legacy
 * 'hsl' cycling (a golden-angle hue rotation) only guarantees distinct hues for small counts.
 * The scheme defaults to Obsidian, the default theme.
 */
export function assignPalette(
  branchNames: string[],
  defaultBranch: string,
  scheme: PaletteScheme = DEFAULT_THEME,
): Record<string, string> {
  const others = [...new Set(branchNames)].filter((name) => name !== defaultBranch).sort(compareNames)
  // Object.fromEntries defines own data properties (CreateDataProperty), so a branch that is
  // legally named '__proto__' gets a real entry instead of hitting the Object.prototype setter
  // and silently vanishing, as `palette[name] = ...` would.
  return Object.fromEntries([
    [defaultBranch, scheme.accent],
    ...others.map((name, index) => [name, colorAt(index, scheme)] as const),
  ])
}

/**
 * 'oklch' cycling state per scheme object, built lazily on the first colorAt(index >= 12) for it:
 * the candidate pool and its CIELAB values; per candidate, its CIEDE2000 distance to the nearest
 * colour handed out (minD), exact as of the first `seen` picks and so an upper bound until it is
 * refreshed against the rest; a max-heap of the unpicked candidates on (minD, then lowest index);
 * and the cycled colours picked so far (picks[i] is index 12 + i).
 */
interface CycleState {
  pool: string[]
  labs: Lab[]
  minD: number[]
  seen: number[]
  heap: number[]
  picks: string[]
  pickLabs: Lab[]
}
const cycleCache = new WeakMap<PaletteScheme, CycleState>()

/**
 * The colour for the index-th non-default branch in sorted order. The first twelve are the
 * scheme's branchColors. Past them, cycle 'hsl' rotates the HSL hue by the golden angle per cycle
 * (the original behaviour, kept bit for bit for Obsidian; distinct hues for small counts only).
 * Cycle 'oklch' extends the palette by farthest-point sampling over an OKLCH grid of candidates
 * that clear 3:1 on the canvas; clear the metro floors (METRO_MIN_LINE/STUB/MUTED_CONTRAST) when
 * drawn at the theme's metroLineAlpha, metroStubAlpha and metroMutedAlpha, so a cycled route,
 * lead-in or muted route reads like a base colour's; keep dE 15 from the accent (so a cycled
 * branch never impersonates the trunk); are no darker (OKLCH L) than the darkest base colour minus
 * CYCLE_L_MARGIN; and, on light themes, keep CYCLE_MIN_RING_CONTRAST against stationRing (so no
 * branch turns as dark as the station rings and text). Each new colour is the candidate farthest
 * (CIEDE2000) from the 12 base colours and every earlier cycled colour, ties going to the first
 * candidate. A pick depends only on the earlier ones, so a colour is the same whatever order the
 * indices are asked for in. Every cycled colour is distinct until the pool (several hundred
 * colours per theme) runs out; past that the picks repeat in order.
 */
export function colorAt(index: number, scheme: PaletteScheme = DEFAULT_THEME): string {
  const palette = scheme.branchColors
  const base = palette[index % palette.length]
  const cycle = Math.floor(index / palette.length)
  if (cycle === 0) return base
  if (scheme.cycle === 'hsl') {
    // A golden-angle hue rotation never lands on exactly the same colour twice for any practical
    // branch count (a lightness step cannot: it saturates at the clamp and repeats), but past a
    // few dozen branches some cycled colours sit close to others.
    return rotateHue(base, cycle * CYCLE_HUE_STEP)
  }
  const { pool, labs, minD, seen, heap, picks, pickLabs } = cycleState(scheme)
  if (pool.length === 0) return base // a scheme with no admissible candidate: plain cycling
  const wanted = index - palette.length
  // Add picks in order up to `wanted`. Lazy greedy: distances only shrink as picks are
  // added, so a stale minD is an upper bound. When the heap's top is up to date it is the true
  // farthest candidate (lowest index on ties), exactly what a full rescan would pick; when it is
  // stale, refresh it against the picks it has not seen and let it sink.
  while (picks.length <= wanted && heap.length > 0) {
    const top = heap[0]
    if (seen[top] < pickLabs.length) {
      let near = minD[top]
      for (let p = seen[top]; p < pickLabs.length; p++) near = Math.min(near, deltaE2000Lab(labs[top], pickLabs[p]))
      minD[top] = near
      seen[top] = pickLabs.length
      siftDown(heap, 0, minD)
      continue
    }
    const last = heap.pop() as number
    if (heap.length > 0) {
      heap[0] = last
      siftDown(heap, 0, minD)
    }
    picks.push(pool[top])
    pickLabs.push(labs[top])
  }
  // Past the whole pool (several hundred colours per theme) the picks repeat in order.
  return picks[wanted % picks.length]
}

/** Max-heap sift-down of candidate indices, ordered by larger minD first, then lower index. */
function siftDown(heap: number[], i: number, minD: readonly number[]): void {
  const before = (a: number, b: number) => minD[a] > minD[b] || (minD[a] === minD[b] && a < b)
  for (;;) {
    const left = 2 * i + 1
    const right = left + 1
    let first = i
    if (left < heap.length && before(heap[left], heap[first])) first = left
    if (right < heap.length && before(heap[right], heap[first])) first = right
    if (first === i) return
    ;[heap[i], heap[first]] = [heap[first], heap[i]]
    i = first
  }
}

/**
 * The OKLCH candidate grid as distinct hex colours, with their CIELAB values and the grid L each
 * was made at, in grid order. Theme independent: built once.
 */
interface CandidateGrid {
  hexes: string[]
  labs: Lab[]
  ls: number[]
}
let candidateGrid: CandidateGrid | null = null

function grid(): CandidateGrid {
  if (candidateGrid !== null) return candidateGrid
  const hexes: string[] = []
  const ls: number[] = []
  const seen = new Set<string>()
  for (let i = 0; POOL_L_MIN + i * POOL_L_STEP <= POOL_L_MAX + 1e-9; i++) {
    const L = POOL_L_MIN + i * POOL_L_STEP
    for (const C of POOL_CHROMAS) {
      for (let h = 0; h < 360; h += POOL_HUE_STEP) {
        const hex = oklchToHex(L, C, h)
        if (seen.has(hex)) continue
        seen.add(hex)
        hexes.push(hex)
        ls.push(L)
      }
    }
  }
  candidateGrid = { hexes, labs: hexes.map(hexToLab), ls }
  return candidateGrid
}

/**
 * The 'oklch' candidate pool for a scheme: the grid colours that are not base colours, clear 3:1
 * on the canvas and the metro floors at the theme's metro alphas, keep dE 15 from the accent, are
 * no darker than the darkest base colour minus CYCLE_L_MARGIN and (light themes) keep 1.5:1
 * against stationRing, with each one's distance to the nearest base colour.
 */
function cycleState(scheme: PaletteScheme): CycleState {
  const cached = cycleCache.get(scheme)
  if (cached !== undefined) return cached
  const all = grid()
  const taken = new Set<string>(scheme.branchColors)
  const accent = hexToLab(scheme.accent)
  const floorL = Math.min(...scheme.branchColors.map((h) => hexToOklch(h)[0])) - CYCLE_L_MARGIN
  /** contrast on the canvas of the candidate drawn at this alpha over it, as a metro route is */
  const onCanvas = (hex: string, a: number) => contrastRatio(blendHex(hex, scheme.canvas, a), scheme.canvas)
  const pool: string[] = []
  const labs: Lab[] = []
  all.hexes.forEach((hex, k) => {
    if (taken.has(hex)) return
    if (all.ls[k] < floorL - 1e-9) return
    if (contrastRatio(hex, scheme.canvas) < CYCLE_MIN_CONTRAST) return
    if (
      onCanvas(hex, scheme.metroLineAlpha) < METRO_MIN_LINE_CONTRAST ||
      onCanvas(hex, scheme.metroStubAlpha) < METRO_MIN_STUB_CONTRAST ||
      onCanvas(hex, scheme.metroMutedAlpha) < METRO_MIN_MUTED_CONTRAST
    )
      return
    if (scheme.mode === 'light' && contrastRatio(hex, scheme.stationRing) < CYCLE_MIN_RING_CONTRAST) return
    if (deltaE2000Lab(all.labs[k], accent) < CYCLE_MIN_ACCENT_DE) return
    pool.push(hex)
    labs.push(all.labs[k])
  })
  const baseLabs = scheme.branchColors.map(hexToLab)
  const minD = labs.map((lab) => {
    let near = Infinity
    for (const b of baseLabs) near = Math.min(near, deltaE2000Lab(lab, b))
    return near
  })
  const heap = pool.map((_, k) => k)
  for (let i = (heap.length >> 1) - 1; i >= 0; i--) siftDown(heap, i, minD)
  const state: CycleState = { pool, labs, minD, seen: pool.map(() => 0), heap, picks: [], pickLabs: [] }
  cycleCache.set(scheme, state)
  return state
}

/** Rotate a hex colour's HSL hue by degrees, keeping saturation and lightness. */
export function rotateHue(hex: string, degrees: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  return rgbToHex(hslToRgb([(((h + degrees) % 360) + 360) % 360, s, l]))
}

/**
 * Move a hex colour's HSL lightness by delta (clamped), keeping hue and saturation.
 * Not used by palette assignment any more (the clamp makes it repeat colours); kept exported.
 */
export function shiftLightness(hex: string, delta: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  const shifted = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l + delta))
  return rgbToHex(hslToRgb([h, s, shifted]))
}

// ---------- HSL ----------

type Hsl = [h: number, s: number, l: number] // h 0..360, s/l 0..1

function rgbToHsl([r255, g255, b255]: Rgb): Hsl {
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = h / 360
  const channel = (t0: number): number => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255]
}
