import { useCallback, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useGardenStore } from '../store/useGardenStore'
import { getTheme } from '../theme/themes'
import { KeyIcon, PaletteIcon, SproutIcon } from './icons'
import ThemePicker from './ThemePicker'

export interface TopBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  inputRef: RefObject<HTMLInputElement | null>
  tokenOpen: boolean
  onToggleToken: () => void
  busy: boolean
}

export default function TopBar({ value, onChange, onSubmit, inputRef, tokenOpen, onToggleToken, busy }: TopBarProps) {
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

  // The theme picker and the token panel drop down from the bar in the same place: one at a time.
  const themeId = useGardenStore((s) => s.themeId)
  const setThemeId = useGardenStore((s) => s.setThemeId)
  const [themeOpen, setThemeOpen] = useState(false)
  const themeButtonRef = useRef<HTMLButtonElement | null>(null)
  const themeListId = useId()
  const [seenTokenOpen, setSeenTokenOpen] = useState(tokenOpen)
  if (tokenOpen !== seenTokenOpen) {
    // the token panel opened (its button, or an error card's "add a token"): the picker gives way
    setSeenTokenOpen(tokenOpen)
    if (tokenOpen) setThemeOpen(false)
  }
  const toggleTheme = () => {
    if (!themeOpen && tokenOpen) onToggleToken()
    setThemeOpen((open) => !open)
  }
  const closeTheme = useCallback((refocus: boolean) => {
    setThemeOpen(false)
    if (refocus) themeButtonRef.current?.focus()
  }, [])

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
    <div className="absolute left-4 top-4 z-20 flex max-w-[calc(100vw-2rem)] flex-col gap-2">
      <div className="flex items-center gap-1 rounded-xl border border-garden-border bg-garden-panel/95 p-1.5 text-[13px] shadow-soft backdrop-blur">
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
          className="w-[280px] max-w-[55vw] bg-transparent px-2 py-1 text-garden-text outline-none placeholder:text-garden-muted"
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
      </div>

      {themeOpen && (
        <ThemePicker id={themeListId} value={themeId} onChange={setThemeId} onClose={closeTheme} buttonRef={themeButtonRef} />
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
