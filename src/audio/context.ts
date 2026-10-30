/**
 * The music box's switch (remembered in localStorage) and its audio context, kept out of the
 * time-lapse's chunk so that App can start audio in the click that opens the time-lapse. WebKit
 * lets an AudioContext play only when it was made or resumed while a user gesture was being
 * handled, and the time-lapse controls (with the music box) may mount a network round trip after
 * that click, when their chunk was not loaded yet.
 *
 * Browser only, apart from readSound and writeSound, which also work without storage.
 */
import { SOUND_STORAGE_KEY } from '../storageKeys'

export { SOUND_STORAGE_KEY }

export function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function writeSound(on: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // storage unavailable: the switch still holds for this visit
  }
}

/** a context made in a click, waiting for the music box to take it */
let unlocked: AudioContext | null = null

/** Call from a click: a context made or resumed now may play later, outside the gesture. */
export function unlockAudio(): void {
  if (typeof AudioContext === 'undefined') return
  try {
    unlocked ??= new AudioContext()
    unlocked.resume().catch(() => {})
  } catch {
    // no audio (too many contexts, say): the music box makes its own later
    unlocked = null
  }
}

/** The context unlockAudio made, handed over once; otherwise a new one. */
export function takeAudioContext(): AudioContext {
  const ctx = unlocked ?? new AudioContext()
  unlocked = null
  return ctx
}

/** Closes a context unlockAudio made that nothing took (the time-lapse closed before it loaded). */
export function releaseAudio(): void {
  unlocked?.close().catch(() => {})
  unlocked = null
}
