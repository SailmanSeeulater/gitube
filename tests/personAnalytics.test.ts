import { describe, expect, it } from 'vitest'
import { personGrowEventData } from '../src/profile/analytics'
import type { ProfileData } from '../src/types'

/** The only fields the rule reads; a public login, spelt as GitHub spells it. */
const octocat: Pick<ProfileData, 'login' | 'source'> = { login: 'Octocat', source: 'rest' }

describe('personGrowEventData', () => {
  it('names the login only for a live fetch without a token', () => {
    expect(personGrowEventData(octocat, false, false)).toEqual({
      mode: 'person',
      source: 'rest',
      cached: false,
      token: false,
      login: 'Octocat',
    })
  })

  it('never names the login for a profile from the cache', () => {
    // a cached copy is never proof of a tokenless fetch, whatever tier its key names
    expect(personGrowEventData(octocat, true, false)).toEqual({ mode: 'person', source: 'rest', cached: true, token: false })
    expect(personGrowEventData(octocat, true, true)).toEqual({ mode: 'person', source: 'rest', cached: true, token: true })
  })

  it('never names the login under a token, without leaning on track() to drop it', () => {
    // the rule's own output is checked here: track()'s sanitizer is only the backstop
    const event = personGrowEventData(octocat, false, true)
    expect(event).toEqual({ mode: 'person', source: 'rest', cached: false, token: true })
    expect('login' in event).toBe(false)
  })

  it('reports the tier that filled the profile', () => {
    expect(personGrowEventData({ ...octocat, source: 'graphql' }, false, true).source).toBe('graphql')
    expect(personGrowEventData({ ...octocat, source: 'graphql' }, true, true).source).toBe('graphql')
    // a token set but REST filled the profile after a GraphQL fallback: the tier is rest
    expect(personGrowEventData(octocat, false, true).source).toBe('rest')
  })

  it("keeps GitHub's casing of the login", () => {
    // the cache keys by the lowercased login; the event keeps the spelling the profile carries
    expect(personGrowEventData({ login: 'MixedCase-Login', source: 'rest' }, false, false).login).toBe('MixedCase-Login')
  })

  it('carries no other name and no repo', () => {
    for (const cached of [false, true]) {
      for (const token of [false, true]) {
        const keys = Object.keys(personGrowEventData(octocat, cached, token)).sort()
        const expected = ['cached', 'mode', 'source', 'token']
        if (!cached && !token) expected.push('login')
        expect(keys, `cached ${cached}, token ${token}`).toEqual(expected.sort())
      }
    }
  })
})
