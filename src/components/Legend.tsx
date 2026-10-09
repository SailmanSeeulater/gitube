import { ACCENT, CANVAS_BG, ROOT_FILL, ROOT_RING } from './gardenUtils'

function Glyph({ kind }: { kind: 'tip' | 'fork' | 'merge' | 'root' }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': true as const }
  switch (kind) {
    case 'tip':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={ACCENT} />
          <circle cx="9" cy="9" r="6.5" fill="none" stroke={ACCENT} strokeWidth="1.5" />
        </svg>
      )
    case 'fork':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="4" fill={CANVAS_BG} stroke={ACCENT} strokeWidth="1.5" />
        </svg>
      )
    case 'merge':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.5" fill={ACCENT} />
          <circle cx="9" cy="9" r="6" fill="none" stroke={ACCENT} strokeWidth="0.8" />
        </svg>
      )
    case 'root':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="3.5" fill={ROOT_FILL} />
          <circle cx="9" cy="9" r="6" fill="none" stroke={ROOT_RING} strokeWidth="1.2" strokeDasharray="2.2 1.8" />
        </svg>
      )
  }
}

const ITEMS: ReadonlyArray<{ kind: 'tip' | 'fork' | 'merge' | 'root'; label: string; hint: string }> = [
  { kind: 'tip', label: 'tip', hint: 'branch head, labelled' },
  { kind: 'fork', label: 'fork', hint: 'two or more children' },
  { kind: 'merge', label: 'merge', hint: 'two or more parents' },
  { kind: 'root', label: 'root', hint: 'history cut off here' },
]

export default function Legend() {
  return (
    <div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {ITEMS.map((item) => (
          <li key={item.kind} className="flex items-center gap-2" title={item.hint}>
            <Glyph kind={item.kind} />
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
