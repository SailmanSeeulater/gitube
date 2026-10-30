import { useEffect, useState } from 'react'
import { recentRepos, sharedRepoStore, type RecentRepo } from '../api/repoCache'
import { relativeTime } from './graphUtils'

export interface EmptyStateProps {
  onPick: (example: string) => void
}

const EXAMPLES: ReadonlyArray<{ repo: string; note: string }> = [
  { repo: 'octocat/Hello-World', note: 'tiny' },
  { repo: 'vitejs/vite', note: 'bigger' },
]

/** Recent chips shown at most. */
const MAX_RECENT = 4

const chip =
  'group flex items-center gap-2 rounded-full border border-ui-border bg-ui-panel/90 px-3 py-1 text-[12px] text-ui-text-dim shadow-soft transition-colors hover:border-ui-accent/50 hover:text-ui-text'

export default function EmptyState({ onPick }: EmptyStateProps) {
  // repos grown in this browser before; growing one again within a day costs no requests
  const [recent, setRecent] = useState<RecentRepo[]>([])
  useEffect(() => {
    const store = sharedRepoStore()
    if (!store) return
    let live = true
    void recentRepos(store, Date.now()).then((list) => {
      if (live) setRecent(list.slice(0, MAX_RECENT))
    })
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-[13px] text-ui-muted">paste a GitHub repo to map its branches</p>
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((example) => (
          <button key={example.repo} type="button" onClick={() => onPick(example.repo)} className={chip}>
            <span className="font-mono">{example.repo}</span>
            <span className="text-[11px] text-ui-muted group-hover:text-ui-text-dim">{example.note}</span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="pointer-events-auto flex flex-col items-center gap-2">
          <p className="text-[11px] text-ui-muted">recently opened in this browser</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {recent.map((r) => (
              <button key={`${r.owner}/${r.repo}`} type="button" onClick={() => onPick(`${r.owner}/${r.repo}`)} className={chip}>
                <span className="font-mono">
                  {r.owner}/{r.repo}
                </span>
                <span className="text-[11px] text-ui-muted group-hover:text-ui-text-dim">{relativeTime(r.savedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-ui-muted">or drop a saved .json file here</p>
    </div>
  )
}
