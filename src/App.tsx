import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseRepoUrl, type RepoRef } from './api/parseRepoUrl'
import { assignPalette, buildContributors, buildFullGraph, buildGraph, contributorFocus } from './graph'
import { buildTimeline } from './graph/timeline'
import { buildScore } from './graph/score'
import { findWeeds, type WeedReport } from './graph/weeds'
import TimelapseBar from './components/TimelapseBar'
import GardenBattle from './components/GardenBattle'
import type { GardenTimelapse } from './components/Garden'
import type { ContributorFocus, ContributorIndex } from './graph'
import type { Graph, RepoData } from './types'
import { GardenFileError, gardenFileName, parseGardenFile, serializeGarden } from './export/gardenFile'
import { canvasToPng, composeGraphImage, downloadBlob } from './export/image'
import { readShareState, writeShareState, type ShareState } from './share/shareUrl'
import { useRepoData } from './hooks/useRepoData'
import { useGardenStore } from './store/useGardenStore'
import { applyTheme } from './theme/applyTheme'
import { readStoredThemeId } from './theme/storage'
import { THEME_STORAGE_KEY } from './theme/themes'
import { useTheme } from './theme/useTheme'
import Garden from './components/Garden'
import TopBar from './components/TopBar'
import Panel from './components/Panel'
import StatusStrip from './components/StatusStrip'
import ErrorCard from './components/ErrorCard'
import EmptyState from './components/EmptyState'
import NodeInspector from './components/NodeInspector'
import { staleBranchNames } from './components/gardenUtils'
import { useMetroView } from './components/useMetroView'

/** Side panel width (300px) plus its 12px edge gap and a 12px breathing gap. */
const PANEL_INSET = 324

/** GitHub owner and repo names are case-insensitive. */
function sameRepo(a: RepoRef | null, b: RepoRef): boolean {
  return a !== null && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
}

