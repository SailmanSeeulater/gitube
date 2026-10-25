import { useMemo, type KeyboardEvent } from 'react'
import type { ProfileData } from '../types'
import type { Theme } from '../theme/themes'
import { useGardenStore } from '../store/useGardenStore'
import { SearchIcon } from '../components/icons'
import type { RepoNamer, ShownName } from './lifeTypes'
import PersonLegend from './PersonLegend'
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, LockIcon, ShownRepoName } from './personIcons'
import { repoKey, shownMilestoneRepo } from './privacy'
import { dayNumber, githubDay, type Lane, type LifeTimeline } from './timeline'
import { usePersonStore, type PersonState } from './usePersonStore'

export interface PersonPanelProps {
  profile: ProfileData
  timeline: LifeTimeline
  /** language -> colour in the active theme, the one the canvas paints with */
  colourOf: (language: string | null) => string
  /** the only way a repo name reaches the panel */
  name: RepoNamer
  /** private repos in the profile (privateRepoKeys): the privacy toggle shows only when there are some */
  privateCount: number
  /** private names show, for this login (isRevealed) */
  revealed: boolean
  onReveal: (on: boolean) => void
  theme: Theme
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** GitHub serves avatars at any size through ?s=; ask for a crisp one at twice the drawn size. */
const AVATAR_PX = 32

function Tabs({ value, onChange, repoCount, milestoneCount }: {
  value: PersonState['tab']
  onChange: (tab: PersonState['tab']) => void
  repoCount: number
  milestoneCount: number
}) {
  const tabs: ReadonlyArray<{ id: PersonState['tab']; label: string; count: number }> = [
    { id: 'repos', label: 'repos', count: repoCount },
    { id: 'milestones', label: 'milestones', count: milestoneCount },
  ]
  return (
    <div role="tablist" aria-label="Panel" className="flex gap-1 border-b border-garden-border px-2">
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-[12px] transition-colors ${
              active ? 'border-garden-accent text-garden-accent' : 'border-transparent text-garden-muted hover:text-garden-text'
            }`}
          >
            {tab.label}
            <span className="rounded bg-garden-hover px-1 font-mono text-[10px] tabular-nums text-garden-muted">{tab.count}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The privacy toggle (PROFILE_SPEC.md section 2, "Privacy rule"): names hidden by default, shown on this screen only. */
function PrivacyToggle({ count, revealed, onReveal }: { count: number; revealed: boolean; onReveal: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={revealed}
      onClick={() => onReveal(!revealed)}
      title="Shows private repo names on this screen only, never in links or analytics. Hidden again on reload."
      className="flex items-center gap-2 border-b border-garden-border px-3 py-2 text-left text-[12px] text-garden-muted hover:bg-garden-hover hover:text-garden-text"
    >
      <LockIcon />
      <span className="min-w-0 flex-1">
        {plural(count, 'private repo')}: names {revealed ? 'shown on this screen' : 'hidden'}
      </span>
      <span className="shrink-0 text-garden-accent">{revealed ? 'hide' : 'show'}</span>
    </button>
  )
}

export interface RepoRowProps {
  lane: Lane
  shown: ShownName
  colour: string
  selected: boolean
  hidden: boolean
  /** the pointer is over its plant on the canvas */
  hovered: boolean
  onSelect: () => void
  onToggleHidden: () => void
  onHover: (on: boolean) => void
}

/**
 * A repo row's keys: Enter or Space on the row itself selects it. A key pressed on the eye button
 * inside bubbles up here too, and is the button's own: preventing it would cancel the button's
 * click (hiding the repo) and select the row instead, so the row leaves it be.
 */
export function onRepoRowKey(event: Pick<KeyboardEvent, 'key' | 'target' | 'currentTarget' | 'preventDefault'>, onSelect: () => void): void {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
  event.preventDefault()
  onSelect()
}

export function RepoRow({ lane, shown, colour, selected, hidden, hovered, onSelect, onToggleHidden, onHover }: RepoRowProps) {
  const kinds: string[] = []
  if (!lane.isOwn) kinds.push('contributed')
  if (lane.isFork) kinds.push('fork')
  if (lane.isArchived) kinds.push('archived')
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => onRepoRowKey(event, onSelect)
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
        title={`${shown.text}, rooted ${lane.root}`}
        className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
          selected ? 'bg-garden-accent/10' : hovered ? 'bg-garden-hover' : 'hover:bg-garden-hover'
        } ${hidden ? 'opacity-40' : ''}`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} />
        <span className={`flex min-w-0 flex-1 items-center gap-1 ${selected ? 'text-garden-accent' : 'text-garden-text'}`}>
          <ShownRepoName shown={shown} />
          {kinds.map((kind) => (
            <span key={kind} className="ml-1.5 shrink-0 text-[10px] uppercase tracking-wide text-garden-muted">
              {kind}
            </span>
          ))}
        </span>
        {lane.stars > 0 && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-garden-muted" title={plural(lane.stars, 'star')}>
            ★{lane.stars}
          </span>
        )}
        {/* the year it was rooted, from GitHub's day key as written */}
        <span className="w-[2.75rem] shrink-0 whitespace-nowrap text-right text-[11px] text-garden-muted">{lane.root.slice(0, 4)}</span>
        <button
          type="button"
          aria-label={hidden ? `Show ${shown.text}` : `Hide ${shown.text}`}
          aria-pressed={hidden}
          onClick={(event) => {
            event.stopPropagation()
            onToggleHidden()
          }}
          className={`shrink-0 rounded p-0.5 text-garden-muted transition-opacity hover:text-garden-text ${
            hidden ? '' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
          }`}
        >
          {hidden ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </li>
  )
}

