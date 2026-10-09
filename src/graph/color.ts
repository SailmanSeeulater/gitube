/**
 * Branch colour assignment.
 *
 * Pure and deterministic: the same set of branch names always yields the same palette,
 * whatever order the names arrive in, so colours do not jump between refetches or when a
 * branch is toggled on and off.
 */

/** Accent used for the default branch (Obsidian-style purple). */
export const ACCENT_COLOR = '#a78bfa'

/** Twelve soft-but-distinct colours that read well on the #1e1e1e canvas. */
export const BRANCH_COLORS: readonly string[] = [
  '#f472b6', // pink
  '#fb923c', // orange
  '#fbbf24', // amber
  '#a3e635', // lime
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#818cf8', // indigo
  '#e879f9', // fuchsia
  '#f87171', // red
  '#2dd4bf', // teal
  '#c084fc', // purple
]

/** Lightness bounds keep shifted colours visible on a dark canvas without washing out. */
const MIN_LIGHTNESS = 0.3
const MAX_LIGHTNESS = 0.85
/** Hue offset per cycle beyond the first twelve colours (golden angle, never repeats). */
const CYCLE_HUE_STEP = 137.508

/** Code-point order: locale independent, hence deterministic everywhere. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Map branch names to colours. The default branch always gets ACCENT_COLOR; every other
 * name is sorted and takes the next colour from BRANCH_COLORS. Past twelve names the list
 * cycles with a hue rotation (golden angle per cycle), so no two indices share a colour.
 */
export function assignPalette(branchNames: string[], defaultBranch: string): Record<string, string> {
  const others = [...new Set(branchNames)].filter((name) => name !== defaultBranch).sort(compareNames)
  // Object.fromEntries defines own data properties (CreateDataProperty), so a branch that is
  // legally named '__proto__' gets a real entry instead of hitting the Object.prototype setter
  // and silently vanishing, as `palette[name] = ...` would.
  return Object.fromEntries([
    [defaultBranch, ACCENT_COLOR],
    ...others.map((name, index) => [name, colorAt(index)] as const),
  ])
}

/** The colour for the index-th non-default branch in sorted order. */
export function colorAt(index: number): string {
  const base = BRANCH_COLORS[index % BRANCH_COLORS.length]
  const cycle = Math.floor(index / BRANCH_COLORS.length)
  if (cycle === 0) return base
  // A golden-angle hue rotation never lands on the same colour twice for any practical
  // branch count. (A lightness step cannot do this: it saturates at the clamp and repeats.)
  return rotateHue(base, cycle * CYCLE_HUE_STEP)
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

// ---------- colour maths ----------

type Rgb = [r: number, g: number, b: number] // 0..255
type Hsl = [h: number, s: number, l: number] // h 0..360, s/l 0..1

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const value = Number.parseInt(full, 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function rgbToHex([r, g, b]: Rgb): string {
  const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

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
