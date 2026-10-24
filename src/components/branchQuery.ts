/**
 * The branch search's little query language. Free text matches branch names as it always did; a few
 * qualifiers filter the panel's branch list by pull request:
 *
 *   is:pr  is:draft  is:conflict  review:approved|changes|waiting  checks:failing|running|passing|none  #N
 *
 * (#N being a pull request's number.)
 *
 * Qualifiers and text combine with AND, case-insensitively. A word that only looks like a qualifier
 * (is:open, foo:bar) stays text. Only the list reads the qualifiers: the canvas (search halos,
 * pinned labels, the metro reveal) gets the text part alone, which for plain text is the search
 * exactly as typed.
 */
import type { ChecksState, PullSummary, ReviewState } from '../types'

export type BranchFilter =
  | { kind: 'pr' }
  | { kind: 'draft' }
  | { kind: 'conflict' }
  | { kind: 'review'; value: Exclude<ReviewState, 'unknown'> }
  | { kind: 'checks'; value: Exclude<ChecksState, 'unknown'> }
  | { kind: 'number'; value: number }

export interface BranchQuery {
  /** the free text, trimmed (whitespace inside kept as typed when no qualifier was taken out) */
  text: string
  filters: BranchFilter[]
}

const REVIEWS = new Set(['approved', 'changes', 'waiting'])
const CHECKS = new Set(['failing', 'running', 'passing', 'none'])

/** The filter one whitespace-free word stands for, or null when it is text. */
function qualifier(word: string): BranchFilter | null {
  const w = word.toLowerCase()
  if (w === 'is:pr') return { kind: 'pr' }
  if (w === 'is:draft') return { kind: 'draft' }
  if (w === 'is:conflict') return { kind: 'conflict' }
  if (w.startsWith('review:') && REVIEWS.has(w.slice(7))) return { kind: 'review', value: w.slice(7) as Exclude<ReviewState, 'unknown'> }
  if (w.startsWith('checks:') && CHECKS.has(w.slice(7))) return { kind: 'checks', value: w.slice(7) as Exclude<ChecksState, 'unknown'> }
  const number = /^#(\d{1,9})$/.exec(w)
  if (number) return { kind: 'number', value: Number(number[1]) }
  return null
}

export function parseBranchQuery(search: string): BranchQuery {
  const words = search.split(/\s+/).filter((w) => w !== '')
  const filters: BranchFilter[] = []
  const text: string[] = []
  for (const word of words) {
    const filter = qualifier(word)
    if (filter) filters.push(filter)
    else text.push(word)
  }
  // without qualifiers the text is the search itself, so the canvas sees exactly what it always saw
  return { text: filters.length === 0 ? search.trim() : text.join(' '), filters }
}

/** The free-text part of a search (what the canvas matches tip labels against). */
export function branchQueryText(search: string): string {
  return parseBranchQuery(search).text
}

function matchesFilter(filter: BranchFilter, prs: ReadonlyArray<PullSummary>): boolean {
  switch (filter.kind) {
    case 'pr':
      return prs.length > 0
    case 'draft':
      return prs.some((pr) => pr.draft)
    case 'conflict':
      return prs.some((pr) => pr.conflict === true)
    case 'review':
      return prs.some((pr) => pr.review === filter.value)
    case 'checks':
      return prs.some((pr) => pr.checks === filter.value)
    case 'number':
      return prs.some((pr) => pr.number === filter.value)
  }
}

/** Does a branch (its name and its open pull requests) pass the query? */
export function matchesBranchQuery(query: BranchQuery, name: string, prs: ReadonlyArray<PullSummary>): boolean {
  const text = query.text.toLowerCase()
  if (text !== '' && !name.toLowerCase().includes(text)) return false
  return query.filters.every((filter) => matchesFilter(filter, prs))
}

/** The search with is:pr added, or taken out when it is there (the "N with PRs" link). */
export function toggleIsPr(search: string): string {
  const words = search.split(/\s+/).filter((w) => w !== '')
  const without = words.filter((w) => w.toLowerCase() !== 'is:pr')
  if (without.length !== words.length) return without.join(' ')
  return [...words, 'is:pr'].join(' ')
}

/** Whether the search holds is:pr. */
export function hasIsPr(search: string): boolean {
  return search.split(/\s+/).some((w) => w.toLowerCase() === 'is:pr')
}

/** The search box's tooltip once pull requests are known. */
export const QUERY_HELP =
  'Find a branch by name. Pull request filters: is:pr, is:draft, is:conflict, review:approved|changes|waiting, checks:failing|running|passing|none, and # with a pull request number. They narrow this list only.'
