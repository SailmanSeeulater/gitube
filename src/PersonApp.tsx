import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseSubject } from './api/parseSubject'
import type { RepoInitial } from './RepoApp'
import type { ProfileData } from './types'
import { writeUserShare, type PersonView } from './share/shareUrl'
import { useGardenStore } from './store/useGardenStore'
import { useTheme } from './theme/useTheme'
import TopBar from './components/TopBar'
import ErrorCard from './components/ErrorCard'
import { reloadPage } from './components/LazyPart'
import StatusStrip from './components/StatusStrip'
import { useProfileData } from './profile/useProfileData'
import { usePersonAnalytics } from './profile/usePersonAnalytics'
import { RequestTracker, analyticsInput, refreshProfile, requestKey, startRequest } from './profile/personRequests'
import { buildLifeTimeline, type LifeTimeline } from './profile/timeline'
import { buildDayIndex } from './profile/dayIndex'
import { languageColour, languagePalette } from './profile/lifeInk'
import { isRevealed, privateRepoKeys, repoNamer } from './profile/privacy'
import { personErrorCopy } from './profile/personErrors'
import { usePersonStore } from './profile/usePersonStore'
import LifeView from './profile/LifeViewCanvas'
import type { LifeViewDef, LifeViewModel } from './profile/lifeView'
import { LIFE_VIEWS, switchView } from './profile/lifeViews'
import PersonPanel from './profile/PersonPanel'
import PersonInspector from './profile/PersonInspector'
import PersonStatus from './profile/PersonStatus'
import PersonTimelapse from './profile/PersonTimelapse'
import { closeLifeTimelapse, openLifeTimelapse } from './profile/lifeTimelapse'
import { posterFailure, saveLifePoster } from './profile/lifePoster'

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
 * Each view's layout of one timeline, made the first time the view is asked for and kept for every
 * switch back to it: a layout is pure, so the kept one is the one the view would make again. A new
 * timeline (a new profile) takes a new set.
 */
export function viewLayouts(timeline: LifeTimeline, source: ProfileData['source']): (def: LifeViewDef) => LifeViewModel {
  const made = new Map<LifeViewDef, LifeViewModel>()
  return (def) => {
    const kept = made.get(def)
    if (kept) return kept
    const layout: LifeViewModel = def.layout(timeline, source)
    made.set(def, layout)
    return layout
  }
}

/**
 * Person mode (?user=): one GitHub user's coding life as a garden, life lines or a constellation
 * (the panel's view switcher), with the side panel, the inspector, the status strip and the privacy
 * toggle, the time-lapse (with its recording), the poster (from the panel or the top bar's "Save
 * image") and the copy-link button, all shared by the three views. Every repo name on show goes
 * through one namer, so a private repo's name is hidden until the toggle reveals it for this login;
 * a recording and a poster use the same namer (the toggle and the switcher wait while a recording
 * runs), and a copied link names only the user and the view.
 */
