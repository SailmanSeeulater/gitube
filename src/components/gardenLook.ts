/**
 * The garden layout's look as plain numbers: how a tip blooms by age, how thick a stem is, where
 * leaves and petals go, how roots reach down. Garden turns these into canvas paths (gardenPaint).
 * Deterministic: a node always gets the same leaves and roots, so nothing flickers between frames.
 */

/** A tip's state by how long its branch has been quiet. */
export type Bloom = 'bloom' | 'bud' | 'wilted'

/** A tip quiet this long has closed back to a bud... */
export const BUD_AFTER_DAYS = 30
/** ...and this long, it has wilted. */
export const WILT_AFTER_DAYS = 180

const DAY_MS = 24 * 60 * 60 * 1000

export function bloomOf(date: string, now: number): Bloom {
  const t = Date.parse(date)
  if (!Number.isFinite(t)) return 'bud'
  const days = (now - t) / DAY_MS
  if (days >= WILT_AFTER_DAYS) return 'wilted'
  if (days >= BUD_AFTER_DAYS) return 'bud'
  return 'bloom'
}

/** How far a stem into a wilted tip sags, as a share of its length. */
export const DROOP = 0.35

/** Stem width in screen px: thicker where more branches share the stem (the trunk). */
export function stemWidthPx(reach: number): number {
  const r = Number.isFinite(reach) && reach > 0 ? reach : 1
  return Math.min(5, 0.8 + 0.9 * Math.sqrt(r))
}

/** Leaves drawn along a skeleton stem: one per hidden commit, up to this many. */
export const MAX_LEAVES = 6

/** Where leaves sit along a stem (t from parent 0 to child 1), alternating sides. */
export function leafSpots(hidden: number): Array<{ t: number; side: 1 | -1 }> {
  const n = Math.min(MAX_LEAVES, Math.max(0, Math.floor(hidden)))
  return Array.from({ length: n }, (_, i) => ({ t: (i + 1) / (n + 1), side: i % 2 === 0 ? 1 : -1 }))
}

/** A stable number in [0, 1) for a string (FNV-1a): per-node turns, leaf tilts, root shapes. */
export function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}

/**
 * Petal directions (radians, canvas angles: 0 = right, PI/2 = down) for a tip's flower, turned by
 * a per-node amount. An open bloom spreads six evenly; a wilted one hangs four, bunched downward.
 */
export function petalAngles(bloom: Bloom, turn: number): number[] {
  if (bloom === 'wilted') {
    const down = Math.PI / 2
    return [-0.9, -0.3, 0.3, 0.9].map((d) => down + d + (turn - 0.5) * 0.4)
  }
  const n = bloom === 'bloom' ? 6 : 0
  return Array.from({ length: n }, (_, i) => (i / n) * Math.PI * 2 + turn * Math.PI)
}

/**
 * Root tendrils under a node whose history was cut off: each [cx, cy, x, y], a quadratic curve
 * from the node (0, 0) through (cx, cy) to (x, y), in units of `length`, reaching downward.
 */
export function rootTendrils(seed: number, count = 4): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = []
  for (let i = 0; i < count; i++) {
    const u = hash01(`${seed}:${i}`)
    // fan from down-left to down-right, each a little bent
    const spread = (i / Math.max(1, count - 1) - 0.5) * 1.6 + (u - 0.5) * 0.3
    const reach = 0.7 + u * 0.5
    const x = Math.sin(spread) * reach
    const y = Math.cos(spread) * reach
    out.push([x * 0.3 + (u - 0.5) * 0.4, y * 0.55, x, y])
  }
  return out
}
