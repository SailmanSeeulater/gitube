import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Branch, PullSummary, RepoData, ViewMode } from '../types'
import { track } from '../analytics/umami'
import type { ContributorIndex } from '../graph/contributors'
import { branchPrs, branchUnchecked, combineMarks, countPulls, lookupPlan } from '../graph/pulls'
import type { CleanupReport } from '../graph/cleanup'
import type { PullsView } from '../hooks/usePulls'
import { preload, type Chunk } from '../lazy/chunk'
import { vsChunk, contributorsTabChunk, metroChunk, cleanupTabChunk } from '../lazy/parts'
import { useChunk } from '../lazy/useChunk'
import { useAppStore, type LayoutMode, type PanelTab } from '../store/useAppStore'
import { useTheme } from '../theme/useTheme'
import { STALE_OPTIONS, formatClock, isStale, relativeTime } from './graphUtils'
import { QUERY_HELP, hasIsPr, matchesBranchQuery, parseBranchQuery, toggleIsPr } from './branchQuery'
import { PrStatusLine, PrSwatch } from './PrGlyph'
import { prRowSuffix } from './prMark'
import Legend from './Legend'
import { ChunkPlaceholder, LazySlot, lazyPart } from './LazyPart'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, LinkIcon, SearchIcon, SwordsIcon } from './icons'

// the people and cleanup tabs load when first shown, or as the pointer or focus reaches their tab
const ContributorsTab = lazyPart(contributorsTabChunk)
const CleanupTab = lazyPart(cleanupTabChunk)
const TAB_CHUNKS: Partial<Record<PanelTab, Chunk<unknown>>> = { contributors: contributorsTabChunk, cleanup: cleanupTabChunk }
/** a lazy tab's placeholder, in the list's place */
const TAB_FRAME = 'min-h-0 flex-1 px-3 py-3'

export interface PanelProps {
  data: RepoData
  /** branch name -> colour in the active theme (App's palette, not graph.palette) */
  palette: Record<string, string>
  contributors: ContributorIndex
  cleanup: CleanupReport
  /** starts a vs against the repo typed in; false when that is not a repo */
  onVs: (value: string) => boolean
  /** the repo's open pull requests (null for a saved file): row glyphs, the count line, search qualifiers */
  pulls?: PullsView | null
  /** some tip on the canvas carries a pull request mark (the legend then explains it) */
  hasPrMarks?: boolean
  /** some of those marks have their review or checks known (the legend's glyph then shows their colours) */
  prMarksKnown?: boolean
}

/** The ⚔ form under the panel header: which repo to compare with (vs). */
function VsForm({ onVs, onDone }: { onVs: (value: string) => boolean; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (onVs(value)) onDone()
        else setBad(true)
      }}
      className="flex flex-col gap-1 border-b border-ui-border px-3 py-2"
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
          aria-label="Repo to compare"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg bg-ui-field px-2 py-1 text-[12px] text-ui-text outline-none placeholder:text-ui-muted"
        />
        <button type="submit" className="shrink-0 rounded-lg bg-ui-accent/15 px-2.5 py-1 text-[12px] font-medium text-ui-accent hover:bg-ui-accent/25">
          go
        </button>
      </div>
      <p className={`text-[11px] leading-snug ${bad ? 'text-ui-danger' : 'text-ui-muted'}`}>
        {bad ? "that doesn't look like a GitHub repo." : 'opens both side by side and scores them, measure by measure.'}
      </p>
    </form>
  )
}

