import type { ProfileData } from '../types'
import type { Theme } from '../theme/themes'
import { gardenInk, leafColour } from '../components/gardenPaint'
import { DORMANT_DAYS, githubDay, type LifeTimeline } from './timeline'
import { LockIcon } from './personIcons'

type GlyphKind = 'bloom' | 'bud' | 'wilted' | 'leaf' | 'cutting' | 'visiting' | 'seedling' | 'milestone' | 'lock'

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

/** The life garden's glyphs in the active theme, in the accent, the colour of the leading language. */
function Glyph({ kind, theme }: { kind: GlyphKind; theme: Theme }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true as const }
  const colour = theme.accent
  const ink = gardenInk(theme)
  const horizon = <line x1="1" y1="14" x2="17" y2="14" stroke={ink.root} strokeWidth="1.5" />
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
 * What GitHub's data leaves out of this profile, as the legend lists it (PROFILE_SPEC.md section
 * 2, "Known limits"): the tier's own limits, then anything cut short, naming the quarters lost.
 */
export function dataLimits(
  profile: Pick<ProfileData, 'source' | 'recentFrom' | 'restrictedContributions' | 'truncated' | 'lostWindows' | 'fallback'>,
): string[] {
  const out: string[] = []
  if (profile.source === 'graphql') {
    out.push("commits count only on a repo's default branch (or gh-pages), made with an email linked to the account, and not in forks.")
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
        ? `no commit counts: ${GRAPHQL_FAILED}. a plant's height is how long the repo was active, from its creation to its last push.`
        : "no commit counts without a token: a plant's height is how long the repo was active, from its creation to its last push.",
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
}

/** The life garden's legend: its glyphs, its language colours and the limits of GitHub's data. */
export default function PersonLegend({ profile, timeline, colourOf, theme, hasPrivate }: PersonLegendProps) {
  const graphql = profile.source === 'graphql'
  const items: Array<{ kind: GlyphKind; label: string; hint: string }> = [
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
  if (graphql && timeline.lanes.some((lane) => !lane.detailed)) {
    items.push({ kind: 'seedling', label: 'seedling', hint: 'a repo GitHub counted no commits to: see what the data leaves out, below' })
  }
  if (hasPrivate) items.push({ kind: 'lock', label: 'private repo', hint: 'its name stays hidden until shown with the toggle at the top of the panel' })

  const languages = languagesOf(timeline)
  const shown = languages.slice(0, MAX_LANGUAGES)

  return (
    <div>
      <p className="mb-2 text-[11px] leading-snug text-garden-muted">
        time runs left to right; each plant is a repo, rooted where their part in it starts.{' '}
        {graphql ? 'height: the commits GitHub counted.' : 'height: how long it was active.'}
      </p>
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
          <p className="mt-2 text-[11px] leading-snug text-garden-muted">
            colour = a repo&apos;s main language; the strip under the horizon, the leading one each quarter.
          </p>
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
        {dataLimits(profile).map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </div>
  )
}
