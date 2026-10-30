import type { GraphNode, RepoData } from '../types'
import { branchUnchecked, nodePrs } from '../graph/pulls'
import type { PullsView } from '../hooks/usePulls'
import { pullsChunk } from '../lazy/parts'
import { useTheme } from '../theme/useTheme'
import { formatDateTime, relativeTime, shortSha } from './graphUtils'
import { CloseIcon, ExternalIcon } from './icons'
import { LazySlot, lazyPart } from './LazyPart'

// the pull request block lives in the pulls chunk, loaded once a repo is in (see usePulls)
const PrBlock = lazyPart(pullsChunk)

/** What the inspector needs for a tip's open pull requests (absent for a saved file). */
export interface InspectorPulls {
  view: PullsView
  /** the repo the pull requests are of */
  data: Pick<RepoData, 'owner' | 'repo' | 'defaultBranch' | 'branches'>
  /** when the graph on show was fetched from GitHub (ISO), for "PR head is newer than this tip" */
  graphAt: string | null
  /** opens the token form (no token: lookups cost the visitor's 60 requests an hour) */
  onAddToken: () => void
  /** fetches the graph and its pull requests again */
  onRefresh: () => void
}

export interface NodeInspectorProps {
  node: GraphNode
  /** branch name -> colour in the active theme */
  palette: Record<string, string>
  onClose: () => void
  /** Contributor.key of the commit's author; null hides the author link. */
  authorKey?: string | null
  /** Highlights the author's commits (and shows them in the leaderboard). */
  onShowAuthor?: (key: string) => void
  /** the open pull request overlay; null or absent shows none */
  pulls?: InspectorPulls | null
}

export default function NodeInspector({ node, palette, onClose, authorKey = null, onShowAuthor, pulls = null }: NodeInspectorProps) {
  const { commit } = node
  const kinds: string[] = []
  if (node.isTip) kinds.push('tip')
  if (node.isFork) kinds.push('fork')
  if (node.isMerge) kinds.push('merge')
  if (node.isRoot) kinds.push('root')
  const fallback = useTheme().fallback
  const ownerColour = palette[node.owner] ?? fallback
  const prs = pulls && node.isTip ? nodePrs(pulls.view.index, node.tips) : []
  // a block only where there is something to say: this tip's pull requests, the default branch's
  // count of them, a branch GitHub did not answer for, or the overlay still reading or failed;
  // other tips look as they always did
  const prStatus = pulls?.view.status ?? 'off'
  const isDefaultTip = pulls !== null && node.tips.includes(pulls.data.defaultBranch)
  const showPrs =
    pulls !== null &&
    node.isTip &&
    (prs.length > 0 ||
      node.tips.some((tip) => branchUnchecked(pulls.view.index, tip)) ||
      prStatus === 'loading' ||
      prStatus === 'error' ||
      (isDefaultTip && (pulls.view.index?.total ?? 0) > 0))

  return (
    <div
      role="dialog"
      aria-label={`Commit ${shortSha(commit.sha)}`}
      className="absolute bottom-16 left-4 z-20 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-ui-border bg-ui-panel/95 p-3 text-[13px] shadow-soft backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ownerColour }} title={`owned by ${node.owner}`} />
        <span className="font-mono text-ui-text" title={commit.sha}>
          {shortSha(commit.sha)}
        </span>
        {kinds.map((kind) => (
          <span key={kind} className="rounded bg-ui-hover px-1.5 py-px text-[10px] uppercase tracking-wide text-ui-muted">
            {kind}
          </span>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-ui-muted hover:bg-ui-hover hover:text-ui-text"
        >
          <CloseIcon />
        </button>
      </div>

      <p className="mt-2 break-words leading-snug text-ui-text">{commit.message || '(no message)'}</p>

      <p className="mt-1.5 text-[12px] text-ui-muted">
        {authorKey !== null && onShowAuthor ? (
          <button
            type="button"
            onClick={() => onShowAuthor(authorKey)}
            title={`Highlight every commit by ${commit.author || 'this author'}`}
            className="text-ui-text-dim underline decoration-ui-border underline-offset-2 hover:text-ui-accent hover:decoration-ui-accent"
          >
            {commit.author || 'unknown'}
          </button>
        ) : (
          <span className="text-ui-text-dim">{commit.author || 'unknown'}</span>
        )}
        {commit.login && commit.login.toLowerCase() !== commit.author.toLowerCase() && <span> (@{commit.login})</span>}
        {' · '}
        <span title={commit.date}>{formatDateTime(commit.date) || commit.date}</span>
        {relativeTime(commit.date) && <span> ({relativeTime(commit.date)})</span>}
      </p>

      {node.tips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {node.tips.map((tip) => (
            <span
              key={tip}
              className="flex items-center gap-1.5 rounded-full border border-ui-border px-2 py-px text-[11px] text-ui-text-dim"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: palette[tip] ?? fallback }} />
              {tip}
            </span>
          ))}
        </div>
      )}

      {showPrs && pulls && (
        <div className="mt-2.5 border-t border-ui-border pt-2.5">
          <LazySlot
            fallback={
              <p role="status" className="animate-pulse text-[12px] text-ui-muted">
                checking pull requests…
              </p>
            }
          >
            <PrBlock node={node} prs={prs} pulls={pulls} palette={palette} fallback={fallback} />
          </LazySlot>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between text-[12px]">
        <span className="text-ui-muted">
          in {node.reach} branch{node.reach === 1 ? '' : 'es'}
          {' · '}
          {commit.parents.length} parent{commit.parents.length === 1 ? '' : 's'}
        </span>
        <a
          href={commit.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-ui-accent hover:underline"
        >
          open on GitHub <ExternalIcon size={12} />
        </a>
      </div>
    </div>
  )
}
