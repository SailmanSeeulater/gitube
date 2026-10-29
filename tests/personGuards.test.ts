/**
 * Person mode's privacy rule, end to end (PROFILE_SPEC.md section 2, "Privacy rule", and risk 8.3):
 * on the recordings with some repos made private, one of them private only in a stale copy and one
 * with pull requests landed in it, no private name reaches the panel, the inspector, the legend, the
 * milestones, the status strip or PersonApp's markup (text or any attribute), nor any text the
 * canvas draws or measures, in any of the views, by default or after a reveal for another login;
 * and the address bar only ever names the user and the view.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import PersonApp, { personSearch } from '../src/PersonApp'
import personAppSource from '../src/PersonApp.tsx?raw'
import PersonInspector from '../src/profile/PersonInspector'
import PersonLegend from '../src/profile/PersonLegend'
import PersonPanel from '../src/profile/PersonPanel'
import PersonStatus from '../src/profile/PersonStatus'
import { PRIVATE_REPO_LABEL, repoKey } from '../src/profile/privacy'
import { profileQueryFn, profileQueryKey } from '../src/profile/useProfileData'
import { usePersonStore, type PersonState } from '../src/profile/usePersonStore'
import { dayNumber } from '../src/profile/timeline'
import { getTheme } from '../src/theme/themes'
import type { PersonView } from '../src/share/shareUrl'
import type { ProfileData } from '../src/types'
import { kepanoRouter, makeFetch } from './helpers/profileReplay'
import {
  FAKE_TOKEN,
  GAEARON_NOW,
  KEPANO_NOW,
  gaearonProfile,
  grow,
  kepanoProfile,
  paintView,
  setGarden,
  setPerson,
  withPrivate,
  type Grown,
} from './helpers/personScene'

const noop = () => {}
const theme = getTheme('obsidian')
/** person mode's three views */
const VIEWS: PersonView[] = ['garden', 'lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap', 'helix']

/**
 * kepano's repos made private: the top-starred one (a derived milestone names it), one of his own,
 * one he only contributed to (wordgard, which also has pull requests of his landed in it), a fork
 * GitHub counted no commits to, and an archived one. aloha is private only in a stale copy, so its
 * lane may read public.
 */
const KEPANO_PRIVATE = ['kepano/obsidian-skills', 'kepano/tidy', 'obsidianmd/wordgard', 'kepano/bookcover-api', 'kepano/obsidian-highlights-sidebar']
const KEPANO_STALE = ['kepano/aloha']

interface Case {
  label: string
  profile: ProfileData
  now: number
  token: string
  /** every private repo's nameWithOwner */
  names: string[]
}

const cases: Case[] = []

/** gaearon's most pushed-to recent repo of his own (pushes to others' repos are in recent too) and his most starred one, made private. */
function gaearonPrivate(profile: ProfileData): string[] {
  const own = new Set(profile.repos.map((r) => repoKey(r.nameWithOwner)))
  const pushes = new Map<string, number>()
  for (const r of profile.recent) if (own.has(repoKey(r.repo))) pushes.set(r.repo, (pushes.get(r.repo) ?? 0) + r.pushes)
  const pushed = [...pushes].sort((a, b) => b[1] - a[1])[0][0]
  const starred = [...profile.repos].sort((a, b) => b.stars - a.stars)[0].nameWithOwner
  return [...new Set([pushed, starred])]
}

