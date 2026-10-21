import { describe, expect, it } from 'vitest'
import {
  BUD_AFTER_DAYS,
  MAX_LEAVES,
  WILT_AFTER_DAYS,
  bloomOf,
  hash01,
  leafSpots,
  petalAngles,
  rootTendrils,
  stemWidthPx,
} from '../src/components/gardenLook'

const NOW = Date.parse('2026-10-21T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

describe('garden look', () => {
  it('blooms fresh tips, closes quiet ones to buds, wilts stale ones', () => {
    expect(bloomOf(daysAgo(0), NOW)).toBe('bloom')
    expect(bloomOf(daysAgo(BUD_AFTER_DAYS - 1), NOW)).toBe('bloom')
    expect(bloomOf(daysAgo(BUD_AFTER_DAYS), NOW)).toBe('bud')
    expect(bloomOf(daysAgo(WILT_AFTER_DAYS - 1), NOW)).toBe('bud')
    expect(bloomOf(daysAgo(WILT_AFTER_DAYS), NOW)).toBe('wilted')
    expect(bloomOf(daysAgo(-3), NOW)).toBe('bloom') // a clock running ahead
    expect(bloomOf('', NOW)).toBe('bud')
  })

  it('thickens stems with reach, within limits', () => {
    expect(stemWidthPx(1)).toBeLessThan(stemWidthPx(4))
    expect(stemWidthPx(4)).toBeLessThan(stemWidthPx(16))
    expect(stemWidthPx(10_000)).toBe(5)
    expect(stemWidthPx(0)).toBe(stemWidthPx(1))
    expect(stemWidthPx(Number.NaN)).toBe(stemWidthPx(1))
  })

  it('spaces leaves evenly along a stem, alternating sides, capped', () => {
    expect(leafSpots(0)).toEqual([])
    expect(leafSpots(3)).toEqual([
      { t: 0.25, side: 1 },
      { t: 0.5, side: -1 },
      { t: 0.75, side: 1 },
    ])
    expect(leafSpots(57)).toHaveLength(MAX_LEAVES)
  })

  it('hashes strings to a stable number in [0, 1)', () => {
    expect(hash01('abc')).toBe(hash01('abc'))
    expect(hash01('abc')).not.toBe(hash01('abd'))
    for (const s of ['', 'a', 'f2f2f2f2', 'feature/x']) {
      expect(hash01(s)).toBeGreaterThanOrEqual(0)
      expect(hash01(s)).toBeLessThan(1)
    }
  })

  it('opens six petals for a bloom, none for a bud, and hangs four for a wilted tip', () => {
    expect(petalAngles('bloom', 0)).toHaveLength(6)
    expect(petalAngles('bud', 0.3)).toEqual([])
    const wilted = petalAngles('wilted', 0.5)
    expect(wilted).toHaveLength(4)
    // all pointing below the horizon (sin > 0 is down on a canvas)
    for (const a of wilted) expect(Math.sin(a)).toBeGreaterThan(0)
  })

  it('reaches roots downward, the same shape every time', () => {
    const roots = rootTendrils(7)
    expect(roots).toHaveLength(4)
    for (const [, , , y] of roots) expect(y).toBeGreaterThan(0)
    expect(rootTendrils(7)).toEqual(roots)
    expect(rootTendrils(8)).not.toEqual(roots)
  })
})
