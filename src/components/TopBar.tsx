import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react'
import { track } from '../analytics/umami'
import { preload } from '../lazy/chunk'
import { exportMenuChunk, themePickerChunk } from '../lazy/parts'
import { useAppStore } from '../store/useAppStore'
import { getTheme } from '../theme/themes'
import { DownloadIcon, KeyIcon, PaletteIcon, MetroIcon } from './icons'

/** A classic token with no scopes reads everything public, which is all gitube needs without private repos. */
const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?description=gitube'
/** The app's own source, so a visitor can see where the token goes. */
const SOURCE_URL = 'https://github.com/SailmanSeeulater/gitube'
/** The page without a repo or a person in its address: the start screen. */
const HOME_URL = './'
import { LazySlot, lazyPart } from './LazyPart'

// both drop-downs load on first open, or as the pointer or focus reaches their button
const ThemePicker = lazyPart(themePickerChunk)
const ExportMenu = lazyPart(exportMenuChunk)
const preloadThemePicker = () => preload(themePickerChunk)
const preloadExportMenu = () => preload(exportMenuChunk)

/** The bar's icon buttons: a 32px square (44px to a finger, see ui-hit) that tints when its drop-down is open. */
const iconButton = (active: boolean) =>
  `ui-hit ui-press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
    active ? 'bg-ui-accent/12 text-ui-accent' : 'text-ui-muted hover:bg-ui-hover hover:text-ui-text'
  }`

/** A phone-width window: the address field is short there, so its hint is too. */
const NARROW = '(max-width: 479px)'
const narrowQuery = () => (typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? null : window.matchMedia(NARROW))
function subscribeNarrow(onChange: () => void): () => void {
  const query = narrowQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}
const isNarrow = () => narrowQuery()?.matches ?? false

/** The drop-downs' box, for their placeholder while they load (each sets its own width). */
const DROPDOWN_FRAME = 'self-end rounded-2xl border border-ui-border ui-glass px-3 py-2.5 shadow-soft'

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
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false)
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

  // "/" puts the cursor in the address field, as on GitHub, unless something is being typed already.
  useEffect(() => {
    const onSlash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('keydown', onSlash)
    return () => window.removeEventListener('keydown', onSlash)
  }, [inputRef])

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
      <div
        role="search"
        className="ui-glass ui-field-frame flex min-w-0 items-center gap-1 rounded-2xl border border-ui-border p-1.5 text-[13px] shadow-soft"
      >
        <a
          href={HOME_URL}
          aria-label="gitube home"
          title="gitube: start over"
          className="ui-hit ui-press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ui-accent hover:bg-ui-hover"
        >
          <MetroIcon size={17} />
        </a>
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          enterKeyHint="go"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={narrow ? 'repo or user' : 'owner/repo or username'}
          aria-label="GitHub repository or user"
          aria-keyshortcuts="/"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="h-8 w-[280px] min-w-0 max-w-[55vw] shrink bg-transparent px-1.5 text-ui-text outline-none placeholder:text-ui-muted"
        />
        {value === '' && (
          <kbd
            aria-hidden
            className="pointer-events-none mr-1 hidden h-5 min-w-5 shrink-0 items-center justify-center rounded-md border border-ui-border px-1 font-sans text-[11px] text-ui-muted [@media(hover:hover)]:flex"
          >
            /
          </kbd>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          aria-busy={busy}
          className="ui-press flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ui-accent px-3.5 font-semibold text-ui-accent-text hover:opacity-90 disabled:cursor-progress disabled:opacity-70"
        >
          {busy && <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />}
          {busy ? 'loading' : 'Go'}
        </button>
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-ui-border max-sm:hidden" />
        <button
          type="button"
          onClick={onToggleToken}
          aria-pressed={tokenOpen}
          aria-label="GitHub token"
          title={token ? 'Token set. Click to edit' : 'Add a GitHub token (optional)'}
          className={iconButton(tokenOpen)}
        >
          <KeyIcon size={16} />
          {token && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ui-accent ring-2 ring-ui-panel" aria-hidden />}
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
          className={iconButton(themeOpen)}
        >
          <PaletteIcon size={16} />
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
          className={iconButton(exportOpen)}
        >
          <DownloadIcon size={16} />
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
          <LazySlot frame={`w-[352px] max-w-[calc(100vw-2rem)] ${DROPDOWN_FRAME}`} label="loading themes">
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
        <div className="ui-glass ui-pop flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-2xl border border-ui-border p-3 text-[12px] shadow-soft">
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
              className="h-8 min-w-0 flex-1 rounded-lg bg-ui-field px-2.5 font-mono text-ui-text outline-none placeholder:font-sans placeholder:text-ui-muted"
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
                  className="ui-press h-8 rounded-lg px-2.5 text-ui-muted hover:bg-ui-hover hover:text-ui-text"
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
          <p className="leading-snug text-ui-muted">
            public repos need no permissions:{' '}
            <a href={NEW_TOKEN_URL} target="_blank" rel="noreferrer" className="text-ui-accent hover:underline">
              create a token
            </a>{' '}
            with no boxes ticked. the code is{' '}
            <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="text-ui-accent hover:underline">
              public on GitHub
            </a>
            , so you can check.
          </p>
        </div>
      )}
    </div>
  )
}
