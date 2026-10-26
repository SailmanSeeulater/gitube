/**
 * Private repo names in person mode (PROFILE_SPEC.md section 2, "Privacy rule"). While a profile
 * holds a private repo, its name is hidden by default: every view shows "private repo" with a lock
 * in its place, on canvas and in the DOM alike. A toggle reveals the names on screen only, for the
 * login it was turned on for, and nothing persists it, so a reload or a new grow hides them again.
 * Links and analytics never carry a repo name at all.
 *
 * PersonApp builds one namer per profile and toggle state and hands it to every view, so no name
 * reaches the screen any other way.
 */
import type { ProfileData } from '../types'
import type { LifeMilestone } from './timeline'
import type { RepoNamer, ShownName } from './lifeTypes'

/** What a hidden private repo is called. */
export const PRIVATE_REPO_LABEL = 'private repo'

/** A repo's key: its nameWithOwner without case, as GitHub compares names and the timeline merges them. */
export function repoKey(nameWithOwner: string): string {
  return nameWithOwner.toLowerCase()
}

/**
 * The keys of every repo any copy of which is private. The timeline marks a merged lane private
 * the same way; this set is what every view's namer reads, so it does not depend on the merge.
 */
export function privateRepoKeys(profile: Pick<ProfileData, 'repos'>): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const repo of profile.repos) if (repo.isPrivate) keys.add(repoKey(repo.nameWithOwner))
  return keys
}

// Shared by every hidden name, and frozen: a slip that wrote a name into it would show that name everywhere.
const HIDDEN: ShownName = Object.freeze({ text: PRIVATE_REPO_LABEL, locked: true })

/**
 * Names repos as the views show them: a private one as PRIVATE_REPO_LABEL unless revealed, and
 * locked either way, so the lock still shows on a revealed name. A name gets the same object on
 * every call.
 */
export function repoNamer(privateKeys: ReadonlySet<string>, revealed: boolean): RepoNamer {
  const shown = new Map<string, ShownName>()
  return (nameWithOwner) => {
    let name = shown.get(nameWithOwner)
    if (!name) {
      const locked = privateKeys.has(repoKey(nameWithOwner))
      name = locked && !revealed ? HIDDEN : { text: nameWithOwner, locked }
      shown.set(nameWithOwner, name)
    }
    return name
  }
}

/** The toggle shows private names only for the login it was turned on for (revealFor is that login, lowercased). */
export function isRevealed(revealFor: string | null, login: string): boolean {
  return revealFor !== null && revealFor.toLowerCase() === login.toLowerCase()
}

/** A milestone's repo as the views show it, or null for a milestone without one. */
export function shownMilestoneRepo(m: Pick<LifeMilestone, 'repo'>, name: RepoNamer): ShownName | null {
  return m.repo ? name(m.repo) : null
}
