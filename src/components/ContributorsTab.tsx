import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Contributor, ContributorIndex } from '../graph/contributors'
import { useAppStore } from '../store/useAppStore'
import { useTheme } from '../theme/useTheme'
import { relativeTime } from './graphUtils'
import { ExternalIcon, SearchIcon } from './icons'

export interface ContributorsTabProps {
  contributors: ContributorIndex
  /** branch name -> colour in the active theme */
  palette: Record<string, string>
  /** one timestamp per loaded repo, shared with the branch list */
  now: number
}

/** Branches listed under an expanded row before "+N more". */
const MAX_BRANCHES_SHOWN = 6
const AVATAR_PX = 20
const SPARK_H = 22

const LOADED_ONLY =
  'Counts cover the commits gitube loaded: up to 500 on the default branch and 250 per other branch, so older history is not included.'

/** GitHub serves avatars at any size through ?s=; ask for a crisp one at twice the drawn size. */
function avatarSrc(url: string, px: number): string {
  try {
    const u = new URL(url)
    u.searchParams.set('s', String(px * 2))
    return u.toString()
  } catch {
    return url
  }
}

function initials(name: string): string {
  const parts = name.replace(/\[bot\]$/i, '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

function shortDate(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** github.com page for an account; bot accounts live under /apps. */
function profileUrl(c: Contributor): string | null {
  if (!c.login) return null
  const bot = /^(.*)\[bot\]$/i.exec(c.login)
  return bot ? `https://github.com/apps/${bot[1]}` : `https://github.com/${c.login}`
}

function Avatar({ contributor }: { contributor: Contributor }) {
  const [failed, setFailed] = useState(false)
  if (contributor.avatarUrl && !failed) {
    return (
      <img
        src={avatarSrc(contributor.avatarUrl, AVATAR_PX)}
        width={AVATAR_PX}
        height={AVATAR_PX}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full bg-ui-hover"
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-ui-hover text-[9px] font-medium text-ui-text-dim"
      style={{ width: AVATAR_PX, height: AVATAR_PX }}
    >
      {initials(contributor.name)}
    </span>
  )
}

/** Commits per slice of the loaded window as a row of bars, oldest on the left. */
function Activity({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts)
  const step = 4
  return (
    <svg
      viewBox={`0 0 ${counts.length * step} ${SPARK_H}`}
      preserveAspectRatio="none"
      className="block h-[22px] w-full text-ui-accent"
      aria-hidden
    >
      <line x1={0} x2={counts.length * step} y1={SPARK_H - 0.5} y2={SPARK_H - 0.5} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
      {counts.map((n, i) => {
        if (n <= 0) return null
        const h = Math.max(2, (n / max) * (SPARK_H - 1))
        return <rect key={i} x={i * step + 0.5} y={SPARK_H - h} width={step - 1} height={h} rx={0.8} fill="currentColor" />
      })}
    </svg>
  )
}

interface RowProps {
  contributor: Contributor
  rank: number
  /** share of the top contributor's commits, 0..1 */
  share: number
  selected: boolean
  now: number
  onSelect: () => void
}

function ContributorRow({ contributor: c, rank, share, selected, now, onSelect }: RowProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      title={c.login ? `${c.name} (@${c.login})` : c.name}
      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
        selected ? 'bg-ui-accent/10' : 'hover:bg-ui-hover'
      }`}
    >
      <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-ui-muted">{rank}</span>
      <Avatar contributor={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className={`truncate ${selected ? 'text-ui-accent' : 'text-ui-text'}`}>{c.name}</span>
          {c.isBot && <span className="shrink-0 text-[10px] uppercase tracking-wide text-ui-muted">bot</span>}
        </span>
        <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-ui-hover">
          <span className="block h-full rounded-full bg-ui-accent/70" style={{ width: `${Math.max(2, share * 100)}%` }} />
        </span>
      </span>
      <span className="shrink-0 font-mono text-[12px] tabular-nums text-ui-text-dim" title={`${c.commits} commit${c.commits === 1 ? '' : 's'}`}>
        {c.commits}
      </span>
      <span
        className="w-[3.25rem] shrink-0 whitespace-nowrap text-right text-[11px] text-ui-muted"
        title={c.lastDate ? `last commit ${shortDate(c.lastDate)}` : undefined}
      >
        {relativeTime(c.lastDate, now)}
      </span>
    </div>
  )
}

interface DetailsProps {
  contributor: Contributor
  palette: Record<string, string>
  fallback: string
  windowStart: string
  windowEnd: string
}

function ContributorDetails({ contributor: c, palette, fallback, windowStart, windowEnd }: DetailsProps) {
  const shown = c.branches.slice(0, MAX_BRANCHES_SHOWN)
  const more = c.branches.length - shown.length
  const profile = profileUrl(c)
  return (
    <div className="mx-1 mb-1.5 mt-0.5 rounded-md bg-ui-field px-2.5 py-2 text-[11px] text-ui-muted">
      <div className="flex justify-between gap-2">
        <span>
          first <span className="text-ui-text-dim">{shortDate(c.firstDate) || 'unknown'}</span>
        </span>
        <span>
          last <span className="text-ui-text-dim">{shortDate(c.lastDate) || 'unknown'}</span>
        </span>
      </div>

      <div className="mt-2" title="their commits over the loaded window, oldest on the left">
        <Activity counts={c.activity} />
        <div className="mt-0.5 flex justify-between text-[10px]">
          <span>{shortDate(windowStart)}</span>
          <span>{shortDate(windowEnd)}</span>
        </div>
      </div>

      <div className="mt-2">commits by branch</div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {shown.map((b) => (
          <li key={b.name} className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: palette[b.name] ?? fallback }} />
            <span className="min-w-0 flex-1 truncate text-ui-text-dim" title={b.name}>
              {b.name}
            </span>
            <span className="shrink-0 font-mono tabular-nums">{b.commits}</span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <div className="mt-0.5">
          +{more} more branch{more === 1 ? '' : 'es'}
        </div>
      )}

      {profile && (
        <a
          href={profile}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex max-w-full items-center gap-1 text-ui-accent hover:underline"
        >
          <span className="truncate">@{c.login}</span> on GitHub <ExternalIcon size={11} className="shrink-0" />
        </a>
      )}
    </div>
  )
}

/** The side panel's leaderboard: who wrote the loaded commits, and where. Selecting a row highlights their commits on the graph. */
export default function ContributorsTab({ contributors, palette, now }: ContributorsTabProps) {
  const fallback = useTheme().fallback
  const selected = useAppStore((s) => s.selectedContributor)
  const toggleSelected = useAppStore((s) => s.toggleSelectedContributor)
  const [query, setQuery] = useState('')
  const [showBots, setShowBots] = useState(false)
  const listRef = useRef<HTMLUListElement | null>(null)

  const botCount = useMemo(() => contributors.list.filter((c) => c.isBot).length, [contributors])

  // rank among the people shown (bots in or out), so filtering by name keeps each rank
  const ranked = useMemo(
    () => contributors.list.filter((c) => showBots || !c.isBot || c.key === selected),
    [contributors, showBots, selected],
  )
  const top = ranked.reduce((max, c) => Math.max(max, c.commits), 1)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = ranked.map((c, i) => ({ c, rank: i + 1 }))
    if (q === '') return all
    return all.filter(({ c }) => c.name.toLowerCase().includes(q) || (c.login ?? '').toLowerCase().includes(q))
  }, [ranked, query])

  // a person picked elsewhere (the commit inspector) scrolls into view
  useEffect(() => {
    if (selected === null) return
    const el = listRef.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const people = ranked.length
  const loaded = contributors.keyBySha.size

  return (
    <>
      <div className="flex flex-col gap-2 border-b border-ui-border px-3 py-2.5">
        <label className="flex items-center gap-2 rounded-lg bg-ui-field px-2 py-1 text-ui-muted focus-within:text-ui-text">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="find a person"
            aria-label="Find a person"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ui-text outline-none placeholder:text-ui-muted"
          />
        </label>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pt-2 text-[11px] text-ui-muted">
        <span title={LOADED_ONLY}>
          {people} {people === 1 ? 'person' : 'people'} · {loaded} loaded commit{loaded === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-2">
          {botCount > 0 && (
            <button type="button" onClick={() => setShowBots((v) => !v)} className="text-ui-accent hover:underline">
              {showBots ? 'hide bots' : `show ${botCount} bot${botCount === 1 ? '' : 's'}`}
            </button>
          )}
          {selected !== null && (
            <button type="button" onClick={() => toggleSelected(selected)} className="text-ui-accent hover:underline">
              clear
            </button>
          )}
        </span>
      </div>

      <ul ref={listRef} className="ui-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {rows.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-ui-muted">nobody matches</li>}
        {rows.map(({ c, rank }) => (
          <li key={c.key} data-key={c.key}>
            <ContributorRow
              contributor={c}
              rank={rank}
              share={c.commits / top}
              selected={selected === c.key}
              now={now}
              onSelect={() => toggleSelected(c.key)}
            />
            {selected === c.key && (
              <ContributorDetails
                contributor={c}
                palette={palette}
                fallback={fallback}
                windowStart={contributors.windowStart}
                windowEnd={contributors.windowEnd}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
