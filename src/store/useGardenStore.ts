import { create } from 'zustand'
import type { FetchProgress, ViewMode } from '../types'
import type { RateInfo } from '../api/http'
import { readStoredThemeId, writeStoredThemeId } from '../theme/storage'
import { isThemeId, type ThemeId } from '../theme/themes'

/**
 * How the garden is laid out: free force physics, pinned to a straight metro map, or the physics
 * grown upward and drawn as plants (stems, leaves, blooms, roots).
 */
export type LayoutMode = 'organic' | 'metro' | 'garden'

/** Which list the side panel shows. */
export type PanelTab = 'branches' | 'contributors' | 'weeds'

/** localStorage key for the GitHub personal access token. */
export const TOKEN_STORAGE_KEY = 'repo-garden:token'

function readStoredToken(): string {
  try {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** localStorage key for the organic | metro | garden layout choice. */
export const LAYOUT_STORAGE_KEY = 'repo-garden:layout'

export function readStoredLayoutMode(): LayoutMode {
  try {
    if (typeof localStorage === 'undefined') return 'organic'
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY)
    return stored === 'metro' || stored === 'garden' ? stored : 'organic'
  } catch {
    return 'organic'
  }
}

function writeStoredLayoutMode(mode: LayoutMode): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(LAYOUT_STORAGE_KEY, mode)
  } catch {
    // storage unavailable; the choice still holds for this session
  }
}

function writeStoredToken(token: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // storage unavailable (private mode, blocked); the token still lives in memory for this session
  }
}

export interface GardenState {
  /** GitHub personal access token, '' when unset. Persisted under TOKEN_STORAGE_KEY. */
  token: string
  viewMode: ViewMode
  /** organic (force physics) or metro (straight lanes). Persisted under LAYOUT_STORAGE_KEY. */
  layoutMode: LayoutMode
  /** Branch names hidden via the eye toggle. Replaced immutably on every change. */
  hiddenBranches: ReadonlySet<string>
  /** Branch isolated from the panel; null when nothing is selected. Never set together with selectedContributor. */
  selectedBranch: string | null
  /** Contributor.key whose commits the graph highlights; null when nobody is selected. */
  selectedContributor: string | null
  panelTab: PanelTab
  /** Branch-list filter / tip-node highlight query. */
  search: string
  /** Hide branches whose tip is older than this many days. 0 = show all. */
  staleDays: number
  panelOpen: boolean
  /** Commit sha shown in the NodeInspector, null when closed. */
  inspectorNodeId: string | null
  /** Latest fetch progress, null when idle. */
  progress: FetchProgress | null
  /**
   * Tip labels on the canvas whose names are hidden for lack of room (the status strip hint).
   * Written by the label placer only when its labels settle, never per frame.
   */
  hiddenLabels: number
  /** Colour theme. Persisted under THEME_STORAGE_KEY; Obsidian on a first visit. */
  themeId: ThemeId
  /**
   * The core (REST) budget as the latest response reported it, from the graph fetch and the pull
   * request overlay alike; null until a response arrives. GraphQL points never land here. Cleared
   * by setToken (a token has its own budget), kept across repos (the budget is the visitor's).
   */
  rate: RateInfo | null
}

export interface GardenActions {
  setToken: (token: string) => void
  setViewMode: (mode: ViewMode) => void
  toggleViewMode: () => void
  setLayoutMode: (mode: LayoutMode) => void
  toggleLayoutMode: () => void
  hideBranch: (name: string) => void
  showBranch: (name: string) => void
  toggleBranchHidden: (name: string) => void
  setHiddenBranches: (names: Iterable<string>) => void
  clearHiddenBranches: () => void
  /** Selecting a branch drops any selected contributor, and the other way round. */
  setSelectedBranch: (name: string | null) => void
  toggleSelectedBranch: (name: string) => void
  setSelectedContributor: (key: string | null) => void
  toggleSelectedContributor: (key: string) => void
  setPanelTab: (tab: PanelTab) => void
  setSearch: (query: string) => void
  setStaleDays: (days: number) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setInspectorNodeId: (id: string | null) => void
  setProgress: (progress: FetchProgress | null) => void
  setHiddenLabels: (count: number) => void
  /**
   * Records the core budget a response reported. Within one window the lowest count wins (answers
   * to concurrent requests can arrive out of order); a later window replaces it.
   */
  noteRate: (rate: RateInfo | null) => void
  /** Switches the theme and saves the choice; unknown ids are ignored. */
  setThemeId: (id: ThemeId) => void
  /** Clears the branch or contributor selection and the inspector (Escape / background click). */
  clearSelection: () => void
  /** Resets per-repo UI state when a different repo is grown. Keeps token, view and layout mode, panel and its tab, stale filter, theme. */
  resetForNewRepo: () => void
}

