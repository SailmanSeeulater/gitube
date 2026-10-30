import type { ProfileData } from '../types'
import type { Theme } from '../theme/themes'
import type { PersonView } from '../share/shareUrl'
import { DORMANT_DAYS, githubDay, type LifeTimeline } from './timeline'
import { LockIcon } from './personIcons'
import { htopLanguageSlots } from './htopLayout'
import { htopRowColour } from './htopPaint'
import { gitLogSlots } from './gitLogLayout'
import { branchColour } from './gitLogPaint'
import { minimapTones } from './minimapLayout'
import { toneColour } from './minimapPaint'

type GlyphKind =
  // every view's
  | 'milestone'
  | 'lock'
  // life lines'
  | 'run'
  | 'dormant'
  | 'start'
  | 'joined'
  | 'stub'
  | 'terminus'
  | 'station'
  | 'dotted'
  | 'landed-station'
  // the constellation's
  | 'size'
  | 'glow'
  | 'hollow'
  | 'twin'
  | 'dry-star'
  | 'link'
  | 'faint'
  | 'landed-tick'
  // phosphor's
  | 'blocks'
  | 'head'
  | 'hollow-head'
  | 'dim-stack'
  | 'faint-stack'
  | 'landed-block'
  // htop's
  | 'meter'
  | 'busy'
  | 'idle'
  | 'dry-meter'
  | 'half-meter'
  | 'landed-cell'
  // the git log's
  | 'branch'
  | 'hollow-commit'
  | 'end'
  | 'tag'
  | 'landed-commit'
  // the minimap's
  | 'token'
  | 'whitespace'
  | 'comment'
  | 'hollow-token'
  | 'landed-token'
  // the helix's
  | 'coil'
  | 'far-coil'
  | 'wound'
  | 'dashed-coil'
  | 'dim-coil'
  | 'faint-coil'
  | 'landed-coil'

