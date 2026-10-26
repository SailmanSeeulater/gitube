import { describe, expect, it } from 'vitest'
import { parseRepoUrl } from '../src/api/parseRepoUrl'
import { ACCEPTED_REPO_URLS } from './fixtures/repoUrls'

const REF = { owner: 'owner', repo: 'repo' }

describe('parseRepoUrl', () => {
  describe('accepts', () => {
    it.each(ACCEPTED_REPO_URLS)('%j', (input, expected) => {
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
