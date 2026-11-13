import { useEffect, useState } from 'react'
import { recentRepos, sharedRepoStore, type RecentRepo } from '../api/repoCache'
import { useTheme } from '../theme/useTheme'
import type { Theme } from '../theme/themes'
import { useRateBudget } from '../hooks/useRateBudget'
import { SAMPLES, type Sample } from '../samples/samples'
import { formatClock, relativeTime } from './graphUtils'
import { ExternalIcon, MetroIcon, StarIcon } from './icons'

export interface EmptyStateProps {
  /** a repo ('owner/repo') or a login was picked: fill the address field and load it */
  onPick: (example: string) => void
  /** a snapshot sample was picked: open it without a request */
  onSample: (sample: Sample) => void
  /** 'owner/repo' of a sample on its way in, if any */
  sampleLoading?: string | null
  /** opens the token panel */
  onAddToken?: () => void
}

/** The app's own source, linked from the start screen. */
const SOURCE_URL = 'https://github.com/SailmanSeeulater/gitube'

/** Who made gitube, and where to find them. */
const MAKER = 'Perfect Phanitchaleun'
const MAKER_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Portfolio', href: 'https://latesailor.dev' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/perfect-phanitchaleun' },
  { label: 'GitHub', href: 'https://github.com/SailmanSeeulater' },
]

const PEOPLE: ReadonlyArray<{ value: string; note: string }> = [
  { value: 'torvalds', note: 'since 2011' },
  { value: 'karpathy', note: '15 years' },
]

/**
 * The fewest requests a person view can take without a token (3 to 9: README, "A person"). Below
 * it the people chips grey out until the budget refills.
 */
const PERSON_MIN_REQUESTS = 3

/** Recent chips shown at most. */
const MAX_RECENT = 4

const chip =
  'ui-press group flex h-9 max-w-full items-center gap-2 rounded-full border border-ui-border bg-ui-panel px-3.5 text-[13px] text-ui-text shadow-soft hover:border-ui-accent/60'
const chipNote = 'shrink-0 text-[11px] text-ui-muted group-hover:text-ui-text-dim'
const rowLabel = 'w-full text-[11px] font-medium uppercase tracking-[0.08em] text-ui-muted sm:w-[4.5rem] sm:text-right'

/**
 * What gitube draws, in the active theme's colours: a trunk with three branches, one merging back.
 * The lines draw themselves in once (see ui-draw in index.css); the stations follow.
 */
function HeroMap({ theme }: { theme: Theme }) {
  const [a, b, c] = theme.branchColors
  const line = (delay: number) => ({ pathLength: 1, className: 'ui-draw', style: { animationDelay: `${delay}ms` } })
  const dot = (delay: number) => ({ className: 'ui-fade', style: { animationDelay: `${delay}ms` } })
  const interchange = (cx: number, delay: number) => (
    <circle cx={cx} cy="60" r="5.5" fill={theme.canvas} stroke={theme.stationRing} strokeWidth="2.5" {...dot(delay)} />
  )
  return (
    <svg viewBox="0 0 320 104" aria-hidden focusable="false" className="h-auto w-[min(320px,78vw)]">
      <g fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 60H302" stroke={theme.accent} {...line(0)} />
        <path d="M72 60l28-28h68l28 28" stroke={a} {...line(260)} />
        <path d="M132 60l24 24h78" stroke={b} {...line(420)} />
        <path d="M222 60l24-24h40" stroke={c} {...line(580)} />
      </g>
      {interchange(72, 500)}
      {interchange(132, 620)}
      {interchange(196, 700)}
      {interchange(222, 780)}
      <circle cx="234" cy="84" r="6" fill={b} {...dot(900)} />
      <circle cx="286" cy="36" r="6" fill={c} {...dot(1000)} />
      <circle cx="302" cy="60" r="7" fill={theme.accent} {...dot(820)} />
      <circle cx="18" cy="60" r="6" fill={theme.canvas} stroke={theme.stationRing} strokeWidth="2.5" {...dot(0)} />
    </svg>
  )
}

/**
 * How much of GitHub's hourly budget is left, so a click never lands on a rate limit unannounced:
 * "58 of 60 free requests left this hour", or, once spent, when it refills and what still works.
 */
function BudgetLine({
  budget,
  reset,
  onAddToken,
}: {
  budget: { remaining: number | null; limit: number | null }
  reset: string
  onAddToken?: () => void
}) {
  if (budget.remaining === null) return null
  const free = budget.limit === null || budget.limit <= 60
  const of = budget.limit !== null ? ` of ${budget.limit.toLocaleString('en-US')}` : ''
  if (budget.remaining < PERSON_MIN_REQUESTS) {
    return (
      <p role="status" className="text-pretty text-[12px] text-ui-warn">
        GitHub's free requests are used up{reset ? ` until ${reset}` : ' for this hour'}. The repo samples still open instantly
        {onAddToken ? (
          <>
            , or{' '}
            <button type="button" onClick={onAddToken} className="font-medium text-ui-accent hover:underline">
              add a token
            </button>{' '}
            for 5,000 an hour.
          </>
        ) : (
          '.'
        )}
      </p>
    )
  }
  return (
    <p className="flex items-center justify-center gap-1.5 text-[12px] text-ui-muted">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ui-accent" />
      <span className="tabular-nums">
        {budget.remaining.toLocaleString('en-US')}
        {of} {free ? 'free requests' : 'requests'} left this hour
      </span>
      <span aria-hidden className="text-ui-border">
        ·
      </span>
      <span>samples use none</span>
    </p>
  )
}

