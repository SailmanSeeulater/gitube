/**
 * The router (src/App.tsx, src/subject.ts) and RepoApp's deltas from the old App body, so "repo mode is unchanged"
 * has a guard: what a page address opens, that a ?repo= link renders repo mode and a ?user=
 * link the person-mode slot, and that RepoApp's Go hands a login over before anything of repo
 * mode is reset, fetched or counted (checked on RepoApp's source, as prMarks.placement does).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '../src/App'
import { subjectOf } from '../src/subject'
import repoApp from '../src/RepoApp.tsx?raw'

// repo mode's canvas (force-graph) needs a window as it loads; the markup checked here has none
vi.mock('../src/components/RepoGraph', () => ({ default: () => null }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('subjectOf', () => {
  it('opens repo mode for no link, a repo link, or anything that is not a user', () => {
    for (const search of ['', '?repo=expressjs/express', '?repo=expressjs/express&user=octocat&view=lines', '?user=login', '?user=-x', '?user=a/b', '?view=lines', '?by=octocat']) {
      expect(subjectOf(search), search).toEqual({ kind: 'repo' })
    }
  })

  it('opens person mode for a user link, with its view, as a page load (not from the input)', () => {
    expect(subjectOf('?user=octocat')).toEqual({ kind: 'user', login: 'octocat', request: 0, view: null, fromInput: false })
    expect(subjectOf('?user=OctoCat&view=constellation')).toEqual({ kind: 'user', login: 'OctoCat', request: 0, view: 'constellation', fromInput: false })
    // an unparsable repo next to a valid user: the user
    expect(subjectOf('?repo=not%20a%20repo&user=octocat')).toMatchObject({ kind: 'user', login: 'octocat' })
  })
})

describe('App', () => {
  function render(search: string): string {
    vi.stubGlobal('window', { location: { search, pathname: '/', hash: '' } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return renderToStaticMarkup(h(QueryClientProvider, { client }, h(App)))
  }

  it('renders repo mode for a repo link, and the person-mode slot for a user link', () => {
    const repo = render('?repo=expressjs/express')
    expect(repo).toContain('aria-label="GitHub repository or user"')
    expect(repo).toContain('value="expressjs/express"')
    expect(repo).not.toContain('loading person mode')
    const person = render('?user=octocat')
    expect(person).toContain('loading person mode')
  })
})

describe("RepoApp's load", () => {
  /** load's body, from its useCallback to the deps array that closes it */
  const load = repoApp.slice(repoApp.indexOf('const load = useCallback('), repoApp.indexOf('const submit = useCallback('))

  it('hands a login to person mode before anything of repo mode is reset, fetched or counted', () => {
    const at = (needle: string) => {
      const i = load.indexOf(needle)
      expect(i, needle).toBeGreaterThan(-1)
      return i
    }
    const handOver = at('onUser(subject.login)')
    expect(handOver).toBeLessThan(at('setInvalidUrl(false)'))
    expect(handOver).toBeLessThan(at('resetForNewRepo()'))
    expect(handOver).toBeLessThan(at('noteLoad(parsed)'))
    // and returns right after it
    expect(load.slice(handOver, handOver + 60)).toMatch(/onUser\(subject\.login\)\s*return/)
    // unparsable input still shows the invalid input card, before any hand-over
    expect(at('setInvalidUrl(true)')).toBeLessThan(handOver)
  })

  it('keeps the vs field on repos only', () => {
    const versus = repoApp.slice(repoApp.indexOf('const startVs = useCallback('))
    expect(versus.slice(0, 300)).toContain('parseRepoUrl(value)')
  })
})
