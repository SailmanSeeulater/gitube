/**
 * Person mode's view state: hidden repos, the hover, the selection, a pending focus, the privacy
 * toggle and the panel's tab and search. A store rather than PersonApp state, so a view can
 * subscribe to only what it draws: hovering the ground changes the day every few pixels, and the
 * inspector follows it while the repo list does not re-render.
 *
 * The store is a module singleton that outlives PersonApp, so PersonApp calls resetFor on its mount
 * and on every new login or request. Nothing in it is persisted: the privacy toggle in particular is
 * hidden again on reload (PROFILE_SPEC.md section 2, "Privacy rule").
 *
 * Repos are named by repoKey (privacy.ts); keys are lowercased as they come in.
 */
import { create } from 'zustand'
import type { LifeFocus, LifeHover } from './lifeTypes'
import { repoKey } from './privacy'

export interface PersonState {
  /** the login this state belongs to, lowercased; null before the first resetFor */
  owner: string | null
  /** repo keys hidden with the eye toggle. Replaced immutably on every change. */
  hidden: ReadonlySet<string>
  hover: LifeHover
  /** the repo key a click pinned; null when nothing is selected */
  selected: string | null
  /** the last request to bring something into view */
  focus: LifeFocus
  /** the login, lowercased, whose private repo names show (isRevealed); never persisted */
  revealFor: string | null
  tab: 'repos' | 'milestones'
  /** the repo list's filter */
  search: string
}

export interface PersonActions {
  /** A new login or request: clears everything but the tab, the privacy toggle included. */
  resetFor: (owner: string) => void
  /** Hiding the selected or hovered repo drops it from the selection and the hover. */
  toggleHidden: (key: string) => void
  showAll: () => void
  /** Keeps the same state object when the hover is unchanged, so a move within a day re-renders nothing. */
  setHover: (hover: LifeHover) => void
  select: (key: string | null) => void
  /** A new focus each call, even for the same target. */
  focusOn: (target: { kind: 'repo'; key: string } | { kind: 'day'; day: number }) => void
  /** On reveals private repo names for owner only (any other login stays hidden); off hides them. */
  setReveal: (owner: string, on: boolean) => void
  setTab: (tab: PersonState['tab']) => void
  setSearch: (query: string) => void
  /** Clears the selection and the hover (Escape). */
  clearSelection: () => void
}

export type PersonStore = PersonState & PersonActions

function sameHover(a: LifeHover, b: LifeHover): boolean {
  if (a === null || b === null) return a === b
  if (a.kind === 'repo') return b.kind === 'repo' && a.key === b.key
  return b.kind === 'day' && a.day === b.day && a.milestone === b.milestone
}

const NONE: ReadonlySet<string> = new Set<string>()

export const usePersonStore = create<PersonStore>()((set) => {
  // focus requests count up for the store's whole life, so no two are ever equal
  let seq = 0
  return {
    owner: null,
    hidden: NONE,
    hover: null,
    selected: null,
    focus: null,
    revealFor: null,
    tab: 'repos',
    search: '',

    resetFor: (owner) =>
      set((s) => {
        const key = owner.toLowerCase()
        const clean =
          s.owner === key && s.hidden.size === 0 && s.hover === null && s.selected === null && s.focus === null && s.revealFor === null && s.search === ''
        return clean ? s : { owner: key, hidden: NONE, hover: null, selected: null, focus: null, revealFor: null, search: '' }
      }),

    toggleHidden: (name) =>
      set((s) => {
        const key = repoKey(name)
        const hidden = new Set(s.hidden)
        if (hidden.delete(key)) return { hidden }
        hidden.add(key)
        return {
          hidden,
          selected: s.selected === key ? null : s.selected,
          hover: s.hover?.kind === 'repo' && s.hover.key === key ? null : s.hover,
        }
      }),
    showAll: () => set((s) => (s.hidden.size === 0 ? s : { hidden: NONE })),

    setHover: (hover) =>
      set((s) => {
        const next: LifeHover = hover?.kind === 'repo' ? { kind: 'repo', key: repoKey(hover.key) } : hover
        return sameHover(s.hover, next) ? s : { hover: next }
      }),
    select: (name) =>
      set((s) => {
        const selected = name === null ? null : repoKey(name)
        return s.selected === selected ? s : { selected }
      }),
    focusOn: (target) => {
      seq += 1
      set({ focus: target.kind === 'repo' ? { kind: 'repo', key: repoKey(target.key), seq } : { kind: 'day', day: target.day, seq } })
    },

    setReveal: (owner, on) =>
      set((s) => {
        const revealFor = on ? owner.toLowerCase() : null
        return s.revealFor === revealFor ? s : { revealFor }
      }),
    setTab: (tab) => set((s) => (s.tab === tab ? s : { tab })),
    setSearch: (search) => set((s) => (s.search === search ? s : { search })),

    clearSelection: () => set((s) => (s.selected === null && s.hover === null ? s : { selected: null, hover: null })),
  }
})
