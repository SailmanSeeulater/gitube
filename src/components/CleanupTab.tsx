import { useEffect, useMemo, useState } from 'react'
import { defaultLeftoverPicks, deleteCommand, type CleanupReport } from '../graph/cleanup'
import type { PullSummary } from '../types'
import { useAppStore } from '../store/useAppStore'
import { useTheme } from '../theme/useTheme'
import { relativeTime } from './graphUtils'
import { CheckIcon, ExternalIcon, SpikesIcon } from './icons'

export interface CleanupTabProps {
  report: CleanupReport
  owner: string
  repo: string
  defaultBranch: string
  /** branch name -> colour in the active theme */
  palette: Record<string, string>
  /** one timestamp per loaded repo, shared with the other tabs */
  now: number
  /** open pull requests by head branch (the overlay's index), null when not known */
  prs?: ReadonlyMap<string, readonly PullSummary[]> | null
  /** branches GitHub did not answer for (the index's unchecked): they may have an open pull request */
  unchecked?: ReadonlyArray<string> | null
}

/** The leftovers that have (or may have) an open pull request, as one string that changes when the set does. */
const prLeftoverKey = (report: CleanupReport, hasOpenPr: (name: string) => boolean) =>
  report.leftovers
    .filter((w) => hasOpenPr(w.name))
    .map((w) => w.name)
    .join('\n')

/**
 * Branch cleanup: branches whose work is all in the default branch (with one command to delete the
 * ticked ones from the remote), and diverged branches far apart from it on both sides. Clicking a name
 * selects that branch on the graph.
 */
