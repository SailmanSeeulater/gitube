import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { FileIcon, ImageIcon, OpenIcon } from './icons'

export interface ExportMenuProps {
  id: string
  /** false while no repo is loaded: only opening a file is offered */
  canExport: boolean
  /** the data (JSON) can be saved too; canExport when left out (person mode saves only the image) */
  canExportData?: boolean
  onExportImage: () => void
  onExportData: () => void
  onOpenFile: () => void
  /** close the menu; refocus: hand focus back to the toggle button */
  onClose: (refocus: boolean) => void
  /** the button that toggles the menu: focus moving onto it does not count as leaving */
  buttonRef: RefObject<HTMLElement | null>
}

interface ItemProps {
  icon: ReactNode
  label: string
  hint: string
  disabled?: boolean
  onSelect: () => void
}

function Item({ icon, label, hint, disabled = false, onSelect }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ui-hover focus-visible:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 shrink-0 text-ui-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-ui-text">{label}</span>
        <span className="block text-[11px] leading-snug text-ui-muted">{hint}</span>
      </span>
    </button>
  )
}

/**
 * Drop-down from the top bar: save the graph as a PNG or the loaded data as JSON, or open a saved
 * file. Up/Down move between items; tabbing away closes it. Escape and a click outside close it
 * too, through TopBar (which also covers the menu's placeholder while it loads).
 */
export default function ExportMenu({ id, canExport, canExportData = canExport, onExportImage, onExportData, onOpenFile, onClose, buttonRef }: ExportMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  const items = (): HTMLButtonElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])

  // Open with the first available item focused, unless focus has moved on while the menu was
  // loading (it can open a fetch after the click), as in ThemePicker.
  useEffect(() => {
    const focused = document.activeElement
    const stayed = focused === null || focused === document.body || focused === buttonRef.current
    if (stayed) items()[0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const list = items()
    if (list.length === 0) return
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length
    list[next].focus()
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next !== null && (menuRef.current?.contains(next) || buttonRef.current?.contains(next))) return
    onClose(false)
  }

  const run = (action: () => void) => () => {
    onClose(true)
    action()
  }

  return (
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label="Save or open"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="w-[260px] self-end rounded-xl border border-ui-border bg-ui-panel/95 p-1.5 text-[12px] shadow-soft backdrop-blur"
    >
      <Item
        icon={<ImageIcon size={14} />}
        label="Save image (PNG)"
        hint="the graph as it looks right now"
        disabled={!canExport}
        onSelect={run(onExportImage)}
      />
      <Item
        icon={<FileIcon size={14} />}
        label="Save data (JSON)"
        hint="reopen it later without any GitHub requests"
        disabled={!canExportData}
        onSelect={run(onExportData)}
      />
      <div className="mx-2 my-1 h-px bg-ui-border" role="separator" />
      <Item icon={<OpenIcon size={14} />} label="Open a saved file…" hint="or drop a .json file on the page" onSelect={run(onOpenFile)} />
    </div>
  )
}
