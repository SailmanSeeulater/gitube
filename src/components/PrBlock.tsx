import { useEffect, useMemo } from 'react'
import type { GraphNode, PullSummary } from '../types'
import { LOOKUP_COST } from '../api/pulls'
import { branchUnchecked, combineMarks, defaultTipSummary, headMoved, lookupPlan } from '../graph/pulls'
import type { InspectorPulls } from './NodeInspector'
import { PrGlyph, PrStatusLine } from './PrGlyph'
import { prMeta } from './prMark'
import { formatClock, relativeTime } from './gardenUtils'
import { ExternalIcon } from './icons'

/** Pull requests listed per tip; the rest are a "+N more" link to GitHub's list. */
const SHOWN = 2

export interface PrBlockProps {
  node: GraphNode
  /** the open pull requests from the node's branches, most recently updated first */
  prs: readonly PullSummary[]
  pulls: InspectorPulls
  /** branch name -> colour in the active theme */
  palette: Record<string, string>
  fallback: string
}

const linkClass = 'text-garden-accent hover:underline'

/**
 * The node inspector's pull request block (in the pulls chunk, see lazy/parts.ts): under a tip's
 * branch chips, one row per open pull request from its branches (review, checks, draft, conflicts,
 * base, author), the default branch's count of pull requests into it, and what is still being read
 * or could not be. Without a token a pull request's review and checks are looked up when it is shown
 * here, 300 ms after it opens, while the hourly budget allows; otherwise a link offers it.
 */
