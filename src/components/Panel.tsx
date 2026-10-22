import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Branch, RepoData, ViewMode } from '../types'
import type { ContributorIndex } from '../graph/contributors'
import type { WeedReport } from '../graph/weeds'
import { preload, type Chunk } from '../lazy/chunk'
import { battleChunk, contributorsTabChunk, metroChunk, weedsTabChunk } from '../lazy/parts'
import { useChunk } from '../lazy/useChunk'
import { useGardenStore, type LayoutMode, type PanelTab } from '../store/useGardenStore'
import { useTheme } from '../theme/useTheme'
import { STALE_OPTIONS, isStale, relativeTime } from './gardenUtils'
import Legend from './Legend'
import { ChunkPlaceholder, LazySlot, lazyPart } from './LazyPart'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, LinkIcon, SearchIcon, SwordsIcon } from './icons'

// the people and weeds tabs load when first shown, or as the pointer or focus reaches their tab
const ContributorsTab = lazyPart(contributorsTabChunk)
const WeedsTab = lazyPart(weedsTabChunk)
const TAB_CHUNKS: Partial<Record<PanelTab, Chunk<unknown>>> = { contributors: contributorsTabChunk, weeds: weedsTabChunk }
/** a lazy tab's placeholder, in the list's place */
const TAB_FRAME = 'min-h-0 flex-1 px-3 py-3'

export interface PanelProps {
  data: RepoData
  /** branch name -> colour in the active theme (App's palette, not graph.palette) */
  palette: Record<string, string>
  contributors: ContributorIndex
  weeds: WeedReport
  /** starts a garden battle against the repo typed in; false when that is not a repo */
  onBattle: (value: string) => boolean
}

/** The ⚔ form under the panel header: which repo to battle. */
function BattleForm({ onBattle, onDone }: { onBattle: (value: string) => boolean; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (onBattle(value)) onDone()
        else setBad(true)
      }}
      className="flex flex-col gap-1 border-b border-garden-border px-3 py-2"
    >
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setBad(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onDone()
            }
          }}
          placeholder="vs owner/repo"
          aria-label="Repo to battle"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg bg-garden-field px-2 py-1 text-[12px] text-garden-text outline-none placeholder:text-garden-muted"
        />
        <button type="submit" className="shrink-0 rounded-lg bg-garden-accent/15 px-2.5 py-1 text-[12px] font-medium text-garden-accent hover:bg-garden-accent/25">
          fight
        </button>
      </div>
      <p className={`text-[11px] leading-snug ${bad ? 'text-garden-danger' : 'text-garden-muted'}`}>
        {bad ? "that doesn't look like a GitHub repo." : 'grows both side by side and scores them, measure by measure.'}
      </p>
    </form>
  )
}

/** Copies the page address, which App keeps naming the repo and its selection (see share/shareUrl). */
function CopyLinkButton() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 1600)
    return () => clearTimeout(timer)
  }, [state])
  const copy = () => {
    const done = navigator.clipboard?.writeText(window.location.href)
    if (!done) {
      setState('failed')
      return
    }
    done.then(
      () => setState('copied'),
      () => setState('failed'),
    )
  }
  const label = state === 'copied' ? 'link copied' : state === 'failed' ? 'copy the address bar instead' : 'Copy a link to this view'
  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1 rounded p-1 text-[11px] hover:bg-garden-hover ${
        state === 'copied' ? 'text-garden-accent' : 'text-garden-muted hover:text-garden-text'
      }`}
    >
      {state === 'idle' ? <LinkIcon /> : state === 'copied' ? <CheckIcon /> : <span>copy failed</span>}
    </button>
  )
}

interface TabsProps {
  value: PanelTab
  onChange: (tab: PanelTab) => void
  branchCount: number
  peopleCount: number
  weedCount: number
}

function preloadTab(tab: PanelTab): void {
  const chunk = TAB_CHUNKS[tab]
  if (chunk) preload(chunk)
}

function Tabs({ value, onChange, branchCount, peopleCount, weedCount }: TabsProps) {
  const tabs: ReadonlyArray<{ id: PanelTab; label: string; count: number }> = [
    { id: 'branches', label: 'branches', count: branchCount },
    { id: 'contributors', label: 'people', count: peopleCount },
    { id: 'weeds', label: 'weeds', count: weedCount },
  ]
  return (
    <div role="tablist" aria-label="Panel" className="flex gap-1 border-b border-garden-border px-2">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            onPointerEnter={() => preloadTab(tab.id)}
            onFocus={() => preloadTab(tab.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[12px] transition-colors ${
              active ? 'border-garden-accent text-garden-accent' : 'border-transparent text-garden-muted hover:text-garden-text'
            }`}
          >
            {tab.label}
            <span className="rounded bg-garden-hover px-1 font-mono text-[10px] tabular-nums text-garden-muted">{tab.count}</span>
          </button>
        )
      })}
    </div>
  )
}

