import { create } from 'zustand'
import type { FetchProgress, ViewMode } from '../types'

/** How the garden is laid out: free force physics, or pinned to a straight metro map. */
export type LayoutMode = 'organic' | 'metro'

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

/** localStorage key for the organic | metro layout toggle. */
export const LAYOUT_STORAGE_KEY = 'repo-garden:layout'

export function readStoredLayoutMode(): LayoutMode {
  try {
    if (typeof localStorage === 'undefined') return 'organic'
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'metro' ? 'metro' : 'organic'
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
  /** Branch isolated from the panel; null when nothing is selected. */
  selectedBranch: string | null
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
  setSelectedBranch: (name: string | null) => void
  toggleSelectedBranch: (name: string) => void
  setSearch: (query: string) => void
  setStaleDays: (days: number) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setInspectorNodeId: (id: string | null) => void
  setProgress: (progress: FetchProgress | null) => void
  setHiddenLabels: (count: number) => void
  /** Clears branch selection and the inspector (Escape / background click). */
  clearSelection: () => void
  /** Resets per-repo UI state when a different repo is grown. Keeps token, view and layout mode, panel, stale filter. */
  resetForNewRepo: () => void
}

export type GardenStore = GardenState & GardenActions

export const useGardenStore = create<GardenStore>()((set, get) => ({
  token: readStoredToken(),
  viewMode: 'skeleton',
  layoutMode: readStoredLayoutMode(),
  hiddenBranches: new Set<string>(),
  selectedBranch: null,
  search: '',
  staleDays: 0,
  panelOpen: true,
  inspectorNodeId: null,
  progress: null,
  hiddenLabels: 0,

  setToken: (token) => {
    const trimmed = token.trim()
    writeStoredToken(trimmed)
    set({ token: trimmed })
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

  setSelectedBranch: (selectedBranch) => set({ selectedBranch }),
  toggleSelectedBranch: (name) => set((s) => ({ selectedBranch: s.selectedBranch === name ? null : name })),

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

  clearSelection: () =>
    set((s) => (s.selectedBranch === null && s.inspectorNodeId === null ? s : { selectedBranch: null, inspectorNodeId: null })),
  resetForNewRepo: () =>
    set({
      hiddenBranches: new Set<string>(),
      selectedBranch: null,
      search: '',
      inspectorNodeId: null,
      progress: null,
      hiddenLabels: 0,
    }),
}))
