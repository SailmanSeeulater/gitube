import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAYOUT_STORAGE_KEY, readStoredLayoutMode, useGardenStore } from './useGardenStore'

const reset = () =>
  useGardenStore.setState({
    token: '',
    viewMode: 'skeleton',
    layoutMode: 'organic',
    hiddenBranches: new Set<string>(),
    selectedBranch: null,
    selectedContributor: null,
    panelTab: 'branches',
    search: '',
    staleDays: 0,
    panelOpen: true,
    inspectorNodeId: null,
    progress: null,
    themeId: 'obsidian',
    rate: null,
  })

describe('useGardenStore', () => {
  beforeEach(reset)

  it('has the expected initial shape', () => {
    const s = useGardenStore.getState()
    expect(s.token).toBe('')
    expect(s.viewMode).toBe('skeleton')
    expect(s.hiddenBranches.size).toBe(0)
    expect(s.selectedBranch).toBeNull()
    expect(s.search).toBe('')
    expect(s.staleDays).toBe(0)
    expect(s.panelOpen).toBe(true)
    expect(s.inspectorNodeId).toBeNull()
    expect(s.progress).toBeNull()
    expect(s.themeId).toBe('obsidian') // nothing saved (no localStorage in node): the default theme
  })

  it('switches theme, ignores unknown ids, and keeps the theme across a new repo', () => {
    const s = useGardenStore.getState()
    s.setThemeId('paper')
    expect(useGardenStore.getState().themeId).toBe('paper')
    s.setThemeId('neon' as never)
    expect(useGardenStore.getState().themeId).toBe('paper')
    const before = useGardenStore.getState()
    s.setThemeId('paper')
    expect(useGardenStore.getState()).toBe(before) // same theme: no state change
    s.resetForNewRepo()
    expect(useGardenStore.getState().themeId).toBe('paper')
    s.setThemeId('obsidian')
    expect(useGardenStore.getState().themeId).toBe('obsidian')
  })

  it('trims the token and clears it with an empty string', () => {
    useGardenStore.getState().setToken('  ghp_abc  ')
    expect(useGardenStore.getState().token).toBe('ghp_abc')
    useGardenStore.getState().setToken('')
    expect(useGardenStore.getState().token).toBe('')
  })

  it('replaces the hidden set immutably on hide/show', () => {
    const before = useGardenStore.getState().hiddenBranches
    useGardenStore.getState().hideBranch('feature/a')
    const after = useGardenStore.getState().hiddenBranches
    expect(after).not.toBe(before)
    expect(before.has('feature/a')).toBe(false)
    expect(after.has('feature/a')).toBe(true)

    useGardenStore.getState().showBranch('feature/a')
    const shown = useGardenStore.getState().hiddenBranches
    expect(shown).not.toBe(after)
    expect(shown.has('feature/a')).toBe(false)
  })

  it('does not create a new set when nothing changes', () => {
    useGardenStore.getState().hideBranch('x')
    const set = useGardenStore.getState().hiddenBranches
    useGardenStore.getState().hideBranch('x')
    expect(useGardenStore.getState().hiddenBranches).toBe(set)
    useGardenStore.getState().showBranch('never-hidden')
    expect(useGardenStore.getState().hiddenBranches).toBe(set)
  })

  it('toggles hidden state and drops the selection when the selected branch is hidden', () => {
    const s = useGardenStore.getState()
    s.setSelectedBranch('main')
    s.toggleBranchHidden('main')
    expect(useGardenStore.getState().hiddenBranches.has('main')).toBe(true)
    expect(useGardenStore.getState().selectedBranch).toBeNull()
    useGardenStore.getState().toggleBranchHidden('main')
    expect(useGardenStore.getState().hiddenBranches.has('main')).toBe(false)
  })

  it('toggles selection on repeated clicks', () => {
    useGardenStore.getState().toggleSelectedBranch('dev')
    expect(useGardenStore.getState().selectedBranch).toBe('dev')
    useGardenStore.getState().toggleSelectedBranch('dev')
    expect(useGardenStore.getState().selectedBranch).toBeNull()
    useGardenStore.getState().toggleSelectedBranch('dev')
    useGardenStore.getState().toggleSelectedBranch('other')
    expect(useGardenStore.getState().selectedBranch).toBe('other')
  })

  it('normalises staleDays', () => {
    useGardenStore.getState().setStaleDays(90)
    expect(useGardenStore.getState().staleDays).toBe(90)
    useGardenStore.getState().setStaleDays(-5)
    expect(useGardenStore.getState().staleDays).toBe(0)
    useGardenStore.getState().setStaleDays(Number.NaN)
    expect(useGardenStore.getState().staleDays).toBe(0)
  })

  it('clearSelection clears both branch and inspector', () => {
    useGardenStore.getState().setSelectedBranch('a')
    useGardenStore.getState().setInspectorNodeId('abc')
    useGardenStore.getState().clearSelection()
    expect(useGardenStore.getState().selectedBranch).toBeNull()
    expect(useGardenStore.getState().inspectorNodeId).toBeNull()
  })

  it('keeps a branch and a contributor from being selected together', () => {
    const s = useGardenStore.getState()
    s.setSelectedBranch('main')
    s.toggleSelectedContributor('login:ann')
    expect(useGardenStore.getState().selectedContributor).toBe('login:ann')
    expect(useGardenStore.getState().selectedBranch).toBeNull()
    s.toggleSelectedBranch('dev')
    expect(useGardenStore.getState().selectedBranch).toBe('dev')
    expect(useGardenStore.getState().selectedContributor).toBeNull()
    s.setSelectedContributor('login:bob')
    s.setSelectedBranch(null) // clearing a branch leaves the contributor alone
    expect(useGardenStore.getState().selectedContributor).toBe('login:bob')
    s.toggleSelectedContributor('login:bob')
    expect(useGardenStore.getState().selectedContributor).toBeNull()
  })

  it('clearSelection and resetForNewRepo drop the selected contributor but keep the panel tab', () => {
    const s = useGardenStore.getState()
    s.setPanelTab('contributors')
    s.setSelectedContributor('login:ann')
    s.clearSelection()
    expect(useGardenStore.getState().selectedContributor).toBeNull()
    s.setSelectedContributor('login:ann')
    s.resetForNewRepo()
    expect(useGardenStore.getState().selectedContributor).toBeNull()
    expect(useGardenStore.getState().panelTab).toBe('contributors')
  })

  it('resetForNewRepo keeps token, view mode, panel and stale filter', () => {
    const s = useGardenStore.getState()
    s.setToken('tok')
    s.setViewMode('full')
    s.setStaleDays(30)
    s.setPanelOpen(false)
    s.hideBranch('b')
    s.setSelectedBranch('b2')
    s.setSearch('q')
    s.setInspectorNodeId('n')
    s.setProgress({
      stage: 'compare',
      done: 1,
      total: 2,
      message: '',
      requestsUsed: 3,
      rateLimitRemaining: 10,
      rateLimitResetAt: null,
    })
    useGardenStore.getState().resetForNewRepo()
    const after = useGardenStore.getState()
    expect(after.token).toBe('tok')
    expect(after.viewMode).toBe('full')
    expect(after.staleDays).toBe(30)
    expect(after.panelOpen).toBe(false)
    expect(after.hiddenBranches.size).toBe(0)
    expect(after.selectedBranch).toBeNull()
    expect(after.search).toBe('')
    expect(after.inspectorNodeId).toBeNull()
    expect(after.progress).toBeNull()
  })

  it('toggles the layout mode and persists it', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    expect(useGardenStore.getState().layoutMode).toBe('organic')
    useGardenStore.getState().toggleLayoutMode()
    expect(useGardenStore.getState().layoutMode).toBe('metro')
    expect(store.get(LAYOUT_STORAGE_KEY)).toBe('metro')
    expect(readStoredLayoutMode()).toBe('metro')
    useGardenStore.getState().setLayoutMode('organic')
    expect(readStoredLayoutMode()).toBe('organic')
    // anything else saved, the retired 'garden' layout included, opens on metro, the default
    for (const saved of ['bogus', 'garden']) {
      store.set(LAYOUT_STORAGE_KEY, saved)
      expect(readStoredLayoutMode()).toBe('metro')
    }
    store.delete(LAYOUT_STORAGE_KEY)
    expect(readStoredLayoutMode()).toBe('metro')
  })

  it('layout mode survives broken storage and a new repo', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    })
    expect(readStoredLayoutMode()).toBe('metro')
    useGardenStore.getState().setLayoutMode('organic')
    expect(useGardenStore.getState().layoutMode).toBe('organic')
    useGardenStore.getState().resetForNewRepo()
    expect(useGardenStore.getState().layoutMode).toBe('organic')
  })
})

