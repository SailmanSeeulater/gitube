import { useMemo, type KeyboardEvent } from 'react'
import type { Branch, RepoData, ViewMode } from '../types'
import { useGardenStore, type LayoutMode } from '../store/useGardenStore'
import { useTheme } from '../theme/useTheme'
import { STALE_OPTIONS, isStale, relativeTime } from './gardenUtils'
import Legend from './Legend'
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, SearchIcon } from './icons'

export interface PanelProps {
  data: RepoData
  /** branch name -> colour in the active theme (App's palette, not graph.palette) */
  palette: Record<string, string>
}

interface SegmentedProps<T extends string | number> {
  ariaLabel: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}

function Segmented<T extends string | number>({ ariaLabel, options, value, onChange }: SegmentedProps<T>) {
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
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-md px-2 py-1 text-[12px] transition-colors ${
              active ? 'bg-garden-hover text-garden-accent' : 'text-garden-muted hover:text-garden-text'
            }`}
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
]

const STALE_SEGMENTS = STALE_OPTIONS.map((o) => ({ value: o.days, label: o.label }))

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
        <span className="w-12 shrink-0 text-right text-[11px] text-garden-muted" title={branch.tipDate}>
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

export default function Panel({ data, palette }: PanelProps) {
  const theme = useTheme()
  const panelOpen = useGardenStore((s) => s.panelOpen)
  const togglePanel = useGardenStore((s) => s.togglePanel)
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
          onClick={togglePanel}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
        >
          <ChevronRightIcon />
        </button>
      </header>

      <div className="flex flex-col gap-2 border-b border-garden-border px-3 py-2.5">
        <div className="flex gap-2">
          <div className="flex-1">
            <Segmented ariaLabel="View" options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
          </div>
          <div className="flex-1" title="organic: free physics. metro: straight lanes, like a tube map">
            <Segmented ariaLabel="Layout" options={LAYOUT_OPTIONS} value={layoutMode} onChange={setLayoutMode} />
          </div>
        </div>
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

      <footer className="border-t border-garden-border px-3 py-2.5">
        <Legend />
      </footer>
    </aside>
  )
}
