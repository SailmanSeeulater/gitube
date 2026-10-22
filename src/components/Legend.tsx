import { useGardenStore } from '../store/useGardenStore'
import type { Theme } from '../theme/themes'
import { useTheme } from '../theme/useTheme'
import { BUD_AFTER_DAYS, WILT_AFTER_DAYS, petalAngles } from './gardenLook'
import { gardenInk, leafColour } from './gardenPaint'
import { PrRingPaths } from './PrGlyph'
import type { PrMark } from '../types'

type GlyphKind =
  | 'tip'
  | 'fork'
  | 'merge'
  | 'root'
  | 'station'
  | 'interchange'
  | 'origin'
  | 'muted'
  | 'run'
  | 'thorn'
  | 'bloom'
  | 'bud'
  | 'wilted'
  | 'flower'
  | 'roots'
  | 'pr'
  | 'pr-station'
  | 'pr-bloom'

/** Ellipse petals around (9, 9) for the garden glyphs, as gardenPaint draws them. */
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

/** The spikes Garden draws around a thorny tip (drawThorns), as an SVG path around (9, 9). */
const THORN_PATH = Array.from({ length: 9 }, (_, i) => {
  const a = (i / 9) * Math.PI * 2 + 0.3
  const half = (Math.PI / 9) * 0.55
  const p = (r: number, t: number) => `${(9 + Math.cos(t) * r).toFixed(2)} ${(9 + Math.sin(t) * r).toFixed(2)}`
  return `M${p(5.5, a - half)}L${p(8.8, a)}L${p(5.5, a + half)}Z`
}).join('')

/** The legend's pull request once some review or checks are known: review approved (left), checks failing (right, broken). */
const LEGEND_PR: Pick<PrMark, 'review' | 'checks' | 'draft'> = { review: 'approved', checks: 'failing', draft: false }
/** ...and while none is (a visitor without a token, before a tip is opened): the gapped ring in the tip's own colour. */
const LEGEND_PR_UNKNOWN: Pick<PrMark, 'review' | 'checks' | 'draft'> = { review: 'unknown', checks: 'unknown', draft: false }

/**
 * The canvas glyphs, drawn in the default branch's colour (the accent) as Garden paints them, in the
 * active theme (metro stations in its station colour, run markers in its runMark, and so on).
 * prKnown: the pull request glyphs show review and checks colours, as the canvas does once known.
 */