interface SegmentedProps<T extends string | number> {
  ariaLabel: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  /** the pointer or focus reached an option (to start loading what it needs) */
  onIntent?: (value: T) => void
  /** an option whose code is still loading: it pulses */
  pending?: T | null
}

function Segmented<T extends string | number>({ ariaLabel, options, value, onChange, onIntent, pending = null }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-lg bg-garden-field p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-busy={option.value === pending || undefined}
            onClick={() => onChange(option.value)}
            onPointerEnter={onIntent ? () => onIntent(option.value) : undefined}
            onFocus={onIntent ? () => onIntent(option.value) : undefined}
            className={`flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors ${
              active ? 'bg-garden-hover text-garden-accent' : 'text-garden-muted hover:text-garden-text'
            } ${option.value === pending ? 'animate-pulse' : ''}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'skeleton', label: 'skeleton' },
  { value: 'full', label: 'full' },
]

const LAYOUT_OPTIONS: ReadonlyArray<{ value: LayoutMode; label: string }> = [
  { value: 'organic', label: 'organic' },
  { value: 'metro', label: 'metro' },
  { value: 'garden', label: 'garden' },
]

const STALE_SEGMENTS = STALE_OPTIONS.map((o) => ({ value: o.days, label: o.label }))

/** the metro layout's engine is its own chunk: start on it when the pointer reaches the option */
const preloadLayout = (mode: LayoutMode) => {
  if (mode === 'metro') preload(metroChunk)
}

interface BranchRowProps {
  branch: Branch
  colour: string
  selected: boolean
  hidden: boolean
  now: number
  onSelect: () => void
  onToggleHidden: () => void
}

function BranchRow({ branch, colour, selected, hidden, now, onSelect, onToggleHidden }: BranchRowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        title={branch.name}
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
          selected ? 'bg-garden-accent/10' : 'hover:bg-garden-hover'
        } ${hidden ? 'opacity-40' : ''}`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} />
        <span className={`min-w-0 flex-1 truncate ${selected ? 'text-garden-accent' : 'text-garden-text'}`}>
          {branch.name}
          {branch.isDefault && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-garden-muted">default</span>
          )}
        </span>
        {!branch.isDefault && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-garden-muted" title="ahead / behind the default branch">
            +{branch.aheadBy} <span className="text-garden-border">/</span> -{branch.behindBy}
          </span>
        )}
        <span className="w-[3.25rem] shrink-0 whitespace-nowrap text-right text-[11px] text-garden-muted" title={branch.tipDate}>
          {relativeTime(branch.tipDate, now)}
        </span>
        <button
          type="button"
          aria-label={hidden ? `Show ${branch.name}` : `Hide ${branch.name}`}
          aria-pressed={hidden}
          onClick={(event) => {
            event.stopPropagation()
            onToggleHidden()
          }}
          className={`shrink-0 rounded p-0.5 text-garden-muted transition-opacity hover:text-garden-text ${
            hidden ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          }`}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </li>
  )
}

