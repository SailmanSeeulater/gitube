import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseSubject } from './api/parseSubject'
import type { RepoInitial } from './RepoApp'
import { writeUserShare, type PersonView } from './share/shareUrl'
import { useGardenStore } from './store/useGardenStore'
import { useTheme } from './theme/useTheme'
import TopBar from './components/TopBar'
import ErrorCard from './components/ErrorCard'
import StatusStrip from './components/StatusStrip'
import { useProfileData } from './profile/useProfileData'
import { usePersonAnalytics } from './profile/usePersonAnalytics'
import { RequestTracker, analyticsInput, refreshProfile, requestKey, startRequest } from './profile/personRequests'
import { buildLifeTimeline } from './profile/timeline'
import { layoutLifeGarden } from './profile/lifeGardenLayout'
import { buildDayIndex } from './profile/dayIndex'
import { languageColour, languagePalette } from './profile/lifeInk'
import { isRevealed, privateRepoKeys, repoNamer } from './profile/privacy'
import { personErrorCopy } from './profile/personErrors'
import { usePersonStore } from './profile/usePersonStore'
import LifeGarden from './profile/LifeGarden'
import PersonPanel from './profile/PersonPanel'
import PersonInspector from './profile/PersonInspector'
import PersonStatus from './profile/PersonStatus'

export interface PersonAppProps {
  /** as typed (GitHub compares logins case-insensitively) */
  login: string
  /** counts the grows of this login, so a new one can refetch it */
  request: number
  /** the view a ?user= link named, carried through unchanged */
  view: PersonView | null
  /** reached from the input, whose element the switch replaced: focus this one's input */
  focusInput: boolean
  /** a repo typed, or a saved file opened or dropped: back to the repo garden */
  onRepo: (initial: RepoInitial) => void
  /** a login typed */
  onUser: (login: string) => void
}

/** Side panel width (300px) plus its 12px edge gap and a 12px breathing gap, as in the repo garden. */
const PANEL_INSET = 324

const NO_KEYS: ReadonlySet<string> = new Set<string>()

const noop = () => {}

/**
 * The query string person mode writes: the login and the view, and nothing else of its own. What is
 * hidden, selected or revealed, and every repo name, stays out of the address bar (and so out of
 * every copied link).
 */
export function personSearch(login: string, view: PersonView, current: string): string {
  return writeUserShare({ login, view }, current)
}

/**
 * Person mode (?user=): one GitHub user's coding life as a garden, with the side panel, the
 * inspector, the status strip and the privacy toggle. Every repo name on show goes through one
 * namer, so a private repo's name is hidden until the toggle reveals it for this login.
 */
