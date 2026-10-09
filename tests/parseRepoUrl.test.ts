import { describe, expect, it } from 'vitest'
import { parseRepoUrl } from '../src/api/parseRepoUrl'

const REF = { owner: 'owner', repo: 'repo' }

describe('parseRepoUrl', () => {
  describe('accepts', () => {
    it.each([
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
    ])('%j', (input, expected) => {
      expect(parseRepoUrl(input)).toEqual(expected)
    })

    it('strips only a trailing .git suffix', () => {
      expect(parseRepoUrl('owner/repo.git')).toEqual(REF)
      expect(parseRepoUrl('owner/git.repo')).toEqual({ owner: 'owner', repo: 'git.repo' })
      expect(parseRepoUrl('owner/repo.github')).toEqual({ owner: 'owner', repo: 'repo.github' })
    })
  })

  describe('rejects', () => {
    it.each([
      [''],
      ['   '],
      ['owner'],
      ['owner/'],
      ['/owner'],
      ['https://gitlab.com/a/b'],
      ['https://bitbucket.org/a/b'],
      ['gitlab.com/owner/repo'],
      ['https://github.com/owner'],
      ['https://github.com/owner/'],
      ['https://github.com'],
      ['https://github.com/'],
      ['git@gitlab.com:owner/repo.git'],
      ['not a url'],
      ['hello world/repo'],
      ['owner/repo name'],
      ['-owner/repo'],
      ['owner/..'],
      ['owner/.'],
      ['owner/repo/extra'],
      ['a/b/c/d'],
      ['http://'],
      ['://github.com/owner/repo'],
      ['https://evil.com/github.com/owner/repo'],
      ['https://github.com.evil.com/owner/repo'],
      ['owner//repo'],
    ])('%j', (input) => {
      expect(parseRepoUrl(input)).toBeNull()
    })

    it('rejects non-string input defensively', () => {
      expect(parseRepoUrl(undefined as unknown as string)).toBeNull()
      expect(parseRepoUrl(null as unknown as string)).toBeNull()
    })
  })
})
