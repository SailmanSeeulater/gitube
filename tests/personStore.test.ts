import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePersonStore } from '../src/profile/usePersonStore'
import source from '../src/profile/usePersonStore.ts?raw'
import { isRevealed } from '../src/profile/privacy'
import { readSubject, writeUserShare } from '../src/share/shareUrl'

const initial = usePersonStore.getState()
const store = () => usePersonStore.getState()

// each test starts from the store as a page load leaves it
beforeEach(() => usePersonStore.setState(initial, true))

describe('usePersonStore', () => {
  it('starts empty, on the repo list', () => {
    expect(store()).toMatchObject({ owner: null, hover: null, selected: null, focus: null, revealFor: null, tab: 'repos', search: '' })
    expect(store().hidden.size).toBe(0)
  })

  it('resetFor clears everything but the tab, the privacy toggle included', () => {
    store().resetFor('Me')
    store().toggleHidden('me/a')
    store().setHover({ kind: 'repo', key: 'me/b' })
    store().select('me/c')
    store().focusOn({ kind: 'day', day: 19000 })
    store().setReveal('Me', true)
    store().setTab('milestones')
    store().setSearch('plans')
    store().resetFor('Kepano')
    expect(store()).toMatchObject({ owner: 'kepano', hover: null, selected: null, focus: null, revealFor: null, tab: 'milestones', search: '' })
    expect(store().hidden.size).toBe(0)
  })

  it('resetFor keeps the same state object when there is nothing to clear', () => {
    store().resetFor('Me')
    const before = store()
    store().resetFor('me')
    expect(store()).toBe(before)
    store().resetFor('someone')
    expect(store()).not.toBe(before)
    expect(store().owner).toBe('someone')
  })

  it('toggleHidden hides and shows repos by key, replacing the set each time', () => {
    store().toggleHidden('Me/A')
    const once = store().hidden
    expect([...once]).toEqual(['me/a'])
    store().toggleHidden('me/b')
    expect(store().hidden).not.toBe(once)
    expect([...once]).toEqual(['me/a'])
    store().toggleHidden('ME/A')
    expect([...store().hidden]).toEqual(['me/b'])
  })

  it('hiding the selected or hovered repo drops it from both, hiding another keeps them', () => {
    store().select('me/a')
    store().setHover({ kind: 'repo', key: 'me/a' })
    store().toggleHidden('me/b')
    expect(store()).toMatchObject({ selected: 'me/a', hover: { kind: 'repo', key: 'me/a' } })
    store().toggleHidden('Me/A')
    expect(store()).toMatchObject({ selected: null, hover: null })
    // a day under the pointer is not a repo, and stays
    store().setHover({ kind: 'day', day: 19000, milestone: null })
    store().toggleHidden('me/c')
    expect(store().hover).toEqual({ kind: 'day', day: 19000, milestone: null })
  })

  it('showAll clears the hidden set, and leaves an empty one alone', () => {
    store().toggleHidden('me/a')
    store().toggleHidden('me/b')
    store().showAll()
    expect(store().hidden.size).toBe(0)
    const before = store()
    store().showAll()
    expect(store()).toBe(before)
  })

  it('setHover keeps the same state object while the hover is unchanged', () => {
    const calls = vi.fn()
    const unsubscribe = usePersonStore.subscribe(calls)
    store().setHover(null)
    store().setHover({ kind: 'repo', key: 'me/a' })
    const repo = store()
    store().setHover({ kind: 'repo', key: 'me/a' })
    store().setHover({ kind: 'repo', key: 'Me/A' })
    expect(store()).toBe(repo)
    store().setHover({ kind: 'day', day: 19000, milestone: null })
    const day = store()
    store().setHover({ kind: 'day', day: 19000, milestone: null })
    expect(store()).toBe(day)
    store().setHover({ kind: 'day', day: 19000, milestone: 2 })
    store().setHover({ kind: 'day', day: 19001, milestone: 2 })
    expect(store().hover).toEqual({ kind: 'day', day: 19001, milestone: 2 })
    unsubscribe()
    // repo, day, day with a milestone, the next day: one notice each
    expect(calls).toHaveBeenCalledTimes(4)
  })

  it('select pins a repo by key; clearSelection drops it and the hover', () => {
    store().select('Me/A')
    expect(store().selected).toBe('me/a')
    const before = store()
    store().select('me/a')
    expect(store()).toBe(before)
    store().toggleHidden('me/b')
    store().focusOn({ kind: 'repo', key: 'me/a' })
    store().setHover({ kind: 'repo', key: 'me/c' })
    store().clearSelection()
    expect(store()).toMatchObject({ selected: null, hover: null })
    expect([...store().hidden]).toEqual(['me/b'])
    expect(store().focus).toMatchObject({ kind: 'repo', key: 'me/a' })
    const cleared = store()
    store().clearSelection()
    expect(store()).toBe(cleared)
    store().select('me/a')
    store().select(null)
    expect(store().selected).toBeNull()
  })

  it('focusOn makes a new request each time, even for the same target', () => {
    store().focusOn({ kind: 'repo', key: 'Me/A' })
    const first = store().focus
    store().focusOn({ kind: 'repo', key: 'me/a' })
    const second = store().focus
    expect(first).toMatchObject({ kind: 'repo', key: 'me/a' })
    expect(second).toMatchObject({ kind: 'repo', key: 'me/a' })
    expect(second!.seq).toBeGreaterThan(first!.seq)
    store().focusOn({ kind: 'day', day: 19000 })
    expect(store().focus).toEqual({ kind: 'day', day: 19000, seq: second!.seq + 1 })
  })

  it('reveals private names for one login only, until reset', () => {
    store().resetFor('Me')
    store().setReveal('Me', true)
    expect(store().revealFor).toBe('me')
    expect(isRevealed(store().revealFor, 'ME')).toBe(true)
    expect(isRevealed(store().revealFor, 'someone')).toBe(false)
    store().setReveal('me', false)
    expect(store().revealFor).toBeNull()
    store().setReveal('me', true)
    // a new login or a new request for the same one hides them again
    store().resetFor('me')
    expect(store().revealFor).toBeNull()
  })

  it('persists nothing, so a reload hides private names again', async () => {
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|\bpersist\(/)
    // zustand gives only create: its middleware and other names would rename the shared state chunk
    expect([...source.matchAll(/^import\s+(.*?)\s+from\s+'zustand[^']*'/gm)].map((m) => m[1])).toEqual(['{ create }'])
    store().setReveal('me', true)
    vi.resetModules()
    const reloaded = await import('../src/profile/usePersonStore')
    expect(reloaded.usePersonStore).not.toBe(usePersonStore)
    expect(reloaded.usePersonStore.getState().revealFor).toBeNull()
  })

  it('puts nothing it holds into the share link', () => {
    store().resetFor('Me')
    store().toggleHidden('me/secret-plans')
    store().select('me/other-secret')
    store().focusOn({ kind: 'repo', key: 'me/other-secret' })
    store().setSearch('secret')
    store().setReveal('Me', true)
    const search = writeUserShare({ login: 'Me', view: 'lines' }, '?user=x&view=lines')
    expect([...new URLSearchParams(search).keys()].sort()).toEqual(['user', 'view'])
    expect(search.toLowerCase()).not.toContain('secret')
    expect(readSubject(search)).toEqual({ kind: 'user', login: 'Me', view: 'lines' })
  })
})
