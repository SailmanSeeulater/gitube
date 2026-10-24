import type { Graph, RepoData } from '../types'
import { preload } from '../lazy/chunk'
import { timelapseChunk } from '../lazy/parts'
import { useGardenStore } from '../store/useGardenStore'
import { formatClock, formatDateTime, relativeTime, stageLabel } from './gardenUtils'
import { PlayIcon } from './icons'

export interface StatusStripProps {
  data: RepoData | undefined
  graph: Graph | null
  isFetching: boolean
  /** the data came from a saved file: when it was saved (ISO, '' if unknown); null for live data */
  fileSavedAt?: string | null
  /** the data came from this browser's cache: when it was fetched (ISO); null for a live fetch */
  cachedAt?: string | null
  /** fetch the repo from GitHub again, skipping the cache */
  onRefresh?: () => void
  /** opens the time-lapse (the strip gives way to its controls); omitted while there is no graph */
  onTimelapse?: () => void
}

/** the time-lapse controls load as the pointer or focus reaches their button */
const preloadTimelapse = () => preload(timelapseChunk)

const shell =
  'absolute bottom-4 left-4 z-20 rounded-xl border border-garden-border bg-garden-panel/95 text-[12px] shadow-soft backdrop-blur'

export default function StatusStrip({
  data,
  graph,
  isFetching,
  fileSavedAt = null,
  cachedAt = null,
  onRefresh,
  onTimelapse,
}: StatusStripProps) {
  const progress = useGardenStore((s) => s.progress)
  const hiddenLabels = useGardenStore((s) => s.hiddenLabels)

  if (isFetching) {
    const stage = progress ? stageLabel(progress.stage) : 'starting'
    const hasTotal = progress !== null && progress.total > 0
    const pct = hasTotal ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0
    const reset = progress ? formatClock(progress.rateLimitResetAt) : ''
    return (
      <div className={`${shell} w-[320px] max-w-[calc(100vw-2rem)] px-3 py-2`} role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-garden-text">{stage}</span>
          <span className="shrink-0 font-mono tabular-nums text-garden-muted">
            {hasTotal ? `${progress.done}/${progress.total}` : ''}
          </span>
        </div>
        <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-garden-hover">
          {hasTotal ? (
            <div className="h-full bg-garden-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-1/3 animate-pulse bg-garden-accent/70" />
          )}
        </div>
        {progress?.message && <div className="mt-1 truncate text-garden-muted">{progress.message}</div>}
        {progress && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-garden-muted">
            <span>
              {progress.requestsUsed} request{progress.requestsUsed === 1 ? '' : 's'}
            </span>
            {progress.rateLimitRemaining !== null && (
              <span>
                {progress.rateLimitRemaining} left
                {reset && ` · resets ${reset}`}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  if (!data) return null

  const commitCount = Object.keys(data.commits).length
  const remaining = progress?.rateLimitRemaining ?? null

  return (
    <div className={`${shell} flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5`} role="status">
      {onTimelapse && (
        <button
          type="button"
          onClick={onTimelapse}
          onPointerEnter={preloadTimelapse}
          onFocus={preloadTimelapse}
          title="Replay the garden growing from its first loaded commit, and record it as a video"
          className="-ml-1.5 flex items-center gap-1 rounded-md bg-garden-accent/15 px-1.5 py-px text-[11px] font-medium text-garden-accent hover:bg-garden-accent/25"
        >
          <PlayIcon size={11} />
          watch it grow
        </button>
      )}
      <span className="text-garden-text-dim">
        {data.branches.length} branch{data.branches.length === 1 ? '' : 'es'}
      </span>
      <span className="text-garden-border">·</span>
      <span className="text-garden-text-dim">
        {commitCount} commit{commitCount === 1 ? '' : 's'}
      </span>
      {graph && (
        <>
          <span className="text-garden-border">·</span>
          <span className="text-garden-muted">
            {graph.nodes.length} node{graph.nodes.length === 1 ? '' : 's'} shown
          </span>
        </>
      )}
      {graph && hiddenLabels > 0 && (
        <>
          <span className="text-garden-border">·</span>
          <span className="text-garden-muted" title="Branch names that do not fit at this zoom. Hover a tip, zoom in or search to read them.">
            {hiddenLabels} name{hiddenLabels === 1 ? '' : 's'} hidden · hover, zoom or search
          </span>
        </>
      )}
      {data.truncated && (
        <span
          className="rounded-md border border-garden-warn/40 bg-garden-warn/10 px-1.5 py-px text-[11px] text-garden-warn"
          title={`History was cut short by fetch caps at ${data.truncatedAt.length} commit${data.truncatedAt.length === 1 ? '' : 's'}; dashed roots mark where it stops.`}
        >
          history truncated
        </span>
      )}
      {fileSavedAt !== null && (
        <span
          className="rounded-md border border-garden-border px-1.5 py-px text-[11px] text-garden-text-dim"
          title={`Opened from a saved file${fileSavedAt ? ` (saved ${formatDateTime(fileSavedAt)})` : ''}. Press Grow to load it live from GitHub.`}
        >
          from file{fileSavedAt && relativeTime(fileSavedAt) ? ` · saved ${relativeTime(fileSavedAt)}` : ''}
        </span>
      )}
      {cachedAt !== null && fileSavedAt === null && (
        <span
          className="flex items-center gap-1.5 rounded-md border border-garden-border px-1.5 py-px text-[11px] text-garden-text-dim"
          title={`Shown from this browser's cache (fetched ${formatDateTime(cachedAt)}), so no GitHub requests were used.`}
        >
          cached {relativeTime(cachedAt)}
          {onRefresh && (
            <button type="button" onClick={onRefresh} className="text-garden-accent hover:underline">
              refresh
            </button>
          )}
        </span>
      )}
      {remaining !== null && fileSavedAt === null && cachedAt === null && (
        <span className="text-garden-muted" title="GitHub API requests remaining this hour">
          {remaining} requests left
        </span>
      )}
    </div>
  )
}
