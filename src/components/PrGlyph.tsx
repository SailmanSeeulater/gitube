import type { ReactNode } from 'react'
import type { ChecksState, PrMark, PullSummary, ReviewState } from '../types'
import type { Theme } from '../theme/themes'
import { useTheme } from '../theme/useTheme'
import { DOT_PITCH, DOT_WIDTH, TRACK_ALPHA, checksTone, checksWords, checksWordsShort, prRingArcs, reviewTone, reviewWords, toneColour, type PrRingOptions, type PrTone } from './prMark'

type MarkLike = Pick<PrMark, 'review' | 'checks' | 'draft'>

const f = (n: number) => Math.round(n * 100) / 100

function arcPath(cx: number, cy: number, R: number, a0: number, a1: number): string {
  const x0 = cx + R * Math.cos(a0)
  const y0 = cy + R * Math.sin(a0)
  const x1 = cx + R * Math.cos(a1)
  const y1 = cy + R * Math.sin(a1)
  return `M${f(x0)} ${f(y0)}A${f(R)} ${f(R)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(x1)} ${f(y1)}`
}

/**
 * The ring's arcs as SVG paths round (cx, cy), in screen px, as the canvas draws them. neutral: the
 * colour of a half not looked up yet (the outline the glyph has without a pull request).
 */
export function PrRingPaths({
  cx,
  cy,
  R,
  w,
  mark,
  theme,
  neutral,
  opts,
}: {
  cx: number
  cy: number
  R: number
  w: number
  mark: MarkLike
  theme: Theme
  neutral: string
  opts?: PrRingOptions
}) {
  return (
    <>
      {prRingArcs(R, w, mark, 1, opts).map((arc, i) => (
        <path
          key={i}
          d={arcPath(cx, cy, R, arc.a0, arc.a1)}
          fill="none"
          stroke={arc.unknown ? neutral : toneColour(theme, arc.tone)}
          strokeOpacity={arc.track ? TRACK_ALPHA : undefined}
          strokeWidth={arc.dotted ? w * DOT_WIDTH : w}
          strokeLinecap={arc.dotted ? 'round' : 'butt'}
          strokeDasharray={arc.dotted ? `0.01 ${f(w * DOT_PITCH)}` : undefined}
        />
      ))}
    </>
  )
}

/**
 * A branch row's 14 px swatch: today's 10 px dot, or (with a pull request) a 6.6 px dot in a small
 * pull request ring. Rows only switch to it once the repo has a pull request on some branch.
 */
export function PrSwatch({ colour, mark }: { colour: string; mark: MarkLike | null }) {
  const theme = useTheme()
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      {mark ? (
        <>
          <circle cx={7} cy={7} r={3.3} fill={colour} />
          <PrRingPaths cx={7} cy={7} R={5.9} w={1.7} mark={mark} theme={theme} neutral={colour} opts={{ gapPx: 2.2, breakPx: 2.6 }} />
        </>
      ) : (
        <circle cx={7} cy={7} r={5} fill={colour} />
      )}
    </svg>
  )
}

/** One half of the ring (review on the left, checks on the right), 12 px, beside its words. */
export function PrHalfGlyph({ side, state }: { side: 'review'; state: ReviewState } | { side: 'checks'; state: ChecksState }) {
  const theme = useTheme()
  const mark: MarkLike = side === 'review' ? { review: state, checks: 'none', draft: false } : { review: 'waiting', checks: state, draft: false }
  // the half sits over the middle of its box: its centre is pushed towards the open side
  const cx = side === 'review' ? 8.5 : 3.5
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <PrRingPaths cx={cx} cy={6} R={4.4} w={1.7} mark={mark} theme={theme} neutral={theme.muted} opts={{ sides: [side], gapPx: 1.5, breakPx: 2.4 }} />
    </svg>
  )
}

/** Text colour of a tone: success, warn and danger read as text; muted stays the line's muted. */
const TONE_TEXT: Record<PrTone, string> = {
  success: 'text-ui-success',
  warn: 'text-ui-warn',
  danger: 'text-ui-danger',
  muted: '',
}

/**
 * "◖ no review yet  ◗ 2 of 30 checks failing" (or "review required" where a branch rule wants
 * approvals): a pull request's two halves in words, each by its half of the ring. compact (the selected branch row) leaves out how many reviewers were asked.
 */
export function PrStatusLine({ pr, compact = false, children }: { pr: PullSummary; compact?: boolean; children?: ReactNode }) {
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-y-0.5 text-ui-muted ${compact ? 'gap-x-2.5' : 'gap-x-3'}`}>
      <span className={`flex items-center gap-1 ${TONE_TEXT[reviewTone(pr.review)]}`}>
        <PrHalfGlyph side="review" state={pr.review} />
        {reviewWords(pr)}
        {!compact && pr.reviewersAsked !== null && pr.reviewersAsked > 0 && pr.review !== 'approved' && (
          <span className="text-ui-muted"> · {pr.reviewersAsked} asked</span>
        )}
      </span>
      <span className={`flex items-center gap-1 ${TONE_TEXT[checksTone(pr.checks)]}`}>
        <PrHalfGlyph side="checks" state={pr.checks} />
        {compact ? checksWordsShort(pr) : checksWords(pr)}
      </span>
      {children}
    </span>
  )
}

/** A whole mark round a dot in a branch colour (the inspector's rows). */
export function PrGlyph({ mark, colour, size = 16 }: { mark: MarkLike; colour: string; size?: number }) {
  const theme = useTheme()
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <circle cx={c} cy={c} r={size * 0.24} fill={colour} />
      <PrRingPaths cx={c} cy={c} R={size * 0.4} w={size * 0.13} mark={mark} theme={theme} neutral={colour} opts={{ gapPx: 2.2, breakPx: 2.8 }} />
    </svg>
  )
}
