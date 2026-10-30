import type { ProfileData } from '../types'
import { useGardenStore } from '../store/useGardenStore'
import { formatClock, relativeTime } from '../components/gardenUtils'
import { PlayIcon } from '../components/icons'
import type { LifeTimeline } from './timeline'
import { cutShort } from './PersonLegend'
import { fallbackNote } from './personErrors'

export interface PersonStatusProps {
  profile: ProfileData
  timeline: LifeTimeline
  /** the profile came from this browser's cache: when it was fetched (ISO); null for a live fetch */
  cachedAt: string | null
  hasToken: boolean
  /** fetch the profile from GitHub again, skipping the cache */
  onRefresh: () => void
  /** opens the token form */
  onAddToken: () => void
  /** opens the time-lapse (the strip gives way to its controls); omitted while there is no view to grow */
  onTimelapse?: () => void
}

const shell =
  'absolute bottom-4 left-4 z-20 rounded-xl border border-garden-border bg-garden-panel/95 text-[12px] shadow-soft backdrop-blur'

const warnChip = 'rounded-md border border-garden-warn/40 bg-garden-warn/10 px-1.5 py-px text-[11px] text-garden-warn'

/**
 * The status strip once a profile is on show: the button that opens the time-lapse, its repos, its
 * span of years and (with a token) its contributions and the pull requests it landed in other
 * people's repos; why REST filled a token run, what was cut
 * short, and whether it came from the cache. The fetching state is StatusStrip's, which reads only
 * the progress.
 */
export default function PersonStatus({ profile, timeline, cachedAt, hasToken, onRefresh, onAddToken, onTimelapse }: PersonStatusProps) {
  // the core budget as the latest response put it; GraphQL points never land here
  const rate = useGardenStore((s) => s.rate)
  const repos = timeline.lanes.length
  // years from GitHub's day keys, read as written
  const from = timeline.start.slice(0, 4)
  const to = timeline.today.slice(0, 4)
  const contributions = profile.source === 'graphql' ? timeline.eras.reduce((sum, era) => sum + (era.contributions ?? 0), 0) : null
  // pull requests landed in repos they do not own, as the lanes hold them (a token profile only)
  let landed = 0
  let landedRepos = 0
  for (const lane of timeline.lanes) {
    if (lane.landed.length === 0) continue
    landed += lane.landed.length
    landedRepos += 1
  }
  const note = profile.fallback ? fallbackNote(profile.fallback) : null
  const short = cutShort(profile)
  const remaining = rate?.remaining ?? null

  return (
    <div className={`${shell} flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5`} role="status">
      {onTimelapse && (
        <button
          type="button"
          onClick={onTimelapse}
          title="Replay this life from its start, and record it as a video"
          className="-ml-1.5 flex items-center gap-1 rounded-md bg-garden-accent/15 px-1.5 py-px text-[11px] font-medium text-garden-accent hover:bg-garden-accent/25"
        >
          <PlayIcon size={11} />
          replay
        </button>
      )}
      <span className="text-garden-text-dim">
        {repos} repo{repos === 1 ? '' : 's'}
      </span>
      <span className="text-garden-border">·</span>
      <span className="text-garden-text-dim" title={`${timeline.start} to ${timeline.today}, in GitHub's days`}>
        {from === to ? from : `${from}–${to}`}
      </span>
      {contributions !== null && (
        <>
          <span className="text-garden-border">·</span>
          <span className="text-garden-muted" title="GitHub's contribution calendar, summed over the years shown">
            {contributions} contribution{contributions === 1 ? '' : 's'}
          </span>
        </>
      )}
      {landed > 0 && (
        <>
          <span className="text-garden-border">·</span>
          <span className="text-garden-muted" title="pull requests of theirs merged into repos they do not own">
            {landed} pr{landed === 1 ? '' : 's'} landed in {landedRepos} repo{landedRepos === 1 ? '' : 's'}
          </span>
        </>
      )}
      {note && (
        <span className={`flex items-center gap-1.5 ${warnChip}`} title={note.title}>
          {note.text}
          <button type="button" onClick={onRefresh} className="text-garden-accent hover:underline">
            try again
          </button>
        </span>
      )}
      {short.length > 0 && (
        <span className={warnChip} title={short.join(' ')}>
          profile truncated
        </span>
      )}
      {cachedAt !== null && (
        <span
          className="flex items-center gap-1.5 rounded-md border border-garden-border px-1.5 py-px text-[11px] text-garden-text-dim"
          title={`Shown from this browser's cache (fetched ${relativeTime(cachedAt)} at ${formatClock(cachedAt)}), so it used no GitHub requests.`}
        >
          cached {relativeTime(cachedAt)}
          <button type="button" onClick={onRefresh} className="text-garden-accent hover:underline">
            refresh
          </button>
        </span>
      )}
      {!hasToken && (
        <button
          type="button"
          onClick={onAddToken}
          title="With a token, person mode reads the commits GitHub counted, day by day, the contribution calendar and the first pull request and issue (GitHub's GraphQL API), and the hourly limit goes from 60 requests to 5000."
          className="text-[11px] text-garden-accent hover:underline"
        >
          add a token for commits
        </button>
      )}
      {remaining !== null && cachedAt === null && (
        <span className="text-garden-muted" title="GitHub API requests remaining this hour">
          {remaining} requests left
        </span>
      )}
    </div>
  )
}
