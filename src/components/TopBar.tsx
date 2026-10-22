import { useCallback, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { preload } from '../lazy/chunk'
import { exportMenuChunk, themePickerChunk } from '../lazy/parts'
import { useGardenStore } from '../store/useGardenStore'
import { getTheme } from '../theme/themes'
import { DownloadIcon, KeyIcon, PaletteIcon, SproutIcon } from './icons'
import { LazySlot, lazyPart } from './LazyPart'

// both drop-downs load on first open, or as the pointer or focus reaches their button
const ThemePicker = lazyPart(themePickerChunk)
const ExportMenu = lazyPart(exportMenuChunk)
const preloadThemePicker = () => preload(themePickerChunk)
const preloadExportMenu = () => preload(exportMenuChunk)

/** The drop-downs' box, for their placeholder while they load (each sets its own width). */
const DROPDOWN_FRAME = 'self-end rounded-xl border border-garden-border bg-garden-panel/95 px-3 py-2.5 shadow-soft backdrop-blur'

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
  onExportImage,
  onExportData,
  onOpenFile,
  besidePanel,
}: TopBarProps) {
  const token = useGardenStore((s) => s.token)
  const setToken = useGardenStore((s) => s.setToken)

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
  const themeId = useGardenStore((s) => s.themeId)
  const setThemeId = useGardenStore((s) => s.setThemeId)
  const [themeOpen, setThemeOpen] = useState(false)
  const themeButtonRef = useRef<HTMLButtonElement | null>(null)
  const themeListId = useId()
  const [exportOpen, setExportOpen] = useState(false)
  const exportButtonRef = useRef<HTMLButtonElement | null>(null)
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

  const commitToken = () => {
    if (dirty) setToken(draft)
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
      <div className="flex min-w-0 items-center gap-1 rounded-xl border border-garden-border bg-garden-panel/95 p-1.5 text-[13px] shadow-soft backdrop-blur">
        <span className="pl-1.5 text-garden-muted" aria-hidden>
          <SproutIcon size={15} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="github.com/owner/repo"
          aria-label="GitHub repository URL"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-[280px] min-w-0 max-w-[55vw] shrink bg-transparent px-2 py-1 text-garden-text outline-none placeholder:text-garden-muted"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="rounded-lg bg-garden-accent/15 px-3 py-1 font-medium text-garden-accent transition-colors hover:bg-garden-accent/25 disabled:cursor-progress disabled:opacity-60"
        >
          {busy ? 'growing' : 'Grow'}
        </button>
        <button
          type="button"
          onClick={onToggleToken}
          aria-pressed={tokenOpen}
          aria-label="GitHub token"
          title={token ? 'Token set — click to edit' : 'Add a GitHub token (optional)'}
          className={`relative rounded-lg p-1.5 transition-colors ${
            tokenOpen ? 'bg-garden-hover text-garden-accent' : 'text-garden-muted hover:bg-garden-hover hover:text-garden-text'
          }`}
        >
          <KeyIcon size={15} />
          {token && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-garden-accent" aria-hidden />}
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
            themeOpen ? 'bg-garden-hover text-garden-accent' : 'text-garden-muted hover:bg-garden-hover hover:text-garden-text'
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
            exportOpen ? 'bg-garden-hover text-garden-accent' : 'text-garden-muted hover:bg-garden-hover hover:text-garden-text'
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

      {themeOpen && (
        <LazySlot frame={`w-[232px] ${DROPDOWN_FRAME}`} label="loading themes">
          <ThemePicker id={themeListId} value={themeId} onChange={setThemeId} onClose={closeTheme} buttonRef={themeButtonRef} />
        </LazySlot>
      )}

      {exportOpen && (
        <LazySlot frame={`w-[260px] ${DROPDOWN_FRAME}`}>
          <ExportMenu
            id={exportMenuId}
            canExport={canExport}
            onExportImage={onExportImage}
            onExportData={onExportData}
            onOpenFile={pickFile}
            onClose={closeExport}
            buttonRef={exportButtonRef}
          />
        </LazySlot>
      )}

      {tokenOpen && (
        <div className="flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-xl border border-garden-border bg-garden-panel/95 p-2.5 text-[12px] shadow-soft backdrop-blur">
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
              className="min-w-0 flex-1 rounded-lg bg-garden-field px-2 py-1 font-mono text-garden-text outline-none placeholder:font-sans placeholder:text-garden-muted"
            />
            {dirty ? (
              <span className="shrink-0 px-1 text-garden-accent" aria-live="polite">
                Enter to save
              </span>
            ) : (
              token && (
                <button
                  type="button"
                  onClick={clearToken}
                  className="rounded-lg px-2 py-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
                >
                  clear
                </button>
              )
            )}
          </div>
          <p className="leading-snug text-garden-muted">
            saved when you press Enter or leave the field. stored only in this browser (localStorage) and sent only to
            api.github.com. unlocks 5000 requests/hour and private repos.
          </p>
        </div>
      )}
    </div>
  )
}