export default function Panel({ data, palette, contributors, weeds, onBattle }: PanelProps) {
  const [battleOpen, setBattleOpen] = useState(false)
  const theme = useTheme()
  const panelOpen = useGardenStore((s) => s.panelOpen)
  const togglePanel = useGardenStore((s) => s.togglePanel)
  const panelTab = useGardenStore((s) => s.panelTab)
  const setPanelTab = useGardenStore((s) => s.setPanelTab)
  const viewMode = useGardenStore((s) => s.viewMode)
  const setViewMode = useGardenStore((s) => s.setViewMode)
  const layoutMode = useGardenStore((s) => s.layoutMode)
  const setLayoutMode = useGardenStore((s) => s.setLayoutMode)
  const search = useGardenStore((s) => s.search)
  const setSearch = useGardenStore((s) => s.setSearch)
  const staleDays = useGardenStore((s) => s.staleDays)
  const setStaleDays = useGardenStore((s) => s.setStaleDays)
  const hiddenBranches = useGardenStore((s) => s.hiddenBranches)
  const toggleBranchHidden = useGardenStore((s) => s.toggleBranchHidden)
  const clearHiddenBranches = useGardenStore((s) => s.clearHiddenBranches)
  const selectedBranch = useGardenStore((s) => s.selectedBranch)
  const toggleSelectedBranch = useGardenStore((s) => s.toggleSelectedBranch)
  // metro picked, its engine still on the way (App loads it and keeps the old layout until then)
  const metroLoading = useChunk(metroChunk, false).status === 'loading' && layoutMode === 'metro'
  // The people tab mounts once its code is in, instead of suspending on the way: a share link's
  // ?by= selects the tab as soon as the repo is in, which from the repo cache can be before its
  // code, and Suspense would then hold the placeholder for its 300 ms fallback throttle as well.
  const peopleCode = useChunk(contributorsTabChunk, panelOpen && panelTab === 'contributors')

  // one timestamp per loaded repo keeps relative dates consistent across rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [data])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const time = (b: Branch) => {
      const t = Date.parse(b.tipDate)
      return Number.isFinite(t) ? t : 0
    }
    return data.branches
      .filter((b) => (q === '' || b.name.toLowerCase().includes(q)) && (b.isDefault || !isStale(b.tipDate, staleDays, now)))
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        return time(b) - time(a)
      })
  }, [data, search, staleDays, now])

  // bots are left out, as the leaderboard leaves them out until asked
  const peopleCount = useMemo(() => contributors.list.filter((c) => !c.isBot).length, [contributors])

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={togglePanel}
        title="Open panel"
        aria-label="Open panel"
        className="absolute right-0 top-4 z-20 rounded-l-lg border border-r-0 border-garden-border bg-garden-panel/95 px-1.5 py-2.5 text-garden-muted shadow-soft backdrop-blur hover:text-garden-text"
      >
        <ChevronLeftIcon />
      </button>
    )
  }

  const repoUrl = `https://github.com/${data.owner}/${data.repo}`

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-garden-border bg-garden-panel/95 text-[13px] shadow-soft backdrop-blur">
      <header className="flex items-start gap-2 border-b border-garden-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            title={repoUrl}
            className="block truncate font-medium text-garden-text hover:text-garden-accent"
          >
            {data.owner}/{data.repo}
          </a>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-garden-muted">
            <span>default</span>
            <span className="rounded bg-garden-hover px-1 font-mono text-garden-text-dim">{data.defaultBranch}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            // the battle's code loads while the challenger is typed in
            if (!battleOpen) preload(battleChunk)
            setBattleOpen(!battleOpen)
          }}
          aria-expanded={battleOpen}
          title="Garden battle: grow another repo beside this one and score them"
          aria-label="Garden battle"
          className={`rounded p-1 hover:bg-garden-hover ${battleOpen ? 'text-garden-accent' : 'text-garden-muted hover:text-garden-text'}`}
        >
          <SwordsIcon />
        </button>
        <CopyLinkButton />
        <button
          type="button"
          onClick={togglePanel}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
        >
          <ChevronRightIcon />
        </button>
      </header>

      {battleOpen && <BattleForm onBattle={onBattle} onDone={() => setBattleOpen(false)} />}

      <div className="flex gap-2 px-3 py-2.5">
        <div className="flex-1">
          <Segmented ariaLabel="View" options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
        </div>
        <div className="flex-[1.45]" title="organic: free physics. metro: straight lanes, like a tube map. garden: grown upward as plants">
          <Segmented
            ariaLabel="Layout"
            options={LAYOUT_OPTIONS}
            value={layoutMode}
            onChange={setLayoutMode}
            onIntent={preloadLayout}
            pending={metroLoading ? 'metro' : null}
          />
        </div>
      </div>

      <Tabs
        value={panelTab}
        onChange={setPanelTab}
        branchCount={data.branches.length}
        peopleCount={peopleCount}
        weedCount={weeds.weeds.length}
      />

      {panelTab === 'contributors' ? (
        peopleCode.status === 'ready' ? (
          <LazySlot key="contributors" frame={TAB_FRAME} label="loading people">
            <ContributorsTab contributors={contributors} palette={palette} now={now} />
          </LazySlot>
        ) : (
          // coming back to the tab, or the pointer reaching it, tries again
          <ChunkPlaceholder
            key="contributors"
            frame={TAB_FRAME}
            label="loading people"
            failed={peopleCode.status === 'failed'}
          />
        )
      ) : panelTab === 'weeds' ? (
        <LazySlot key="weeds" frame={TAB_FRAME} label="loading weeds">
          <WeedsTab
            report={weeds}
            owner={data.owner}
            repo={data.repo}
            defaultBranch={data.defaultBranch}
            palette={palette}
            now={now}
          />
        </LazySlot>
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b border-garden-border px-3 py-2.5">
            <label className="flex items-center gap-2 rounded-lg bg-garden-field px-2 py-1 text-garden-muted focus-within:text-garden-text">
              <SearchIcon />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="find a branch"
                aria-label="Find a branch"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-garden-text outline-none placeholder:text-garden-muted"
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[11px] text-garden-muted">stale</span>
              <div className="flex-1">
                <Segmented ariaLabel="Hide branches older than" options={STALE_SEGMENTS} value={staleDays} onChange={setStaleDays} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 pt-2 text-[11px] text-garden-muted">
            <span>
              {rows.length === data.branches.length ? `${rows.length} branches` : `${rows.length} of ${data.branches.length} branches`}
            </span>
            <span className="flex items-center gap-2">
              {hiddenBranches.size > 0 && (
                <button type="button" onClick={clearHiddenBranches} className="text-garden-accent hover:underline">
                  show {hiddenBranches.size} hidden
                </button>
              )}
              {selectedBranch !== null && (
                <button type="button" onClick={() => toggleSelectedBranch(selectedBranch)} className="text-garden-accent hover:underline">
                  clear selection
                </button>
              )}
            </span>
          </div>

          <ul className="garden-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {rows.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-garden-muted">no branches match</li>}
            {rows.map((branch) => (
              <BranchRow
                key={branch.name}
                branch={branch}
                colour={palette[branch.name] ?? theme.fallback}
                selected={selectedBranch === branch.name}
                hidden={hiddenBranches.has(branch.name)}
                now={now}
                onSelect={() => toggleSelectedBranch(branch.name)}
                onToggleHidden={() => toggleBranchHidden(branch.name)}
              />
            ))}
          </ul>
        </>
      )}

      <footer className="border-t border-garden-border px-3 py-2.5">
        <Legend />
      </footer>
    </aside>
  )
}