describe('the core request budget (noteRate)', () => {
  beforeEach(reset)
  const WINDOW = '2026-10-22T02:00:00.000Z'
  const NEXT = '2026-10-22T03:00:00.000Z'

  it('keeps the lowest count of a window (answers arrive out of order), and a later window replaces it', () => {
    const { noteRate } = useGardenStore.getState()
    noteRate({ remaining: 41, limit: 60, resetAt: WINDOW })
    noteRate({ remaining: 39, limit: null, resetAt: WINDOW })
    noteRate({ remaining: 40, limit: 60, resetAt: WINDOW })
    expect(useGardenStore.getState().rate).toEqual({ remaining: 39, limit: 60, resetAt: WINDOW })
    noteRate({ remaining: 59, limit: 60, resetAt: NEXT })
    expect(useGardenStore.getState().rate).toEqual({ remaining: 59, limit: 60, resetAt: NEXT })
    // an answer from the window before
    noteRate({ remaining: 2, limit: 60, resetAt: WINDOW })
    expect(useGardenStore.getState().rate?.remaining).toBe(59)
    noteRate(null)
    expect(useGardenStore.getState().rate?.remaining).toBe(59)
  })

  it('is the visitor’s: kept for a new repo, dropped with a new token (a token has its own budget)', () => {
    const s = useGardenStore.getState()
    s.noteRate({ remaining: 12, limit: 60, resetAt: WINDOW })
    s.resetForNewRepo()
    expect(useGardenStore.getState().rate?.remaining).toBe(12)
    s.setToken('')
    expect(useGardenStore.getState().rate?.remaining).toBe(12)
    s.setToken('ghp_x')
    expect(useGardenStore.getState().rate).toBeNull()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