export default function PersonApp({ login, request, view: linkedView, focusInput, onRepo, onUser }: PersonAppProps) {
  const [input, setInput] = useState(login)
  const [invalidUrl, setInvalidUrl] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  // The view on show, first the link's: a new login keeps it (App passes no view for one), and the
  // panel's switcher changes it (switchView, which counts it).
  const [view, setView] = useState<PersonView>(() => linkedView ?? 'garden')
  const pickView = useCallback((next: PersonView) => switchView(view, next, setView), [view])
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** the canvas wrapper: the time-lapse records the canvas inside it */
  const canvasHostRef = useRef<HTMLDivElement | null>(null)

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

  // The life is read once per profile, today being when it arrived; the view on show is laid out
  // from it, once per view: a switch back reuses that view's layout until the timeline changes. Every
  // view spans the same days, so a switch keeps the camera and the selection in view.
  const timeline = useMemo(() => (profile ? buildLifeTimeline(profile, Date.now()) : null), [profile])
  const layoutOf = useMemo(() => (profile && timeline ? viewLayouts(timeline, profile.source) : null), [profile, timeline])
  const def = LIFE_VIEWS[view]
  const layout = useMemo(() => layoutOf?.(def) ?? null, [layoutOf, def])
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

  /** a part that loads on demand (the recorder, the exporters) could not be loaded: the reload card */
  const [chunkFailed, setChunkFailed] = useState(false)
  const showChunkFailed = useCallback(() => setChunkFailed(true), [])

  // ---- time-lapse ----
  const [lapseOpen, setLapseOpen] = useState(false)
  /** a recording is running: the privacy toggle and the view switcher wait for it to end */
  const [lapseRecording, setLapseRecording] = useState(false)
  /** 0..1; the controls write it every frame and LifeView reads it in every paint, without renders; a view switch keeps it */
  const lapseProgress = useRef(1)
  // one identity while it is on: the painter is made per value
  // live while playing, recording or scrubbing: a paused time-lapse stops repainting (a new object
  // each time it changes, so the garden takes up a new painter and wakes its loop)
  const [lapseLive, setLapseLive] = useState(true)
  const lifeLapse = useMemo(
    () => (lapseOpen && profile ? { progress: lapseProgress, title: profile.login, live: lapseLive } : null),
    [lapseOpen, profile, lapseLive],
  )
  const openLapse = useCallback(
    () =>
      openLifeTimelapse(lapseProgress, () => {
        usePersonStore.getState().clearSelection()
        setLapseLive(true)
        setLapseOpen(true)
      }),
    [],
  )
  const closeLapse = useCallback(
    () =>
      closeLifeTimelapse(lapseProgress, () => {
        setLapseOpen(false)
        setLapseRecording(false)
      }),
    [],
  )
  // a new login or request, or a different profile, starts with the whole life on show (before
  // paint, like startRequest); a view switch does not, so the time-lapse carries on in the new view
  useLayoutEffect(() => closeLapse(), [asked, profile, closeLapse])
  const getCanvas = useCallback(() => canvasHostRef.current?.querySelector('canvas') ?? null, [])

  // ---- poster: the view on show fully grown, framed, with the names as the screen shows them now ----
  const [posterBusy, setPosterBusy] = useState(false)
  const [posterError, setPosterError] = useState<string | null>(null)
  // a new login or request leaves the last one's poster error and reload card behind
  useEffect(() => {
    setPosterError(null)
    setChunkFailed(false)
  }, [asked])
  const savePoster = useCallback(async () => {
    if (!profile || !timeline || !layout) return
    setPosterBusy(true)
    try {
      await saveLifePoster({ profile, timeline, view: def, layout, theme, colourOf, name, hidden: usePersonStore.getState().hidden })
      setPosterError(null)
    } catch (err) {
      // the exporters chunk could not be loaded: the reload card, not a module URL
      const failure = posterFailure(err)
      if (failure.code === 'chunk_failed') setChunkFailed(true)
      else setPosterError(failure.message)
    } finally {
      setPosterBusy(false)
    }
  }, [profile, timeline, def, layout, theme, colourOf, name])

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
      setPosterError(null)
      setChunkFailed(false)
      setTokenOpen(false)
      // the time-lapse stays on (its controls are always in), as in the repo garden
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const errorCopy = error ? personErrorCopy(error, login, hasToken) : null
  const shown = profile !== undefined && timeline !== null

  return (
    <div className="relative h-full w-full overflow-hidden bg-garden-bg text-garden-text">
      {/* The canvas stops short of the side panel so the fitted life never hides behind it. One canvas
          serves every view, so a switch keeps its camera, and a recording of it keeps going. */}
      <div ref={canvasHostRef} className="absolute inset-y-0 left-0" style={{ right: shown && panelOpen ? PANEL_INSET : 0 }}>
        {profile && timeline && layout && (
          <LifeView def={def} layout={layout} timeline={timeline} theme={theme} colourOf={colourOf} name={name} login={profile.login} timelapse={lifeLapse} />
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
        canExport={layout !== null && !posterBusy}
        canExportData={false}
        onExportImage={savePoster}
        onExportData={noop}
        onOpenFile={openFile}
        besidePanel={shown && panelOpen}
      />

      {invalidUrl && <ErrorCard code="invalid_url" onDismiss={() => setInvalidUrl(false)} />}
      {!invalidUrl && chunkFailed && <ErrorCard code="chunk_failed" onReload={reloadPage} onDismiss={() => setChunkFailed(false)} />}
      {!invalidUrl && !chunkFailed && posterError !== null && (
        <ErrorCard code="export_failed" title="couldn't save the poster" hint={`${posterError}. try again.`} onDismiss={() => setPosterError(null)} />
      )}
      {!invalidUrl && !chunkFailed && posterError === null && error && errorCopy && !isFetching && (
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
          revealLocked={lapseRecording}
          theme={theme}
          onPoster={layout ? savePoster : undefined}
          posterBusy={posterBusy}
          view={view}
          onView={pickView}
          viewLocked={lapseRecording}
        />
      )}

      {/* the time-lapse controls take the status strip's place while it is on, as in the repo garden */}
      {lapseOpen && profile && timeline && layout ? (
        <PersonTimelapse
          onClose={closeLapse}
          timeline={timeline}
          login={profile.login}
          progress={lapseProgress}
          getCanvas={getCanvas}
          besidePanel={panelOpen}
          revealed={revealed}
          onRecordingChange={setLapseRecording}
          onLiveChange={setLapseLive}
          onChunkFailed={showChunkFailed}
        />
      ) : isFetching ? (
        <StatusStrip data={undefined} graph={null} isFetching />
      ) : (
        profile &&
        timeline && (
          <PersonStatus
            profile={profile}
            timeline={timeline}
            cachedAt={cachedAt}
            hasToken={hasToken}
            onRefresh={refresh}
            onAddToken={openToken}
            onTimelapse={layout ? openLapse : undefined}
          />
        )
      )}

      {profile && timeline && days && <PersonInspector profile={profile} timeline={timeline} days={days} colourOf={colourOf} name={name} />}
    </div>
  )
}