/**
 * Person mode's side panel: who it is, the privacy toggle, the repo list (search, hide, select) and
 * the milestones, with the legend at the foot. Every repo name comes through the namer, and search
 * matches only what is shown, so a hidden private name cannot be found by guessing it.
 */
export default function PersonPanel({ profile, timeline, colourOf, name, privateCount, revealed, onReveal, theme }: PersonPanelProps) {
  const panelOpen = useGardenStore((s) => s.panelOpen)
  const togglePanel = useGardenStore((s) => s.togglePanel)
  const tab = usePersonStore((s) => s.tab)
  const setTab = usePersonStore((s) => s.setTab)
  const search = usePersonStore((s) => s.search)
  const setSearch = usePersonStore((s) => s.setSearch)
  const hidden = usePersonStore((s) => s.hidden)
  const toggleHidden = usePersonStore((s) => s.toggleHidden)
  const showAll = usePersonStore((s) => s.showAll)
  const selected = usePersonStore((s) => s.selected)
  const select = usePersonStore((s) => s.select)
  const focusOn = usePersonStore((s) => s.focusOn)
  const setHover = usePersonStore((s) => s.setHover)
  // only the hovered repo's key, so moving over the ground from day to day re-renders no row
  const hoveredKey = usePersonStore((s) => (s.hover?.kind === 'repo' ? s.hover.key : null))

  // the newest roots first; lanes are a total order, so this one is too
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const out: Array<{ lane: Lane; key: string; shown: ShownName }> = []
    for (let i = timeline.lanes.length - 1; i >= 0; i--) {
      const lane = timeline.lanes[i]
      const shown = name(lane.repo)
      if (query && !shown.text.toLowerCase().includes(query) && !(lane.language ?? '').toLowerCase().includes(query)) continue
      out.push({ lane, key: repoKey(lane.repo), shown })
    }
    return out
  }, [timeline, name, search])

  if (!panelOpen) {
    return (
      <button
        type="button"
        onClick={togglePanel}
        title="Open panel"
        aria-label="Open panel"
        className="absolute right-0 top-4 z-20 rounded-l-lg border border-r-0 border-garden-border bg-garden-panel/95 px-1.5 py-2.5 text-garden-muted shadow-soft backdrop-blur hover:text-garden-text"
      >
        <ChevronLeftIcon />
      </button>
    )
  }

  const total = timeline.lanes.length
  const profileUrl = `https://github.com/${profile.login}`
  const avatar = `${profile.avatarUrl}${profile.avatarUrl.includes('?') ? '&' : '?'}s=${AVATAR_PX * 2}`

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-garden-border bg-garden-panel/95 text-[13px] shadow-soft backdrop-blur">
      <header className="flex items-start gap-2 border-b border-garden-border px-3 py-2.5">
        <img src={avatar} width={AVATAR_PX} height={AVATAR_PX} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full bg-garden-hover" />
        <div className="min-w-0 flex-1">
          <a href={profileUrl} target="_blank" rel="noreferrer" title={profileUrl} className="block truncate font-medium text-garden-text hover:text-garden-accent">
            {profile.login}
          </a>
          <div className="mt-0.5 truncate text-[11px] text-garden-muted">
            {profile.name ? `${profile.name} · ` : ''}on GitHub since {githubDay(profile.createdAt) ?? profile.createdAt.slice(0, 10)}
          </div>
        </div>
        <button
          type="button"
          onClick={togglePanel}
          title="Collapse panel"
          aria-label="Collapse panel"
          className="rounded p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
        >
          <ChevronRightIcon />
        </button>
      </header>

      {privateCount > 0 && <PrivacyToggle count={privateCount} revealed={revealed} onReveal={onReveal} />}

      <Tabs value={tab} onChange={setTab} repoCount={total} milestoneCount={timeline.milestones.length} />

      {tab === 'milestones' ? (
        <ul className="garden-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {timeline.milestones.length === 0 && <li className="px-2 py-3 text-center text-[12px] text-garden-muted">no milestones yet</li>}
          {timeline.milestones.map((m, i) => {
            const repo = shownMilestoneRepo(m, name)
            const day = dayNumber(m.day)
            const hover = () => setHover({ kind: 'day', day, milestone: i })
            return (
              <li key={`${m.kind} ${m.day}`}>
                <button
                  type="button"
                  onClick={() => focusOn({ kind: 'day', day })}
                  onPointerEnter={hover}
                  onPointerLeave={() => setHover(null)}
                  onFocus={hover}
                  onBlur={() => setHover(null)}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-garden-hover"
                >
                  {/* GitHub's day key, as written */}
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-garden-muted">{m.day}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-garden-text">{m.label}</span>
                    {repo && (
                      <span className="flex min-w-0 items-center gap-1 text-[11px] text-garden-muted">
                        <ShownRepoName shown={repo} />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b border-garden-border px-3 py-2.5">
            <label className="flex items-center gap-2 rounded-lg bg-garden-field px-2 py-1 text-garden-muted focus-within:text-garden-text">
              <SearchIcon />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="find a repo or language"
                aria-label="Find a repo"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-garden-text outline-none placeholder:text-garden-muted"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-2 px-3 pt-2 text-[11px] text-garden-muted">
            <span>{rows.length === total ? plural(total, 'repo') : `${rows.length} of ${plural(total, 'repo')}`}</span>
            <span className="flex items-center gap-2">
              {hidden.size > 0 && (
                <button type="button" onClick={showAll} className="text-garden-accent hover:underline">
                  show {hidden.size} hidden
                </button>
              )}
              {selected !== null && (
                <button type="button" onClick={() => select(null)} className="text-garden-accent hover:underline">
                  clear selection
                </button>
              )}
            </span>
          </div>

          <ul className="garden-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {rows.length === 0 && (
              <li className="px-2 py-3 text-center text-[12px] text-garden-muted">
                {total > 0 ? 'no repos match' : profile.source === 'rest' ? 'no public repos' : 'no repos'}
              </li>
            )}
            {rows.map(({ lane, key, shown }) => (
              <RepoRow
                key={key}
                lane={lane}
                shown={shown}
                colour={colourOf(lane.language)}
                selected={selected === key}
                hidden={hidden.has(key)}
                hovered={hoveredKey === key}
                onSelect={() => {
                  if (selected === key) {
                    select(null)
                    return
                  }
                  select(key)
                  focusOn({ kind: 'repo', key })
                }}
                onToggleHidden={() => toggleHidden(key)}
                onHover={(on) => setHover(on ? { kind: 'repo', key } : null)}
              />
            ))}
          </ul>
        </>
      )}

      {/* the legend scrolls on its own past this share of the panel, so the list keeps its room */}
      <footer className="garden-scroll min-h-0 overflow-y-auto border-t border-garden-border px-3 py-2.5" style={{ maxHeight: '45%' }}>
        <PersonLegend profile={profile} timeline={timeline} colourOf={colourOf} theme={theme} hasPrivate={privateCount > 0} />
      </footer>
    </aside>
  )
}
