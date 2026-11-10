import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import { THEMES, type Theme, type ThemeId, type ThemeMode } from '../theme/themes'
import { CheckIcon } from './icons'

const GROUPS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'dark', label: 'Dark' },
  { mode: 'light', label: 'Light' },
]

/** The themes in the order the picker shows them (and the arrow keys walk them): dark, then light. */
const ORDERED: readonly Theme[] = GROUPS.flatMap((group) => THEMES.filter((theme) => theme.mode === group.mode))

/** Tiles per row, which is also how far Up and Down move. */
const COLUMNS = 4

/**
 * The theme in miniature, as the map draws it: its canvas, the default branch (accent) as a trunk
 * running from a ringed origin to its tip, and two branches forking off in the first two colours.
 */
function Swatch({ theme }: { theme: Theme }) {
  const [a, b] = theme.branchColors
  return (
    <svg viewBox="0 0 72 40" aria-hidden focusable="false" className="block h-auto w-full">
      <rect x="0.5" y="0.5" width="71" height="39" rx="7.5" fill={theme.canvas} stroke={theme.panelBorder} />
      <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 24H60" stroke={theme.accent} />
        <path d="M24 24l8-10h14" stroke={a} />
        <path d="M38 24l5 7h9" stroke={b} />
      </g>
      <circle cx="46" cy="14" r="2.7" fill={a} />
      <circle cx="52" cy="31" r="2.7" fill={b} />
      <circle cx="60" cy="24" r="3.3" fill={theme.accent} />
      <circle cx="12" cy="24" r="3" fill={theme.canvas} stroke={theme.stationRing} strokeWidth="1.6" />
    </svg>
  )
}

/** Where each group starts in ORDERED, and how many themes it holds. */
const SPANS: ReadonlyArray<{ start: number; count: number }> = GROUPS.map((group) => ({
  start: ORDERED.findIndex((theme) => theme.mode === group.mode),
  count: ORDERED.filter((theme) => theme.mode === group.mode).length,
}))

/**
 * The tile one row down (rows = 1) or up (rows = -1) from index, staying in its column: within its
 * group where there is such a row, else in the nearest row of the next group that way (its last
 * tile when that row is short of the column). At the first or last row it stays put.
 */
export function step(index: number, rows: 1 | -1): number {
  const g = SPANS.findIndex((span) => index >= span.start && index < span.start + span.count)
  if (g < 0) return index
  const span = SPANS[g]
  const column = (index - span.start) % COLUMNS
  const within = index + rows * COLUMNS
  if (within >= span.start && within < span.start + span.count) return within
  // the last row of a group may be short: from the row above it, land on its last tile
  const lastRowStart = span.start + Math.floor((span.count - 1) / COLUMNS) * COLUMNS
  if (rows === 1 && index < lastRowStart) return span.start + span.count - 1
  const to = SPANS[g + rows]
  if (to === undefined) return index
  const rowStart = rows === 1 ? to.start : to.start + Math.floor((to.count - 1) / COLUMNS) * COLUMNS
  return Math.min(rowStart + column, to.start + to.count - 1)
}

export interface ThemePickerProps {
  /** id of the listbox (the toggle button's aria-controls) */
  id: string
  value: ThemeId
  /** a theme was chosen (click, or the arrow keys: selection follows focus, so themes preview live) */
  onChange: (id: ThemeId) => void
  /** close the picker; refocus: hand focus back to the toggle button */
  onClose: (refocus: boolean) => void
  /** the button that toggles the picker: focus moving onto it does not count as leaving */
  buttonRef: RefObject<HTMLElement | null>
}

/**
 * Popover showing every theme as a tile (a miniature map and its name), in a Dark and a Light
 * group, with the chosen theme's one-line character underneath. A single-select listbox laid out
 * as a grid: the arrow keys, Home and End move and apply the theme at once (a switch is only a
 * repaint, so previewing is cheap), Enter or Space confirms and closes, a click applies and keeps
 * the list open for comparing. Tabbing away closes it; Escape and a click outside close it too,
 * through TopBar (which also covers the picker's placeholder while it loads).
 */
