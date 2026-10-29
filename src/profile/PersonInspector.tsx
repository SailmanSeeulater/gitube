import { useMemo } from 'react'
import type { ProfileData } from '../types'
import { CloseIcon, ExternalIcon } from '../components/icons'
import { dayDetail, type DayIndex } from './dayIndex'
import type { LifeHover, RepoNamer, ShownName } from './lifeTypes'
import { GRAPHQL_FAILED } from './PersonLegend'
import { ShownRepoName } from './personIcons'
import { repoKey, shownMilestoneRepo } from './privacy'
import { githubDay, type Lane, type LifeTimeline } from './timeline'
import { usePersonStore } from './usePersonStore'

export interface PersonInspectorProps {
  profile: ProfileData
  timeline: LifeTimeline
  days: DayIndex
  /** language -> colour in the active theme */
  colourOf: (language: string | null) => string
  /** the only way a repo name reaches the inspector */
  name: RepoNamer
}

const shell =
  'absolute bottom-16 left-4 z-20 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-garden-border bg-garden-panel/95 p-3 text-[13px] shadow-soft backdrop-blur'

/** A card that only follows the hover lets the pointer through: opened under it, it would take the hover and close, again and again. */
const hoverShell = `${shell} pointer-events-none`

const badge = 'rounded bg-garden-hover px-1.5 py-px text-[10px] uppercase tracking-wide text-garden-muted'

/** Spans and repos listed before the rest are summed up. */
const MAX_ROWS = 5

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

/** recentFrom, a day key: githubDay leaves one as it is (and would read a timestamp in GitHub's zone, not the viewer's). */
function recentDay(profile: Pick<ProfileData, 'recentFrom'>): string | null {
  return profile.recentFrom ? (githubDay(profile.recentFrom) ?? profile.recentFrom) : null
}

/** A repo name as shown, on a line of its own. */
function Name({ shown, className }: { shown: ShownName; className: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <ShownRepoName shown={shown} />
    </span>
  )
}

