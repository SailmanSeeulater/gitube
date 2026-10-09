export interface EmptyStateProps {
  onPick: (example: string) => void
}

const EXAMPLES: ReadonlyArray<{ repo: string; note: string }> = [
  { repo: 'octocat/Hello-World', note: 'tiny' },
  { repo: 'vitejs/vite', note: 'bigger' },
]

export default function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-[13px] text-garden-muted">paste a GitHub repo to grow its garden</p>
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.repo}
            type="button"
            onClick={() => onPick(example.repo)}
            className="group flex items-center gap-2 rounded-full border border-garden-border bg-garden-panel/90 px-3 py-1 text-[12px] text-garden-text-dim shadow-soft transition-colors hover:border-garden-accent/50 hover:text-garden-text"
          >
            <span className="font-mono">{example.repo}</span>
            <span className="text-[11px] text-garden-muted group-hover:text-garden-text-dim">{example.note}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
