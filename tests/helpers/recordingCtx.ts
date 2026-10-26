/**
 * A stand-in for CanvasRenderingContext2D in node, for painter tests: it records every method call
 * and every property set in order, each call with the styles in force when it ran, so a test can
 * read what was drawn, in which colour and with which text. Any method a painter calls exists (it
 * records and returns undefined), except for the few that answer something: measureText (6 px per
 * character), getTransform, and save and restore, which keep a real stack of the styles.
 */

/** The state a call ran under. */
export interface CtxStyle {
  fillStyle: unknown
  strokeStyle: unknown
  globalAlpha: unknown
  lineWidth: unknown
  font: unknown
}

export type CtxEntry =
  | { kind: 'call'; name: string; args: unknown[]; style: CtxStyle }
  | { kind: 'set'; name: string; value: unknown }

export interface RecordingCtx {
  /** cast for painters that take a real context */
  ctx: CanvasRenderingContext2D
  log: CtxEntry[]
  /** every call of one method, in order */
  calls: (name: string) => Array<Extract<CtxEntry, { kind: 'call' }>>
  /** every value one property was set to, in order */
  sets: (name: string) => unknown[]
  /** every string passed to fillText, strokeText or measureText */
  texts: () => string[]
  clear: () => void
}

/** What measureText answers per character. */
export const CHAR_PX = 6

export function recordingCtx(width = 1280, height = 800): RecordingCtx {
  const log: CtxEntry[] = []
  let state: Record<string, unknown> = {
    fillStyle: 'unset',
    strokeStyle: 'unset',
    globalAlpha: 1,
    lineWidth: 1,
    font: 'unset',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    transform: [1, 0, 0, 1, 0, 0],
  }
  const stack: Array<Record<string, unknown>> = []
  const canvas = { width, height }
  const style = (): CtxStyle => ({
    fillStyle: state.fillStyle,
    strokeStyle: state.strokeStyle,
    globalAlpha: state.globalAlpha,
    lineWidth: state.lineWidth,
    font: state.font,
  })
  const record = (name: string, args: unknown[]) => log.push({ kind: 'call', name, args, style: style() })

  const special: Record<string, (...args: unknown[]) => unknown> = {
    measureText: (text) => {
      record('measureText', [text])
      return { width: CHAR_PX * String(text).length }
    },
    save: () => {
      record('save', [])
      stack.push({ ...state })
    },
    restore: () => {
      record('restore', [])
      const prev = stack.pop()
      if (prev) state = prev
    },
    setTransform: (...args) => {
      record('setTransform', args)
      state.transform = args.slice(0, 6)
    },
    getTransform: () => {
      const [a, b, c, d, e, f] = state.transform as number[]
      return { a, b, c, d, e, f }
    },
  }

  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop === 'canvas') return canvas
      if (prop in special) return special[prop]
      if (prop in state) return state[prop]
      return (...args: unknown[]) => {
        record(prop, args)
      }
    },
    set(_target, prop, value) {
      if (typeof prop !== 'string') return false
      log.push({ kind: 'set', name: prop, value })
      state[prop] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D

  const calls = (name: string) => log.filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && e.name === name)
  return {
    ctx,
    log,
    calls,
    sets: (name) => log.filter((e) => e.kind === 'set' && e.name === name).map((e) => (e as Extract<CtxEntry, { kind: 'set' }>).value),
    texts: () =>
      log.flatMap((e) => (e.kind === 'call' && (e.name === 'fillText' || e.name === 'strokeText' || e.name === 'measureText') ? [String(e.args[0])] : [])),
    clear: () => {
      log.length = 0
    },
  }
}