/** Copies the page address, which App or PersonApp keeps naming the subject (see share/shareUrl). */
export function CopyLinkButton() {
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
      () => {
        setState('copied')
        track('share-copy')
      },
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
      className={`flex items-center gap-1 rounded p-1 text-[11px] hover:bg-ui-hover ${
        state === 'copied' ? 'text-ui-accent' : 'text-ui-muted hover:text-ui-text'
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
  leftoverCount: number
}

function preloadTab(tab: PanelTab): void {
  const chunk = TAB_CHUNKS[tab]
  if (chunk) preload(chunk)
}

function Tabs({ value, onChange, branchCount, peopleCount, leftoverCount }: TabsProps) {
  const tabs: ReadonlyArray<{ id: PanelTab; label: string; count: number }> = [
    { id: 'branches', label: 'branches', count: branchCount },
    { id: 'contributors', label: 'people', count: peopleCount },
    { id: 'cleanup', label: 'cleanup', count: leftoverCount },
  ]
  return (
    <div role="tablist" aria-label="Panel" className="flex gap-1 border-b border-ui-border px-2">
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
              active ? 'border-ui-accent text-ui-accent' : 'border-transparent text-ui-muted hover:text-ui-text'
            }`}
          >
            {tab.label}
            <span className="rounded bg-ui-hover px-1 font-mono text-[10px] tabular-nums text-ui-muted">{tab.count}</span>
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
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-lg bg-ui-field p-0.5">
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
              active ? 'bg-ui-hover text-ui-accent' : 'text-ui-muted hover:text-ui-text'
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
  { value: 'metro', label: 'metro' },
  { value: 'organic', label: 'organic' },
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
  /** the branch's open pull requests (most recently updated first) */
  prs: readonly PullSummary[]
  /**
   * The repo has a pull request on some branch: every row's dot sits in a 14 px box, ringed on the
   * rows with one. Otherwise the rows are exactly as they were.
   */
  prSwatch: boolean
  /** the pull request overlay, for the selected row's status line */
  pulls: PullsView | null
  /** GitHub did not answer for this branch: whether it has a pull request is not known */
  unchecked: boolean
}

/**
 * The selected row's pull request, under it: its review and checks in words, and its number as a
 * link. Without a token, showing it looks its review and checks up after a moment, as the inspector
 * does (and only while the hourly budget allows).
 */
