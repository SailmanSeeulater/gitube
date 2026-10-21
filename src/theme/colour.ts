/**
 * Colour maths for the themes and the branch palette: hex parsing, alpha (rgba) and opaque
 * blending, WCAG contrast, OKLab/OKLCH, and CIEDE2000. Pure: no DOM, no React, no imports, so it
 * runs in node (tests, vite.config) as well as in the browser.
 */

/** 0..255 per channel. */
export type Rgb = [r: number, g: number, b: number]

/** '#rgb' | '#rgba' | '#rrggbb' | '#rrggbbaa' (the '#' optional) -> [r, g, b]; null for anything else. Alpha digits are ignored. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!match) return null
  let h = match[1]
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 && h.length !== 8) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** Like parseHex, but black for unparsable input (for maths on colours already known to be valid). */
export function hexToRgb(hex: string): Rgb {
  return parseHex(hex) ?? [0, 0, 0]
}

/** [r, g, b] (rounded and clamped to 0..255) -> '#rrggbb'. */
export function rgbToHex([r, g, b]: Rgb): string {
  const toHex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** '#rgb' | '#rrggbb' | '#rrggbbaa' -> 'rgba(r, g, b, a)', alpha clamped to 0..1. Non-hex input is returned unchanged. */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex)
  if (rgb === null) return hex
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`
}

/** `fg` at `alpha` composited over opaque `bg` (sRGB-space blend, as canvas 2D and CSS do), as '#rrggbb'. */
export function blendHex(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  return rgbToHex([f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a)])
}

// ---------- WCAG ----------

const toLinear = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (l: number): number => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055)

/** WCAG 2.x relative luminance, 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ---------- CIELAB / CIEDE2000 ----------

/** CIELAB (D65) [L 0..100, a, b]; also reused for OKLab triples internally. */
export type Lab = [number, number, number]

/** hex -> CIELAB (D65). Parse once and reuse with deltaE2000Lab when comparing a colour many times. */
export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** CIEDE2000 colour difference (kL = kC = kH = 1; Sharma, Wu, Dalal 2005). About 2 is just noticeable. */
export function deltaE2000(hexA: string, hexB: string): number {
  return deltaE2000Lab(hexToLab(hexA), hexToLab(hexB))
}

/** deltaE2000 on colours already converted with hexToLab (no re-parsing: for search loops). */
export function deltaE2000Lab([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hp = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0
    const h = Math.atan2(b, a) / rad
    return h >= 0 ? h : h + 360
  }
  const h1p = hp(a1p, b1)
  const h2p = hp(a2p, b2)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2)
  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbarp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2
    else hbarp = (h1p + h2p - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2)
  const Sc = 1 + 0.045 * Cbarp
  const Sh = 1 + 0.015 * Cbarp * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

// ---------- OKLab / OKLCH ----------

function linearRgbToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** hex -> [L 0..1, C, h degrees 0..360). */
export function hexToOklch(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  const [L, A, B] = linearRgbToOklab(r, g, b)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return [L, Math.hypot(A, B), h]
}

/** OKLCH -> hex, reducing chroma (binary search) until the colour fits in sRGB. */
export function oklchToHex(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180
  const inGamut = (c: number) => oklabToLinearRgb(L, c * Math.cos(rad), c * Math.sin(rad)).every((v) => v >= -1e-4 && v <= 1 + 1e-4)
  let c = C
  if (!inGamut(c)) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(mid)) lo = mid
      else hi = mid
    }
    c = lo
  }
  const [r, g, b] = oklabToLinearRgb(L, c * Math.cos(rad), c * Math.sin(rad))
  const channel = (v: number) => fromLinear(Math.min(1, Math.max(0, v)))
  return rgbToHex([channel(r), channel(g), channel(b)])
}
