import type { ProfileData } from '../types'
import type { Theme } from '../theme/themes'
import type { PersonView } from '../share/shareUrl'
import { gardenInk, leafColour } from '../components/gardenPaint'
import { DORMANT_DAYS, githubDay, type LifeTimeline } from './timeline'
import { LockIcon } from './personIcons'

type GlyphKind =
  // the life garden's
  | 'bloom'
  | 'bud'
  | 'wilted'
  | 'leaf'
  | 'cutting'
  | 'visiting'
  | 'seedling'
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
  // the constellation's
  | 'size'
  | 'glow'
  | 'hollow'
  | 'twin'
  | 'dry-star'
  | 'link'
  | 'faint'

// The petal directions gardenLook's petalAngles gives an open bloom at turn 0.1 and a wilted head at
// turn 0.5, as the repo garden's legend draws them; written out, so the first-load entry need not
// export petalAngles for these two glyphs alone (a test holds them equal).
export const LEGEND_BLOOM_PETALS = [0, 1, 2, 3, 4, 5].map((i) => (i / 6) * Math.PI * 2 + 0.1 * Math.PI)
export const LEGEND_WILTED_PETALS = [-0.9, -0.3, 0.3, 0.9].map((d) => Math.PI / 2 + d)

/** Ellipse petals around (9, 9), as gardenPaint draws them. */
function Petals({ angles, reach, long, short, fill }: { angles: number[]; reach: number; long: number; short: number; fill: string }) {
  return (
    <>
      {angles.map((a) => (
        <ellipse
          key={a}
          cx={9 + Math.cos(a) * reach}
          cy={9 + Math.sin(a) * reach}
          rx={long}
          ry={short}
          transform={`rotate(${(a * 180) / Math.PI} ${9 + Math.cos(a) * reach} ${9 + Math.sin(a) * reach})`}
          fill={fill}
        />
      ))}
    </>
  )
}