export default function PrBlock({ node, prs, pulls, palette, fallback }: PrBlockProps) {
  const { view, data } = pulls
  const { index, status, error } = view
  const shown = prs.slice(0, SHOWN)
  // the tip's branches GitHub did not answer for: whether they have pull requests is not known
  const unchecked = node.tips.filter((tip) => branchUnchecked(index, tip))
  const isDefaultTip = node.tips.includes(data.defaultBranch)
  const summary = useMemo(() => (isDefaultTip && index ? defaultTipSummary(index) : null), [isDefaultTip, index])
  const tipOf = useMemo(() => new Map(data.branches.map((b) => [b.name, b] as const)), [data])

  // look the shown pull requests up once the tip has been open a moment (no token: 3 requests each)
  const { autoLookup, canAutoLookup, lookupErrors } = view
  const due = shown.filter((pr) => lookupPlan(pr, view) === 'auto')
  const dueKey = due.map((pr) => pr.number).join(',')
  useEffect(() => {
    if (!canAutoLookup || due.length === 0) return
    const cancels = due.map((pr) => autoLookup(pr))
    return () => cancels.forEach((cancel) => cancel())
    // dueKey stands for due
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dueKey, canAutoLookup, autoLookup, lookupErrors])

  const baseList = `https://github.com/${data.owner}/${data.repo}/pulls?q=${encodeURIComponent(`is:pr is:open base:${data.defaultBranch}`)}`
  // when the graph on show was read from GitHub: "5h ago", "just now"
  const graphAge = pulls.graphAt ? relativeTime(pulls.graphAt) : ''
  const remaining = view.rate?.remaining ?? null
  const reset = formatClock(view.rate?.resetAt ?? null)

  return (
    <div className="flex flex-col gap-2 text-[12px]">
      {status === 'loading' && prs.length === 0 && (
        <p role="status" className="animate-pulse text-garden-muted">
          checking pull requests…
        </p>
      )}
      {status === 'error' && error && (
        <p className="leading-snug text-garden-muted" title={error.message}>
          pull requests could not be loaded ({error.code === 'rate_limited' ? `rate limited${error.resetAt ? ` until ${formatClock(error.resetAt)}` : ''}` : error.code.replace('_', ' ')})
          {error.retriable && (
            <>
              {' · '}
              <button type="button" onClick={view.retry} className={linkClass}>
                retry
              </button>
            </>
          )}
        </p>
      )}

      {summary && (
        <div className="leading-snug">
          <p className="flex min-w-0 items-center gap-1.5">
            <a href={baseList} target="_blank" rel="noreferrer" className={`shrink-0 font-medium ${linkClass}`}>
              {summary.into !== null ? `${summary.into} open PR${summary.into === 1 ? '' : 's'}` : `${summary.total ?? 0} open PRs`}
            </a>
            <span className="min-w-0 flex-1 truncate text-garden-text-dim">
              {summary.into !== null ? `into ${data.defaultBranch}` : 'in the repo'}
            </span>
            <a href={baseList} target="_blank" rel="noreferrer" aria-label="Open the list on GitHub" className="shrink-0 text-garden-muted hover:text-garden-accent">
              <ExternalIcon size={12} />
            </a>
          </p>
          {summary.notDrawn > 0 &&
            (summary.unchecked > 0 ? (
              <p className="text-garden-muted">
                {summary.notDrawn} not drawn (forks, branches not loaded, or {summary.unchecked} branch{summary.unchecked === 1 ? '' : 'es'} GitHub did
                not answer for)
              </p>
            ) : (
              <p className="text-garden-muted">
                {summary.notDrawn} from {summary.onlyForks ? 'forks' : 'forks or branches not loaded'} (no branch on the graph, so not drawn)
              </p>
            ))}
          {summary.mapped > 0 && (
            <p className="text-garden-muted">
              {summary.mapped} from branches on the graph
              {summary.failing + summary.drafts > 0 && ': '}
              {[summary.failing > 0 ? `${summary.failing} failing checks` : '', summary.drafts > 0 ? `${summary.drafts} draft${summary.drafts === 1 ? '' : 's'}` : '']
                .filter(Boolean)
                .join(', ')}
            </p>
          )}
          {index?.truncated &&
            (index.source === 'rest' ? (
              <p className="text-garden-muted">
                checked the {index.listed} most recently updated of ~{index.total ?? index.listed}
              </p>
            ) : (
              <p className="text-garden-muted">some branches have more open pull requests than were read</p>
            ))}
        </div>
      )}

      {unchecked.length > 0 && (
        <p className="leading-snug text-garden-muted" title={unchecked.join(', ')}>
          PRs not checked (GitHub did not answer)
        </p>
      )}

      {shown.map((pr) => {
        const mark = combineMarks([pr])
        const branch = tipOf.get(pr.head)
        const plan = lookupPlan(pr, view)
        const cost = LOOKUP_COST
        return (
          <div key={pr.number} className="flex flex-col gap-0.5 leading-snug">
            <p className="flex min-w-0 items-center gap-1.5">
              {mark && <PrGlyph mark={mark} colour={palette[pr.head] ?? fallback} />}
              <a href={pr.url} target="_blank" rel="noreferrer" className={`shrink-0 font-medium ${linkClass}`}>
                #{pr.number}
              </a>
              <span className="min-w-0 flex-1 truncate text-garden-text" title={pr.title}>
                {pr.title}
              </span>
              <a href={pr.url} target="_blank" rel="noreferrer" aria-label={`Open pull request ${pr.number} on GitHub`} className="shrink-0 text-garden-muted hover:text-garden-accent">
                <ExternalIcon size={12} />
              </a>
            </p>
            <div className={`pl-[22px] ${plan === 'running' ? 'animate-pulse' : ''}`}>
              <PrStatusLine pr={pr} />
            </div>
            <p className="pl-[22px] text-[11px] text-garden-muted">{prMeta(pr, data.defaultBranch).join(' · ')}</p>
            {plan === 'running' && (
              <p role="status" className="pl-[22px] text-[11px] text-garden-muted">
                checking review and checks…
              </p>
            )}
            {plan === 'failed' && (
              <p className="pl-[22px] text-[11px] text-garden-muted" title={lookupErrors.get(pr.number)}>
                couldn't look up its review and checks ·{' '}
                <button type="button" onClick={() => view.lookup(pr)} className={linkClass}>
                  retry
                </button>
              </p>
            )}
            {plan === 'ask' && (
              <p className="pl-[22px] text-[11px] text-garden-muted">
                {remaining === null || remaining >= cost ? (
                  <button type="button" onClick={() => view.lookup(pr)} className={linkClass}>
                    load review and checks ({cost} requests)
                  </button>
                ) : (
                  <span>
                    {cost} requests to look up
                  </span>
                )}
                {remaining !== null && ` · ${remaining} left this hour${reset ? ` (resets ${reset})` : ''}`}
                {!view.hasToken && (
                  <>
                    {' · '}
                    <button type="button" onClick={pulls.onAddToken} className={linkClass}>
                      add a token
                    </button>
                  </>
                )}
              </p>
            )}
            {branch && headMoved(branch, pr) && (
              <p className="pl-[22px] text-[11px] text-garden-muted">
                PR head is newer than this tip{graphAge ? ` (graph fetched ${graphAge})` : ''} ·{' '}
                <button type="button" onClick={pulls.onRefresh} className={linkClass}>
                  refresh
                </button>
              </p>
            )}
          </div>
        )
      })}

      {prs.length > SHOWN && (
        <a
          href={`https://github.com/${data.owner}/${data.repo}/pulls?q=${encodeURIComponent(`is:pr is:open ${node.tips.map((t) => `head:${t}`).join(' ')}`)}`}
          target="_blank"
          rel="noreferrer"
          className={`text-[11px] ${linkClass}`}
        >
          +{prs.length - SHOWN} more
        </a>
      )}
    </div>
  )
}
