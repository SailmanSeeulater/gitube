/**
 * A prolific profile for the life lines' tests at scale: hundreds of repos over ten years, the way an
 * account that starts a lot of things looks, from a seed so a failure reproduces.
 */
import { dayKey, dayNumber } from '../../src/profile/timeline'
import type { ProfileData, ProfileRepo } from '../../src/types'

/** A timestamp on a day: 20:00 UTC is 12:00 or 13:00 the same day in Los Angeles. */
const iso = (day: string) => `${day}T20:00:00Z`

/**
 * A prolific account of n repos over ten years (to 2024-06-01; read it at a now after that): most
 * worked on for a few weeks or months and then left, some picked up again a year or two on, some
 * still going, some archived, forked or someone else's. With a token each has its commits; without
 * one, its first and last push.
 */
export function prolific(n: number, source: ProfileData['source'], seed = 11): ProfileData {
  let state = seed
  const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const from = dayNumber('2014-06-01')
  const last = dayNumber('2024-06-01')
  const repos = Array.from({ length: n }, (_, i): ProfileRepo => {
    const born = from + Math.floor(rand() * (last - from))
    // weeks to two years of work, mostly short
    const runs = 1 + Math.floor(rand() * rand() * 36)
    const days = Array.from({ length: runs }, (_, r) => born + r * 20)
    if (rand() < 0.15) for (let r = 0; r < 3; r++) days.push(days.at(-1)! + 400 + Math.floor(rand() * 300) + r * 15)
    if (rand() < 0.05) for (let d = days.at(-1)! + 60; d < last; d += 45) days.push(d)
    const activity = days.filter((d) => d <= last).map((d) => ({ date: dayKey(d), commits: 1 + Math.floor(rand() * 8) }))
    const kind = rand()
    const own = kind > 0.1
    const created = iso(dayKey(born))
    return {
      nameWithOwner: own ? `me/r${i}` : `someone/r${i}`,
      createdAt: own ? created : iso('2012-01-01'),
      firstActiveAt: created,
      lastActiveAt: iso(activity.at(-1)!.date),
      isOwn: own,
      language: ['TypeScript', 'Go', 'Rust', 'Python', null][i % 5],
      languageColor: null,
      stars: Math.floor(rand() * rand() * 500),
      forks: 0,
      isFork: kind > 0.1 && kind < 0.25,
      isArchived: kind > 0.9,
      isPrivate: false,
      activity: source === 'graphql' ? activity : [],
    }
  })
  return {
    login: 'me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2014-05-01'),
    source,
    repos,
    days: [],
    recent: [],
    recentFrom: null,
    milestones: [],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    fallback: null,
  }
}
