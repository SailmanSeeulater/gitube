import { useGardenStore } from '../store/useGardenStore'
import type { Theme } from '../theme/themes'
import { useTheme } from '../theme/useTheme'

type GlyphKind = 'tip' | 'fork' | 'merge' | 'root' | 'station' | 'interchange' | 'origin' | 'muted' | 'run'

/**
 * The canvas glyphs, drawn in the default branch's colour (the accent) as Garden paints them, in the
 * active theme (metro stations in its station colour, run markers in its runMark, and so on).
 */
function Glyph({ kind, theme }: { kind: GlyphKind; theme: Theme }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true as const }
  const branch = theme.derived.defaultBranchColour
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
    case 'tip':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={branch} />
          <circle cx="9" cy="9" r="6.5" fill="none" stroke={branch} strokeWidth="1.5" />
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
]

const METRO_ITEMS: ReadonlyArray<{ kind: GlyphKind; label: string; hint: string }> = [
  { kind: 'station', label: 'tip', hint: 'branch head, labelled' },
  { kind: 'interchange', label: 'interchange', hint: 'a fork or merge: lines meet here' },
  { kind: 'origin', label: 'root', hint: 'history cut off here (dashed lead-in)' },
  { kind: 'muted', label: 'merged / sync', hint: 'faint: a deleted merged branch. dashed: a merge between two live lines' },
  { kind: 'run', label: '+N hidden', hint: 'commits collapsed in skeleton view; the count shows beside the line when zoomed in enough' },
]

export default function Legend() {
  const theme = useTheme()
  const metro = useGardenStore((s) => s.layoutMode === 'metro')
  return (
    <div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {(metro ? METRO_ITEMS : ITEMS).map((item) => (
          <li key={item.kind} className="flex items-center gap-2" title={item.hint}>
            <Glyph kind={item.kind} theme={theme} />
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
