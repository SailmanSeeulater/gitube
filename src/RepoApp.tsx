import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseRepoUrl, type RepoRef } from './api/parseRepoUrl'
import { parseSubject } from './api/parseSubject'
import { assignPalette, buildContributors, buildFullGraph, buildGraph, contributorFocus } from './graph'
import { buildTimeline } from './graph/timeline'
import { findCleanup, type CleanupReport } from './graph/cleanup'
import { healthItems, repoHealth } from './graph/health'
import { countPulls, prMarks } from './graph/pulls'
import type { RepoGraphTimelapse } from './components/RepoGraph'
import type { ContributorFocus, ContributorIndex } from './graph'
import type { Graph, RepoData } from './types'
import { releaseAudio, readSound, unlockAudio } from './audio/context'
import { preload } from './lazy/chunk'
import { vsChunk, contributorsTabChunk, exportersChunk, metroChunk, timelapseChunk } from './lazy/parts'
import { useChunk } from './lazy/useChunk'
import { readShareState, writeShareState, type ShareState } from './share/shareUrl'
import { track } from './analytics/umami'
import { useRepoAnalytics } from './analytics/useRepoAnalytics'
import { useRepoData } from './hooks/useRepoData'
import { usePulls } from './hooks/usePulls'
import { useAppStore, type LayoutMode } from './store/useAppStore'
import { useTheme } from './theme/useTheme'
import RepoGraph from './components/RepoGraph'
import TopBar from './components/TopBar'
import Panel from './components/Panel'
import StatusStrip from './components/StatusStrip'
import ErrorCard from './components/ErrorCard'
import EmptyState from './components/EmptyState'
import NodeInspector, { type InspectorPulls } from './components/NodeInspector'
import { staleBranchNames } from './components/graphUtils'
import { ChunkPlaceholder, LazySlot, lazyPart, reloadPage } from './components/LazyPart'
import { useMetroView } from './components/useMetroView'

/** Side panel width (300px) plus its 12px edge gap and a 12px breathing gap. */
const PANEL_INSET = 324

// loaded when first opened (see lazy/parts.ts)
const TimelapseBar = lazyPart(timelapseChunk)
const VsView = lazyPart(vsChunk)

/** The time-lapse controls' placeholder while they load, where they will be (and the status strip was). */
const TIMELAPSE_FRAME =
  'absolute bottom-4 left-4 z-20 rounded-xl border border-ui-border bg-ui-panel/95 px-3 py-2 shadow-soft backdrop-blur'
/** The vs view's placeholder: vs covers the app, so its placeholder does. */
const VS_FRAME = 'absolute inset-0 z-30 flex items-center justify-center bg-ui-bg'

/** GitHub owner and repo names are case-insensitive. */
function sameRepo(a: RepoRef | null, b: RepoRef): boolean {
  return a !== null && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
}

/** What person mode hands over: a repo typed there, or a saved file opened or dropped there. */
export type RepoInitial = { input: string } | { file: File }

export interface RepoAppProps {
  /** a login was loaded: the router switches to person mode */
  onUser: (login: string) => void
  /** run once on mount, as if typed into the input or dropped on the page */
  initial?: RepoInitial
}

