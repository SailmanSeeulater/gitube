import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { track } from '../analytics/umami'
import { preload } from '../lazy/chunk'
import { exportMenuChunk, themePickerChunk } from '../lazy/parts'
import { useAppStore } from '../store/useAppStore'
import { getTheme } from '../theme/themes'
import { DownloadIcon, KeyIcon, PaletteIcon, MetroIcon } from './icons'
import { LazySlot, lazyPart } from './LazyPart'

// both drop-downs load on first open, or as the pointer or focus reaches their button
const ThemePicker = lazyPart(themePickerChunk)
const ExportMenu = lazyPart(exportMenuChunk)
const preloadThemePicker = () => preload(themePickerChunk)
const preloadExportMenu = () => preload(exportMenuChunk)

/** The drop-downs' box, for their placeholder while they load (each sets its own width). */
const DROPDOWN_FRAME = 'self-end rounded-xl border border-ui-border bg-ui-panel/95 px-3 py-2.5 shadow-soft backdrop-blur'

export interface TopBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputRef: RefObject<HTMLInputElement | null>
  tokenOpen: boolean
  onToggleToken: () => void
  busy: boolean
  /** a repo is loaded, so there is something to save */
  canExport: boolean
  /** the data can be saved too; canExport when left out (see ExportMenu) */
  canExportData?: boolean
  onExportImage: () => void
  onExportData: () => void
  /** a file was picked to open */
  onOpenFile: (file: File) => void
  /** the side panel is open: keep clear of it (the address field gives up width first) */
  besidePanel: boolean
}

