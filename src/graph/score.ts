/**
 * The music box: the time-lapse as a score. Every commit plays a note as it appears; each branch
 * has its own pitch on a pentatonic scale (so any mix of branches sounds consonant), the default
 * branch plays the bass, merges strike a chord and branch tips ring an octave higher. Busy weeks
 * come out as fast runs, quiet months as rests: the tempo is the repo's.
 *
 * Pure. Pitches are MIDI note numbers.
 */
import type { GraphBody } from './build'
import { linkKey } from './contributors'
import { countUpTo, type Timeline } from './timeline'

export interface Note {
  /** time-lapse progress at which it sounds */
  at: number
  /** MIDI pitches struck together */
  pitches: number[]
  /** a branch tip: louder and longer */
  accent: boolean
}

export interface Score {
  /** by at, ascending */
  notes: Note[]
  /** notes[i].at, for searching */
  ats: Float64Array
}

/** The default branch's pitch: C3. */
export const BASS = 48
/** Other branches climb a major pentatonic scale from C4, wrapping after three octaves. */
export const MELODY = 60
const PENTATONIC = [0, 2, 4, 7, 9] as const

/** A branch's pitch from its place in the repo's branch list (the palette's order). */
export function pitchOf(branchIndex: number, isDefault: boolean): number {
  if (isDefault) return BASS
  const k = Math.max(0, branchIndex - 1)
  return MELODY + PENTATONIC[k % PENTATONIC.length] + 12 * (Math.floor(k / PENTATONIC.length) % 3)
}

/**
 * The score of the shown graph: one note per commit the timeline knows (shown nodes, and the
 * commits skeleton links hide), in the pitch of the branch that owns it.
 *
 * @param branches the repo's branch names in data order (which assigns the palette, and pitches)
 */
export function buildScore(shown: GraphBody, timeline: Timeline, branches: ReadonlyArray<string>, defaultBranch: string): Score {
  const others = branches.filter((b) => b !== defaultBranch)
  const pitch = new Map<string, number>([[defaultBranch, pitchOf(0, true)]])
  others.forEach((name, i) => pitch.set(name, pitchOf(i + 1, false)))
  const pitchFor = (branch: string): number => pitch.get(branch) ?? MELODY

  const notes: Note[] = []
  for (const node of shown.nodes) {
    const at = timeline.nodeAt.get(node.id)
    if (at === undefined) continue
    const p = pitchFor(node.owner)
    if (node.isMerge) notes.push({ at, pitches: [p, p + 7, p + 12], accent: false })
    else if (node.isTip) notes.push({ at, pitches: [p + 12], accent: true })
    else notes.push({ at, pitches: [p], accent: false })
  }
  for (const link of shown.links) {
    const run = timeline.runAt.get(linkKey(link.source, link.target))
    if (!run) continue
    const p = pitchFor(link.owner)
    for (const at of run) notes.push({ at, pitches: [p], accent: false })
  }
  notes.sort((a, b) => a.at - b.at || b.pitches.length - a.pitches.length || a.pitches[0] - b.pitches[0])
  return { notes, ats: Float64Array.from(notes, (n) => n.at) }
}

/** The notes that sound as progress moves from `from` (exclusive) to `to` (inclusive). */
export function notesBetween(score: Score, from: number, to: number): Note[] {
  if (!(to > from)) return []
  return score.notes.slice(countUpTo(score.ats, from), countUpTo(score.ats, to))
}

/**
 * At most `max` of the notes due in one frame, so a burst of commits is a flourish, not a wall of
 * sound: tips and chords first, then one note per pitch, in score order.
 */
export function pickNotes(due: ReadonlyArray<Note>, max: number): Note[] {
  if (due.length <= max) return [...due]
  const ranked = due
    .map((note, i) => ({ note, i, weight: (note.accent ? 2 : 0) + (note.pitches.length > 1 ? 1 : 0) }))
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
  const out: Array<{ note: Note; i: number }> = []
  const seen = new Set<number>()
  for (const r of ranked) {
    if (out.length >= max) break
    if (seen.has(r.note.pitches[0])) continue
    seen.add(r.note.pitches[0])
    out.push(r)
  }
  return out.sort((a, b) => a.i - b.i).map((r) => r.note)
}

/** Hz of a MIDI pitch (A4 = 69 = 440 Hz). */
export function frequencyOf(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12)
}
