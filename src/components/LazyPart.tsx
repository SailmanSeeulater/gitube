import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react'
import { isChunkLoadError, type Chunk } from '../lazy/chunk'

/**
 * Reloads the page. index.html is served no-cache (deploy/nginx), so the reload picks up the build
 * now on the server and the chunks it names.
 */
export function reloadPage(): void {
  window.location.reload()
}

/**
 * Renewals for parts whose load failed. React.lazy keeps a failure for good, so a failed part gets
 * a fresh one, but only once its failure has been shown and put away (see ChunkBoundary): renewing
 * it on the next render instead would retry for ever before the failure could ever show, because
 * React renders a part that never mounted again from scratch after its load rejects.
 */
const failedParts = new Set<() => void>()

/**
 * A component that lives in a chunk (see lazy/parts.ts). Its first mount suspends while the chunk
 * loads, unless it has loaded already (a preload on hover, say), in which case it renders at once.
 * Opened again after a failure, it tries again, under a new URL (see lazy/chunk.ts).
 */
export function lazyPart<P extends object>(chunk: Chunk<{ default: ComponentType<P> }>): ComponentType<P> {
  const renew = () => {
    Lazy = make()
  }
  const make = () =>
    lazy(() =>
      chunk.load().catch((error: unknown) => {
        failedParts.add(renew)
        throw error
      }),
    )
  let Lazy = make()
  function LazyPart(props: P) {
    // decided once per mount: switching between the two would remount the part and lose its state
    const [Part] = useState<ComponentType<P>>(() => chunk.peek()?.default ?? Lazy)
    return <Part {...props} />
  }
  return LazyPart
}

/** Says a part could not be loaded, after its retry too, and offers the reload. */
export function ReloadNotice() {
  return (
    <p role="status" className="text-[12px] leading-snug text-ui-muted">
      couldn't load this part. the connection may have dropped, or gitube was updated since this tab was opened.{' '}
      <button type="button" onClick={reloadPage} className="font-medium text-ui-accent hover:underline">
        reload
      </button>
    </p>
  )
}

export interface ChunkPlaceholderProps {
  /** classes of the box that stands in for the part */
  frame?: string
  /** what is loading ('loading themes' shows as 'loading themes…') */
  label?: string
  /** the part could not be loaded: the reload notice instead of the label */
  failed?: boolean
}

/** What stands in for a lazy part: a quiet "loading…" line, or the reload notice once it failed. */
export function ChunkPlaceholder({ frame = '', label = 'loading', failed = false }: ChunkPlaceholderProps) {
  return (
    <div className={frame}>
      {failed ? (
        <ReloadNotice />
      ) : (
        <p role="status" className="animate-pulse text-[12px] text-ui-muted">
          {label}…
        </p>
      )}
    </div>
  )
}

interface BoundaryProps {
  children: ReactNode
  /** drawn in place of the part when its chunk failed to load */
  failure: ReactNode
  onFailed?: () => void
}

interface BoundaryState {
  /** boxed, so a thrown null or undefined still counts */
  caught: { error: unknown } | null
}

/** Catches a failed chunk load below it; any other error is thrown on, as if this were not here. */
class ChunkBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { caught: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { caught: { error } }
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error)) this.props.onFailed?.()
  }

  componentWillUnmount() {
    // the failure was shown and is going away (closed, or another tab picked): the next opening
    // of a failed part loads it afresh (a new React.lazy, whose load() tries a new URL)
    if (this.state.caught === null || !isChunkLoadError(this.state.caught.error)) return
    for (const renew of failedParts) renew()
    failedParts.clear()
  }

  render() {
    const { caught } = this.state
    if (caught === null) return this.props.children
    // a bug in the part, not a load failure: crash as it would have without the boundary
    if (!isChunkLoadError(caught.error)) throw caught.error
    return this.props.failure
  }
}

export interface LazySlotProps {
  children: ReactNode
  /** classes of the box that stands in for the part while it loads, and if it fails to */
  frame?: string
  /** what is loading, for the placeholder ('loading themes' shows as 'loading themes…') */
  label?: string
  /** what stands in while loading, instead of the frame and label */
  fallback?: ReactNode
  /**
   * The caller handles a failure itself (closes the part and says so elsewhere), so nothing is
   * drawn in its place. Without it, the frame says what happened and offers a reload.
   */
  onFailed?: () => void
}

/**
 * Where a lazy part goes: a quiet placeholder while it loads, and a reload notice (or onFailed)
 * when it cannot be loaded, rather than a blank space or a crash. Give each slot its own key when
 * slots swap in one place, so a failure in one does not stick to the next.
 */
export function LazySlot({ children, frame = '', label = 'loading', fallback, onFailed }: LazySlotProps) {
  const failure = onFailed ? null : <ChunkPlaceholder frame={frame} failed />
  const loading = fallback ?? <ChunkPlaceholder frame={frame} label={label} />
  return (
    <ChunkBoundary failure={failure} onFailed={onFailed}>
      <Suspense fallback={loading}>{children}</Suspense>
    </ChunkBoundary>
  )
}
