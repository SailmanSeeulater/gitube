import { useMemo } from 'react'
import type { RepoRef } from '../api/parseRepoUrl'
import { assignPalette, buildGraph } from '../graph'
import { battle, gardenStats, type BattleRow, type Side } from '../graph/battle'
import { findWeeds } from '../graph/weeds'
import { useGardenStore } from '../store/useGardenStore'
import type { Theme } from '../theme/themes'
import type { GitHubFetchError, RepoData } from '../types'
import Garden from './Garden'
import { useMetroView } from './useMetroView'
import { metroChunk } from '../lazy/parts'
import { useChunk } from '../lazy/useChunk'
import { CloseIcon, CrownIcon, SwordsIcon } from './icons'

export interface GardenBattleProps {
  a: RepoData
  /** the challenger, once it has loaded */
  b: RepoData | undefined
  bRef: RepoRef
  bFetching: boolean
  bError: GitHubFetchError | null
  theme: Theme
  onRetry: () => void
  onClose: () => void
}

const noop = () => {}

/** A measure's value for the scoreboard. */
function formatValue(row: BattleRow, value: number): string {
  if (!Number.isFinite(value)) return '–'
  if (row.key === 'perWeek') return value >= 10 ? value.toFixed(0) : value.toFixed(1)
  if (row.key === 'lastCommitDays') {
    if (value < 1) return 'today'
    if (value < 60) return `${Math.floor(value)}d ago`
    if (value < 730) return `${Math.floor(value / 30)}mo ago`
    return `${Math.floor(value / 365)}y ago`
  }
  return String(Math.round(value))
}

/**
 * One repo's half of the battle: its metro map, named in the corner, crowned if it won. Until the
 * metro engine is in (or if it cannot be loaded) the side is laid out organic.
 */
function BattleSide({ data, theme, crowned, side }: { data: RepoData; theme: Theme; crowned: boolean; side: Side }) {
  const graph = useMemo(() => buildGraph(data, 'skeleton'), [data])
  const palette = useMemo(() => assignPalette(data.branches.map((b) => b.name), data.defaultBranch, theme), [data, theme])
  const thorns = useMemo(() => findWeeds(data).thorns, [data])
  const engine = useChunk(metroChunk, true)
  const metro = useMetroView(graph, data, 'skeleton', engine.status === 'ready' ? engine.value.metroLayout : null)
  return (
    <>
      <Garden
        graph={graph}
        palette={palette}
        theme={theme}
        viewMode="skeleton"
        defaultBranch={data.defaultBranch}
        onNodeClick={noop}
        onBackgroundClick={noop}
        thorns={thorns}
        metro={metro}
      />
      <div
        className={`pointer-events-none absolute top-3 flex items-center gap-1.5 rounded-lg border border-garden-border bg-garden-panel/90 px-2.5 py-1 text-[13px] font-medium shadow-soft backdrop-blur ${
          side === 'a' ? 'left-3' : 'right-3'
        } ${crowned ? 'text-garden-accent' : 'text-garden-text'}`}
      >
        {crowned && <CrownIcon size={14} />}
        {data.owner}/{data.repo}
      </div>
    </>
  )
}

/**
 * Two repos side by side as metro maps, over a scoreboard of measures (see graph/battle) with a
 * winner per measure and overall. Drawn over the whole app; Escape or the close button ends it.
 */
export default function GardenBattle({ a, b, bRef, bFetching, bError, theme, onRetry, onClose }: GardenBattleProps) {
  const progress = useGardenStore((s) => s.progress)
  // one clock per pairing, so "last commit" does not tick while you look
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [a, b])
  const fight = useMemo(() => (b ? battle(gardenStats(a, now), gardenStats(b, now)) : null), [a, b, now])
  const nameA = `${a.owner}/${a.repo}`
  const nameB = b ? `${b.owner}/${b.repo}` : `${bRef.owner}/${bRef.repo}`

  return (
    <div role="dialog" aria-label={`vs: ${nameA} and ${nameB}`} className="absolute inset-0 z-30 flex flex-col bg-garden-bg text-[13px]">
      <header className="flex items-center gap-2.5 border-b border-garden-border bg-garden-panel/95 px-4 py-2.5">
        <span className="text-garden-accent">
          <SwordsIcon size={16} />
        </span>
        <span className="min-w-0 truncate font-medium text-garden-text">{nameA}</span>
        <span className="text-garden-muted">vs</span>
        <span className="min-w-0 truncate font-medium text-garden-text">{nameB}</span>
        <span className="flex-1" />
        {fight && (
          <span className="shrink-0 text-garden-text-dim" aria-live="polite">
            <span className="font-mono tabular-nums text-garden-text">
              {fight.score.a} – {fight.score.b}
            </span>
            {' · '}
            {fight.winner === null ? 'a draw' : `${fight.winner === 'a' ? nameA : nameB} wins`}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close vs"
          className="shrink-0 rounded-lg p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
        >
          <CloseIcon />
        </button>
      </header>

      {/* one row that may shrink below its canvases, so the scoreboard always fits */}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)]">
        <section className="relative min-h-0 min-w-0 overflow-hidden border-r border-garden-border" aria-label={nameA}>
          <BattleSide data={a} theme={theme} crowned={fight?.winner === 'a'} side="a" />
        </section>
        <section className="relative min-h-0 min-w-0 overflow-hidden" aria-label={nameB}>
          {b ? (
            <BattleSide data={b} theme={theme} crowned={fight?.winner === 'b'} side="b" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              {bFetching ? (
                <>
                  <p className="animate-pulse text-garden-muted">loading {nameB}…</p>
                  {progress?.message && <p className="text-[11px] text-garden-muted">{progress.message}</p>}
                </>
              ) : bError ? (
                <>
                  <p className="font-medium text-garden-text">couldn't load {nameB}</p>
                  <p className="max-w-[320px] text-[12px] leading-snug text-garden-muted">{bError.message}</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={onRetry} className="rounded-lg bg-garden-accent/15 px-2.5 py-1 text-[12px] font-medium text-garden-accent hover:bg-garden-accent/25">
                      try again
                    </button>
                    <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 text-[12px] text-garden-muted hover:bg-garden-hover hover:text-garden-text">
                      pick another
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {fight && (
        <footer className="border-t border-garden-border bg-garden-panel/95 px-4 py-2.5">
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {fight.rows.map((row) => (
              <li key={row.key} title={row.hint} className="rounded-lg bg-garden-field px-2.5 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-garden-muted">{row.label}</div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[12px] tabular-nums">
                  <span className={row.winner === 'a' ? 'font-semibold text-garden-accent' : 'text-garden-text-dim'}>{formatValue(row, row.a)}</span>
                  <span className={row.winner === 'b' ? 'font-semibold text-garden-accent' : 'text-garden-text-dim'}>{formatValue(row, row.b)}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-garden-muted">
            measured on the loaded commits of each repo (up to 500 on the default branch and 250 per other branch). hover a
            measure to see what wins it.
          </p>
        </footer>
      )}
    </div>
  )
}