function SelectedPrLine({ pr, more, pulls }: { pr: PullSummary; more: number; pulls: PullsView }) {
  const plan = lookupPlan(pr, pulls)
  const { autoLookup } = pulls
  useEffect(() => {
    if (plan !== 'auto') return
    return autoLookup(pr)
    // pr.number and plan stand for pr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr.number, plan, autoLookup])
  return (
    <div className={`flex items-center gap-2 pb-1 pl-[30px] pr-2 text-[11px] leading-[18px] ${plan === 'running' ? 'animate-pulse' : ''}`}>
      <span className="min-w-0 flex-1">
        <PrStatusLine pr={pr} compact />
      </span>
      {plan === 'ask' && (
        <button
          type="button"
          onClick={() => pulls.lookup(pr)}
          title="Look its review and checks up (3 of this hour's GitHub requests)"
          className="shrink-0 text-ui-accent hover:underline"
        >
          load
        </button>
      )}
      <a href={pr.url} target="_blank" rel="noreferrer" title={pr.title} className="shrink-0 text-ui-accent hover:underline">
        #{pr.number} ↗{more > 0 ? ` +${more}` : ''}
      </a>
    </div>
  )
}

/** What a branch row's title and label add for GitHub not answering about it. */
const UNCHECKED_SUFFIX = ', PRs not checked (GitHub did not answer)'

function BranchRow({ branch, colour, selected, hidden, now, onSelect, onToggleHidden, prs, prSwatch, pulls, unchecked }: BranchRowProps) {
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
        title={prs.length > 0 ? `${branch.name}${prRowSuffix(prs)}` : unchecked ? `${branch.name}${UNCHECKED_SUFFIX}` : branch.name}
        aria-label={
          prs.length > 0 || unchecked
            ? `${branch.name}${branch.isDefault ? ' (default)' : ''}${prs.length > 0 ? prRowSuffix(prs) : UNCHECKED_SUFFIX}`
            : undefined
        }
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
          selected ? 'bg-ui-accent/10' : 'hover:bg-ui-hover'
        } ${hidden ? 'opacity-40' : ''}`}
      >
        {prSwatch ? (
          <PrSwatch colour={colour} mark={combineMarks(prs)} />
        ) : (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} />
        )}
        <span className={`min-w-0 flex-1 truncate ${selected ? 'text-ui-accent' : 'text-ui-text'}`}>
          {branch.name}
          {branch.isDefault && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ui-muted">default</span>
          )}
        </span>
        {!branch.isDefault && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ui-muted" title="ahead / behind the default branch">
            +{branch.aheadBy} <span className="text-ui-border">/</span> -{branch.behindBy}
          </span>
        )}
        <span className="w-[3.25rem] shrink-0 whitespace-nowrap text-right text-[11px] text-ui-muted" title={branch.tipDate}>
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
          className={`shrink-0 rounded p-0.5 text-ui-muted transition-opacity hover:text-ui-text ${
            hidden ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          }`}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {selected && pulls && prs.length > 0 && <SelectedPrLine pr={prs[0]} more={prs.length - 1} pulls={pulls} />}
      {selected && pulls && prs.length === 0 && unchecked && (
        <p className="pb-1 pl-[30px] pr-2 text-[11px] leading-[18px] text-ui-muted">PRs not checked (GitHub did not answer)</p>
      )}
    </li>
  )
}

/**
 * The count line's one word on pull requests: reading them, how many branches have one (a link that
 * toggles is:pr in the search), or that they could not be read (and why, in its title); and how many
 * branches GitHub did not answer for. Nothing when the repo has none, so such a repo's panel is as
 * it always was.
 */
function PrCountPhrase({ pulls, search, onSearch }: { pulls: PullsView; search: string; onSearch: (value: string) => void }) {
  const { status, index, error } = pulls
  const dot = <span className="text-ui-border">·</span>
  if (status === 'loading') {
    return (
      <span className="flex items-center gap-2">
        {dot}
        <span role="status" className="animate-pulse">
          checking PRs…
        </span>
      </span>
    )
  }
  if (status === 'error' && error) {
    const when = error.resetAt ? formatClock(error.resetAt) : ''
    const until = when ? ` until ${when}` : ''
    const reason =
      error.code !== 'rate_limited'
        ? error.message
        : error.limit === 'secondary'
          ? `GitHub asked for a short pause (secondary rate limit)${until}.`
          : error.limit === 'graphql'
            ? `GitHub's hourly GraphQL limit for this token is used up${until}.`
            : `GitHub's hourly request limit is used up${until}${pulls.hasToken ? '.' : '; a token raises it.'}`
    const title = `Open pull requests could not be read: ${reason}`
    return (
      <span className="flex items-center gap-2">
        {dot}
        {error.retriable ? (
          <button type="button" onClick={pulls.retry} title={`${title} Click to try again.`} className="hover:text-ui-text hover:underline">
            PRs not checked
          </button>
        ) : (
          <span title={title}>PRs not checked</span>
        )}
      </span>
    )
  }
  const withPrs = index ? index.byBranch.size : 0
  const unchecked = index?.unchecked ?? []
  if (status !== 'ready' || (withPrs === 0 && unchecked.length === 0)) return null
  const on = hasIsPr(search)
  return (
    <>
      {withPrs > 0 && (
        <span className="flex items-center gap-2">
          {dot}
          <button
            type="button"
            aria-pressed={on}
            onClick={() => onSearch(toggleIsPr(search))}
            title={on ? 'Show every branch again (takes is:pr out of the search)' : `List only the branches with an open pull request (${countPulls(index)} open from branches here)`}
            className={`text-ui-accent hover:underline ${on ? 'font-medium' : ''}`}
          >
            {withPrs} with PRs
          </button>
        </span>
      )}
      {unchecked.length > 0 && (
        <span className="flex items-center gap-2">
          {dot}
          <span title={`GitHub did not answer for these branches, so whether they have pull requests is not known: ${unchecked.join(', ')}`}>
            {unchecked.length} not checked
          </span>
        </span>
      )}
    </>
  )
}