function Glyph({ kind, theme, prKnown }: { kind: GlyphKind; theme: Theme; prKnown: boolean }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true as const }
  const branch = theme.derived.defaultBranchColour
  const ink = gardenInk(theme)
  const prMark = prKnown ? LEGEND_PR : LEGEND_PR_UNKNOWN
  switch (kind) {
    // metro mode: the station glyphs Garden draws on the straight map
    case 'station':
      return (
        <svg {...common}>
          <line x1="0" y1="9" x2="18" y2="9" stroke={branch} strokeWidth="2.5" />
          <circle cx="9" cy="9" r="4.5" fill={branch} stroke={theme.stationRing} strokeWidth="1.3" />
        </svg>
      )
    case 'interchange':
      return (
        <svg {...common}>
          <line x1="0" y1="9" x2="18" y2="9" stroke={branch} strokeWidth="2.5" />
          <circle cx="9" cy="9" r="4.5" fill={theme.stationRing} />
          <circle cx="9" cy="9" r="2.2" fill={theme.derived.stationCore} />
        </svg>
      )
    case 'origin':
      return (
        <svg {...common}>
          <line x1="0" y1="9" x2="5" y2="9" stroke={branch} strokeWidth="1.2" strokeDasharray="2 2" />
          <line x1="12" y1="9" x2="18" y2="9" stroke={branch} strokeWidth="2.5" />
          <circle cx="9" cy="9" r="3.5" fill={theme.derived.stationCore} stroke={branch} strokeWidth="1.5" />
        </svg>
      )
    case 'muted':
      return (
        <svg {...common}>
          <line x1="0" y1="9" x2="18" y2="9" stroke={branch} strokeWidth="2.5" strokeOpacity={theme.metroMutedAlpha} />
          <line x1="0" y1="14" x2="18" y2="4" stroke={branch} strokeWidth="1.6" strokeDasharray="3 2" />
        </svg>
      )
    // the break Garden draws across a line where skeleton view hides commits (see strokeRunBars):
    // a cut in the background colour (here the panel's) under two bars
    case 'run':
      return (
        <svg {...common}>
          <line x1="0" y1="11" x2="18" y2="11" stroke={branch} strokeWidth="2.5" />
          <line x1="7.25" y1="7.5" x2="7.25" y2="14.5" stroke={theme.panel} strokeWidth="3.5" />
          <line x1="10.75" y1="7.5" x2="10.75" y2="14.5" stroke={theme.panel} strokeWidth="3.5" />
          <line x1="7.25" y1="7.5" x2="7.25" y2="14.5" stroke={theme.derived.runMark} strokeWidth="1.5" />
          <line x1="10.75" y1="7.5" x2="10.75" y2="14.5" stroke={theme.derived.runMark} strokeWidth="1.5" />
          <text x="9" y="5" fill={theme.derived.runMark} fontSize="6" textAnchor="middle">
            +N
          </text>
        </svg>
      )
    // a tip with an open pull request: the layout's tip glyph, its ring split in review | checks
    case 'pr':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={branch} />
          <PrRingPaths cx={9} cy={9} R={6.6} w={2} mark={prMark} theme={theme} neutral={branch} opts={{ gapPx: 1.8, breakPx: 2.8 }} />
        </svg>
      )
    case 'pr-station':
      return (
        <svg {...common}>
          <line x1="0" y1="9" x2="9" y2="9" stroke={branch} strokeWidth="2.5" />
          <circle cx="9" cy="9" r="4.5" fill={branch} />
          <PrRingPaths cx={9} cy={9} R={5.9} w={1.9} mark={prMark} theme={theme} neutral={theme.stationRing} opts={{ gapPx: 1.8, breakPx: 2.8 }} />
        </svg>
      )
    case 'pr-bloom':
      return (
        <svg {...common}>
          <Petals angles={petalAngles('bloom', 0.1)} reach={3.6} long={3} short={1.7} fill={branch} />
          <circle cx="9" cy="9" r="2.2" fill={ink.centre} />
          <PrRingPaths cx={9} cy={9} R={5.8} w={1.8} mark={prMark} theme={theme} neutral={theme.stationRing} opts={{ gapPx: 1.8, breakPx: 2.8 }} />
        </svg>
      )
    case 'tip':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={branch} />
          <circle cx="9" cy="9" r="6.5" fill="none" stroke={branch} strokeWidth="1.5" />
        </svg>
      )
    // the garden layout's glyphs (gardenPaint)
    case 'bloom':
      return (
        <svg {...common}>
          <Petals angles={petalAngles('bloom', 0.1)} reach={3.6} long={3} short={1.7} fill={branch} />
          <circle cx="9" cy="9" r="2.2" fill={ink.centre} />
        </svg>
      )
    case 'bud':
      return (
        <svg {...common}>
          <path d="M9 14.5 Q6 13 4.5 11.5 Q7 11 9 13.5Z M9 14.5 Q12 13 13.5 11.5 Q11 11 9 13.5Z" fill={leafColour(branch, ink)} />
          <path d="M9 3 Q13.5 9 9 14 Q4.5 9 9 3Z" fill={branch} />
        </svg>
      )
    case 'wilted':
      return (
        <svg {...common}>
          <path d="M2 13 Q6 4 9 7" fill="none" stroke={branch} strokeWidth="1.4" strokeOpacity={theme.linkAlpha} />
          <Petals angles={petalAngles('wilted', 0.5)} reach={3} long={2.6} short={1.2} fill={ink.wilt} />
          <circle cx="9" cy="9" r="1.8" fill={ink.wiltCore} />
        </svg>
      )
    case 'flower':
      return (
        <svg {...common}>
          <Petals angles={[0, 1, 2, 3, 4].map((i) => (i / 5) * Math.PI * 2)} reach={3} long={2.2} short={1.4} fill={branch} />
          <circle cx="9" cy="9" r="1.7" fill={ink.centre} />
        </svg>
      )
    case 'roots':
      return (
        <svg {...common}>
          <path d="M9 6 Q7 11 4 16 M9 6 Q8 12 7.5 17 M9 6 Q10 12 11 17 M9 6 Q11 11 14 15" fill="none" stroke={ink.root} strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="9" cy="6" r="2.4" fill={ink.root} />
        </svg>
      )
    case 'thorn':
      return (
        <svg {...common}>
          <path d={THORN_PATH} fill={branch} />
          <circle cx="9" cy="9" r="3" fill={branch} />
          <circle cx="9" cy="9" r="5" fill="none" stroke={branch} strokeWidth="1.2" />
        </svg>
      )
    case 'fork':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={theme.derived.forkNodeFill} stroke={branch} strokeWidth="1.5" />
        </svg>
      )
    case 'merge':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.5" fill={branch} />
          <circle cx="9" cy="9" r="6" fill="none" stroke={branch} strokeWidth="0.8" />
        </svg>
      )
    case 'root':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.5" fill={theme.rootFill} />
          <circle cx="9" cy="9" r="6" fill="none" stroke={theme.rootRing} strokeWidth="1.2" strokeDasharray="2.2 1.8" />
        </svg>
      )
  }
}