beforeAll(async () => {
  const [kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
  cases.push({
    label: 'kepano, with a token',
    profile: withPrivate(kepano, KEPANO_PRIVATE, KEPANO_STALE),
    now: KEPANO_NOW,
    token: FAKE_TOKEN,
    names: [...KEPANO_PRIVATE, ...KEPANO_STALE],
  })
  const names = gaearonPrivate(gaearon)
  cases.push({ label: 'gaearon, without a token', profile: withPrivate(gaearon, names), now: GAEARON_NOW, token: '', names })
})

beforeEach(() => {
  usePersonStore.getState().resetFor('nobody')
  setPerson({ tab: 'repos', hover: null, selected: null, hidden: new Set(), search: '' })
  setGarden({ panelOpen: true, rate: null, token: '', themeId: theme.id })
})

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * What would give a private repo away: its full name, and its name without the owner (the canvas
 * labels drop the person's own login), each as a whole name, so gaearon/react is not found in
 * gaearon/react-hot-loader, nor react in react/react, nor next.js in vercel/next.js.
 */
function secretsOf(c: Case): RegExp[] {
  return c.names.flatMap((name) => [
    new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w.-])`, 'i'),
    new RegExp(`(?<![\\w./-])${escape(name.slice(name.indexOf('/') + 1))}(?![\\w./-])`, 'i'),
  ])
}

function expectNoSecret(c: Case, text: string, where: string): void {
  for (const secret of secretsOf(c)) {
    const found = secret.exec(text)
    // the text round it, to show where it slipped through
    expect(found && text.slice(Math.max(0, found.index - 60), found.index + 60), `${secret} in ${where}`).toBeNull()
  }
}

/** Every part's markup for one state of the store: the panel (with its switcher), the inspector, each view's legend and the strip. */
function markup(g: Grown, revealed: boolean): string[] {
  const { profile, timeline, days, colourOf, name, privateKeys } = g
  return [
    renderToStaticMarkup(
      h(PersonPanel, { profile, timeline, colourOf, name, privateCount: privateKeys.size, revealed, onReveal: noop, theme, view: 'garden', onView: noop }),
    ),
    renderToStaticMarkup(h(PersonInspector, { profile, timeline, days, colourOf, name })),
    ...VIEWS.map((view) => renderToStaticMarkup(h(PersonLegend, { profile, timeline, colourOf, theme, hasPrivate: privateKeys.size > 0, view }))),
    renderToStaticMarkup(h(PersonStatus, { profile, timeline, cachedAt: null, hasToken: profile.source === 'graphql', onRefresh: noop, onAddToken: noop })),
  ]
}

/** The states a visitor can put the views in that show a private repo: hovered, selected, hidden, searched, its days and milestones. */
function states(g: Grown, c: Case): Array<Partial<PersonState>> {
  const keys = c.names.map(repoKey)
  const out: Array<Partial<PersonState>> = [{}, { tab: 'milestones' }, { search: 'private' }, { hidden: new Set(keys) }]
  for (const key of keys) out.push({ hover: { kind: 'repo', key } }, { selected: key }, { selected: key, hidden: new Set([key]) })
  // every day a private repo was active on, or rooted on, and every milestone's day
  const days = new Set<number>()
  for (const [day, repos] of g.days.repos) if (repos.some((r) => g.privateKeys.has(repoKey(r.repo)))) days.add(day)
  for (const [day, rows] of g.days.landed) if (rows.some((r) => g.privateKeys.has(repoKey(r.repo)))) days.add(day)
  for (const lane of g.timeline.lanes) if (g.privateKeys.has(repoKey(lane.repo))) days.add(lane.rootDay)
  g.timeline.milestones.forEach((m, i) => out.push({ hover: { kind: 'day', day: dayNumber(m.day), milestone: i } }))
  for (const day of days) out.push({ hover: { kind: 'day', day, milestone: null } })
  return out
}

function personApp(c: Case, view: PersonView | null = null): string {
  setGarden({ token: c.token })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(profileQueryKey(c.profile.login, c.token), { profile: c.profile, cachedAt: null })
  return renderToStaticMarkup(
    h(QueryClientProvider, { client }, h(PersonApp, { login: c.profile.login, request: 0, view, focusInput: false, onRepo: noop, onUser: noop })),
  )
}

describe('private repo names', () => {
  it('are names no public repo shares, so the checks below can tell them apart', () => {
    for (const c of cases) {
      const others = [...c.profile.repos.map((r) => r.nameWithOwner), ...c.profile.recent.map((r) => r.repo)].filter(
        (name) => !c.names.some((n) => repoKey(n) === repoKey(name)),
      )
      for (const name of others) expectNoSecret(c, name, 'another repo\'s name')
      // the stale copy counts: the timeline merged it into a lane that may read public
      expect(grow(c.profile, c.now, theme).privateKeys.size).toBe(c.names.length)
      // with a token, a private repo has pull requests landed in it, so the checks below cover their marks and lines
      if (c.token) expect(c.profile.landed.some((l) => c.names.some((n) => repoKey(n) === repoKey(l.repo)))).toBe(true)
    }
  })

  it('never reach the panel, inspector, legend, milestones or strip while hidden, or revealed for another login', () => {
    for (const c of cases) {
      for (const revealFor of [null, 'someone-else']) {
        const g = grow(c.profile, c.now, theme, revealFor)
        for (const state of states(g, c)) {
          setPerson(state)
          for (const html of markup(g, false)) expectNoSecret(c, html, `${c.label} ${JSON.stringify(state, (_k, v) => (v instanceof Set ? [...v] : v))}`)
          setPerson({ tab: 'repos', hover: null, selected: null, hidden: new Set(), search: '' })
        }
        // the lock and its label show in their place
        const html = markup(g, false)[0]
        expect(html).toContain(PRIVATE_REPO_LABEL)
        expect(html).toContain('aria-pressed="false"')
      }
    }
  })

  it('never reach a fallback note: GitHub words, quoted, lose anything slashed', () => {
    for (const c of cases) {
      const profile: ProfileData = { ...c.profile, source: 'rest', fallback: { message: `Could not resolve ${c.names[0]} (${c.names[0]}).`, limit: null, resetAt: null } }
      const g = grow(profile, c.now, theme)
      for (const html of markup(g, false)) expectNoSecret(c, html, `${c.label} fallback`)
    }
  })

  it("never reach the fetching strip: a GraphQL fallback's quoted error loses anything slashed", async () => {
    const said = 'Resource not accessible: kepano/secret-plans (https://github.com/kepano/secret-plans)'
    const refused = () => ({ body: { data: null, errors: [{ type: 'FORBIDDEN', message: said }] } })
    const messages: string[] = []
    const run = profileQueryFn('kepano', {
      token: FAKE_TOKEN,
      setProgress: (progress) => {
        if (progress) messages.push(progress.message)
      },
      noteRate: noop,
      store: () => null,
      takeLive: () => true,
      fetch: makeFetch(kepanoRouter(refused, true)).fetch,
      now: () => KEPANO_NOW,
    })
    const { profile } = await run({ signal: new AbortController().signal })
    expect(profile.fallback?.message).toContain('kepano/secret-plans')
    const note = messages.find((message) => message.startsWith('GraphQL failed'))
    expect(note).toContain('Resource not accessible')
    for (const message of messages) expect(message).not.toMatch(/secret-plans/)
  })

  it('never reach PersonApp, whatever is hovered or selected, in any view', () => {
    for (const c of cases) {
      const keys = c.names.map(repoKey)
      for (const view of [null, ...VIEWS]) {
        for (const state of [{}, { hover: { kind: 'repo', key: keys[0] }, selected: keys[1] ?? keys[0] }, { tab: 'milestones' }] as Array<Partial<PersonState>>) {
          for (const revealFor of [null, 'someone-else']) {
            setPerson({ ...state, revealFor })
            const html = personApp(c, view)
            expect(html).toContain('<canvas')
            expectNoSecret(c, html, `${c.label} PersonApp ${view}`)
          }
        }
      }
    }
  })

  it('never reach the canvas, drawn or measured, while hidden or revealed for another login, in any view', () => {
    for (const c of cases) {
      const keys = c.names.map(repoKey)
      for (const revealFor of [null, 'someone-else']) {
        const g = grow(c.profile, c.now, theme, revealFor)
        for (const view of VIEWS) {
          let shownLabel = false
          for (const key of keys) {
            for (const over of [{ hover: { kind: 'repo' as const, key } }, { selected: key }]) {
              const { rec, measured } = paintView(g, view, over)
              for (const text of [...rec.texts(), ...measured]) expectNoSecret(c, text, `${c.label} ${view} canvas`)
              shownLabel ||= rec.calls('fillText').some((call) => call.args[0] === PRIVATE_REPO_LABEL)
            }
          }
          // the hovered private repo's plate says what it is
          expect(shownLabel, view).toBe(true)
        }
      }
    }
    // every view painted in forty states on a recording context: about 14 s here, over 20 s on CI's runners
  }, 60_000)

  it('show on screen once revealed for this very login, still locked and never linked', () => {
    for (const c of cases) {
      const key = repoKey(c.names[0])
      const g = grow(c.profile, c.now, theme, c.profile.login.toUpperCase())
      setPerson({ hover: { kind: 'repo', key } })
      const [panel, inspector] = markup(g, true)
      expect(panel.toLowerCase()).toContain(key)
      expect(inspector.toLowerCase()).toContain(key)
      expect(inspector.toLowerCase()).not.toContain(`href="https://github.com/${key}"`)
      const short = key.slice(key.indexOf('/') + 1)
      for (const view of VIEWS) {
        const { rec } = paintView(g, view, { hover: { kind: 'repo', key } })
        expect(rec.texts().some((text) => text.toLowerCase().includes(short)), view).toBe(true)
      }
    }
  })
})

describe('the address bar', () => {
  it('names only the user and the view, whatever is hidden, selected or revealed', () => {
    const c = cases[0]
    const store = usePersonStore.getState()
    store.resetFor('kepano')
    store.toggleHidden(c.names[0])
    store.select(c.names[1])
    store.setHover({ kind: 'repo', key: c.names[2] })
    store.focusOn({ kind: 'repo', key: c.names[1] })
    store.setReveal('kepano', true)
    store.setSearch(c.names[3])
    for (const current of ['', '?user=kepano', '?user=kepano&view=garden', `?repo=${c.names[0]}&branch=main&by=octocat&vs=${c.names[1]}`]) {
      const search = personSearch('kepano', 'garden', current)
      expect([...new URLSearchParams(search).keys()].sort()).toEqual(['user', 'view'])
      expect(search).toBe('?user=kepano&view=garden')
      expectNoSecret(c, search, 'the address bar')
    }
    // a view named by an incoming link passes through, whatever the store holds
    expect(personSearch('kepano', 'lines', '?user=kepano&view=lines')).toBe('?user=kepano&view=lines')
    // other parameters are not person mode's to drop
    expect(personSearch('kepano', 'garden', '?utm_source=x')).toBe('?utm_source=x&user=kepano&view=garden')
  })

  it('is written by PersonApp only through personSearch, from the login and the view it holds', () => {
    expect(personAppSource.match(/replaceState\(/g)).toHaveLength(1)
    expect(personAppSource).toContain('const search = personSearch(login, view, window.location.search)')
    expect(personAppSource.match(/writeUserShare\(/g)).toHaveLength(1)
    // the view starts as the link's and is kept across logins; only the switcher changes it, through switchView
    expect(personAppSource).toContain("useState<PersonView>(() => linkedView ?? 'garden')")
    expect(personAppSource).toContain('switchView(view, next, setView)')
  })
})