export default function RepoApp({ onUser, initial }: RepoAppProps) {
  // A share link (?repo=...&branch=... or &by=...) loads its repo straight away; its selection is
  // applied once that repo's data is in (see the share link effects below).
  const [initialShare] = useState<ShareState>(() => readShareState(typeof window === 'undefined' ? '' : window.location.search))
  const pendingShare = useRef<ShareState | null>(initialShare.repo ? initialShare : null)
  const [input, setInput] = useState(() => (initialShare.repo ? `${initialShare.repo.owner}/${initialShare.repo.repo}` : ''))
  const [repoRef, setRepoRef] = useState<RepoRef | null>(initialShare.repo)
  const [invalidUrl, setInvalidUrl] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  /** A repo opened from a saved file; it stands in for fetched data until the next Go. */
  const [opened, setOpened] = useState<{ data: RepoData; savedAt: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  /** a part of the app that loads on demand could not be fetched, even on its retry: offer a reload */
  const [chunkFailed, setChunkFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)

  const viewMode = useAppStore((s) => s.viewMode)
  const layoutMode = useAppStore((s) => s.layoutMode)
  const hiddenBranches = useAppStore((s) => s.hiddenBranches)
  const staleDays = useAppStore((s) => s.staleDays)
  const inspectorNodeId = useAppStore((s) => s.inspectorNodeId)
  const setInspectorNodeId = useAppStore((s) => s.setInspectorNodeId)
  const selectedBranch = useAppStore((s) => s.selectedBranch)
  const setSelectedBranch = useAppStore((s) => s.setSelectedBranch)
  const selectedContributor = useAppStore((s) => s.selectedContributor)
  const setSelectedContributor = useAppStore((s) => s.setSelectedContributor)
  const setPanelTab = useAppStore((s) => s.setPanelTab)
  const setPanelOpen = useAppStore((s) => s.setPanelOpen)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const resetForNewRepo = useAppStore((s) => s.resetForNewRepo)
  const panelOpen = useAppStore((s) => s.panelOpen)
  const theme = useTheme()

  const fetched = useRepoData(repoRef)
  // a vs: the challenger loads beside the repo on show (a share link may name one)
  const [vsRef, setVsRef] = useState<RepoRef | null>(initialShare.vs ?? null)
  const challenger = useRepoData(vsRef)
  // The vs view's code loads as soon as a vs is named, a share link's included, while the repo
  // data is still on its way. Its overlay mounts once the code is in instead of suspending: a map
  // read from the repo cache would otherwise wait out Suspense's 300 ms fallback throttle as well.
  const vsCode = useChunk(vsChunk, vsRef !== null)
  const { error, isFetching, refetch } = fetched
  const data = opened?.data ?? fetched.data
  const cachedAt = opened ? null : fetched.cachedAt

  // eye-toggled branches plus anything the stale filter removes
  const effectiveHidden = useMemo<ReadonlySet<string>>(() => {
    if (!data) return hiddenBranches
    const stale = staleBranchNames(data.branches, staleDays)
    if (stale.length === 0) return hiddenBranches
    const merged = new Set(hiddenBranches)
    for (const name of stale) merged.add(name)
    return merged
  }, [data, hiddenBranches, staleDays])

  // The eye toggle clears a selection through hideBranch, but the stale filter does not know
  // which branches it removes (the store has no data.branches). RepoApp is the one place that
  // knows the full hidden set, so it drops a selection the filter invalidated; otherwise the
  // panel's "clear selection" link and aria-pressed rows keep pointing at a hidden branch.
  useEffect(() => {
    if (selectedBranch !== null && effectiveHidden.has(selectedBranch)) setSelectedBranch(null)
  }, [effectiveHidden, selectedBranch, setSelectedBranch])

  const graph = useMemo<Graph | null>(
    () => (data ? buildGraph(data, viewMode, { hiddenBranches: effectiveHidden }) : null),
    [data, viewMode, effectiveHidden],
  )

  // ---- pull requests (the overlay) ----
  // The repo's open pull requests, once its graph is in and its own fetch has finished: never for a
  // saved file (no network at all), never for a vs challenger, and not while a challenger
  // named by a share link is still loading (the anonymous budget goes to it first).
  const pullsEnabled = opened === null && fetched.data !== undefined && !isFetching && !(vsRef !== null && challenger.isFetching)
  const pulls = usePulls(opened ? null : fetched.data, pullsEnabled)
  /** tip node id -> its pull request mark; empty when there are none (the canvas then looks as before) */
  const marks = useMemo(() => prMarks(graph, opened ? null : pulls.index), [graph, opened, pulls.index])
  /** some mark has its review or checks known (else all are the gapped ring in the tip's own colour): the legend shows what is drawn */
  const prMarksKnown = useMemo(() => [...marks.values()].some((m) => m.review !== 'unknown' || m.checks !== 'unknown'), [marks])
  const pullsInvalidate = pulls.invalidate

  // load, fetch-error and pr-overlay (the click events are sent where each click is handled)
  const noteLoad = useRepoAnalytics({
    data: fetched.data,
    fetchedAt: fetched.fetchedAt,
    cachedAt: fetched.cachedAt,
    isFetching,
    error,
    pullsStatus: pulls.status,
    pullsIndex: pulls.index,
    prMarkCount: marks.size,
    initialRepo: initialShare.repo,
  })

  // the leaderboard covers every fetched commit, whatever is hidden
  const contributors = useMemo<ContributorIndex | null>(() => (data ? buildContributors(data) : null), [data])
  // merged branches to clear away, and diverged ones drifting far from the default branch
  const cleanup = useMemo<CleanupReport | null>(() => (data ? findCleanup(data) : null), [data])
  // the status strip's health line: bus factor, branch lifetime, pull request hygiene
  const health = useMemo(
    () => (data && contributors && cleanup ? healthItems(repoHealth(data, contributors, cleanup, pulls.index)) : null),
    [data, contributors, cleanup, pulls.index],
  )

  // ---- share links ----
  // A link to a person (?by=) opens the people tab once the repo is in: start on its code now, while
  // the repo is fetched, not after (the vs view's code, ?vs=, starts through vsCode above).
  useEffect(() => {
    if (initialShare.person !== null) preload(contributorsTabChunk)
  }, [initialShare])

  // The link's selection, once its repo has loaded (a link to another repo's data is dropped).
  useEffect(() => {
    const pending = pendingShare.current
    if (pending === null || !data || !contributors) return
    pendingShare.current = null
    if (!pending.repo || !sameRepo(pending.repo, data)) return
    if (pending.branch !== null && data.branches.some((b) => b.name === pending.branch)) {
      setSelectedBranch(pending.branch)
    } else if (pending.person !== null && contributors.list.some((c) => c.key === pending.person)) {
      setSelectedContributor(pending.person)
      setPanelTab('contributors')
    }
  }, [data, contributors, setSelectedBranch, setSelectedContributor, setPanelTab])

  // The address bar follows the repo on show and its selection, so copying it shares this view.
  // replaceState: Back leaves the app rather than stepping through every click.
  const shownOwner = data?.owner ?? repoRef?.owner ?? null
  const shownRepo = data?.repo ?? repoRef?.repo ?? null
  useEffect(() => {
    // leave an incoming link alone until its selection has been applied
    if (pendingShare.current !== null) return
    const repo = shownOwner !== null && shownRepo !== null ? { owner: shownOwner, repo: shownRepo } : null
    const search = writeShareState({ repo, branch: selectedBranch, person: selectedContributor, vs: vsRef }, window.location.search)
    if (search !== window.location.search) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
    }
  }, [shownOwner, shownRepo, selectedBranch, selectedContributor, vsRef])

  // The selected person's commits to keep lit. Skeleton links stand for runs of hidden commits, so
  // the full graph (same hidden branches) is walked to see whose commits each run holds.
  const focus = useMemo<ContributorFocus | null>(() => {
    if (!data || !graph || !contributors || selectedContributor === null) return null
    const person = contributors.list.find((c) => c.key === selectedContributor)
    const full = viewMode === 'full' ? graph : buildFullGraph(data, effectiveHidden)
    const branches = person ? person.branches.map((b) => b.name) : []
    return contributorFocus(graph, full, contributors.keyBySha, selectedContributor, branches)
  }, [data, graph, contributors, selectedContributor, viewMode, effectiveHidden])

  // ---- time-lapse ----
  const [timelapseOpen, setTimelapseOpen] = useState(false)
  /** 0..1; the controls write it every frame and RepoGraph reads it in every paint, without renders */
  const timelapseProgress = useRef(1)
  // when each shown node and link appears; skeleton links are dated through the full graph
  const timeline = useMemo(() => {
    if (!timelapseOpen || !data || !graph) return null
    return buildTimeline(graph, viewMode === 'full' ? graph : buildFullGraph(data, effectiveHidden))
  }, [timelapseOpen, data, graph, viewMode, effectiveHidden])
  const graphTimelapse = useMemo<RepoGraphTimelapse | null>(
    () => (timeline && data ? { timeline, progress: timelapseProgress, title: `${data.owner}/${data.repo}` } : null),
    [timeline, data],
  )
  const openTimelapse = useCallback(() => {
    // The music box was left on and its code is not in yet: start audio in this click, as WebKit
    // allows only within a gesture, and the controls may mount after a fetch (see audio/context).
    if (readSound() && !timelapseChunk.peek()) unlockAudio()
    // the map goes back to its first commit at once, while the controls may still be loading
    timelapseProgress.current = 0
    setTimelapseOpen(true)
    track('timelapse-play')
  }, [])
  const closeTimelapse = useCallback(() => {
    setTimelapseOpen(false)
    timelapseProgress.current = 1
    // closed before the controls loaded and took the audio openTimelapse started
    releaseAudio()
  }, [])
  const timelapseFailed = useCallback(() => {
    closeTimelapse()
    setChunkFailed(true)
  }, [closeTimelapse])
  // a different repo starts with the whole map on show
  useEffect(() => closeTimelapse(), [data, closeTimelapse])
  // left for person mode while the controls were loading: free the audio openTimelapse started
  useEffect(() => () => releaseAudio(), [])
  const getGraphCanvas = useCallback(() => canvasHostRef.current?.querySelector('canvas') ?? null, [])

  // ---- layouts ----
  // Metro's engine is a chunk of its own, loaded once metro is picked (or was the saved layout).
  // Until it is in, the canvas keeps the layout it had and then tweens across as before; a repo
  // about to appear for the first time waits for it, so the metro default never flashes organic.
  const metroWanted = layoutMode === 'metro'
  const metroEngine = useChunk(metroChunk, metroWanted)
  const metroLayout = metroWanted && metroEngine.status === 'ready' ? metroEngine.value.metroLayout : null
  const drawnLayoutRef = useRef<LayoutMode>(metroWanted ? 'organic' : layoutMode)
  /** the layout on the canvas: layoutMode, except that metro waits for its engine */
  const drawnLayout: LayoutMode = metroWanted && !metroLayout ? drawnLayoutRef.current : layoutMode
  useEffect(() => {
    drawnLayoutRef.current = drawnLayout
  }, [drawnLayout])
  const graphShownRef = useRef(false)
  const holdGraph = metroWanted && !metroLayout && metroEngine.status !== 'failed' && !graphShownRef.current
  const showGraph = graph !== null && !holdGraph
  useEffect(() => {
    graphShownRef.current = showGraph
  }, [showGraph])
  // The engine could not be loaded: the switch goes back to the layout on the canvas and the reload
  // card says why. Not saved, so the saved layout stays metro for the reload; picking metro again
  // tries again, under a new URL (see lazy/chunk.ts). The state is read live, not as this render
  // saw it: when metro is picked after a failure, useChunk's effect (declared above) has already
  // started that new try, so this waits for its outcome. A failure changes the status again, and
  // this runs again.
  useEffect(() => {
    if (!metroWanted || metroChunk.state().status !== 'failed') return
    const shown = drawnLayoutRef.current
    useAppStore.setState({ layoutMode: shown === 'metro' ? 'organic' : shown })
    setChunkFailed(true)
  }, [metroWanted, metroEngine.status])

  // metro mode: the straight layout of exactly this graph (null in the other layouts)
  const metro = useMetroView(graph, data ?? null, viewMode, metroLayout)

  // Branch colours in the active theme. Kept out of the graph memo so a theme switch is a repaint:
  // the graph, its layout and the labels stay put. Covers every branch, hidden ones included.
  const palette = useMemo<Record<string, string>>(
    () => (data ? assignPalette(data.branches.map((branch) => branch.name), data.defaultBranch, theme) : {}),
    [data, theme],
  )

  const nodeById = useMemo(() => {
    if (!graph) return null
    const map = new Map<string, Graph['nodes'][number]>()
    for (const node of graph.nodes) map.set(node.id, node)
    return map
  }, [graph])
  const inspectorNode = inspectorNodeId !== null && nodeById ? (nodeById.get(inspectorNodeId) ?? null) : null

  /**
   * Parse the value and start a fetch. Loading the same repo again refetches in place, so a
   * failed or cancelled fetch can be retried from the Go button (as the error cards promise)
   * instead of silently doing nothing because the query key did not change.
   */
  const load = useCallback(
    (value: string) => {
      const subject = parseSubject(value)
      if (!subject) {
        setInvalidUrl(true)
        return
      }
      // a login: person mode takes over, before anything here is reset, fetched or counted
      if (subject.kind === 'user') {
        onUser(subject.login)
        return
      }
      const parsed = subject.repo
      setInvalidUrl(false)
      setFileError(null)
      setChunkFailed(false)
      setOpened(null)
      resetForNewRepo()
      // a fetch already in flight for the same repo answers this Go too
      noteLoad(parsed)
      if (sameRepo(repoRef, parsed)) {
        if (!isFetching) {
          // its pull requests are read again once the graph is in
          pullsInvalidate()
          refetch()
        }
      } else {
        setRepoRef(parsed)
      }
    },
    [repoRef, isFetching, refetch, resetForNewRepo, pullsInvalidate, noteLoad, onUser],
  )

  const submit = useCallback(() => load(input), [load, input])

  // Example chips fill the input and load straight away.
  const pickExample = useCallback(
    (example: string) => {
      setInput(example)
      load(example)
    },
    [load],
  )

  const openToken = useCallback(() => setTokenOpen(true), [])
  /** the status strip's refresh (and the inspector's): the graph from GitHub, then its pull requests */
  const refresh = useCallback(() => {
    if (repoRef) noteLoad(repoRef)
    pullsInvalidate()
    refetch()
  }, [repoRef, noteLoad, pullsInvalidate, refetch])
  const inspectorPulls = useMemo<InspectorPulls | null>(
    () =>
      opened || !fetched.data
        ? null
        : { view: pulls, data: fetched.data, graphAt: fetched.fetchedAt, onAddToken: openToken, onRefresh: refresh },
    [opened, fetched.data, fetched.fetchedAt, pulls, openToken, refresh],
  )
  const toggleToken = useCallback(() => setTokenOpen((open) => !open), [])
  const handleNodeClick = useCallback((id: string) => setInspectorNodeId(id), [setInspectorNodeId])
  const handleBackgroundClick = useCallback(() => clearSelection(), [clearSelection])
  const closeInspector = useCallback(() => setInspectorNodeId(null), [setInspectorNodeId])
  // the inspector's author link: highlight that person and show them in the leaderboard
  const startVs = useCallback(
    (value: string): boolean => {
      const ref = parseRepoUrl(value)
      if (!ref) return false
      // a selection made for one repo means nothing to the other
      clearSelection()
      setVsRef(ref)
      track('vs-start')
      return true
    },
    [clearSelection],
  )
  const endVs = useCallback(() => setVsRef(null), [])
  const vsFailed = useCallback(() => {
    setVsRef(null)
    setChunkFailed(true)
  }, [])
  // The vs view's code could not be loaded: drop the vs, once it would have shown, and say why.
  // Read live, as for metro: a vs named again after a failure has already started a new try.
  useEffect(() => {
    if (vsRef === null || !data || vsChunk.state().status !== 'failed') return
    vsFailed()
  }, [vsRef, data, vsCode.status, vsFailed])

  const showContributor = useCallback(
    (key: string) => {
      setSelectedContributor(key)
      setPanelTab('contributors')
      setPanelOpen(true)
    },
    [setSelectedContributor, setPanelTab, setPanelOpen],
  )

  // ---- save and open ----
  const [exportError, setExportError] = useState<string | null>(null)

  /**
   * The export code (see lazy/parts.ts), or null and the reload card when it cannot be loaded. The
   * save menu brings it along, so from the menu this resolves at once.
   */
  const loadExporters = useCallback(async () => {
    try {
      return await exportersChunk.load()
    } catch {
      setChunkFailed(true)
      return null
    }
  }, [])

  /** The graph canvas as it is on screen, captioned with the repo and what the view shows. */
  const exportImage = useCallback(async () => {
    const canvas = canvasHostRef.current?.querySelector('canvas')
    if (!data || !canvas) return
    const kit = await loadExporters()
    if (!kit) return
    const commitCount = Object.keys(data.commits).length
    const parts = [viewMode, drawnLayout, `${data.branches.length} branches`, `${commitCount} commits`]
    const prCount = marks.size > 0 && !timelapseOpen ? countPulls(pulls.index) : 0
    if (prCount > 0) parts.push(`${prCount} open PR${prCount === 1 ? '' : 's'}`)
    if (selectedBranch !== null) parts.push(`branch ${selectedBranch}`)
    const person = selectedContributor !== null ? contributors?.list.find((c) => c.key === selectedContributor) : undefined
    if (person) parts.push(`commits by ${person.name}`)
    const day = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    try {
      const image = kit.composeGraphImage(canvas, theme, {
        title: `${data.owner}/${data.repo}`,
        detail: parts.join(' · '),
        credit: `gitube · ${day}`,
      })
      kit.downloadBlob(await kit.canvasToPng(image), kit.exportFileName(data, 'png'))
      setExportError(null)
      track('export', { format: 'png' })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }, [data, loadExporters, viewMode, drawnLayout, selectedBranch, selectedContributor, contributors, theme, marks, timelapseOpen, pulls.index])

  const exportData = useCallback(async () => {
    if (!data) return
    const kit = await loadExporters()
    if (!kit) return
    kit.downloadBlob(new Blob([kit.serializeRepoFile(data)], { type: 'application/json' }), kit.exportFileName(data, 'json'))
    track('export', { format: 'json' })
  }, [data, loadExporters])

  const openFile = useCallback(
    async (file: File) => {
      const kit = await loadExporters()
      if (!kit) return
      try {
        const saved = kit.parseRepoFile(await file.text())
        resetForNewRepo()
        setOpened({ data: saved.data, savedAt: saved.savedAt })
        // no fetch while a file is open; Go (the input now names the repo) loads it live
        setRepoRef(null)
        setInput(`${saved.data.owner}/${saved.data.repo}`)
        setInvalidUrl(false)
        setFileError(null)
        track('export', { format: 'repo-file' })
      } catch (err) {
        setFileError(err instanceof kit.RepoFileError ? err.message : 'the file could not be read.')
      }
    },
    [resetForNewRepo, loadExporters],
  )

  // a saved .json dropped anywhere on the page opens it
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
      if (file) void openFile(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFile])

  // What person mode handed over goes the way of an example chip or a dropped file, so load,
  // analytics and the address bar behave as if it had been typed here. Once: StrictMode runs
  // effects twice on mount, and later renders bring new callbacks.
  const initialRun = useRef(false)
  useEffect(() => {
    if (initialRun.current || !initial) return
    initialRun.current = true
    if ('file' in initial) void openFile(initial.file)
    else {
      pickExample(initial.input)
      // typed in person mode, whose input the switch replaced: keep typing in this one
      inputRef.current?.focus()
    }
  }, [initial, openFile, pickExample])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      clearSelection()
      setInvalidUrl(false)
      setFileError(null)
      setExportError(null)
      setChunkFailed(false)
      setTokenOpen(false)
      setVsRef(null)
      // the time-lapse while its controls are still loading (once they are in, Escape leaves it on)
      if (timelapseChunk.state().status !== 'ready') closeTimelapse()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection, closeTimelapse])

  const showEmpty = !graph && !isFetching && !error && !invalidUrl && fileError === null
  // also while a first map waits for the metro engine (see layouts)
  const showLoading = (!graph && isFetching && repoRef !== null) || (graph !== null && holdGraph)

  return (
    <div className="relative h-full w-full overflow-hidden bg-ui-bg text-ui-text">
      {/* The canvas stops short of the side panel so zoom-to-fit never hides nodes behind it. */}
      <div ref={canvasHostRef} className="absolute inset-y-0 left-0" style={{ right: graph && panelOpen ? PANEL_INSET : 0 }}>
        {graph && showGraph && (
          <RepoGraph
            graph={graph}
            palette={palette}
            theme={theme}
            viewMode={viewMode}
            defaultBranch={data?.defaultBranch ?? ''}
            onNodeClick={handleNodeClick}
            onBackgroundClick={handleBackgroundClick}
            metro={metro}
            focus={focus}
            timelapse={graphTimelapse}
            spikes={cleanup?.spikes ?? null}
            prMarks={timelapseOpen ? null : marks}
          />
        )}
      </div>

      {showEmpty && <EmptyState onPick={pickExample} />}
      {showLoading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="animate-pulse text-[13px] text-ui-muted">
            loading {shownOwner}/{shownRepo}…
          </p>
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
        canExport={graph !== null}
        onExportImage={exportImage}
        onExportData={exportData}
        onOpenFile={openFile}
        besidePanel={graph !== null && panelOpen}
      />

      {invalidUrl && <ErrorCard code="invalid_url" onDismiss={() => setInvalidUrl(false)} />}
      {!invalidUrl && chunkFailed && <ErrorCard code="chunk_failed" onReload={reloadPage} onDismiss={() => setChunkFailed(false)} />}
      {!invalidUrl && !chunkFailed && fileError !== null && (
        <ErrorCard code="bad_file" message={fileError} onDismiss={() => setFileError(null)} />
      )}
      {!invalidUrl && !chunkFailed && fileError === null && exportError !== null && (
        <ErrorCard code="export_failed" message={exportError} onDismiss={() => setExportError(null)} />
      )}
      {!invalidUrl && !chunkFailed && fileError === null && exportError === null && error && !isFetching && (
        <ErrorCard code={error.code} message={error.message} resetAt={error.resetAt} onAddToken={openToken} />
      )}

      {data && graph && contributors && cleanup && (
        <Panel
          data={data}
          palette={palette}
          contributors={contributors}
          cleanup={cleanup}
          onVs={startVs}
          pulls={opened ? null : pulls}
          hasPrMarks={marks.size > 0 && !timelapseOpen}
          prMarksKnown={prMarksKnown}
        />
      )}

      {timelapseOpen && graph && data ? (
        <LazySlot
          frame={TIMELAPSE_FRAME}
          onFailed={timelapseFailed}
          fallback={
            // the map is back at its first commit and the status strip is gone: offer a way out
            <div className={`${TIMELAPSE_FRAME} flex items-center gap-3`}>
              <p role="status" className="animate-pulse text-[12px] text-ui-muted">
                loading the time-lapse…
              </p>
              <button type="button" onClick={closeTimelapse} className="text-[12px] font-medium text-ui-accent hover:underline">
                cancel
              </button>
            </div>
          }
        >
          <TimelapseBar
            onClose={closeTimelapse}
            graph={graph}
            data={data}
            timeline={timeline}
            progress={timelapseProgress}
            getCanvas={getGraphCanvas}
            besidePanel={panelOpen}
          />
        </LazySlot>
      ) : (
        <StatusStrip
          data={data}
          graph={graph}
          isFetching={isFetching}
          fileSavedAt={opened ? opened.savedAt : null}
          cachedAt={cachedAt}
          onRefresh={refresh}
          onTimelapse={graph ? openTimelapse : undefined}
          health={health}
        />
      )}

      {inspectorNode && graph && (
        <NodeInspector
          node={inspectorNode}
          palette={palette}
          onClose={closeInspector}
          authorKey={contributors?.keyBySha.get(inspectorNode.id) ?? null}
          onShowAuthor={showContributor}
          pulls={inspectorPulls}
        />
      )}

      {vsRef &&
        data &&
        (vsCode.status === 'ready' ? (
          <LazySlot frame={VS_FRAME} label="setting up vs" onFailed={vsFailed}>
            <VsView
              a={data}
              b={challenger.data}
              bRef={vsRef}
              bFetching={challenger.isFetching}
              bError={challenger.error}
              theme={theme}
              onRetry={challenger.refetch}
              onClose={endVs}
            />
          </LazySlot>
        ) : (
          // its code is still on the way (a failure drops the vs: see vsFailed)
          <ChunkPlaceholder frame={VS_FRAME} label="setting up vs" />
        ))}
    </div>
  )
}
