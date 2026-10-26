import { describe, expect, it } from 'vitest'
import { PRIVATE_REPO_LABEL, isRevealed, privateRepoKeys, repoKey, repoNamer, shownMilestoneRepo } from '../src/profile/privacy'
import { buildLifeTimeline } from '../src/profile/timeline'
import type { ProfileData, ProfileRepo } from '../src/types'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')

/** A timestamp on a day: 20:00 UTC is 12:00 or 13:00 the same day in Los Angeles. */
const iso = (day: string) => `${day}T20:00:00Z`

function repo(nameWithOwner: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner,
    createdAt,
    firstActiveAt: createdAt,
    lastActiveAt: createdAt,
    isOwn: true,
    language: 'TypeScript',
    languageColor: null,
    stars: 0,
    forks: 0,
    isFork: false,
    isArchived: false,
    isPrivate: false,
    activity: [],
    ...over,
  }
}

/**
 * A token owner looking at themselves: the first and the most starred repo are private, and one
 * repo is listed twice, private in its stale copy and public in its fresh one.
 */
const PROFILE: ProfileData = {
  login: 'Me',
  name: null,
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  createdAt: iso('2019-01-10'),
  source: 'graphql',
  repos: [
    repo('Me/Secret-Plans', { createdAt: iso('2019-02-01'), stars: 40, isPrivate: true, activity: [{ date: '2019-02-01', commits: 3 }] }),
    repo('Me/open', { createdAt: iso('2020-03-01'), stars: 2, activity: [{ date: '2020-03-02', commits: 5 }] }),
    repo('me/mixed', { createdAt: iso('2021-05-01'), lastActiveAt: iso('2021-05-01'), isPrivate: true }),
    repo('Me/Mixed', { createdAt: iso('2021-05-01'), lastActiveAt: iso('2023-01-01'), isPrivate: false }),
  ],
  days: [],
  recent: [],
  recentFrom: null,
  milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
  restrictedContributions: 0,
  truncated: false,
  lostWindows: [],
  fallback: null,
}

const PRIVATE_NAMES = ['me/mixed', 'me/secret-plans']

/** Every private name, in any case, absent from text. */
function expectNoPrivateName(text: string) {
  for (const name of PRIVATE_NAMES) expect(text.toLowerCase()).not.toContain(name)
}

describe('privateRepoKeys', () => {
  it('keys each private repo by its lowercased name', () => {
    expect([...privateRepoKeys(PROFILE)].sort()).toEqual(PRIVATE_NAMES)
    expect(repoKey('Me/Secret-Plans')).toBe('me/secret-plans')
  })

  it('keys a repo private when any copy of it is, and its merged lane reads private too', () => {
    // the timeline merges the copies, lends the fresh (public) copy's fields, and keeps it private
    const lane = buildLifeTimeline(PROFILE, NOW).lanes.find((l) => repoKey(l.repo) === 'me/mixed')!
    expect(lane.isPrivate).toBe(true)
    expect(privateRepoKeys(PROFILE).has(repoKey(lane.repo))).toBe(true)
    expect(repoNamer(privateRepoKeys(PROFILE), false)(lane.repo)).toEqual({ text: PRIVATE_REPO_LABEL, locked: true })
  })

  it('is empty without private repos', () => {
    expect(privateRepoKeys({ repos: [repo('me/a'), repo('me/b')] }).size).toBe(0)
    expect(privateRepoKeys({ repos: [] }).size).toBe(0)
  })
})

describe('repoNamer', () => {
  const keys = privateRepoKeys(PROFILE)

  it('hides a private name, in any case, and shows a public one', () => {
    const name = repoNamer(keys, false)
    for (const variant of ['Me/Secret-Plans', 'me/secret-plans', 'ME/SECRET-PLANS', 'me/Mixed']) {
      expect(name(variant)).toEqual({ text: 'private repo', locked: true })
    }
    expect(name('Me/open')).toEqual({ text: 'Me/open', locked: false })
  })

  it("gives nothing of a hidden name's length away", () => {
    const name = repoNamer(keys, false)
    expect(name('Me/Secret-Plans').text).toBe(name('me/mixed').text)
  })

  it('shows a revealed private name with its lock', () => {
    const name = repoNamer(keys, true)
    expect(name('Me/Secret-Plans')).toEqual({ text: 'Me/Secret-Plans', locked: true })
    expect(name('Me/open')).toEqual({ text: 'Me/open', locked: false })
  })

  it('passes every name through when nothing is private', () => {
    const name = repoNamer(new Set(), false)
    expect(name('Me/Secret-Plans')).toEqual({ text: 'Me/Secret-Plans', locked: false })
  })

  it('gives a name the same object on every call', () => {
    const name = repoNamer(keys, false)
    expect(name('Me/open')).toBe(name('Me/open'))
    expect(name('Me/Secret-Plans')).toBe(name('Me/Secret-Plans'))
  })

  it('cannot have a name written into the hidden label', () => {
    const hidden = repoNamer(keys, false)('Me/Secret-Plans') as { text: string }
    expect(() => {
      hidden.text = 'Me/Secret-Plans'
    }).toThrow(TypeError)
    expect(repoNamer(keys, false)('me/mixed').text).toBe(PRIVATE_REPO_LABEL)
  })
})

describe('isRevealed', () => {
  it('reveals names only for the login the toggle was turned on for', () => {
    expect(isRevealed('me', 'Me')).toBe(true)
    expect(isRevealed('ME', 'me')).toBe(true)
    // another person, even one shown straight after from memory, starts hidden
    expect(isRevealed('me', 'someone')).toBe(false)
    expect(isRevealed(null, 'Me')).toBe(false)
  })
})

describe('shownMilestoneRepo', () => {
  const timeline = buildLifeTimeline(PROFILE, NOW)

  it("masks the derived milestones' private repos", () => {
    // first-repo and top-repo come from the timeline model, which names the private repo
    const first = timeline.milestones.find((m) => m.kind === 'first-repo')!
    const top = timeline.milestones.find((m) => m.kind === 'top-repo')!
    expect(first.repo).toBe('Me/Secret-Plans')
    expect(top.repo).toBe('Me/Secret-Plans')
    const name = repoNamer(privateRepoKeys(PROFILE), false)
    expect(shownMilestoneRepo(first, name)).toEqual({ text: PRIVATE_REPO_LABEL, locked: true })
    expect(shownMilestoneRepo(top, name)).toEqual({ text: PRIVATE_REPO_LABEL, locked: true })
  })

  it('is null for a milestone without a repo', () => {
    const joined = timeline.milestones.find((m) => m.kind === 'joined')!
    expect(shownMilestoneRepo(joined, repoNamer(privateRepoKeys(PROFILE), false))).toBeNull()
    expect(shownMilestoneRepo({ repo: '' }, repoNamer(new Set(), false))).toBeNull()
  })

  it('leaves no private name in what the milestones show while hidden', () => {
    const name = repoNamer(privateRepoKeys(PROFILE), false)
    const shown = timeline.milestones.map((m) => ({ kind: m.kind, day: m.day, label: m.label, repo: shownMilestoneRepo(m, name) }))
    expect(shown.length).toBeGreaterThan(2)
    expectNoPrivateName(JSON.stringify(shown))
    // and the lanes, named the same way
    expectNoPrivateName(JSON.stringify(timeline.lanes.map((lane) => name(lane.repo))))
  })
})