function RepoCard({ lane, profile, colour, shown, pinned, onClose }: {
  lane: Lane
  profile: ProfileData
  colour: string
  shown: ShownName
  pinned: boolean
  onClose: () => void
}) {
  const graphql = profile.source === 'graphql'
  const kinds: string[] = []
  if (!lane.isOwn) kinds.push('contributed')
  if (lane.isFork) kinds.push('fork')
  if (lane.isArchived) kinds.push('archived')
  const active = lane.spans.filter((span) => span.kind === 'active')
  const activeDays = active.reduce((sum, span) => sum + span.days, 0)
  const last = lane.spans[lane.spans.length - 1]
  const listed = active.slice(-MAX_ROWS)
  const recent = graphql ? 0 : profile.recent.reduce((sum, r) => sum + (repoKey(r.repo) === repoKey(lane.repo) ? r.pushes : 0), 0)
  const recentFrom = recentDay(profile)
  // a token run GraphQL could not fill came from REST too, but not for want of a token
  const uncounted = profile.fallback ? `no commit counts: ${GRAPHQL_FAILED}` : 'commits are not counted without a token'

  return (
    // only the pinned card, with its close button and link, takes the pointer
    <div role={pinned ? 'dialog' : undefined} aria-label={pinned ? 'Repo details' : undefined} className={pinned ? shell : hoverShell}>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} />
        <Name shown={shown} className="font-medium text-garden-text" />
        {kinds.map((kind) => (
          <span key={kind} className={badge}>
            {kind}
          </span>
        ))}
        <span className="flex-1" />
        {pinned && (
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text">
            <CloseIcon />
          </button>
        )}
      </div>

      <p className="mt-1.5 text-[12px] text-garden-muted">
        <span className="text-garden-text-dim">{lane.language ?? 'no language'}</span>
        {' · born '}
        {lane.born}
        {!lane.isOwn && ` · first contributed ${lane.root}`}
        {lane.startDay < lane.rootDay && ` · backdated commits from ${lane.start}`}
      </p>

      <p className="mt-1.5 text-[12px] text-garden-muted">
        {plural(active.length, 'active span')}, {plural(activeDays, 'day')} in all
        {lane.isArchived ? ` · archived, last active ${lane.lastActive}` : last.kind === 'dormant' ? ` · quiet since ${last.from}` : ''}
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] tabular-nums text-garden-text-dim">
        {active.length > listed.length && <li className="text-garden-muted">+{active.length - listed.length} earlier</li>}
        {listed.map((span) => (
          <li key={span.fromDay}>
            {span.from === span.to ? span.from : `${span.from} – ${span.to}`}
            {graphql && lane.detailed && <span className="text-garden-muted"> · {plural(span.commits, 'commit')}</span>}
          </li>
        ))}
      </ul>

      <p className="mt-1.5 text-[12px] text-garden-text-dim">
        {!graphql
          ? uncounted
          : lane.detailed
            ? `${plural(lane.commits, 'commit')} on ${plural(lane.activeDays, 'day')}`
            : 'GitHub counted no commits to it: see what the data leaves out, in the panel'}
      </p>
      {!graphql && (
        <p className="mt-0.5 text-[12px] text-garden-muted">
          {plural(recent, 'push', 'pushes')}
          {recentFrom ? ` since ${recentFrom}` : ' lately'}
        </p>
      )}
      {lane.landed.length > 0 && (
        <p className="mt-0.5 text-[12px] text-garden-text-dim" title="pull requests of theirs merged into this repo, by the day they were merged">
          {plural(lane.landed.length, 'pr')} landed
          {lane.landed.length === 1 ? ` on ${lane.landed[0]}` : ` · first ${lane.landed[0]} · last ${lane.landed[lane.landed.length - 1]}`}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between text-[12px]">
        <span className="text-garden-muted">
          {plural(lane.stars, 'star')}
          {' · '}
          {plural(lane.forks, 'fork')}
        </span>
        {/* a private repo never gets a link, revealed or not */}
        {!shown.locked && (
          <a
            href={`https://github.com/${lane.repo}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-garden-accent hover:underline"
          >
            open on GitHub <ExternalIcon size={12} />
          </a>
        )}
      </div>
    </div>
  )
}

function DayCard({ day, milestone, profile, timeline, days, name }: {
  day: number
  milestone: number | null
  profile: ProfileData
  timeline: LifeTimeline
  days: DayIndex
  name: RepoNamer
}) {
  const graphql = profile.source === 'graphql'
  const detail = dayDetail(days, day)
  // the most active first, ties in lane order, so the order tells nothing of a hidden name
  const repos = detail.repos
  const listed = repos.slice(0, MAX_ROWS)
  const rooted = timeline.lanes.filter((lane) => lane.rootDay === detail.day)
  const recentFrom = recentDay(profile)

  return (
    <div className={hoverShell}>
      <p className="flex items-center gap-2">
        {/* a day number is days since 1970-01-01 of GitHub's day: read in UTC, it is that day */}
        <span className="font-mono text-garden-text">{detail.key}</span>
        <span className="text-[12px] text-garden-muted">{WEEKDAYS[new Date(detail.day * 86_400_000).getUTCDay()]}</span>
      </p>

      {graphql ? (
        <p className="mt-1.5 text-[12px] text-garden-text-dim">
          {detail.count !== null ? plural(detail.count, 'contribution') : 'not in the contribution calendar'}
        </p>
      ) : (
        !detail.known && (
          <p className="mt-1.5 text-[12px] text-garden-muted">
            no day detail before {recentFrom ?? 'the last 30 days'}
            {profile.fallback ? `: ${GRAPHQL_FAILED}` : ' without a token'}
          </p>
        )
      )}

      {listed.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px]">
          {listed.map((row) => (
            <li key={repoKey(row.repo)} className="flex items-center justify-between gap-2">
              <Name shown={name(row.repo)} className="text-garden-text-dim" />
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-garden-muted">
                {row.unit === 'commits' ? plural(row.n, 'commit') : plural(row.n, 'push', 'pushes')}
              </span>
            </li>
          ))}
          {repos.length > listed.length && <li className="text-[11px] text-garden-muted">+{repos.length - listed.length} more</li>}
        </ul>
      )}
      {detail.landed.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px]">
          {detail.landed.slice(0, MAX_ROWS).map((row) => (
            <li key={repoKey(row.repo)} className="flex items-center justify-between gap-2">
              <Name shown={name(row.repo)} className="text-garden-text-dim" />
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-garden-accent">{plural(row.n, 'pr')} landed</span>
            </li>
          ))}
          {detail.landed.length > MAX_ROWS && <li className="text-[11px] text-garden-muted">+{detail.landed.length - MAX_ROWS} more</li>}
        </ul>
      )}
      {listed.length === 0 && detail.landed.length === 0 && detail.known && (!graphql || (detail.count ?? 0) > 0) && (
        <p className="mt-1 text-[12px] text-garden-muted">
          {graphql ? 'no commits to a repo listed here: issues, pull requests, reviews or private work' : 'no public pushes'}
        </p>
      )}

      {rooted.length > 0 && (
        <div className="mt-1.5 text-[12px] text-garden-muted">
          {rooted.length === 1 ? 'rooted this day:' : `${rooted.length} rooted this day:`}
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {rooted.slice(0, MAX_ROWS).map((lane) => (
              <li key={repoKey(lane.repo)}>
                <Name shown={name(lane.repo)} className="text-garden-text-dim" />
              </li>
            ))}
            {rooted.length > MAX_ROWS && <li className="text-[11px]">+{rooted.length - MAX_ROWS} more</li>}
          </ul>
        </div>
      )}

      {detail.milestones.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-garden-border pt-2 text-[12px]">
          {detail.milestones.map((index) => {
            const m = timeline.milestones[index]
            if (!m) return null
            const repo = shownMilestoneRepo(m, name)
            return (
              <li key={index} className={index === milestone ? 'text-garden-accent' : 'text-garden-text'}>
                {m.label}
                {repo && <Name shown={repo} className="text-garden-muted" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The card the inspector shows: a day's, or a repo's, pinned when it is the selected one. */
export type InspectorCard =
  | { kind: 'day'; day: number; milestone: number | null }
  | { kind: 'repo'; key: string; pinned: boolean }
  | null

/**
 * Which card a hover and a selection show. A hovered repo or milestone shows over the selection; a
 * plain day does not, so the pointer can cross the ground to the pinned card's close button and
 * link without the card turning into each day it passes.
 */
export function inspectorCard(hover: LifeHover, selected: string | null): InspectorCard {
  if (hover?.kind === 'repo') return { kind: 'repo', key: hover.key, pinned: hover.key === selected }
  if (hover?.kind === 'day' && (selected === null || hover.milestone !== null)) return hover
  return selected === null ? null : { kind: 'repo', key: selected, pinned: true }
}

/**
 * Details of what the pointer is over: a repo (born, active spans, commits, landed pull requests,
 * stars) or a day (its contributions or pushes, by repo, the pull requests landed that day, and its
 * milestones); with nothing hovered, or a plain day, the
 * selected repo (inspectorCard). Every name comes through the namer, and dates are GitHub's day
 * keys as written.
 */
export default function PersonInspector({ profile, timeline, days, colourOf, name }: PersonInspectorProps) {
  const hover = usePersonStore((s) => s.hover)
  const selected = usePersonStore((s) => s.selected)
  const select = usePersonStore((s) => s.select)
  const byKey = useMemo(() => new Map(timeline.lanes.map((lane, i) => [repoKey(lane.repo), i])), [timeline])

  const card = inspectorCard(hover, selected)
  if (card?.kind === 'day') {
    return <DayCard day={card.day} milestone={card.milestone} profile={profile} timeline={timeline} days={days} name={name} />
  }
  if (card === null) return null
  const index = byKey.get(card.key)
  if (index === undefined) return null
  const lane = timeline.lanes[index]
  return (
    <RepoCard
      lane={lane}
      profile={profile}
      colour={colourOf(lane.language)}
      shown={name(lane.repo)}
      pinned={card.pinned}
      onClose={() => select(null)}
    />
  )
}
