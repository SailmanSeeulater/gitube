import { describe, expect, it } from 'vitest'
import { parseRepoUrl } from '../src/api/parseRepoUrl'
import { parseLogin, parseSubject } from '../src/api/parseSubject'
import { ACCEPTED_REPO_URLS } from './fixtures/repoUrls'

/** The github.com routes the spec rejects as logins (PROFILE_SPEC.md, Phase 0). */
const RESERVED_ROUTES = [
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'dashboard', 'enterprise', 'enterprises',
  'explore', 'features', 'issues', 'join', 'login', 'logout', 'marketplace', 'new', 'notifications',
  'organizations', 'orgs', 'pricing', 'pulls', 'search', 'sessions', 'settings', 'signup', 'site', 'sponsors',
  'topics', 'trending', 'users',
]

describe('parseSubject', () => {
  describe('repos', () => {
    // Every input parseRepoUrl accepts stays the same repo, so repo parsing is unchanged.
    it.each(ACCEPTED_REPO_URLS)('%j', (input, expected) => {
      expect(parseSubject(input)).toEqual({ kind: 'repo', repo: expected })
      expect(parseSubject(input)).toEqual({ kind: 'repo', repo: parseRepoUrl(input) })
    })

    it('keeps two-segment github.com paths as repos, even under a reserved route', () => {
      expect(parseSubject('github.com/owner/repo')).toEqual({ kind: 'repo', repo: { owner: 'owner', repo: 'repo' } })
      expect(parseSubject('github.com/settings/profile')).toEqual({
        kind: 'repo',
        repo: { owner: 'settings', repo: 'profile' },
      })
    })
  })

  describe('users', () => {
    it.each([
      ['octocat', 'octocat'],
      ['OctoCat', 'OctoCat'],
      ['@octocat', 'octocat'],
      ['octocat/', 'octocat'],
      ['github.com/octocat', 'octocat'],
      ['www.github.com/octocat', 'octocat'],
      ['https://github.com/octocat/', 'octocat'],
      ['https://GitHub.com/octocat?tab=repositories', 'octocat'],
      ['https://github.com/octocat#pinned', 'octocat'],
      ['a', 'a'],
      ['a'.repeat(39), 'a'.repeat(39)],
      ['a-b-c', 'a-b-c'],
      ['foo-', 'foo-'],
      ['foo--bar', 'foo--bar'],
      ['SailmanSeeulater', 'SailmanSeeulater'],
      ['  @octocat\n', 'octocat'],
    ])('%j', (input, login) => {
      expect(parseSubject(input)).toEqual({ kind: 'user', login })
      expect(parseLogin(input)).toBe(login)
    })
  })

  describe('rejects', () => {
    it.each([
      [''],
      ['   '],
      ['-octocat'],
      ['a'.repeat(40)],
      ['octo_cat'],
      ['octo.cat'],
      ['@octocat/repo'],
      ['git@github.com:octocat'],
      ['https://gitlab.com/octocat'],
      ['gist.github.com/octocat'],
      ['https://github.com/'],
      ['https://github.com.evil.com/octocat'],
      ['login'],
      ['Settings'],
      ['https://github.com/explore'],
    ])('%j', (input) => {
      expect(parseSubject(input)).toBeNull()
      expect(parseLogin(input)).toBeNull()
    })

    it.each(RESERVED_ROUTES)('the reserved route %j, bare or as a github.com URL, in any case', (route) => {
      expect(parseSubject(route)).toBeNull()
      expect(parseSubject(route.toUpperCase())).toBeNull()
      expect(parseSubject(`https://github.com/${route}`)).toBeNull()
      expect(parseSubject(`github.com/${route}/`)).toBeNull()
    })

    it('rejects non-string input defensively', () => {
      expect(parseSubject(undefined as unknown as string)).toBeNull()
      expect(parseLogin(null as unknown as string)).toBeNull()
    })
  })
})

describe('parseLogin', () => {
  it('reads logins only, never a repo', () => {
    expect(parseLogin('owner/repo')).toBeNull()
    expect(parseLogin('https://github.com/owner/repo')).toBeNull()
  })
})