export default function PersonApp({ login, request, view: linkedView, focusInput, onRepo, onUser }: PersonAppProps) {
  const [input, setInput] = useState(login)
  const [invalidUrl, setInvalidUrl] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  // The view on show, set once from the link: a new login keeps it (App passes no view for one).
  const [view] = useState<PersonView>(() => linkedView ?? 'garden')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const theme = useTheme()
  const panelOpen = useGardenStore((s) => s.panelOpen)
  const hasToken = useGardenStore((s) => s.token.trim() !== '')
  const revealFor = usePersonStore((s) => s.revealFor)
  const setReveal = usePersonStore((s) => s.setReveal)

  const fetched = useProfileData(login)
  const { profile, cachedAt, error, isFetching, refetch } = fetched

  // A new login or a new request starts clean: nothing hidden, selected or revealed. Before paint,
  // so the last request's revealed names never show for a frame; and whatever ends a request (a new
  // one, or leaving person mode) hides the names again, so a remount's first render cannot show them.
  const asked = requestKey(login, request)
  useLayoutEffect(() => startRequest(usePersonStore.getState(), asked), [asked])

  // The same login asked for again is fetched again, live, as Grow refetches the same repo, unless a
  // fetch in flight answers it. A new login needs no refetch: its own query reads the cache first.
  const [tracker] = useState(() => new RequestTracker(asked))
  useEffect(() => {
    if (tracker.refetchFor(asked, isFetching)) refetch()
  }, [tracker, asked, isFetching, refetch])

  // grow, once per request for a profile (analytics.ts has the rules)
  const noteGrow = usePersonAnalytics(analyticsInput(login, request, fetched))

  // The life is read once per profile, today being when it arrived; the garden is laid out from it.
  const timeline = useMemo(() => (profile ? buildLifeTimeline(profile, Date.now()) : null), [profile])
  const layout = useMemo(() => (profile && timeline ? layoutLifeGarden(timeline, profile.source) : null), [profile, timeline])
  const days = useMemo(() => (profile && timeline ? buildDayIndex(profile, timeline) : null), [profile, timeline])

  // Language colours in the active theme: a theme switch repaints, the layout stays put.
  const palette = useMemo(() => (timeline ? languagePalette(timeline, theme) : {}), [timeline, theme])
  const colourOf = useCallback((language: string | null) => languageColour(palette, language, theme), [palette, theme])

  // Private names are hidden unless the toggle was turned on for the person on show.
  const shownLogin = profile?.login ?? login
  const privateKeys = useMemo(() => (profile ? privateRepoKeys(profile) : NO_KEYS), [profile])
  const revealed = isRevealed(revealFor, shownLogin)
  const name = useMemo(() => repoNamer(privateKeys, revealed), [privateKeys, revealed])
  const reveal = useCallback((on: boolean) => setReveal(shownLogin, on), [setReveal, shownLogin])

  // The address bar names the person and the view, so a reload or a copied link reopens them.
  useEffect(() => {
    const search = personSearch(login, view, window.location.search)
    if (search !== window.location.search) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
    }
  }, [login, view])

  // the input takes both kinds, as in the repo garden
  const submit = useCallback(() => {
    const subject = parseSubject(input)
    if (!subject) {
      setInvalidUrl(true)
      return
    }
    setInvalidUrl(false)
    if (subject.kind === 'repo') onRepo({ input })
    else onUser(subject.login)
  }, [input, onRepo, onUser])

  // a switch from the repo garden's input lands typing in this one, as Grow leaves it in the input
  useEffect(() => {
    if (focusInput) inputRef.current?.focus()
    // on mount only: later grows keep this input, and its focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleToken = useCallback(() => setTokenOpen((open) => !open), [])
  const openToken = useCallback(() => setTokenOpen(true), [])
  const openFile = useCallback((file: File) => onRepo({ file }), [onRepo])
  /** the status strip's refresh: a new request for the person on show, from GitHub */
  const refresh = useCallback(() => refreshProfile(login, { noteGrow, refetch }), [login, noteGrow, refetch])

  // a saved .json dropped anywhere on the page opens it in the repo garden
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      const file = event.dataTransfer?.files[0]
      if (file) openFile(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFile])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      usePersonStore.getState().clearSelection()
      setInvalidUrl(false)
      setTokenOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const errorCopy = error ? personErrorCopy(error, login, hasToken) : null
  const shown = profile !== undefined && timeline !== null

  return (
    <div className="relative h-full w-full overflow-hidden bg-garden-bg text-garden-text">
      {/* The canvas stops short of the side panel so the fitted life never hides behind it. */}
      <div className="absolute inset-y-0 left-0" style={{ right: shown && panelOpen ? PANEL_INSET : 0 }}>
        {profile && timeline && layout && (
          <LifeGarden timeline={timeline} layout={layout} theme={theme} colourOf={colourOf} name={name} login={profile.login} />
        )}
      </div>

      {!profile && isFetching && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="animate-pulse text-[13px] text-garden-muted">growing {login}…</p>
        </div>
      )}

      <TopBar
        value={input}
        onChange={setInput}
        onSubmit={submit}
        inputRef={inputRef}
        tokenOpen={tokenOpen}
        onToggleToken={toggleToken}
        busy={isFetching}
        canExport={false}
        onExportImage={noop}
        onExportData={noop}
        onOpenFile={openFile}
        besidePanel={shown && panelOpen}
      />

      {invalidUrl && <ErrorCard code="invalid_url" onDismiss={() => setInvalidUrl(false)} />}
      {!invalidUrl && error && errorCopy && !isFetching && (
        <ErrorCard
          code={error.code}
          message={error.message}
          resetAt={error.resetAt}
          title={errorCopy.title}
          hint={errorCopy.hint}
          onAddToken={errorCopy.tokenAction ? openToken : undefined}
        />
      )}

      {profile && timeline && (
        <PersonPanel
          profile={profile}
          timeline={timeline}
          colourOf={colourOf}
          name={name}
          privateCount={privateKeys.size}
          revealed={revealed}
          onReveal={reveal}
          theme={theme}
        />
      )}

      {isFetching ? (
        <StatusStrip data={undefined} graph={null} isFetching />
      ) : (
        profile &&
        timeline && (
          <PersonStatus profile={profile} timeline={timeline} cachedAt={cachedAt} hasToken={hasToken} onRefresh={refresh} onAddToken={openToken} />
        )
      )}

      {profile && timeline && days && <PersonInspector profile={profile} timeline={timeline} days={days} colourOf={colourOf} name={name} />}
    </div>
  )
}
