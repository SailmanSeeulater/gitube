import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import { THEMES, type Theme, type ThemeId, type ThemeMode } from '../theme/themes'
import { CheckIcon } from './icons'

const GROUPS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'dark', label: 'Dark' },
  { mode: 'light', label: 'Light' },
]

/** The themes in the order the picker shows them (and the arrow keys walk them): dark, then light. */
const ORDERED: readonly Theme[] = GROUPS.flatMap((group) => THEMES.filter((theme) => theme.mode === group.mode))

/** The theme in miniature: its canvas, the default branch (accent) as a ringed tip, and three branch colours. */
function Swatch({ theme }: { theme: Theme }) {
  const [a, b, c] = theme.branchColors
  return (
    <svg width="40" height="22" viewBox="0 0 40 22" aria-hidden focusable="false" className="shrink-0">
      <rect x="0.5" y="0.5" width="39" height="21" rx="5" fill={theme.canvas} stroke={theme.panelBorder} />
      <line x1="10" y1="11" x2="34" y2="11" stroke={theme.accent} strokeOpacity={theme.linkAlpha} strokeWidth="1" />
      <circle cx="10" cy="11" r="3.5" fill={theme.accent} />
      <circle cx="10" cy="11" r="5.75" fill="none" stroke={theme.accent} strokeWidth="1.1" />
      <circle cx="21" cy="11" r="2.5" fill={a} />
      <circle cx="27.5" cy="11" r="2.5" fill={b} />
      <circle cx="34" cy="11" r="2.5" fill={c} />
    </svg>
  )
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
 * Compact popover listing the ten themes in a Dark and a Light group, each with a swatch. A
 * single-select listbox: Up/Down/Home/End move and apply the theme at once (a switch is only a
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
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(ORDERED.length - 1, current + 1)
        break
      case 'ArrowUp':
        next = Math.max(0, current - 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = ORDERED.length - 1
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

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Colour theme"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      // Presses on the group headings, the padding or the scrollbar are inside the picker: keep
      // focus on the option (otherwise it drops to <body> and onBlur reads that as leaving).
      onMouseDown={(event) => {
        if (!(event.target as Element).closest('[role="option"]')) event.preventDefault()
      }}
      className="ui-scroll max-h-[calc(100vh-5.5rem)] w-[232px] self-end overflow-y-auto rounded-xl border border-ui-border bg-ui-panel/95 p-1.5 text-[12px] shadow-soft backdrop-blur"
    >
      {GROUPS.map((group) => {
        const labelId = `${id}-${group.mode}`
        return (
          <div key={group.mode} role="group" aria-labelledby={labelId}>
            <div id={labelId} className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-ui-muted">
              {group.label}
            </div>
            {ORDERED.filter((theme) => theme.mode === group.mode).map((theme) => {
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
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 transition-colors ${
                    selected ? 'bg-ui-accent/10 text-ui-accent' : 'text-ui-text hover:bg-ui-hover'
                  }`}
                >
                  <Swatch theme={theme} />
                  <span className="min-w-0 flex-1 truncate">{theme.name}</span>
                  {selected && <CheckIcon size={13} className="shrink-0" />}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
