export interface RepoRef {
  owner: string
  repo: string
}

/**
 * Accepts "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo(.git)(/tree/...)",
 * "git@github.com:owner/repo.git". Returns null when it cannot find owner+repo.
 */
export function parseRepoUrl(_input: string): RepoRef | null {
  throw new Error('not implemented')
}