export default function Panel({ data, palette, contributors, cleanup, onVs, pulls = null, hasPrMarks = false, prMarksKnown = false }: PanelProps) {
  const [vsOpen, setVsOpen] = useState(false)
  const theme = useTheme()
  const panelOpen = useAppStore((s) => s.panelOpen)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const panelTab = useAppStore((s) => s.panelTab)
  const setPanelTab = useAppStore((s) => s.setPanelTab)
  const viewMode = useAppStore((s) => s.viewMode)
  const setViewMode = useAppStore((s) => s.setViewMode)
  const layoutMode = useAppStore((s) => s.layoutMode)
  const setLayoutMode = useAppStore((s) => s.setLayoutMode)
  const search = useAppStore((s) => s.search)
  const setSearch = useAppStore((s) => s.setSearch)
  const staleDays = useAppStore((s) => s.staleDays)
  const setStaleDays = useAppStore((s) => s.setStaleDays)
  const hiddenBranches = useAppStore((s) => s.hiddenBranches)
  const toggleBranchHidden = useAppStore((s) => s.toggleBranchHidden)
  const clearHiddenBranches = useAppStore((s) => s.clearHiddenBranches)
  const selectedBranch = useAppStore((s) => s.selectedBranch)
  const toggleSelectedBranch = useAppStore((s) => s.toggleSelectedBranch)
  // metro picked, its engine still on the way (App loads it and keeps the old layout until then)
  const metroLoading = useChunk(metroChunk, false).status === 'loading' && layoutMode === 'metro'
  const pickView = (view: ViewMode) => {
    if (view !== viewMode) track('view-mode', { view })
    setViewMode(view)
  }
  const pickLayout = (layout: LayoutMode) => {
    if (layout !== layoutMode) track('layout-switch', { layout })
    setLayoutMode(layout)
  }
  // The people tab mounts once its code is in, instead of suspending on the way: a share link's
  // ?by= selects the tab as soon as the repo is in, which from the repo cache can be before its
  // code, and Suspense would then hold the placeholder for its 300 ms fallback throttle as well.
  const peopleCode = useChunk(contributorsTabChunk, panelOpen && panelTab === 'contributors')

  // one timestamp per loaded repo keeps relative dates consistent across rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [data])

  const prIndex = pulls?.index ?? null
  /** some branch has an open pull request: the rows switch to their pull request swatches */
  const hasPrs = prIndex !== null && prIndex.byBranch.size > 0

  const rows = useMemo(() => {
    // free text matches names as it always did; is:pr, checks:failing, ... narrow the list by pull request
    const query = parseBranchQuery(search)
    const time = (b: Branch) => {
      const t = Date.parse(b.tipDate)
      return Number.isFinite(t) ? t : 0
    }
    return data.branches
      .filter((b) => matchesBranchQuery(query, b.name, branchPrs(prIndex, b.name)) && (b.isDefault || !isStale(b.tipDate, staleDays, now)))
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        return time(b) - time(a)
      })
  }, [data, search, staleDays, now, prIndex])

  // bots are left out, as the leaderboard leaves them out until asked
  const peopleCount = useMemo(() => contributors.list.filter((c) => !c.isBot).length, [contributors])

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={togglePanel}
        title="Open panel"
        aria-label="Open panel"
        className="absolute right-0 top-4 z-20 rounded-l-lg border border-r-0 border-ui-border bg-ui-panel/95 px-1.5 py-2.5 text-ui-muted shadow-soft backdrop-blur hover:text-ui-text"
      >
        <ChevronLeftIcon />
      </button>
    )
  }

  const repoUrl = `https://github.com/${data.owner}/${data.repo}`

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-ui-border bg-ui-panel/95 text-[13px] shadow-soft backdrop-blur">
      <header className="flex items-start gap-2 border-b border-ui-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            title={repoUrl}
            className="block truncate font-medium text-ui-text hover:text-ui-accent"
          >
            {data.owner}/{data.repo}
          </a>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ui-muted">
            <span>default</span>
            <span className="rounded bg-ui-hover px-1 font-mono text-ui-text-dim">{data.defaultBranch}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            // the vs view's code loads while the challenger is typed in
            if (!vsOpen) preload(vsChunk)
            setVsOpen(!vsOpen)
          }}
          aria-expanded={vsOpen}
          title="vs: open another repo beside this one and score them"
          aria-label="vs"
          className={`rounded p-1 hover:bg-ui-hover ${vsOpen ? 'text-ui-accent' : 'text-ui-muted hover:text-ui-text'}`}
        >
          <SwordsIcon />
        </button>
        <CopyLinkButton />
        <button
          type="button"
          onClick={togglePanel}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded p-1 text-ui-muted hover:bg-ui-hover hover:text-ui-text"
        >
          <ChevronRightIcon />
        </button>
      </header>

      {vsOpen && <VsForm onVs={onVs} onDone={() => setVsOpen(false)} />}

      <div className="flex gap-2 px-3 py-2.5">
        <div className="flex-1">
          <Segmented ariaLabel="View" options={VIEW_OPTIONS} value={viewMode} onChange={pickView} />
        </div>
        <div className="flex-1" title="metro: straight lanes, like a tube map. organic: free physics">
          <Segmented
            ariaLabel="Layout"
            options={LAYOUT_OPTIONS}
            value={layoutMode}
            onChange={pickLayout}
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
        leftoverCount={cleanup.leftovers.length}
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
      ) : panelTab === 'cleanup' ? (
        <LazySlot key="cleanup" frame={TAB_FRAME} label="loading cleanup">
          <CleanupTab
            report={cleanup}
            owner={data.owner}
            repo={data.repo}
            defaultBranch={data.defaultBranch}
            palette={palette}
            now={now}
            prs={prIndex?.byBranch ?? null}
            unchecked={prIndex?.unchecked ?? null}
          />
        </LazySlot>
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b border-ui-border px-3 py-2.5">
            <label className="flex items-center gap-2 rounded-lg bg-ui-field px-2 py-1 text-ui-muted focus-within:text-ui-text">
              <SearchIcon />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={hasPrs ? 'find a branch or is:pr' : 'find a branch'}
                aria-label="Find a branch"
                title={hasPrs ? QUERY_HELP : undefined}
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ui-text outline-none placeholder:text-ui-muted"
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[11px] text-ui-muted">stale</span>
              <div className="flex-1">
                <Segmented ariaLabel="Hide branches older than" options={STALE_SEGMENTS} value={staleDays} onChange={setStaleDays} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-2 px-3 pt-2 text-[11px] text-ui-muted">
            <span className="flex flex-wrap items-center gap-x-2">
              <span>
                {rows.length === data.branches.length ? `${rows.length} branches` : `${rows.length} of ${data.branches.length} branches`}
              </span>
              {pulls && <PrCountPhrase pulls={pulls} search={search} onSearch={setSearch} />}
            </span>
            <span className="flex items-center gap-2">
              {hiddenBranches.size > 0 && (
                <button type="button" onClick={clearHiddenBranches} className="text-ui-accent hover:underline">
                  show {hiddenBranches.size} hidden
                </button>
              )}
              {selectedBranch !== null && (
                <button type="button" onClick={() => toggleSelectedBranch(selectedBranch)} className="text-ui-accent hover:underline">
                  clear selection
                </button>
              )}
            </span>
          </div>

          <ul className="ui-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {rows.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-ui-muted">no branches match</li>}
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
                prs={branchPrs(prIndex, branch.name)}
                prSwatch={hasPrs}
                pulls={pulls}
                unchecked={branchUnchecked(prIndex, branch.name)}
              />
            ))}
          </ul>
        </>
      )}

      <footer className="border-t border-ui-border px-3 py-2.5">
        <Legend hasPrs={hasPrMarks} prKnown={prMarksKnown} />
      </footer>
    </aside>
  )
}
