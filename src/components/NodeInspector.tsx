import type { GraphNode } from '../types'
import { useTheme } from '../theme/useTheme'
import { formatDateTime, relativeTime, shortSha } from './gardenUtils'
import { CloseIcon, ExternalIcon } from './icons'

export interface NodeInspectorProps {
  node: GraphNode
  /** branch name -> colour in the active theme */
  palette: Record<string, string>
  onClose: () => void
  /** Contributor.key of the commit's author; null hides the author link. */
  authorKey?: string | null
  /** Highlights the author's commits (and shows them in the leaderboard). */
  onShowAuthor?: (key: string) => void
}

export default function NodeInspector({ node, palette, onClose, authorKey = null, onShowAuthor }: NodeInspectorProps) {
  const { commit } = node
  const kinds: string[] = []
  if (node.isTip) kinds.push('tip')
  if (node.isFork) kinds.push('fork')
  if (node.isMerge) kinds.push('merge')
  if (node.isRoot) kinds.push('root')
  const fallback = useTheme().fallback
  const ownerColour = palette[node.owner] ?? fallback

  return (
    <div
      role="dialog"
      aria-label={`Commit ${shortSha(commit.sha)}`}
      className="absolute bottom-16 left-4 z-20 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-garden-border bg-garden-panel/95 p-3 text-[13px] shadow-soft backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ownerColour }} title={`owned by ${node.owner}`} />
        <span className="font-mono text-garden-text" title={commit.sha}>
          {shortSha(commit.sha)}
        </span>
        {kinds.map((kind) => (
          <span key={kind} className="rounded bg-garden-hover px-1.5 py-px text-[10px] uppercase tracking-wide text-garden-muted">
            {kind}
          </span>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
        >
          <CloseIcon />
        </button>
      </div>

      <p className="mt-2 break-words leading-snug text-garden-text">{commit.message || '(no message)'}</p>

      <p className="mt-1.5 text-[12px] text-garden-muted">
        {authorKey !== null && onShowAuthor ? (
          <button
            type="button"
            onClick={() => onShowAuthor(authorKey)}
            title={`Highlight every commit by ${commit.author || 'this author'}`}
            className="text-garden-text-dim underline decoration-garden-border underline-offset-2 hover:text-garden-accent hover:decoration-garden-accent"
          >
            {commit.author || 'unknown'}
          </button>
        ) : (
          <span className="text-garden-text-dim">{commit.author || 'unknown'}</span>
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
              className="flex items-center gap-1.5 rounded-full border border-garden-border px-2 py-px text-[11px] text-garden-text-dim"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: palette[tip] ?? fallback }} />
              {tip}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between text-[12px]">
        <span className="text-garden-muted">
          in {node.reach} branch{node.reach === 1 ? '' : 'es'}
          {' · '}
          {commit.parents.length} parent{commit.parents.length === 1 ? '' : 's'}
        </span>
        <a
          href={commit.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-garden-accent hover:underline"
        >
          open on GitHub <ExternalIcon size={12} />
        </a>
      </div>
    </div>
  )
}