/** The views' glyphs in the active theme, in the accent, the colour of the leading language. */
function Glyph({ kind, theme }: { kind: GlyphKind; theme: Theme }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true as const }
  const colour = theme.accent
  const ink = gardenInk(theme)
  const horizon = <line x1="1" y1="14" x2="17" y2="14" stroke={ink.root} strokeWidth="1.5" />
  /** a life line's thin dormant stretch, behind a mark on it */
  const track = <line x1="1" y1="9" x2="17" y2="9" stroke={colour} strokeWidth="1" />
  switch (kind) {
    case 'bloom':
      return (
        <svg {...common}>
          <Petals angles={LEGEND_BLOOM_PETALS} reach={3.6} long={3} short={1.7} fill={colour} />
          <circle cx="9" cy="9" r="2.2" fill={ink.centre} />
        </svg>
      )
    case 'bud':
      return (
        <svg {...common}>
          <path d="M9 14.5 Q6 13 4.5 11.5 Q7 11 9 13.5Z M9 14.5 Q12 13 13.5 11.5 Q11 11 9 13.5Z" fill={leafColour(colour, ink)} />
          <path d="M9 3 Q13.5 9 9 14 Q4.5 9 9 3Z" fill={colour} />
        </svg>
      )
    // dry: the stem and the head both in the wilt colour
    case 'wilted':
      return (
        <svg {...common}>
          <path d="M2 13 Q6 4 9 7" fill="none" stroke={ink.wilt} strokeWidth="1.4" />
          <Petals angles={LEGEND_WILTED_PETALS} reach={3} long={2.6} short={1.2} fill={ink.wilt} />
          <circle cx="9" cy="9" r="1.8" fill={ink.wiltCore} />
        </svg>
      )
    case 'leaf':
      return (
        <svg {...common}>
          <line x1="9" y1="17" x2="9" y2="2" stroke={colour} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M9 10Q13.24 9.3 13.95 5.05Q9.7 5.76 9 10Z M9 13Q8.3 8.76 4.05 8.05Q4.76 12.3 9 13Z" fill={leafColour(colour, ink)} />
        </svg>
      )
    // a fork: a stem cut off slanting at the base, with no roots
    case 'cutting':
      return (
        <svg {...common}>
          <line x1="9" y1="13.5" x2="9" y2="4" stroke={colour} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="9" cy="4" r="1.8" fill={colour} />
          <line x1="5" y1="15.5" x2="13" y2="12" stroke={ink.root} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    // a repo they only contributed to: a hollow ring where they arrived
    case 'visiting':
      return (
        <svg {...common}>
          {horizon}
          <line x1="9" y1="14" x2="9" y2="4" stroke={colour} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="9" cy="4" r="1.8" fill={colour} />
          <circle cx="9" cy="14" r="2.6" fill={theme.canvas} stroke={theme.rootRing} strokeWidth="1.2" />
        </svg>
      )
    case 'seedling':
      return (
        <svg {...common}>
          {horizon}
          <line x1="9" y1="14" x2="9" y2="10.5" stroke={colour} strokeWidth="1.2" strokeLinecap="round" />
          <path d="M9 7.5Q10.6 9.3 9 11Q7.4 9.3 9 7.5Z" fill={colour} />
        </svg>
      )
    case 'milestone':
      return (
        <svg {...common}>
          <line x1="1" y1="9" x2="17" y2="9" stroke={ink.root} strokeWidth="1.5" />
          <path d="M9 5L13 9L9 13L5 9Z" fill={theme.accent} stroke={theme.derived.textHalo} strokeWidth="1.5" paintOrder="stroke" />
        </svg>
      )
    case 'lock':
      return (
        <span className="text-garden-muted">
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
          <line x1="2" y1="9" x2="12" y2="9" stroke={ink.wilt} strokeWidth="3" strokeLinecap="round" />
          <line x1="13" y1="4" x2="13" y2="14" stroke={ink.wilt} strokeWidth="1.5" />
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
          <circle cx="9" cy="9" r="3.5" fill={ink.wilt} />
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
  garden: { counted: "a plant's height", uncounted: "a plant's height is how long the repo was active" },
  lines: { counted: "a line's thickness", uncounted: 'every line is drawn one thickness, and its thick run is how long the repo was active' },
  constellation: { counted: "a star's size", uncounted: "a star's size is how long the repo was active" },
}

/**
 * What GitHub's data leaves out of this profile, as the legend of a view lists it (PROFILE_SPEC.md
 * section 2, "Known limits"): the tier's own limits, worded for what the view measures a repo by,
 * then anything cut short, naming the quarters lost. The life garden's when view is left out.
 */
export function dataLimits(
  profile: Pick<ProfileData, 'source' | 'recentFrom' | 'restrictedContributions' | 'truncated' | 'lostWindows' | 'fallback'>,
  view: PersonView = 'garden',
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
  /** the view it explains; the life garden when left out */
  view?: PersonView
}

type LegendItem = { kind: GlyphKind; label: string; hint: string }

/** What each view's legend says first, its glyphs, and what its colours are. */
interface ViewLegend {
  intro: string
  items: LegendItem[]
  colours: string
}

const PRIVATE_ITEM: LegendItem = { kind: 'lock', label: 'private repo', hint: 'its name stays hidden until shown with the toggle at the top of the panel' }
const SEEDLING_HINT = 'a repo GitHub counted no commits to: see what the data leaves out, below'

/** The life garden's intro, glyphs and colours. */
function gardenLegend(timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean): ViewLegend {
  const items: LegendItem[] = [
    { kind: 'bloom', label: 'stars', hint: 'a repo with stars blooms: the more stars, the bigger the flower' },
    { kind: 'bud', label: 'no stars', hint: 'a repo without stars ends in a bud' },
    {
      kind: 'leaf',
      label: 'active span',
      hint: `a leaf for each run of activity; quiet gaps under ${DORMANT_DAYS} days stay in one run, and the stem thins where the repo lay dormant`,
    },
    { kind: 'wilted', label: 'archived', hint: 'an archived repo is drawn dry and ends at its last activity; its head still grows with its stars' },
    { kind: 'cutting', label: 'fork', hint: 'a fork is drawn as a cutting: cut off at the base, with no roots' },
    { kind: 'milestone', label: 'milestone', hint: 'a milestone on the horizon: hover it, or see the milestones tab' },
  ]
  if (timeline.lanes.some((lane) => !lane.isOwn)) {
    items.push({ kind: 'visiting', label: 'contributed', hint: 'a repo they only contributed to, rooted on the day of their first counted commit, with a ring at the root' })
  }
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) items.push({ kind: 'seedling', label: 'seedling', hint: SEEDLING_HINT })
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right; each plant is a repo, rooted where their part in it starts. ${
      graphql ? 'height: the commits GitHub counted.' : 'height: how long it was active.'
    }`,
    items,
    colours: "colour = a repo's main language; the strip under the horizon, the leading one each quarter.",
  }
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
  if (hasPrivate) items.push(PRIVATE_ITEM)
  return {
    intro: `time runs left to right; each star is a repo, placed where their part in it starts, in its language's row. ${
      graphql ? 'size: the commits GitHub counted.' : 'size: how long it was active.'
    }`,
    items,
    colours: "colour = a repo's main language; the strip under the horizon, the leading one each quarter.",
  }
}

const LEGENDS: { readonly [V in PersonView]: (timeline: LifeTimeline, graphql: boolean, hasPrivate: boolean) => ViewLegend } = {
  garden: gardenLegend,
  lines: linesLegend,
  constellation: constellationLegend,
}

/** The legend of the view on show: its glyphs, its language colours and the limits of GitHub's data. */
export default function PersonLegend({ profile, timeline, colourOf, theme, hasPrivate, view = 'garden' }: PersonLegendProps) {
  const graphql = profile.source === 'graphql'
  const { intro, items, colours } = LEGENDS[view](timeline, graphql, hasPrivate)

  const languages = languagesOf(timeline)
  const shown = languages.slice(0, MAX_LANGUAGES)

  return (
    <div>
      <p className="mb-2 text-[11px] leading-snug text-garden-muted">{intro}</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map((item) => (
          <li key={item.kind} className="flex items-center gap-2" title={item.hint}>
            <Glyph kind={item.kind} theme={theme} />
            <span className="text-[12px] text-garden-text-dim">{item.label}</span>
          </li>
        ))}
      </ul>
      {languages.length > 0 && (
        <>
          <p className="mt-2 text-[11px] leading-snug text-garden-muted">{colours}</p>
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {shown.map((language) => (
              <li key={language ?? ''} className="flex items-center gap-1.5 text-[11px] text-garden-text-dim">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colourOf(language) }} />
                {language ?? 'no language'}
              </li>
            ))}
            {languages.length > shown.length && <li className="text-[11px] text-garden-muted">+{languages.length - shown.length} more</li>}
          </ul>
        </>
      )}
      <p className="mt-2 text-[11px] font-medium text-garden-text-dim">what GitHub&apos;s data leaves out</p>
      <ul className="mt-1 flex flex-col gap-1 text-[11px] leading-snug text-garden-muted">
        {dataLimits(profile, view).map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </div>
  )
}