const ITEMS: ReadonlyArray<{ kind: GlyphKind; label: string; hint: string }> = [
  { kind: 'tip', label: 'tip', hint: 'branch head, labelled' },
  { kind: 'fork', label: 'fork', hint: 'two or more children' },
  { kind: 'merge', label: 'merge', hint: 'two or more parents' },
  { kind: 'root', label: 'root', hint: 'history cut off here' },
  { kind: 'thorn', label: 'thorns', hint: 'far apart from the default branch on both sides: a merge will likely hurt (see weeds)' },
]

const METRO_ITEMS: ReadonlyArray<{ kind: GlyphKind; label: string; hint: string }> = [
  { kind: 'station', label: 'tip', hint: 'branch head, labelled' },
  { kind: 'interchange', label: 'interchange', hint: 'a fork or merge: lines meet here' },
  { kind: 'origin', label: 'root', hint: 'history cut off here (dashed lead-in)' },
  { kind: 'muted', label: 'merged / sync', hint: 'faint: a deleted merged branch. dashed: a merge between two live lines' },
  { kind: 'run', label: '+N hidden', hint: 'commits collapsed in skeleton view; the count shows beside the line when zoomed in enough' },
  { kind: 'thorn', label: 'thorns', hint: 'far apart from the default branch on both sides: a merge will likely hurt (see weeds)' },
]

const GARDEN_ITEMS: ReadonlyArray<{ kind: GlyphKind; label: string; hint: string }> = [
  { kind: 'bloom', label: 'in bloom', hint: `a branch tip with a commit in the last ${BUD_AFTER_DAYS} days` },
  { kind: 'bud', label: 'bud', hint: `a tip quiet for ${BUD_AFTER_DAYS} to ${WILT_AFTER_DAYS} days` },
  { kind: 'wilted', label: 'wilted', hint: `a tip quiet for over ${WILT_AFTER_DAYS} days: it turns brown and its stem droops` },
  { kind: 'flower', label: 'merge', hint: 'two or more parents' },
  { kind: 'roots', label: 'roots', hint: 'history cut off here' },
  { kind: 'thorn', label: 'thorns', hint: 'far apart from the default branch on both sides: a merge will likely hurt (see weeds)' },
]

const PR_HALVES =
  'left arc: review (green approved, red broken changes requested, grey no review yet / review required). ' +
  'right arc: checks (green passing, amber half-lit running, red broken failing). dotted: draft.'
/** The pull request item's hint, as the canvas shows them: with review and checks known, or none yet. */
const PR_HINT = {
  known: `an open pull request from this branch. ${PR_HALVES} split at 12 and 6 o'clock, in the tip's own colour: not looked up yet (click the tip). click the tip for details`,
  unknown: `split at 12 and 6 o'clock, in the tip's own colour: an open pull request from this branch, not looked up yet (click the tip). once looked up, ${PR_HALVES}`,
}

/** The pull request item for each layout, on its tip glyph (organic: the empty sixth cell; else a seventh). */
const PR_KINDS: Record<'organic' | 'metro' | 'garden', GlyphKind> = { organic: 'pr', metro: 'pr-station', garden: 'pr-bloom' }

export interface LegendProps {
  /** some tip on the canvas carries a pull request mark: the legend explains it (one item, only then) */
  hasPrs?: boolean
  /** some of those marks have their review or checks known (else every one is the gapped neutral ring) */
  prKnown?: boolean
}

export default function Legend({ hasPrs = false, prKnown = false }: LegendProps) {
  const theme = useTheme()
  const layout = useGardenStore((s) => s.layoutMode)
  const base = layout === 'metro' ? METRO_ITEMS : layout === 'garden' ? GARDEN_ITEMS : ITEMS
  const prItem = { kind: PR_KINDS[layout], label: 'pull request', hint: prKnown ? PR_HINT.known : PR_HINT.unknown }
  const items = hasPrs ? [...base, prItem] : base
  return (
    <div>
      {layout === 'garden' && (
        <p className="mb-2 text-[11px] leading-snug text-garden-muted">grown upward: the oldest commits at the bottom, the newest at the top.</p>
      )}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map((item) => (
          <li key={item.kind} className="flex items-center gap-2" title={item.hint}>
            <Glyph kind={item.kind} theme={theme} prKnown={prKnown} />
            <span className="text-[12px] text-garden-text-dim">{item.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-garden-muted">
        colour = branch that reaches a commit first. only live refs are shown; deleted branches are invisible to the API.
      </p>
    </div>
  )
}
