import { describe, expect, it } from 'vitest'
import { buildFullGraph, buildGraph } from '../src/graph'
import { buildTimeline } from '../src/graph/timeline'
import { BASS, MELODY, buildScore, frequencyOf, notesBetween, pickNotes, pitchOf, type Note } from '../src/graph/score'
import { makeRepo } from './fixtures/repos'

/** main c1..c4, feature forks at c2 (f1, f2) and merges back at m. */
function merged() {
  return makeRepo({
    commits: [['c1'], ['c2', 'c1'], ['c3', 'c2'], ['f1', 'c2'], ['f2', 'f1'], ['m', 'c3', 'f2'], ['c4', 'm']],
    branches: [
      { name: 'main', tip: 'c4', isDefault: true },
      { name: 'feature', tip: 'f2' },
    ],
  })
}

describe('music box score', () => {
  it('gives the default branch the bass and climbs a pentatonic scale for the rest', () => {
    expect(pitchOf(0, true)).toBe(BASS)
    expect([1, 2, 3, 4, 5, 6].map((i) => pitchOf(i, false))).toEqual([60, 62, 64, 67, 69, 72])
    // wraps after three octaves
    expect(pitchOf(16, false)).toBe(MELODY)
  })

  it('plays one note per commit, in time order, merges as chords and tips an octave up', () => {
    const data = merged()
    const graph = buildGraph(data, 'full')
    const score = buildScore(graph, buildTimeline(graph, graph), data.branches.map((b) => b.name), data.defaultBranch)
    expect(score.notes).toHaveLength(7)
    expect([...score.ats]).toEqual([...score.ats].sort((a, b) => a - b))
    const merge = score.notes.find((n) => n.pitches.length === 3)!
    expect(merge.pitches).toEqual([BASS, BASS + 7, BASS + 12])
    const tips = score.notes.filter((n) => n.accent)
    expect(tips.map((n) => n.pitches[0]).sort()).toEqual([BASS + 12, pitchOf(1, false) + 12].sort())
  })

  it('in skeleton view, still plays every commit a link hides, in its branch pitch', () => {
    const data = merged()
    const skeleton = buildGraph(data, 'skeleton')
    const score = buildScore(skeleton, buildTimeline(skeleton, buildFullGraph(data)), ['main', 'feature'], 'main')
    expect(score.notes).toHaveLength(7)
    // f1, hidden in feature's run (main's tip rings at the same C4, but as an accent)
    expect(score.notes.filter((n) => n.pitches[0] === pitchOf(1, false) && !n.accent)).toHaveLength(1)
  })

  it('finds the notes due between two moments, start exclusive', () => {
    const data = merged()
    const graph = buildGraph(data, 'full')
    const score = buildScore(graph, buildTimeline(graph, graph), ['main', 'feature'], 'main')
    expect(notesBetween(score, -1, 1)).toHaveLength(7)
    expect(notesBetween(score, -1, 0)).toHaveLength(1) // c1, at 0
    expect(notesBetween(score, 0, 0)).toHaveLength(0)
    expect(notesBetween(score, 0.5, 0.2)).toHaveLength(0) // backwards: silence
  })

  it('thins a burst: tips and chords first, one note per pitch, in score order', () => {
    const n = (at: number, pitches: number[], accent = false): Note => ({ at, pitches, accent })
    const burst = [n(0.1, [60]), n(0.1, [60]), n(0.1, [62]), n(0.1, [48, 55, 60]), n(0.1, [74], true), n(0.1, [64])]
    // the chord and the tip win places; the first 60 takes the last; they sound in the burst's order
    expect(pickNotes(burst, 3).map((x) => x.pitches[0])).toEqual([60, 48, 74])
    expect(pickNotes(burst.slice(0, 2), 3)).toHaveLength(2)
  })

  it('tunes A4 to 440 Hz', () => {
    expect(frequencyOf(69)).toBe(440)
    expect(frequencyOf(81)).toBeCloseTo(880)
  })
})