export type GardenStore = GardenState & GardenActions

export const useGardenStore = create<GardenStore>()((set, get) => ({
  token: readStoredToken(),
  viewMode: 'skeleton',
  layoutMode: readStoredLayoutMode(),
  hiddenBranches: new Set<string>(),
  selectedBranch: null,
  selectedContributor: null,
  panelTab: 'branches',
  search: '',
  staleDays: 0,
  panelOpen: true,
  inspectorNodeId: null,
  progress: null,
  hiddenLabels: 0,
  themeId: readStoredThemeId(),
  rate: null,

  setToken: (token) => {
    const trimmed = token.trim()
    writeStoredToken(trimmed)
    set((s) => (s.token === trimmed ? s : { token: trimmed, rate: null }))
  },
  setViewMode: (viewMode) => set({ viewMode }),
  toggleViewMode: () => set((s) => ({ viewMode: s.viewMode === 'skeleton' ? 'full' : 'skeleton' })),
  setLayoutMode: (layoutMode) => {
    writeStoredLayoutMode(layoutMode)
    set({ layoutMode })
  },
  toggleLayoutMode: () => get().setLayoutMode(get().layoutMode === 'metro' ? 'organic' : 'metro'),

  hideBranch: (name) =>
    set((s) => {
      if (s.hiddenBranches.has(name)) return s
      const next = new Set(s.hiddenBranches)
      next.add(name)
      return {
        hiddenBranches: next,
        selectedBranch: s.selectedBranch === name ? null : s.selectedBranch,
      }
    }),
  showBranch: (name) =>
    set((s) => {
      if (!s.hiddenBranches.has(name)) return s
      const next = new Set(s.hiddenBranches)
      next.delete(name)
      return { hiddenBranches: next }
    }),
  toggleBranchHidden: (name) => {
    if (get().hiddenBranches.has(name)) get().showBranch(name)
    else get().hideBranch(name)
  },
  setHiddenBranches: (names) => set({ hiddenBranches: new Set(names) }),
  clearHiddenBranches: () => set((s) => (s.hiddenBranches.size === 0 ? s : { hiddenBranches: new Set<string>() })),

  setSelectedBranch: (selectedBranch) =>
    set(selectedBranch === null ? { selectedBranch } : { selectedBranch, selectedContributor: null }),
  toggleSelectedBranch: (name) =>
    set((s) => (s.selectedBranch === name ? { selectedBranch: null } : { selectedBranch: name, selectedContributor: null })),
  setSelectedContributor: (selectedContributor) =>
    set(selectedContributor === null ? { selectedContributor } : { selectedContributor, selectedBranch: null }),
  toggleSelectedContributor: (key) =>
    set((s) =>
      s.selectedContributor === key ? { selectedContributor: null } : { selectedContributor: key, selectedBranch: null },
    ),
  setPanelTab: (panelTab) => set({ panelTab }),

  setSearch: (search) => set({ search }),
  setStaleDays: (days) => set({ staleDays: Number.isFinite(days) && days > 0 ? Math.floor(days) : 0 }),

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),

  setInspectorNodeId: (inspectorNodeId) => set({ inspectorNodeId }),
  setProgress: (progress) => set({ progress }),
  setHiddenLabels: (count) =>
    set((s) => {
      const hiddenLabels = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
      return s.hiddenLabels === hiddenLabels ? s : { hiddenLabels }
    }),

  noteRate: (rate) =>
    set((s) => {
      if (!rate || !Number.isFinite(rate.remaining)) return s
      const prev = s.rate
      if (prev !== null && prev.resetAt !== null && rate.resetAt !== null) {
        // an answer from the window before, or a stale count from this one
        if (rate.resetAt < prev.resetAt) return s
        if (rate.resetAt === prev.resetAt && rate.remaining >= prev.remaining) return s
      }
      return {
        rate: { remaining: rate.remaining, limit: rate.limit ?? prev?.limit ?? null, resetAt: rate.resetAt ?? prev?.resetAt ?? null },
      }
    }),

  setThemeId: (id) => {
    if (!isThemeId(id)) return
    writeStoredThemeId(id)
    set((s) => (s.themeId === id ? s : { themeId: id }))
  },

  clearSelection: () =>
    set((s) =>
      s.selectedBranch === null && s.selectedContributor === null && s.inspectorNodeId === null
        ? s
        : { selectedBranch: null, selectedContributor: null, inspectorNodeId: null },
    ),
  resetForNewRepo: () =>
    set({
      hiddenBranches: new Set<string>(),
      selectedBranch: null,
      selectedContributor: null,
      search: '',
      inspectorNodeId: null,
      progress: null,
      hiddenLabels: 0,
    }),
}))