export default function App() {
  // A share link (?repo=...&branch=... or &by=...) grows its repo straight away; its selection is
  // applied once that repo's data is in (see the share link effects below).
  const [initialShare] = useState<ShareState>(() => readShareState(typeof window === 'undefined' ? '' : window.location.search))
  const pendingShare = useRef<ShareState | null>(initialShare.repo ? initialShare : null)
  const [input, setInput] = useState(() => (initialShare.repo ? `${initialShare.repo.owner}/${initialShare.repo.repo}` : ''))
  const [repoRef, setRepoRef] = useState<RepoRef | null>(initialShare.repo)
  const [invalidUrl, setInvalidUrl] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  /** A garden opened from a saved file; it stands in for fetched data until the next Grow. */
  const [opened, setOpened] = useState<{ data: RepoData; savedAt: string } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)

  const viewMode = useGardenStore((s) => s.viewMode)
  const layoutMode = useGardenStore((s) => s.layoutMode)
  const hiddenBranches = useGardenStore((s) => s.hiddenBranches)
  const staleDays = useGardenStore((s) => s.staleDays)
  const inspectorNodeId = useGardenStore((s) => s.inspectorNodeId)
  const setInspectorNodeId = useGardenStore((s) => s.setInspectorNodeId)
  const selectedBranch = useGardenStore((s) => s.selectedBranch)
  const setSelectedBranch = useGardenStore((s) => s.setSelectedBranch)
  const selectedContributor = useGardenStore((s) => s.selectedContributor)
  const setSelectedContributor = useGardenStore((s) => s.setSelectedContributor)
  const setPanelTab = useGardenStore((s) => s.setPanelTab)
  const setPanelOpen = useGardenStore((s) => s.setPanelOpen)
  const clearSelection = useGardenStore((s) => s.clearSelection)
  const resetForNewRepo = useGardenStore((s) => s.resetForNewRepo)
  const panelOpen = useGardenStore((s) => s.panelOpen)
  const theme = useTheme()

  // The DOM half of a theme switch: CSS variables, color-scheme and theme-color, before paint.
  useLayoutEffect(() => applyTheme(theme), [theme])

  // Another tab picked a theme: follow it (the storage event only fires in the other tabs).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
      const themeId = readStoredThemeId()
      if (useGardenStore.getState().themeId !== themeId) useGardenStore.setState({ themeId })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const fetched = useRepoData(repoRef)
  // a garden battle: the challenger grows beside the repo on show (a share link may name one)
  const [battleRef, setBattleRef] = useState<RepoRef | null>(initialShare.vs ?? null)
  const challenger = useRepoData(battleRef)
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
  // which branches it removes (the store has no data.branches). App is the one place that
  // knows the full hidden set, so it drops a selection the filter invalidated; otherwise the
  // panel's "clear selection" link and aria-pressed rows keep pointing at a hidden branch.
  useEffect(() => {
    if (selectedBranch !== null && effectiveHidden.has(selectedBranch)) setSelectedBranch(null)
  }, [effectiveHidden, selectedBranch, setSelectedBranch])

  const graph = useMemo<Graph | null>(
    () => (data ? buildGraph(data, viewMode, { hiddenBranches: effectiveHidden }) : null),
    [data, viewMode, effectiveHidden],
  )

  // the leaderboard covers every fetched commit, whatever is hidden
  const contributors = useMemo<ContributorIndex | null>(() => (data ? buildContributors(data) : null), [data])
  // merged branches to clear away, and thorny ones drifting far from the default branch
  const weeds = useMemo<WeedReport | null>(() => (data ? findWeeds(data) : null), [data])

  // ---- share links ----
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
    const search = writeShareState({ repo, branch: selectedBranch, person: selectedContributor, vs: battleRef }, window.location.search)
    if (search !== window.location.search) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
    }
  }, [shownOwner, shownRepo, selectedBranch, selectedContributor, battleRef])

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
  /** 0..1; the controls write it every frame and Garden reads it in every paint, without renders */
  const timelapseProgress = useRef(1)
  // when each shown node and stem appears; skeleton links are dated through the full graph
  const timeline = useMemo(() => {
    if (!timelapseOpen || !data || !graph) return null
    return buildTimeline(graph, viewMode === 'full' ? graph : buildFullGraph(data, effectiveHidden))
  }, [timelapseOpen, data, graph, viewMode, effectiveHidden])
  // the same history as notes, for the music box (pitches follow the palette's branch order)
  const score = useMemo(
    () => (timeline && data && graph ? buildScore(graph, timeline, data.branches.map((b) => b.name), data.defaultBranch) : null),
    [timeline, data, graph],
  )
  const gardenTimelapse = useMemo<GardenTimelapse | null>(
    () => (timeline && data ? { timeline, progress: timelapseProgress, title: `${data.owner}/${data.repo}` } : null),
    [timeline, data],
  )
  const openTimelapse = useCallback(() => setTimelapseOpen(true), [])
  const closeTimelapse = useCallback(() => {
    setTimelapseOpen(false)
    timelapseProgress.current = 1
  }, [])
  // a different repo starts with the whole garden on show
  useEffect(() => closeTimelapse(), [data, closeTimelapse])
  const getGraphCanvas = useCallback(() => canvasHostRef.current?.querySelector('canvas') ?? null, [])
  const timelapseFileName = useCallback(
    (ext: string) => (data ? gardenFileName(data, ext, new Date(), 'timelapse') : `repo-garden-timelapse.${ext}`),
    [data],
  )

  // metro mode: the straight layout of exactly this graph (null in organic mode)
  const metro = useMetroView(graph, data ?? null, viewMode, layoutMode === 'metro')

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
   * Parse the value and start a fetch. Growing the same repo again refetches in place, so a
   * failed or cancelled fetch can be retried from the Grow button (as the error cards promise)
   * instead of silently doing nothing because the query key did not change.
   */
  const grow = useCallback(
    (value: string) => {
      const parsed = parseRepoUrl(value)
      if (!parsed) {
        setInvalidUrl(true)
        return
      }
      setInvalidUrl(false)
      setFileError(null)
      setOpened(null)
      resetForNewRepo()
      if (sameRepo(repoRef, parsed)) {
        if (!isFetching) refetch()
      } else {
        setRepoRef(parsed)
      }
    },
    [repoRef, isFetching, refetch, resetForNewRepo],
  )

  const submit = useCallback(() => grow(input), [grow, input])

  // Example chips fill the input and grow straight away.
  const pickExample = useCallback(
    (example: string) => {
      setInput(example)
      grow(example)
    },
    [grow],
  )

  const openToken = useCallback(() => setTokenOpen(true), [])
  const toggleToken = useCallback(() => setTokenOpen((open) => !open), [])
  const handleNodeClick = useCallback((id: string) => setInspectorNodeId(id), [setInspectorNodeId])
  const handleBackgroundClick = useCallback(() => clearSelection(), [clearSelection])
  const closeInspector = useCallback(() => setInspectorNodeId(null), [setInspectorNodeId])
  // the inspector's author link: highlight that person and show them in the leaderboard
  const startBattle = useCallback(
    (value: string): boolean => {
      const ref = parseRepoUrl(value)
      if (!ref) return false
      // a selection made for one repo means nothing to the other
      clearSelection()
      setBattleRef(ref)
      return true
    },
    [clearSelection],
  )
  const endBattle = useCallback(() => setBattleRef(null), [])

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

  /** The graph canvas as it is on screen, captioned with the repo and what the view shows. */
  const exportImage = useCallback(async () => {
    const canvas = canvasHostRef.current?.querySelector('canvas')
    if (!data || !canvas) return
    const commitCount = Object.keys(data.commits).length
    const parts = [viewMode, layoutMode, `${data.branches.length} branches`, `${commitCount} commits`]
    if (selectedBranch !== null) parts.push(`branch ${selectedBranch}`)
    const person = selectedContributor !== null ? contributors?.list.find((c) => c.key === selectedContributor) : undefined
    if (person) parts.push(`commits by ${person.name}`)
    const day = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    try {
      const image = composeGraphImage(canvas, theme, {
        title: `${data.owner}/${data.repo}`,
        detail: parts.join(' · '),
        credit: `repo-garden · ${day}`,
      })
      downloadBlob(await canvasToPng(image), gardenFileName(data, 'png'))
      setExportError(null)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }, [data, viewMode, layoutMode, selectedBranch, selectedContributor, contributors, theme])

  const exportData = useCallback(() => {
    if (!data) return
    downloadBlob(new Blob([serializeGarden(data)], { type: 'application/json' }), gardenFileName(data, 'json'))
  }, [data])

  const openFile = useCallback(
    async (file: File) => {
      try {
        const saved = parseGardenFile(await file.text())
        resetForNewRepo()
        setOpened({ data: saved.data, savedAt: saved.savedAt })
        // no fetch while a file is open; Grow (the input now names the repo) loads it live
        setRepoRef(null)
        setInput(`${saved.data.owner}/${saved.data.repo}`)
        setInvalidUrl(false)
        setFileError(null)
      } catch (err) {
        setFileError(err instanceof GardenFileError ? err.message : 'the file could not be read.')
      }
    },
    [resetForNewRepo],
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      clearSelection()
      setInvalidUrl(false)
      setFileError(null)
      setExportError(null)
      setTokenOpen(false)
      setBattleRef(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearSelection])

  const showEmpty = !graph && !isFetching && !error && !invalidUrl && fileError === null
  const showGrowing = !graph && isFetching && repoRef !== null

  return (
    <div className="relative h-full w-full overflow-hidden bg-garden-bg text-garden-text">
      {/* The canvas stops short of the side panel so zoom-to-fit never hides nodes behind it. */}
      <div ref={canvasHostRef} className="absolute inset-y-0 left-0" style={{ right: graph && panelOpen ? PANEL_INSET : 0 }}>
        {graph && (
          <Garden
            graph={graph}
            palette={palette}
            theme={theme}
            viewMode={viewMode}
            defaultBranch={data?.defaultBranch ?? ''}
            onNodeClick={handleNodeClick}
            onBackgroundClick={handleBackgroundClick}
            metro={metro}
            focus={focus}
            timelapse={gardenTimelapse}
            thorns={weeds?.thorns ?? null}
            garden={layoutMode === 'garden'}
          />
        )}
      </div>

      {showEmpty && <EmptyState onPick={pickExample} />}
      {showGrowing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="animate-pulse text-[13px] text-garden-muted">
            growing {repoRef.owner}/{repoRef.repo}…
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
      {!invalidUrl && fileError !== null && <ErrorCard code="bad_file" message={fileError} onDismiss={() => setFileError(null)} />}
      {!invalidUrl && fileError === null && exportError !== null && (
        <ErrorCard code="export_failed" message={exportError} onDismiss={() => setExportError(null)} />
      )}
      {!invalidUrl && fileError === null && exportError === null && error && !isFetching && (
        <ErrorCard code={error.code} message={error.message} resetAt={error.resetAt} onAddToken={openToken} />
      )}

      {data && graph && contributors && weeds && <Panel data={data} palette={palette} contributors={contributors} weeds={weeds} onBattle={startBattle} />}

      {timelapseOpen && graph ? (
        <TimelapseBar
          onClose={closeTimelapse}
          timeline={timeline}
          score={score}
          progress={timelapseProgress}
          getCanvas={getGraphCanvas}
          fileName={timelapseFileName}
          besidePanel={panelOpen}
        />
      ) : (
        <StatusStrip
          data={data}
          graph={graph}
          isFetching={isFetching}
          fileSavedAt={opened ? opened.savedAt : null}
          cachedAt={cachedAt}
          onRefresh={refetch}
          onTimelapse={graph ? openTimelapse : undefined}
        />
      )}

      {inspectorNode && graph && (
        <NodeInspector
          node={inspectorNode}
          palette={palette}
          onClose={closeInspector}
          authorKey={contributors?.keyBySha.get(inspectorNode.id) ?? null}
          onShowAuthor={showContributor}
        />
      )}

      {battleRef && data && (
        <GardenBattle
          a={data}
          b={challenger.data}
          bRef={battleRef}
          bFetching={challenger.isFetching}
          bError={challenger.error}
          theme={theme}
          onRetry={challenger.refetch}
          onClose={endBattle}
        />
      )}
    </div>
  )
}
