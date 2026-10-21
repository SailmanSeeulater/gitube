import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { FileIcon, ImageIcon, OpenIcon } from './icons'

export interface ExportMenuProps {
  id: string
  /** false while no repo is loaded: only opening a file is offered */
  canExport: boolean
  onExportImage: () => void
  onExportData: () => void
  onOpenFile: () => void
  /** close the menu; refocus: hand focus back to the toggle button */
  onClose: (refocus: boolean) => void
  /** the button that toggles the menu: presses on it do not count as outside */
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
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-garden-hover focus-visible:bg-garden-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="mt-0.5 shrink-0 text-garden-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-garden-text">{label}</span>
        <span className="block text-[11px] leading-snug text-garden-muted">{hint}</span>
      </span>
    </button>
  )
}

/**
 * Drop-down from the top bar: save the graph as a PNG or the loaded data as JSON, or open a saved
 * file. Up/Down move between items; Escape, a click outside or tabbing away closes it.
 */
export default function ExportMenu({ id, canExport, onExportImage, onExportData, onOpenFile, onClose, buttonRef }: ExportMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  const items = (): HTMLButtonElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])

  // open with the first available item focused
  useEffect(() => {
    items()[0]?.focus()
  }, [])

  // Capture phase on window, as in ThemePicker: the menu takes this Escape, so App's Escape
  // (clear the selection) does not also run.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose(true)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (target !== null && (menuRef.current?.contains(target) || buttonRef.current?.contains(target))) return
      onClose(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose, buttonRef])

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
      className="w-[260px] self-end rounded-xl border border-garden-border bg-garden-panel/95 p-1.5 text-[12px] shadow-soft backdrop-blur"
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
        disabled={!canExport}
        onSelect={run(onExportData)}
      />
      <div className="mx-2 my-1 h-px bg-garden-border" role="separator" />
      <Item icon={<OpenIcon size={14} />} label="Open a saved file…" hint="or drop a .json file on the page" onSelect={run(onOpenFile)} />
    </div>
  )
}