/** The views' glyphs in the active theme, in the accent, the colour of the leading language. */
function Glyph({ kind, theme }: { kind: GlyphKind; theme: Theme }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true as const }
  const colour = theme.accent
  /** an archived repo's colour, and the horizon's */
  const dry = theme.derived.dry
  const horizon = theme.derived.horizon
  /** a life line's thin dormant stretch, behind a mark on it */
  const track = <line x1="1" y1="9" x2="17" y2="9" stroke={colour} strokeWidth="1" />
  switch (kind) {
    case 'milestone':
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="17" y2="9" stroke={horizon} strokeWidth="1.5" />
          <path d="M9 5L13 9L9 13L5 9Z" fill={theme.accent} stroke={theme.derived.textHalo} strokeWidth="1.5" paintOrder="stroke" />
        </svg>
      )
    case 'lock':
      return (
        <span className="text-ui-muted">
          <LockIcon size={18} />
        </span>
      )
    // life lines: a run of activity thick, a dormant stretch thin
    case 'run':
      return (
        <svg {...common}>
          <line x1="3" y1="9" x2="15" y2="9" stroke={colour} strokeWidth="4" strokeLinecap="round" />
        </svg>
      )
    case 'dormant':
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="17" y2="9" stroke={colour} strokeWidth="1" />
        </svg>
      )
    // where their part in it starts: filled on their own repos, hollow on one they contributed to
    case 'start':
      return (
        <svg {...common}>
          <line x1="6" y1="9" x2="16" y2="9" stroke={colour} strokeWidth="4" strokeLinecap="round" />
          <circle cx="6" cy="9" r="3.5" fill={colour} stroke={theme.canvas} strokeWidth="1.5" />
        </svg>
      )
    case 'joined':
      return (
        <svg {...common}>
          <line x1="6" y1="9" x2="16" y2="9" stroke={colour} strokeWidth="4" strokeLinecap="round" />
          <circle cx="6" cy="9" r="3.5" fill={theme.canvas} stroke={colour} strokeWidth="1.5" />
        </svg>
      )
    // a fork branches off at its start
    case 'stub':
      return (
        <svg {...common}>
          <line x1="3" y1="3" x2="8" y2="9" stroke={colour} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="8" y1="9" x2="16" y2="9" stroke={colour} strokeWidth="4" strokeLinecap="round" />
          <circle cx="8" cy="9" r="3" fill={colour} stroke={theme.canvas} strokeWidth="1.5" />
        </svg>
      )
    // an archived line, drawn dry, ends at a bar
    case 'terminus':
      return (
        <svg {...common}>
          <line x1="2" y1="9" x2="12" y2="9" stroke={dry} strokeWidth="3" strokeLinecap="round" />
          <line x1="13" y1="4" x2="13" y2="14" stroke={dry} strokeWidth="1.5" />
        </svg>
      )
    // a milestone of the repo, on its line
    case 'station':
      return (
        <svg {...common}>
          {track}
          <circle cx="9" cy="9" r="3.5" fill={theme.canvas} stroke={theme.text} strokeWidth="1.5" />
        </svg>
      )
    case 'dotted':
      return (
        <svg {...common}>
          <line x1="2" y1="9" x2="16" y2="9" stroke={colour} strokeWidth="1.4" strokeDasharray="1.5 3" />
        </svg>
      )
    // a landed pull request: a filled station in the accent on the line
    case 'landed-station':
      return (
        <svg {...common}>
          {track}
          <circle cx="9" cy="9" r="3.5" fill={theme.accent} stroke={theme.canvas} strokeWidth="1.5" />
        </svg>
      )
    // the constellation: a star's size, its glow, and its kinds
    case 'size':
      return (
        <svg {...common}>
          <circle cx="4.5" cy="12" r="2.2" fill={colour} />
          <circle cx="11.5" cy="8" r="5" fill={colour} />
        </svg>
      )
    case 'glow':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="8.5" fill={colour} opacity="0.1" />
          <circle cx="9" cy="9" r="6.8" fill={colour} opacity="0.16" />
          <circle cx="9" cy="9" r="5" fill={colour} opacity="0.24" />
          <circle cx="9" cy="9" r="3" fill={colour} />
        </svg>
      )
    case 'hollow':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={theme.canvas} stroke={colour} strokeWidth="1.5" />
        </svg>
      )
    case 'twin':
      return (
        <svg {...common}>
          <circle cx="7.5" cy="10.5" r="3.5" fill={colour} />
          <circle cx="11.7" cy="6.3" r="1.4" fill={colour} />
        </svg>
      )
    case 'dry-star':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.5" fill={dry} />
        </svg>
      )
    case 'link':
      return (
        <svg {...common}>
          <line x1="4" y1="13" x2="14" y2="5" stroke={theme.muted} strokeWidth="1" opacity="0.6" />
          <circle cx="4" cy="13" r="2" fill={colour} />
          <circle cx="14" cy="5" r="2.6" fill={colour} />
        </svg>
      )
    case 'faint':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="1.6" fill={colour} opacity="0.55" />
        </svg>
      )
    // a landed pull request: a diamond in the accent at the star's upper left
    case 'landed-tick':
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="4" fill={colour} />
          <path d="M5 2L8 5L5 8L2 5Z" fill={theme.accent} stroke={theme.derived.textHalo} strokeWidth="1.5" paintOrder="stroke" />
        </svg>
      )
    // phosphor: a stack of blocks, brighter toward its head
    case 'blocks':
      return (
        <svg {...common}>
          {horizon}
          <rect x="7" y="10.5" width="4" height="2.5" fill={colour} opacity="0.4" />
          <rect x="7" y="7" width="4" height="2.5" fill={colour} opacity="0.65" />
          <rect x="7" y="3.5" width="4" height="2.5" fill={colour} />
        </svg>
      )
    // a starred repo's head block, bigger, in a halo
    case 'head':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="12" height="12" fill={colour} opacity="0.25" />
          <rect x="5.5" y="5.5" width="7" height="7" fill={colour} />
        </svg>
      )
    case 'hollow-head':
      return (
        <svg {...common}>
          <rect x="5.5" y="5.5" width="7" height="7" fill="none" stroke={colour} strokeWidth="1.2" />
        </svg>
      )
    case 'dim-stack':
      return (
        <svg {...common}>
          {horizon}
          <rect x="7" y="10.5" width="4" height="2.5" fill={dry} />
          <rect x="7" y="7" width="4" height="2.5" fill={dry} />
        </svg>
      )
    case 'faint-stack':
      return (
        <svg {...common}>
          {horizon}
          <rect x="7" y="10.5" width="4" height="2.5" fill={colour} opacity="0.45" />
        </svg>
      )
    // a landed pull request: a bright diamond over the block at its day's height
    case 'landed-block':
      return (
        <svg {...common}>
          {horizon}
          <rect x="7" y="10.5" width="4" height="2.5" fill={colour} opacity="0.4" />
          <rect x="7" y="7" width="4" height="2.5" fill={colour} opacity="0.65" />
          <rect x="7" y="3.5" width="4" height="2.5" fill={colour} />
          <path d="M9 4.5L12.5 8.25L9 12L5.5 8.25Z" fill={theme.accent} />
        </svg>
      )
    // htop: a meter of ticks between brackets, brighter the busier
    case 'meter':
      return (
        <svg {...common}>
          <path d="M3 5H1.5V13H3 M15 5H16.5V13H15" fill="none" stroke={theme.muted} strokeWidth="1" />
          {[4, 6, 8, 10, 12].map((x) => (
            <rect key={x} x={x} y="6" width="1" height="6" fill={colour} />
          ))}
        </svg>
      )
    case 'busy':
      return (
        <svg {...common}>
          {[2, 4, 6].map((x) => (
            <rect key={x} x={x} y="6" width="1" height="6" fill={colour} opacity="0.45" />
          ))}
          {[10, 12, 14].map((x) => (
            <rect key={x} x={x} y="6" width="1" height="6" fill={colour} />
          ))}
        </svg>
      )
    case 'idle':
      return (
        <svg {...common}>
          <rect x="1" y="8.5" width="16" height="1" fill={colour} opacity="0.5" />
        </svg>
      )
    case 'half-meter':
      return (
        <svg {...common}>
          {[3, 5, 7, 9, 11, 13].map((x) => (
            <rect key={x} x={x} y="6" width="1" height="6" fill={colour} opacity="0.5" />
          ))}
        </svg>
      )
    case 'dry-meter':
      return (
        <svg {...common}>
          {[3, 5, 7, 9, 11].map((x) => (
            <rect key={x} x={x} y="6" width="1" height="6" fill={dry} />
          ))}
        </svg>
      )
    // a landed pull request: a cell in the accent, full height, among the ticks
    case 'landed-cell':
      return (
        <svg {...common}>
          {[3, 5, 11, 13].map((x) => (
            <rect key={x} x={x} y="6" width="1" height="6" fill={colour} opacity="0.6" />
          ))}
          <rect x="7" y="3.5" width="3" height="11" fill={theme.accent} />
        </svg>
      )
    // the git log: a branch forking off the trunk, with its commits
    case 'branch':
      return (
        <svg {...common}>
          <line x1="1" y1="15" x2="17" y2="15" stroke={theme.muted} strokeWidth="1.2" />
          <path d="M3 15V9L6 6H17" fill="none" stroke={colour} strokeWidth="1.4" />
          <circle cx="9" cy="6" r="1.8" fill={colour} />
          <circle cx="14" cy="6" r="1.8" fill={colour} />
        </svg>
      )
    case 'hollow-commit':
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="17" y2="9" stroke={colour} strokeWidth="1.4" />
          <circle cx="9" cy="9" r="2.6" fill={theme.canvas} stroke={colour} strokeWidth="1.2" />
        </svg>
      )
    // an archived branch ends in a "*"
    case 'end':
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="9" y2="9" stroke={colour} strokeWidth="1.4" />
          <circle cx="12" cy="9" r="4.5" fill={theme.canvas} stroke={colour} strokeWidth="1" />
          <path d="M12 6V12 M9.4 7.5L14.6 10.5 M9.4 10.5L14.6 7.5" stroke={colour} strokeWidth="1.2" />
        </svg>
      )
    // a landed pull request: a merge dot in the tag colour on the branch
    case 'landed-commit':
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="17" y2="9" stroke={colour} strokeWidth="1.4" />
          <circle cx="9" cy="9" r="3.4" fill={theme.accent} stroke={theme.canvas} strokeWidth="1" />
        </svg>
      )
    // a milestone: a tag on the trunk
    case 'tag':
      return (
        <svg {...common}>
          <line x1="1" y1="14" x2="17" y2="14" stroke={theme.muted} strokeWidth="1.2" />
          <path d="M5 5H11L14 8L11 11H5Z" fill={theme.accent} />
        </svg>
      )
    // the helix: a turn of a thread, thick where busy and thin where dormant
    case 'coil':
      return (
        <svg {...common}>
          <path d="M1 9 C4 2, 7 2, 9 9" fill="none" stroke={colour} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M9 9 C11 16, 14 16, 17 9" fill="none" stroke={colour} strokeWidth="1" strokeLinecap="round" />
        </svg>
      )
    // the far side of the coil, dimmer
    case 'far-coil':
      return (
        <svg {...common}>
          <path d="M1 9 C4 2, 7 2, 9 9" fill="none" stroke={colour} strokeWidth="2" strokeLinecap="round" />
          <path d="M9 9 C11 16, 14 16, 17 9" fill="none" stroke={colour} strokeWidth="2" strokeLinecap="round" opacity="0.45" />
        </svg>
      )
    // where a thread is wound on: a dot
    case 'wound':
      return (
        <svg {...common}>
          <path d="M5 9 C8 2, 12 2, 17 9" fill="none" stroke={colour} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="5" cy="9" r="2.4" fill={colour} />
        </svg>
      )
    case 'dashed-coil':
      return (
        <svg {...common}>
          <path d="M1 9 C4 2, 7 2, 9 9 C11 16, 14 16, 17 9" fill="none" stroke={colour} strokeWidth="1.8" strokeDasharray="3 2.5" strokeLinecap="round" />
        </svg>
      )
    case 'dim-coil':
      return (
        <svg {...common}>
          <path d="M1 9 C4 2, 7 2, 9 9 C11 16, 14 16, 17 9" fill="none" stroke={dry} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'faint-coil':
      return (
        <svg {...common}>
          <path d="M1 9 C4 2, 7 2, 9 9 C11 16, 14 16, 17 9" fill="none" stroke={colour} strokeWidth="1.8" strokeLinecap="round" opacity="0.45" />
        </svg>
      )
    // a landed pull request: a bright diamond on the thread
    case 'landed-coil':
      return (
        <svg {...common}>
          <path d="M1 9 C4 2, 7 2, 9 9 C11 16, 14 16, 17 9" fill="none" stroke={colour} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M9 5L13 9L9 13L5 9Z" fill={theme.accent} stroke={theme.derived.textHalo} strokeWidth="1.5" paintOrder="stroke" />
        </svg>
      )
    // the minimap: a line of code, its tokens where active and whitespace dots where dormant
    case 'token':
      return (
        <svg {...common}>
          <rect x="1" y="7" width="7" height="4" rx="1.5" fill={colour} />
          <rect x="10" y="7" width="7" height="4" rx="1.5" fill={colour} />
        </svg>
      )
    case 'whitespace':
      return (
        <svg {...common}>
          {[3, 7, 11, 15].map((x) => (
            <circle key={x} cx={x} cy="9" r="0.9" fill={theme.muted} />
          ))}
        </svg>
      )
    case 'comment':
      return (
        <svg {...common}>
          <rect x="1" y="7" width="16" height="4" rx="1.5" fill={dry} />
        </svg>
      )
    case 'hollow-token':
      return (
        <svg {...common}>
          <rect x="2.5" y="6.5" width="13" height="5" rx="1.5" fill="none" stroke={colour} strokeWidth="1" />
        </svg>
      )
    // a landed pull request: a square in the accent, a little taller than a token, on its day
    case 'landed-token':
      return (
        <svg {...common}>
          <rect x="1" y="7" width="6" height="4" rx="1.5" fill={colour} />
          <rect x="11" y="7" width="6" height="4" rx="1.5" fill={colour} />
          <rect x="6" y="6" width="6" height="6" fill={theme.accent} />
        </svg>
      )
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What was cut short in fetching the profile, if anything: a cap reached, and the quarters lost by name. */
export function cutShort(profile: Pick<ProfileData, 'source' | 'truncated' | 'lostWindows'>): string[] {
  const out: string[] = []
  if (profile.truncated) {
    out.push(
      profile.source === 'graphql'
        ? 'cut short by a fetch cap (500 repos, or 100 repos in one quarter) or a lost quarter: some repos or commits are missing.'
        : 'over 500 repos: only the oldest 500 are shown.',
    )
  }
  if (profile.lostWindows.length > 0) out.push(`GitHub did not answer for ${profile.lostWindows.join(', ')}: contributions in those quarters are missing.`)
  return out
}

/**
 * Why a token run's profile came from REST (profile.fallback): it was not for want of a token, so
 * the words that say "without a token" elsewhere say this instead.
 */
export const GRAPHQL_FAILED = 'GraphQL failed, so this is the public profile; try again from the status strip'

/**
 * What each view draws a repo's activity as, for its data limits: what the counted commits make
 * with a token, and what stands in for them without commit counts.
 */
const MEASURES: { readonly [V in PersonView]: { counted: string; uncounted: string } } = {
  lines: { counted: "a line's thickness", uncounted: 'every line is drawn one thickness, and its thick run is how long the repo was active' },
  constellation: { counted: "a star's size", uncounted: "a star's size is how long the repo was active" },
  phosphor: { counted: "a stack's height", uncounted: "a stack's height is how long the repo was active" },
  htop: { counted: "a meter's brightness", uncounted: "every active stretch of a meter is lit full, and a meter's length is how long the repo was active" },
  gitlog: { counted: "a branch's run of commits", uncounted: "a branch has a commit at its start and at its last push, and its length is how long the repo was active" },
  minimap: { counted: "a token's length", uncounted: "a token's length is how long the repo was active" },
  helix: { counted: "a thread's thickness", uncounted: 'every thread is wound one thickness, and its thick run is how long the repo was active' },
}

/**
 * What GitHub's data leaves out of this profile, as the legend of a view lists it (PROFILE_SPEC.md
 * section 2, "Known limits"): the tier's own limits, worded for what the view measures a repo by,
 * then anything cut short, naming the quarters lost. Life lines' when view is left out.
 */
export function dataLimits(
  profile: Pick<ProfileData, 'source' | 'recentFrom' | 'restrictedContributions' | 'truncated' | 'lostWindows' | 'fallback'>,
  view: PersonView = 'lines',
): string[] {
  const out: string[] = []
  const measure = MEASURES[view]
  if (profile.source === 'graphql') {
    out.push(
      `commits count only on a repo's default branch (or gh-pages), made with an email linked to the account, and not in forks: ${measure.counted} counts only those.`,
    )
    const restricted = profile.restrictedContributions
    out.push(
      'contributions to private repos count only with a token that has read:user and can see the repo; otherwise GitHub gives only their number, if the user shares it' +
        (restricted > 0 ? ` (${plural(restricted, 'contribution')} here).` : '.'),
    )
    out.push("days are GitHub's, in US Pacific time, not your time zone.")
    out.push("GitHub's calendar can differ from the count on their github.com profile by a few contributions a year.")
  } else {
    const fallback = profile.fallback !== null
    out.push(
      fallback
        ? `no commit counts: ${GRAPHQL_FAILED}. ${measure.uncounted}, from its creation to its last push.`
        : `no commit counts without a token: ${measure.uncounted}, from its creation to its last push.`,
    )
    const from = profile.recentFrom ? (githubDay(profile.recentFrom) ?? profile.recentFrom) : null
    out.push(
      `recent activity is pushes per repo per day${from ? ` from ${from}` : ''} (GitHub keeps about 30 days of events); days before that are unknown, not quiet.`,
    )
    out.push(
      fallback
        ? 'only their own public repos: repos they only contributed to, and private ones, come only over GraphQL.'
        : 'only their own public repos: repos they only contributed to, and private ones, need a token.',
    )
    out.push("days are GitHub's, in US Pacific time, not your time zone.")
  }
  return [...out, ...cutShort(profile)]
}

/** Languages by how many repos have them, then by name; null (no language) last. */
function languagesOf(timeline: LifeTimeline): Array<string | null> {
  const counts = new Map<string | null, number>()
  for (const lane of timeline.lanes) counts.set(lane.language, (counts.get(lane.language) ?? 0) + 1)
  return [...counts]
    .sort(([a, n], [b, m]) => (a === null ? 1 : b === null ? -1 : m - n || (a < b ? -1 : a > b ? 1 : 0)))
    .map(([language]) => language)
}

/** Language swatches shown before the rest are summed up as "+N more". */
const MAX_LANGUAGES = 8

export interface PersonLegendProps {
  profile: ProfileData
  timeline: LifeTimeline
  /** language -> colour in the active theme, the one the canvas paints with */
  colourOf: (language: string | null) => string
  theme: Theme
  /** the profile holds a private repo (any copy of it) */
  hasPrivate: boolean
  /** the view it explains; life lines when left out */
  view?: PersonView
}

type LegendItem = { kind: GlyphKind; label: string; hint: string }

/** What each view's legend says first, its glyphs, and what its colours are. */
interface ViewLegend {
  intro: string
  items: LegendItem[]
  colours: string
  /**
   * a language's swatch: a console view's own colour for it, as its canvas paints it whatever the
   * theme; null for a view that colours no language; the theme's (colourOf) when left out
   */
  swatch?: ((language: string | null) => string) | null
}

const PRIVATE_ITEM: LegendItem = { kind: 'lock', label: 'private repo', hint: 'its name stays hidden until shown with the toggle at the top of the panel' }
const SEEDLING_HINT = 'a repo GitHub counted no commits to: see what the data leaves out, below'
/** The landed pull request entry, worded for each view's mark. */
export const LANDED_LABEL = 'landed PR'
const LANDED_HINT = 'a pull request of theirs merged into a repo they do not own, marked on the day it was merged'
/** Whether any lane has a landed pull request: then the view draws the mark, and the legend lists it. */
function anyLanded(timeline: LifeTimeline): boolean {
  return timeline.lanes.some((lane) => lane.landed.length > 0)
}

/** Life lines' intro, glyphs and colours. */
function linesLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const items: LegendItem[] = [
    {
      kind: 'run',
      label: 'active run',
      hint: `a run of activity is drawn thick; quiet gaps under ${DORMANT_DAYS} days stay in one run${graphql ? ', and the more commits in a run, the thicker' : ''}`,
    },
    { kind: 'dormant', label: 'dormant', hint: 'where the repo lay dormant, its line runs on thin' },
    { kind: 'start', label: 'start', hint: 'where their part in it starts: a filled dot on their own repos' },
  ]
  if (timeline.lanes.some((lane) => !lane.isOwn)) {
    items.push({ kind: 'joined', label: 'contributed', hint: 'a repo they only contributed to starts with a hollow dot, on the day of their first counted commit' })
  }
  items.push(
    { kind: 'stub', label: 'fork', hint: 'a fork branches off where it starts' },
    { kind: 'terminus', label: 'archived', hint: 'an archived repo is drawn dry and ends at a bar on its last activity' },
    { kind: 'station', label: 'station', hint: "a milestone of the repo, as a station on its line: hover it, or see the milestones tab" },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  )
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'dotted', label: 'seedling', hint: `a dotted line: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-station', label: LANDED_LABEL, hint: `a filled station: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right; each line is a repo, from where their part in it starts to today: thick while active, thin while dormant.${
      graphql ? ' thicker: more commits in a run.' : ''
    }`,
    items,
    colours: "colour = a repo's main language; the bands behind the lines, the leading one each quarter.",
  }
}

/** The constellation's intro, glyphs and colours. */
function constellationLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const items: LegendItem[] = [
    { kind: 'size', label: 'size', hint: graphql ? 'the more commits GitHub counted, the bigger the star' : 'the longer it was active, the bigger the star' },
    { kind: 'glow', label: 'stars', hint: 'a repo with stars glows: the more stars, the brighter, and 100 or more sparkle' },
  ]
  if (timeline.lanes.some((lane) => !lane.isOwn)) {
    items.push({ kind: 'hollow', label: 'contributed', hint: 'a repo they only contributed to is a hollow star, placed on the day of their first counted commit' })
  }
  items.push(
    { kind: 'twin', label: 'fork', hint: 'a fork has a small companion star' },
    { kind: 'dry-star', label: 'archived', hint: 'an archived repo is drawn dry' },
    { kind: 'link', label: 'active together', hint: 'a faint line links repos active in the same months: each star to at most the two it shares the most months with, and in a busy month only its busiest repos' },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  )
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'faint', label: 'seedling', hint: `a faint star: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-tick', label: LANDED_LABEL, hint: `a diamond at the star's upper left, from the day of the first: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right; each star is a repo, placed where their part in it starts, in its language's row. ${
      graphql ? 'size: the commits GitHub counted.' : 'size: how long it was active.'
    }`,
    items,
    colours: "colour = a repo's main language; the strip under the horizon, the leading one each quarter.",
  }
}

/** The console views' line on their colours: a terminal's own, whatever the theme. */
const CONSOLE_COLOURS = 'its own colours, whatever the theme'

/** Phosphor's intro, glyphs and colours. */
function phosphorLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const items: LegendItem[] = [
    {
      kind: 'blocks',
      label: 'stack',
      hint: `a stack of blocks, brighter toward its head, dimmer through stretches the repo lay dormant; ${
        graphql ? 'the more commits GitHub counted, the taller' : 'the longer it was active, the taller'
      }`,
    },
    { kind: 'head', label: 'stars', hint: 'a repo with stars has a bigger head block in a glow: the more stars, the bigger' },
  ]
  if (timeline.lanes.some((lane) => !lane.isOwn)) {
    items.push({ kind: 'hollow-head', label: 'contributed', hint: 'a repo they only contributed to has a hollow head, rising on the day of their first counted commit' })
  }
  items.push(
    { kind: 'dim-stack', label: 'archived', hint: 'an archived repo is drawn dim' },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  )
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'faint-stack', label: 'seedling', hint: `a faint stack: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-block', label: LANDED_LABEL, hint: `a bright diamond over the block at its day's height: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right on a green phosphor screen; each stack of blocks is a repo, rising where their part in it starts. ${
      graphql ? 'height: the commits GitHub counted.' : 'height: how long it was active.'
    }`,
    items,
    colours: `one green for every repo, ${CONSOLE_COLOURS}: hover a repo and the inspector names its language.`,
    swatch: null,
  }
}

/** htop's intro, glyphs and colours. */
function htopLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const slots = htopLanguageSlots(timeline.lanes)
  const items: LegendItem[] = [
    { kind: 'meter', label: 'meter', hint: 'a row per repo, its meter running from where their part in it starts to today, or to an archived repo\'s last activity' },
    {
      kind: 'busy',
      label: graphql ? 'busy' : 'active',
      hint: graphql
        ? 'an active stretch is lit by how busy it was: the more of its days with counted commits, the brighter'
        : 'every active stretch is lit full: without a token there are no commit counts to light it by',
    },
    { kind: 'idle', label: 'dormant', hint: 'where the repo lay dormant, its meter is a dim baseline' },
    { kind: 'dry-meter', label: 'archived', hint: 'an archived repo\'s meter is drawn dry and ends at its last activity' },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  ]
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'half-meter', label: 'seedling', hint: `a meter lit at half: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-cell', label: LANDED_LABEL, hint: `a full-height cell in the monitor's accent: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right on a system monitor; each row is a repo, its meter lit where it was active. ${
      graphql ? 'brightness: the share of days with counted commits.' : 'brightness: every active stretch lit full.'
    }`,
    items,
    colours: `colour = a repo's main language, in the monitor's ${CONSOLE_COLOURS}; the strip under the horizon, the leading one each quarter.`,
    swatch: (language) => htopRowColour({ dry: false, slot: language === null ? -1 : (slots.get(language) ?? -1) }),
  }
}

/** The git log's intro, glyphs and colours. */
function gitLogLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const slots = gitLogSlots(timeline.lanes)
  const items: LegendItem[] = [
    {
      kind: 'branch',
      label: 'branch',
      hint: graphql
        ? 'a repo forks off the trunk where their part in it starts and runs to its last activity, with a commit on its active days'
        : 'a repo forks off the trunk where it was created and runs to its last push, with a commit at each end',
    },
  ]
  if (timeline.lanes.some((lane) => !lane.isOwn)) {
    items.push({ kind: 'hollow-commit', label: 'contributed', hint: 'a repo they only contributed to has hollow commits, and forks off on the day of their first counted commit' })
  }
  items.push(
    { kind: 'end', label: 'archived', hint: 'an archived branch ends in a "*" on its last commit' },
    { kind: 'tag', label: 'milestone', hint: 'a milestone is a tag on the trunk: hover it, or see the milestones tab' },
  )
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'dotted', label: 'seedling', hint: `a branch with only two commits, at its start and its last push: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-commit', label: LANDED_LABEL, hint: `a merge dot in the tag colour on the branch: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right, as git log --graph; each branch is a repo, forking off the trunk where their part in it starts. ${
      graphql ? 'commits: on its active days, as GitHub counted them.' : 'commits: one at its creation and one at its last push.'
    }`,
    items,
    colours: `colour = a repo's main language, in the terminal's ${CONSOLE_COLOURS} (five, so languages may share one); the strip under the horizon, the leading one each quarter.`,
    swatch: (language) => branchColour({ slot: language === null ? -1 : (slots.get(language) ?? -1) }),
  }
}

/** The minimap's intro, glyphs and colours. */
function minimapLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const tones = minimapTones(timeline.lanes)
  const items: LegendItem[] = [
    {
      kind: 'token',
      label: 'token',
      hint: `a run of activity is a syntax token; quiet gaps under ${DORMANT_DAYS} days stay in one token, so ${graphql ? 'its length is the days GitHub counted commits on' : 'its length is how long it was active'}`,
    },
    { kind: 'whitespace', label: 'dormant', hint: 'where the repo lay dormant, its line is whitespace' },
    { kind: 'comment', label: 'archived', hint: 'an archived repo is drawn as a comment' },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  ]
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'hollow-token', label: 'seedling', hint: `a hollow token: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-token', label: LANDED_LABEL, hint: `a square in the editor's accent on the line: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right in a code editor; each line of code is a repo, in the order they started, its tokens where it was active. ${
      graphql ? 'tokens: the days GitHub counted commits on.' : 'tokens: how long it was active.'
    }`,
    items,
    colours: `colour = a repo's main language as a syntax colour, in the editor's ${CONSOLE_COLOURS}; the minimap strip at the right edge shows every line at once.`,
    swatch: (language) => toneColour(language === null ? -1 : (tones.get(language) ?? -1)),
  }
}

/** The helix's intro, glyphs and colours. */
function helixLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const items: LegendItem[] = [
    {
      kind: 'coil',
      label: 'thread',
      hint: `a repo is a thread wound on the coil over its days, thin where it lay dormant; ${
        graphql ? 'the more commits GitHub counted in a stretch, the thicker' : 'its thick run is how long it was active'
      }`,
    },
    { kind: 'far-coil', label: 'far side', hint: 'January 1 is the top of every turn; the first half of a year winds down the near side, the second half back up the far side, drawn dimmer' },
    { kind: 'wound', label: 'start', hint: 'a dot where the thread is wound on: where their part in the repo starts' },
  ]
  if (timeline.lanes.some((lane) => !lane.isOwn)) {
    items.push({ kind: 'dashed-coil', label: 'contributed', hint: 'a repo they only contributed to is a dashed thread, wound on from the day of their first counted commit' })
  }
  items.push(
    { kind: 'dim-coil', label: 'archived', hint: 'an archived repo is drawn dim, and ends at its last activity' },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  )
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'faint-coil', label: 'seedling', hint: `a faint thread: ${SEEDLING_HINT}` })
  if (anyLanded(timeline)) items.push({ kind: 'landed-coil', label: LANDED_LABEL, hint: `a bright diamond on the thread: ${LANDED_HINT}` })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right, wound into a coil one turn a year on an amber vector display; each thread is a repo, wound on where their part in it starts. ${
      graphql ? 'thickness: the commits GitHub counted.' : 'thickness: every active stretch alike.'
    }`,
    items,
    colours: `one amber for every repo, ${CONSOLE_COLOURS}: hover a repo and the inspector names its language.`,
    swatch: null,
  }
}