/**
 * The start screen, shown until something is loaded: what gitube is, in a line, and one click into
 * either mode (an example repo, an example person, or a repo opened here before).
 */
export default function EmptyState({ onPick, onSample, sampleLoading = null, onAddToken }: EmptyStateProps) {
  const theme = useTheme()
  const budget = useRateBudget()
  const reset = formatClock(budget.resetAt)
  const spent = budget.remaining !== null && budget.remaining < PERSON_MIN_REQUESTS
  // repos loaded in this browser before; loading one again within a day costs no requests
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
    // the page behind stays reachable round the column (a file dropped anywhere still opens)
    <main className="ui-scroll pointer-events-none absolute inset-0 z-10 overflow-y-auto">
      <div className="pointer-events-auto mx-auto flex min-h-full w-full max-w-[640px] flex-col items-center justify-center gap-7 px-5 pb-8 pt-24 text-center">
        <HeroMap theme={theme} />

        <div className="ui-rise flex flex-col items-center gap-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ui-accent">
            <MetroIcon size={15} />
            gitube
          </p>
          <h1 className="text-balance text-[32px] font-semibold leading-[1.08] tracking-[-0.03em] text-ui-text sm:text-[44px]">
            A tube map of any GitHub repo.
          </h1>
          <p className="max-w-[30rem] text-pretty text-[15px] leading-relaxed text-ui-text-dim">
            Every branch gets its own line, forking off and merging back. Enter a username instead and their repos become lines
            through the years.
          </p>
        </div>

        <div className="ui-rise flex w-full max-w-[520px] flex-col gap-3 [animation-delay:120ms]">
          <BudgetLine budget={budget} reset={reset} onAddToken={onAddToken} />
          <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap sm:justify-start">
            <span className={rowLabel} title="snapshots served with gitube: they open instantly and use no GitHub requests">
              Repos
            </span>
            {SAMPLES.map((sample) => {
              const name = `${sample.owner}/${sample.repo}`
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onSample(sample)}
                  disabled={sampleLoading !== null}
                  title="a snapshot: opens instantly, no GitHub requests"
                  className={`${chip} disabled:opacity-60`}
                >
                  <span className="truncate font-mono text-[12px]">{name}</span>
                  <span className={chipNote}>{sampleLoading === name ? 'opening…' : sample.note}</span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap sm:justify-start">
            <span className={rowLabel}>People</span>
            {PEOPLE.map((example) => (
              <button
                key={example.value}
                type="button"
                onClick={() => onPick(example.value)}
                disabled={spent}
                title={spent ? `needs 3 to 9 GitHub requests; the free ones refill${reset ? ` at ${reset}` : ' within the hour'}` : 'loads live: 3 to 9 GitHub requests'}
                className={`${chip} disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-ui-border`}
              >
                <span className="truncate font-mono text-[12px]">{example.value}</span>
                <span className={chipNote}>{spent && reset ? `after ${reset}` : example.note}</span>
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className={rowLabel} title="opened in this browser before; within a day they load without a request">
                Recent
              </span>
              {recent.map((r) => (
                <button key={`${r.owner}/${r.repo}`} type="button" onClick={() => onPick(`${r.owner}/${r.repo}`)} className={chip}>
                  <span className="truncate font-mono text-[12px]">
                    {r.owner}/{r.repo}
                  </span>
                  <span className={chipNote}>{relativeTime(r.savedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ui-rise flex flex-col items-center gap-2 text-[12px] text-ui-muted [animation-delay:200ms]">
          <p>
            Type <span className="font-mono text-ui-text-dim">owner/repo</span> or a username in the bar above, or drop a saved{' '}
            <span className="font-mono text-ui-text-dim">.json</span> file anywhere.
          </p>
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span>Runs in your browser</span>
            <span aria-hidden className="text-ui-border">
              ·
            </span>
            <span>No sign-up</span>
            <span aria-hidden className="text-ui-border">
              ·
            </span>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ui-accent hover:underline">
              Open source
              <ExternalIcon size={11} />
            </a>
          </p>
        </div>

        <footer className="ui-rise flex w-full max-w-[420px] flex-col items-center gap-3 border-t border-ui-border pt-5 text-[12px] text-ui-muted [animation-delay:260ms]">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span>
              Made by <span className="font-medium text-ui-text-dim">{MAKER}</span>
            </span>
            {MAKER_LINKS.map((link) => (
              <span key={link.label} className="inline-flex items-center gap-2">
                <span aria-hidden className="text-ui-border">
                  ·
                </span>
                <a href={link.href} target="_blank" rel="noreferrer" className="text-ui-accent hover:underline">
                  {link.label}
                </a>
              </span>
            ))}
          </p>
          <p className="text-pretty">If gitube is useful to you, a star on GitHub would be really appreciated.</p>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={chip}>
            <StarIcon size={14} className="text-ui-accent" />
            <span>Star gitube on GitHub</span>
          </a>
        </footer>
      </div>
    </main>
  )
}
