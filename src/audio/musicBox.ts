/**
 * The music box's instrument (Web Audio): a soft plucked tone per note with a short echo, through
 * a limiter so a busy week never clips. It plays to the speakers and to `stream`, which the video
 * recorder mixes into a recording. Browser only; create it from a click (browsers keep audio
 * suspended until the page has had a gesture).
 */
import { frequencyOf, type Note } from '../graph/score'

/** Loudness of one plain note before the limiter, and of a tip. */
const NOTE_GAIN = 0.22
const ACCENT_GAIN = 0.32
/** How long a note rings, and a tip. */
const NOTE_S = 0.7
const ACCENT_S = 1.4
/** The echo: delay, how much comes back, and how loud it is. */
const ECHO_S = 0.19
const ECHO_FEEDBACK = 0.28
const ECHO_MIX = 0.22

export class MusicBox {
  private readonly ctx: AudioContext
  private readonly input: GainNode
  /** the mix as a MediaStream, for recording */
  readonly stream: MediaStream

  constructor() {
    const ctx = new AudioContext()
    this.ctx = ctx
    this.input = ctx.createGain()

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -12
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.2

    const echo = ctx.createDelay(1)
    echo.delayTime.value = ECHO_S
    const feedback = ctx.createGain()
    feedback.gain.value = ECHO_FEEDBACK
    const wet = ctx.createGain()
    wet.gain.value = ECHO_MIX
    this.input.connect(echo)
    echo.connect(feedback)
    feedback.connect(echo)
    echo.connect(wet)

    this.input.connect(limiter)
    wet.connect(limiter)
    const out = ctx.createMediaStreamDestination()
    limiter.connect(ctx.destination)
    limiter.connect(out)
    this.stream = out.stream
  }

  /** Browsers start audio suspended; call from a click before playing. */
  resume(): Promise<void> {
    return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve()
  }

  play(note: Note): void {
    const ctx = this.ctx
    const t = ctx.currentTime
    const ring = note.accent ? ACCENT_S : NOTE_S
    const peak = (note.accent ? ACCENT_GAIN : NOTE_GAIN) / Math.sqrt(note.pitches.length)
    for (const pitch of note.pitches) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = frequencyOf(pitch)
      const env = ctx.createGain()
      env.gain.setValueAtTime(0, t)
      env.gain.linearRampToValueAtTime(peak, t + 0.006)
      env.gain.exponentialRampToValueAtTime(0.0001, t + ring)
      osc.connect(env)
      env.connect(this.input)
      osc.start(t)
      osc.stop(t + ring + 0.05)
      osc.onended = () => env.disconnect()
    }
  }

  close(): void {
    void this.ctx.close()
  }
}
