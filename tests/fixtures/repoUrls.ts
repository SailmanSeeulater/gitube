/**
 * Inputs parseRepoUrl accepts, each with the repo it names. parseRepoUrl.test.ts checks them
 * directly; parseSubject.test.ts checks that every one stays a repo subject, so the main input
 * reads repos exactly as before person mode.
 */
import type { RepoRef } from '../../src/api/parseRepoUrl'

const REF = { owner: 'owner', repo: 'repo' }

export const ACCEPTED_REPO_URLS: [input: string, expected: RepoRef][] = [
  ['owner/repo', REF],
  ['github.com/owner/repo', REF],
  ['www.github.com/owner/repo', REF],
  ['https://github.com/owner/repo', REF],
  ['http://github.com/owner/repo', REF],
  ['https://www.github.com/owner/repo', REF],
  ['https://GitHub.com/owner/repo', REF],
  ['https://github.com/owner/repo.git', REF],
  ['https://github.com/owner/repo/', REF],
  ['https://github.com/owner/repo.git/', REF],
  ['https://github.com/owner/repo/tree/main/some/path', REF],
  ['https://github.com/owner/repo/blob/main/README.md', REF],
  ['https://github.com/owner/repo/pull/12', REF],
  ['https://github.com/owner/repo/issues?q=is%3Aopen', REF],
  ['https://github.com/owner/repo#readme', REF],
  ['git@github.com:owner/repo.git', REF],
  ['git@github.com:owner/repo', REF],
  ['ssh://git@github.com/owner/repo.git', REF],
  ['   https://github.com/owner/repo   ', REF],
  ['\n\towner/repo\n', REF],
  ['github.com/owner/repo/tree/main', REF],
  ['my-org/my.repo_name', { owner: 'my-org', repo: 'my.repo_name' }],
  ['https://github.com/octocat/Hello-World', { owner: 'octocat', repo: 'Hello-World' }],
]
