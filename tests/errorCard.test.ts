/**
 * The error card's markup for every code, as the repo garden renders it. The snapshot was taken
 * before the card took its optional title and hint (person mode's user wording), so it proves the
 * repo garden's cards unchanged: repo mode never passes either.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ErrorCard, { type ErrorCardProps, type ErrorCode } from '../src/components/ErrorCard'
import { formatClock } from '../src/components/gardenUtils'

const CODES = Object.keys({
  not_found: 1,
  not_a_user: 1,
  rate_limited: 1,
  unauthorized: 1,
  network: 1,
  invalid_url: 1,
  aborted: 1,
  empty_repo: 1,
  unknown: 1,
  bad_file: 1,
  export_failed: 1,
  chunk_failed: 1,
} satisfies Record<ErrorCode, 1>) as ErrorCode[]

const RESET = '2026-10-25T14:05:00Z'
const noop = () => {}

/** The card's markup; the reset time reads in the local time zone, so it is folded to HH:MM. */
function render(props: ErrorCardProps): string {
  const html = renderToStaticMarkup(h(ErrorCard, props))
  const clock = formatClock(RESET)
  return clock ? html.split(clock).join('HH:MM') : html
}

/** Every prop the repo garden passes, its actions included. */
const full = (code: ErrorCode): ErrorCardProps => ({
  code,
  message: 'the reason given',
  resetAt: RESET,
  onAddToken: noop,
  onReload: noop,
  onDismiss: noop,
})

describe('ErrorCard', () => {
  it('renders every code as it always has', () => {
    for (const code of CODES) {
      expect(render({ code }), `${code}, bare`).toMatchSnapshot(`${code}, bare`)
      expect(render(full(code)), `${code}, with every prop`).toMatchSnapshot(`${code}, with every prop`)
    }
  })

  it('shows a given title and hint in place of the code copy, and nothing else changes', () => {
    const base = render(full('not_found'))
    const worded = render({ ...full('not_found'), title: 'user not found', hint: 'check the spelling.' })
    expect(worded).toBe(
      base
        .replace('>repo not found<', '>user not found<')
        .replace('>check the spelling. private repos only appear with a token that can read them.<', '>check the spelling.<'),
    )
    // the token action stays the code's own
    expect(worded).toContain('add a token')
    // either one alone
    expect(render({ code: 'unauthorized', hint: 'edit or clear it.' })).toContain('GitHub rejected the token')
    expect(render({ code: 'unauthorized', hint: 'edit or clear it.' })).toContain('>edit or clear it.<')
    expect(render({ code: 'unauthorized', title: 'token refused' })).toContain('it may be expired')
  })
})