const LEGENDS: { readonly [V in PersonView]: (timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean) => ViewLegend } = {
  lines: linesLegend,
  constellation: constellationLegend,
  phosphor: phosphorLegend,
  htop: htopLegend,
  gitlog: gitLogLegend,
  minimap: minimapLegend,
  helix: helixLegend,
}

/** The legend of the view on show: its glyphs, its language colours and the limits of GitHub's data. */
export default function PersonLegend({ profile, timeline, colourOf, theme, hasPrivate, view = 'lines' }: PersonLegendProps) {
  const graphql = profile.source === 'graphql'
  const { intro, items, colours, swatch } = LEGENDS[view](timeline, graphql, hasPrivate)
  const swatchOf = swatch === undefined ? colourOf : swatch

  const languages = languagesOf(timeline)
  const shown = languages.slice(0, MAX_LANGUAGES)

  return (
    <div>
      <p className="mb-1.5 text-[11px] leading-snug text-ui-muted">{intro}</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map((item) => (
          <li key={item.kind} className="flex items-center gap-2" title={item.hint}>
            <Glyph kind={item.kind} theme={theme} />
            <span className="text-[12px] text-ui-text-dim">{item.label}</span>
          </li>
        ))}
      </ul>
      {languages.length > 0 && swatchOf === null && <p className="mt-2 text-[11px] leading-snug text-ui-muted">{colours}</p>}
      {languages.length > 0 && swatchOf !== null && (
        <>
          <p className="mt-2 text-[11px] leading-snug text-ui-muted">{colours}</p>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {shown.map((language) => (
              <li key={language ?? ''} className="flex items-center gap-1.5 text-[11px] text-ui-text-dim">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: swatchOf(language) }} />
                {language ?? 'no language'}
              </li>
            ))}
            {languages.length > shown.length && <li className="text-[11px] text-ui-muted">+{languages.length - shown.length} more</li>}
          </ul>
        </>
      )}
      <p className="mt-2 text-[11px] font-medium text-ui-text-dim">what GitHub&apos;s data leaves out</p>
      <ul className="mt-1 flex flex-col gap-1 text-[11px] leading-snug text-ui-muted">
        {dataLimits(profile, view).map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </div>
  )
}