export default function TopBar({
  value,
  onChange,
  onSubmit,
  inputRef,
  tokenOpen,
  onToggleToken,
  busy,
  canExport,
  canExportData,
  onExportImage,
  onExportData,
  onOpenFile,
  besidePanel,
}: TopBarProps) {
  const token = useAppStore((s) => s.token)
  const setToken = useAppStore((s) => s.setToken)

  // The token is committed to the store (and so to the query key) on Enter or blur, not on
  // every keystroke, so a half-typed token never starts a fetch that fails with 401.
  const [draft, setDraft] = useState(token)
  const [syncedToken, setSyncedToken] = useState(token)
  if (token !== syncedToken) {
    // the store changed underneath us (clear button, another tab): adopt it
    setSyncedToken(token)
    setDraft(token)
  }
  const dirty = draft.trim() !== token

  // The theme picker, the save menu and the token panel drop down from the bar in the same place:
  // one at a time.
  const themeId = useAppStore((s) => s.themeId)
  const setThemeId = useAppStore((s) => s.setThemeId)
  const [themeOpen, setThemeOpen] = useState(false)
  const themeButtonRef = useRef<HTMLButtonElement | null>(null)
  const themeSlotRef = useRef<HTMLDivElement | null>(null)
  const themeListId = useId()
  const [exportOpen, setExportOpen] = useState(false)
  const exportButtonRef = useRef<HTMLButtonElement | null>(null)
  const exportSlotRef = useRef<HTMLDivElement | null>(null)
  const exportMenuId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [seenTokenOpen, setSeenTokenOpen] = useState(tokenOpen)
  if (tokenOpen !== seenTokenOpen) {
    // the token panel opened (its button, or an error card's "add a token"): the others give way
    setSeenTokenOpen(tokenOpen)
    if (tokenOpen) {
      setThemeOpen(false)
      setExportOpen(false)
    }
  }
  const toggleTheme = () => {
    if (!themeOpen && tokenOpen) onToggleToken()
    setExportOpen(false)
    setThemeOpen((open) => !open)
  }
  const closeTheme = useCallback((refocus: boolean) => {
    setThemeOpen(false)
    if (refocus) themeButtonRef.current?.focus()
  }, [])
  // A theme switch counts once, as the picker closes (by any path): the arrow keys preview each
  // theme on the way, and a click keeps the list open for comparing. Both ends read the store, so
  // this hangs on themeOpen alone, and a theme synced from another tab while it is shut is ignored.
  useEffect(() => {
    if (!themeOpen) return
    const opened = useAppStore.getState().themeId
    return () => {
      const theme = useAppStore.getState().themeId
      if (theme !== opened) track('theme-switch', { theme })
    }
  }, [themeOpen])
  const toggleExport = () => {
    if (!exportOpen && tokenOpen) onToggleToken()
    setThemeOpen(false)
    setExportOpen((open) => !open)
  }
  const closeExport = useCallback((refocus: boolean) => {
    setExportOpen(false)
    if (refocus) exportButtonRef.current?.focus()
  }, [])
  const pickFile = useCallback(() => fileInputRef.current?.click(), [])

  // Escape (wherever focus is) and pointer presses outside close the open drop-down. Handled here
  // rather than in ThemePicker and ExportMenu, so they also close its placeholder while it loads
  // and the notice when it could not be loaded. Capture phase on window: the drop-down takes this
  // Escape, so App's Escape (clear the selection) does not also run.
  const dropdown = themeOpen ? 'theme' : exportOpen ? 'export' : null
  useEffect(() => {
    if (dropdown === null) return
    const slot = dropdown === 'theme' ? themeSlotRef : exportSlotRef
    const button = dropdown === 'theme' ? themeButtonRef : exportButtonRef
    const close = dropdown === 'theme' ? closeTheme : closeExport
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      // focus goes back to the button, unless it has moved on elsewhere
      const focused = document.activeElement
      const stayed = focused === null || focused === document.body || focused === button.current
      close(stayed || slot.current?.contains(focused) === true)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (target !== null && (slot.current?.contains(target) || button.current?.contains(target))) return
      close(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [dropdown, closeTheme, closeExport])

  const commitToken = () => {
    if (!dirty) return
    // Enter commits and then blurs, which commits again before a re-render: the store tells whether
    // this one adds a token. The event carries nothing of it, and clearing it sends nothing.
    const added = draft.trim() !== '' && draft.trim() !== useAppStore.getState().token
    setToken(draft)
    if (added) track('token-added')
  }
  const clearToken = () => {
    setDraft('')
    setToken('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit()
    }
  }

  const onTokenKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitToken()
      event.currentTarget.blur()
    }
  }

  return (
    // beside the panel: 16px left gap + the panel's 312px from the right edge + an 8px gap
    <div
      className={`absolute left-4 top-4 z-20 flex flex-col gap-2 ${
        besidePanel ? 'max-w-[max(240px,calc(100vw-336px))]' : 'max-w-[calc(100vw-2rem)]'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1 rounded-xl border border-ui-border bg-ui-panel/95 p-1.5 text-[13px] shadow-soft backdrop-blur">
        <span className="pl-1.5 text-ui-muted" aria-hidden>
          <MetroIcon size={15} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="owner/repo or a GitHub user"
          aria-label="GitHub repository or user"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-[280px] min-w-0 max-w-[55vw] shrink bg-transparent px-2 py-1 text-ui-text outline-none placeholder:text-ui-muted"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded-lg bg-ui-accent/15 px-3 py-1 font-medium text-ui-accent transition-colors hover:bg-ui-accent/25 disabled:cursor-progress disabled:opacity-60"
        >
          {busy ? 'loading' : 'Go'}
        </button>
        <button
          type="button"
          onClick={onToggleToken}
          aria-pressed={tokenOpen}
          aria-label="GitHub token"
          title={token ? 'Token set — click to edit' : 'Add a GitHub token (optional)'}
          className={`relative rounded-lg p-1.5 transition-colors ${
            tokenOpen ? 'bg-ui-hover text-ui-accent' : 'text-ui-muted hover:bg-ui-hover hover:text-ui-text'
          }`}
        >
          <KeyIcon size={15} />
          {token && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ui-accent" aria-hidden />}
        </button>
        <button
          ref={themeButtonRef}
          type="button"
          onClick={toggleTheme}
          onPointerEnter={preloadThemePicker}
          onFocus={preloadThemePicker}
          aria-haspopup="listbox"
          aria-expanded={themeOpen}
          aria-controls={themeOpen ? themeListId : undefined}
          aria-label="Colour theme"
          title={`Theme: ${getTheme(themeId).name}`}
          className={`rounded-lg p-1.5 transition-colors ${
            themeOpen ? 'bg-ui-hover text-ui-accent' : 'text-ui-muted hover:bg-ui-hover hover:text-ui-text'
          }`}
        >
          <PaletteIcon size={15} />
        </button>
        <button
          ref={exportButtonRef}
          type="button"
          onClick={toggleExport}
          onPointerEnter={preloadExportMenu}
          onFocus={preloadExportMenu}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          aria-controls={exportOpen ? exportMenuId : undefined}
          aria-label="Save or open"
          title="Save the graph or its data, or open a saved file"
          className={`rounded-lg p-1.5 transition-colors ${
            exportOpen ? 'bg-ui-hover text-ui-accent' : 'text-ui-muted hover:bg-ui-hover hover:text-ui-text'
          }`}
        >
          <DownloadIcon size={15} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          tabIndex={-1}
          aria-hidden
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // cleared so picking the same file again still fires a change
            event.target.value = ''
            if (file) onOpenFile(file)
          }}
        />
      </div>

      {/* the drop-downs' wrappers draw no box (contents): they mark what counts as inside */}
      {themeOpen && (
        <div ref={themeSlotRef} className="contents">
          <LazySlot frame={`w-[232px] ${DROPDOWN_FRAME}`} label="loading themes">
            <ThemePicker id={themeListId} value={themeId} onChange={setThemeId} onClose={closeTheme} buttonRef={themeButtonRef} />
          </LazySlot>
        </div>
      )}

      {exportOpen && (
        <div ref={exportSlotRef} className="contents">
          <LazySlot frame={`w-[260px] ${DROPDOWN_FRAME}`}>
            <ExportMenu
              id={exportMenuId}
              canExport={canExport}
              canExportData={canExportData}
              onExportImage={onExportImage}
              onExportData={onExportData}
              onOpenFile={pickFile}
              onClose={closeExport}
              buttonRef={exportButtonRef}
            />
          </LazySlot>
        </div>
      )}

      {tokenOpen && (
        <div className="flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-xl border border-ui-border bg-ui-panel/95 p-2.5 text-[12px] shadow-soft backdrop-blur">
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitToken}
              onKeyDown={onTokenKeyDown}
              placeholder="personal access token (optional)"
              aria-label="GitHub personal access token"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg bg-ui-field px-2 py-1 font-mono text-ui-text outline-none placeholder:font-sans placeholder:text-ui-muted"
            />
            {dirty ? (
              <span className="shrink-0 px-1 text-ui-accent" aria-live="polite">
                Enter to save
              </span>
            ) : (
              token && (
                <button
                  type="button"
                  onClick={clearToken}
                  className="rounded-lg px-2 py-1 text-ui-muted hover:bg-ui-hover hover:text-ui-text"
                >
                  clear
                </button>
              )
            )}
          </div>
          <p className="leading-snug text-ui-muted">
            saved when you press Enter or leave the field. stored only in this browser (localStorage) and sent only to
            api.github.com. unlocks 5000 requests/hour and private repos.
          </p>
        </div>
      )}
    </div>
  )
}
