import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSound, releaseAudio, takeAudioContext, unlockAudio, writeSound } from './context'

/** Just enough of an AudioContext: resume() and close() and their effect on state. */
class FakeAudioContext {
  static all: FakeAudioContext[] = []
  static get made() {
    return FakeAudioContext.all.length
  }
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  constructor() {
    FakeAudioContext.all.push(this)
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  close() {
    this.state = 'closed'
    return Promise.resolve()
  }
}

describe('audio context hand-over', () => {
  afterEach(() => {
    releaseAudio()
    vi.unstubAllGlobals()
    FakeAudioContext.all = []
  })

  it('does nothing without Web Audio', () => {
    expect(() => unlockAudio()).not.toThrow()
  })

  it('hands the context made in a click to the music box, once', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    unlockAudio()
    unlockAudio()
    expect(FakeAudioContext.made).toBe(1)
    const ctx = takeAudioContext() as unknown as FakeAudioContext
    expect(ctx.state).toBe('running')
    // taken: the next music box makes its own
    const next = takeAudioContext() as unknown as FakeAudioContext
    expect(next).not.toBe(ctx)
    expect(FakeAudioContext.made).toBe(2)
  })

  it('closes a context nobody took, and leaves a taken one alone', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    unlockAudio()
    const taken = takeAudioContext() as unknown as FakeAudioContext
    unlockAudio()
    releaseAudio()
    const [, untaken] = FakeAudioContext.all
    expect(untaken.state).toBe('closed')
    expect(taken.state).toBe('running')
    // released, so the next take makes a new one
    expect(takeAudioContext()).not.toBe(untaken)
  })

  it('keeps the music box switch, and reads off without storage', () => {
    expect(readSound()).toBe(false)
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    writeSound(true)
    expect(readSound()).toBe(true)
    writeSound(false)
    expect(readSound()).toBe(false)
  })
})