export default function ThemePicker({ id, value, onChange, onClose, buttonRef }: ThemePickerProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef(new Map<ThemeId, HTMLDivElement>())
  const initialValue = useRef(value)

  // Open with the active theme focused, unless focus has moved on while the picker was loading
  // (it can open a fetch after the click): taking focus back would pull it from where the user went.
  useEffect(() => {
    const focused = document.activeElement
    const stayed = focused === null || focused === document.body || focused === buttonRef.current
    if (stayed) optionRefs.current.get(initialValue.current)?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = (theme: Theme) => {
    onChange(theme.id)
    optionRefs.current.get(theme.id)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = ORDERED.findIndex((theme) => theme.id === value)
    const last = ORDERED.length - 1
    let next: number
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(last, current + 1)
        break
      case 'ArrowLeft':
        next = Math.max(0, current - 1)
        break
      case 'ArrowDown':
        next = step(current, 1)
        break
      case 'ArrowUp':
        next = step(current, -1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onClose(true)
        return
      default:
        return
    }
    event.preventDefault()
    choose(ORDERED[next])
  }

  // tabbing (or clicking) away closes it; moving onto the toggle button leaves that to the button
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next !== null && (listRef.current?.contains(next) || buttonRef.current?.contains(next))) return
    onClose(false)
  }

  const current = ORDERED.find((theme) => theme.id === value)

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Colour theme"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      // Presses on the group headings, the padding or the scrollbar are inside the picker: keep
      // focus on the option (otherwise it drops to <body> and onBlur reads that as leaving).
      onMouseDown={(event) => {
        if (!(event.target as Element).closest('[role="option"]')) event.preventDefault()
      }}
      className="ui-glass ui-pop ui-scroll max-h-[calc(100dvh-5.5rem)] w-[352px] max-w-[calc(100vw-2rem)] self-end overflow-y-auto rounded-2xl border border-ui-border p-2 text-[12px] shadow-soft"
    >
      {GROUPS.map((group) => {
        const labelId = `${id}-${group.mode}`
        const themes = ORDERED.filter((theme) => theme.mode === group.mode)
        return (
          <div key={group.mode} role="group" aria-labelledby={labelId}>
            <div id={labelId} className="flex items-baseline gap-1.5 px-1.5 pb-1.5 pt-1 text-[11px] font-medium text-ui-text-dim">
              {group.label}
              <span className="font-normal tabular-nums text-ui-muted">{themes.length}</span>
            </div>
            <div className="mb-2 grid grid-cols-4 gap-1">
              {themes.map((theme) => {
                const selected = theme.id === value
                return (
                  <div
                    key={theme.id}
                    ref={(el) => {
                      if (el) optionRefs.current.set(theme.id, el)
                      else optionRefs.current.delete(theme.id)
                    }}
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    title={theme.blurb}
                    onClick={() => choose(theme)}
                    className={`ui-press flex min-w-0 flex-col gap-1 rounded-[10px] p-1 ${selected ? 'bg-ui-accent/12' : 'hover:bg-ui-hover'}`}
                  >
                    <span className={`block rounded-lg ${selected ? 'outline-2 outline-offset-1 outline-ui-accent' : ''}`}>
                      <Swatch theme={theme} />
                    </span>
                    <span
                      className={`flex items-center justify-center gap-0.5 truncate text-[11px] leading-4 ${
                        selected ? 'font-medium text-ui-accent' : 'text-ui-text-dim'
                      }`}
                    >
                      {selected && <CheckIcon size={11} className="shrink-0" />}
                      <span className="truncate">{theme.name}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {current && (
        <p className="border-t border-ui-border px-1.5 pb-1 pt-2 text-[11px] leading-snug text-ui-muted" aria-live="polite">
          <span className="font-medium text-ui-text-dim">{current.name}.</span> {current.blurb}
        </p>
      )}
    </div>
  )
}