export default function CleanupTab({ report, owner, repo, defaultBranch, palette, now, prs = null, unchecked = null }: CleanupTabProps) {
  const fallback = useTheme().fallback
  const selectedBranch = useAppStore((s) => s.selectedBranch)
  const toggleSelectedBranch = useAppStore((s) => s.toggleSelectedBranch)

  // ticks start over for each repo: everything but the branches that look kept on purpose and the
  // ones with an open pull request (deleting the branch would close it), or whose pull requests
  // GitHub did not say
  const notChecked = new Set(unchecked ?? [])
  const hasOpenPr = (name: string) => (prs?.get(name)?.length ?? 0) > 0 || notChecked.has(name)
  const prKey = prLeftoverKey(report, hasOpenPr)
  const [picked, setPicked] = useState(() => defaultLeftoverPicks(report.leftovers, hasOpenPr))
  const [pickedFor, setPickedFor] = useState(report)
  const [prKeyFor, setPrKeyFor] = useState(prKey)
  if (pickedFor !== report) {
    setPickedFor(report)
    setPrKeyFor(prKey)
    setPicked(defaultLeftoverPicks(report.leftovers, hasOpenPr))
  } else if (prKeyFor !== prKey) {
    // pull requests read after the tab opened: their branches are unticked (once; a tick after this stays)
    setPrKeyFor(prKey)
    const withPr = new Set(prKey.split('\n'))
    setPicked((prev) => new Set([...prev].filter((name) => !withPr.has(name))))
  }
  const toggle = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const command = useMemo(() => deleteCommand(report.leftovers.filter((w) => picked.has(w.name)).map((w) => w.name)), [report, picked])

  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => setCopied('idle'), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => {
    const done = navigator.clipboard?.writeText(command)
    if (!done) setCopied('failed')
    else done.then(() => setCopied('copied'), () => setCopied('failed'))
  }

  const nameButton = (name: string) => (
    <button
      type="button"
      onClick={() => toggleSelectedBranch(name)}
      aria-pressed={selectedBranch === name}
      title={`${name}: show it on the graph`}
      className={`flex min-w-0 flex-1 items-center gap-2 text-left ${selectedBranch === name ? 'text-ui-accent' : 'text-ui-text'}`}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: palette[name] ?? fallback }} />
      <span className="truncate">{name}</span>
    </button>
  )

  const { leftovers, diverged } = report
  return (
    <div className="ui-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-[12px]">
      <section aria-labelledby="leftovers-heading">
        <h3 id="leftovers-heading" className="text-[11px] uppercase tracking-wide text-ui-muted">
          merged, not deleted
        </h3>
        {leftovers.length === 0 ? (
          <p className="mt-1 leading-snug text-ui-muted">
            nothing to clean up: every branch has commits <span className="font-mono">{defaultBranch}</span> lacks.
          </p>
        ) : (
          <>
            <p className="mt-1 leading-snug text-ui-muted">
              {leftovers.length} branch{leftovers.length === 1 ? ' has' : 'es have'} nothing <span className="font-mono">{defaultBranch}</span>{' '}
              lacks, so deleting {leftovers.length === 1 ? 'it' : 'them'} loses no commits.
            </p>
            <ul className="-mx-1.5 mt-1.5">
              {leftovers.map((w) => (
                <li key={w.name} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-ui-hover">
                  <input
                    type="checkbox"
                    checked={picked.has(w.name)}
                    onChange={() => toggle(w.name)}
                    aria-label={`Include ${w.name} in the delete command`}
                    className="shrink-0 accent-ui-accent"
                  />
                  {nameButton(w.name)}
                  {(() => {
                    const pr = prs?.get(w.name)?.[0]
                    return pr ? (
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded bg-ui-hover px-1 text-[10px] tabular-nums text-ui-text-dim hover:text-ui-accent"
                        title={`deleting this branch closes PR #${pr.number}`}
                      >
                        #{pr.number} open
                      </a>
                    ) : notChecked.has(w.name) ? (
                      <span
                        className="shrink-0 text-[10px] text-ui-muted"
                        title="GitHub did not answer for this branch, so whether it has an open pull request is not known; it is not ticked"
                      >
                        PR status not checked
                      </span>
                    ) : null
                  })()}
                  {w.keep && !hasOpenPr(w.name) && (
                    <span
                      className="shrink-0 text-[10px] uppercase tracking-wide text-ui-muted"
                      title="looks like a release or long-lived branch, so it is not ticked"
                    >
                      kept?
                    </span>
                  )}
                  <span
                    className="shrink-0 font-mono text-[11px] tabular-nums text-ui-muted"
                    title={w.kind === 'same' ? `points at ${defaultBranch}'s own tip` : `${w.behindBy} commits behind ${defaultBranch}, none ahead`}
                  >
                    {w.kind === 'same' ? `= ${defaultBranch}` : `-${w.behindBy}`}
                  </span>
                  <span className="w-[3.25rem] shrink-0 whitespace-nowrap text-right text-[11px] text-ui-muted" title={w.tipDate}>
                    {relativeTime(w.tipDate, now)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-2 rounded-lg bg-ui-field px-2 py-1.5">
              <code className="block whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-ui-text">
                {command || <span className="text-ui-muted">tick a branch to build the command</span>}
              </code>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={copy}
                disabled={!command}
                className="flex items-center gap-1 rounded-lg bg-ui-accent/15 px-2 py-1 text-[11px] font-medium text-ui-accent hover:bg-ui-accent/25 disabled:opacity-40"
              >
                {copied === 'copied' && <CheckIcon size={12} />}
                {copied === 'copied' ? 'copied' : copied === 'failed' ? 'select it and copy' : 'copy command'}
              </button>
              <a
                href={`https://github.com/${owner}/${repo}/branches`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-ui-accent hover:underline"
              >
                or delete on GitHub <ExternalIcon size={11} />
              </a>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-ui-muted">
              the command assumes your remote is called origin. squash- and rebase-merged branches still count commits ahead, so
              they can't be spotted here.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="spikes-heading" className="mt-4">
        <h3 id="spikes-heading" className="text-[11px] uppercase tracking-wide text-ui-muted">
          diverged
        </h3>
        {diverged.length === 0 ? (
          <p className="mt-1 leading-snug text-ui-muted">no diverged branches: nothing has drifted far from {defaultBranch} on both sides.</p>
        ) : (
          <>
            <p className="mt-1 leading-snug text-ui-muted">
              far apart from <span className="font-mono">{defaultBranch}</span> on both sides, so merging or rebasing will likely
              conflict. the spikes load with commits ahead × behind.
            </p>
            <ul className="-mx-1.5 mt-1.5">
              {diverged.map((t) => (
                <li key={t.name} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-ui-hover">
                  {nameButton(t.name)}
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-ui-muted" title="ahead / behind the default branch">
                    +{t.aheadBy} <span className="text-ui-border">/</span> -{t.behindBy}
                  </span>
                  <span className="flex w-[2.75rem] shrink-0 justify-end text-ui-text-dim" title={`${t.level} of 3`} aria-label={`${t.level} of 3 spikes`}>
                    {Array.from({ length: t.level }, (_, i) => (
                      <SpikesIcon key={i} size={12} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
