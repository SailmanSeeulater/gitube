import { describe, expect, it } from 'vitest'
import { THEMES } from '../theme/themes'
import { step } from './ThemePicker'

// The picker lays the themes out four to a row, the dark group above the light one. Up and Down
// keep the column where the next row has it, and never leave the grid.
describe('theme picker grid', () => {
  const dark = THEMES.filter((t) => t.mode === 'dark').length
  const light = THEMES.filter((t) => t.mode === 'light').length
  const last = dark + light - 1

  it('holds the themes it is tested with: 11 dark above 15 light', () => {
    expect([dark, light]).toEqual([11, 15])
  })

  it('moves a row at a time inside a group, keeping the column', () => {
    expect(step(0, 1)).toBe(4)
    expect(step(5, 1)).toBe(9)
    expect(step(9, -1)).toBe(5)
    expect(step(dark + 2, 1)).toBe(dark + 6)
    expect(step(dark + 6, -1)).toBe(dark + 2)
  })

  it('lands on the last tile of a short last row from the row above it', () => {
    // dark's last row holds three tiles (8, 9, 10): column 3 of the row above has nothing under it
    expect(step(7, 1)).toBe(10)
    expect(step(dark + 11, 1)).toBe(last)
  })

  it('crosses between the groups in the same column', () => {
    expect(step(8, 1)).toBe(dark) // dark's last row, column 0 -> light's first row, column 0
    expect(step(10, 1)).toBe(dark + 2)
    expect(step(dark, -1)).toBe(8)
    expect(step(dark + 2, -1)).toBe(10)
    expect(step(dark + 3, -1)).toBe(10) // no column 3 in dark's last row: its last tile
  })

  it('stays put at the top and the bottom, and reaches every tile from every other', () => {
    for (let i = 0; i < 4; i++) expect(step(i, -1)).toBe(i)
    for (let i = dark + 12; i <= last; i++) expect(step(i, 1)).toBe(i)
    expect(step(-1, 1)).toBe(-1)
    for (let i = 0; i <= last; i++) {
      for (const rows of [1, -1] as const) {
        const to = step(i, rows)
        expect(to).toBeGreaterThanOrEqual(0)
        expect(to).toBeLessThanOrEqual(last)
      }
    }
  })
})
