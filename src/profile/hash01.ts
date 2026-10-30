/**
 * A string hashed to [0, 1) (32-bit FNV-1a): a stable per-item offset, so nothing flickers between
 * frames. Callers seed it from days, languages and flags, never a repo's name (privacy.ts).
 */
export function hash01(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x100000000
}
