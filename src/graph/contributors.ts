/**
 * Who wrote the fetched commits: one leaderboard row per person, and the nodes and links to keep
 * lit on the graph while a person is selected.
 *
 * Pure and deterministic. Covers the fetched commits only (FetchOptions caps the trunk and each
 * branch), so counts describe the loaded window, not the repo's whole history.
 */
import type { Commit, RepoData } from '../types'
import { buildFullGraph, type GraphBody } from './build'

/** Time slices in Contributor.activity. */
export const ACTIVITY_BUCKETS = 24

export interface ContributorBranch {
  name: string
  /** Their commits this branch owns (see GraphNode.owner). */
  commits: number
}

export interface Contributor {
  /** 'login:<login>' (lower-case) for a GitHub account, else 'name:<author name>' (lower-case). */
  key: string
  /** The author name used most on their commits. */
  name: string
  login: string | null
  avatarUrl: string | null
  /** A bot account, such as dependabot[bot]. */
  isBot: boolean
  commits: number
  /** Branches that own their commits, most commits first. */
  branches: ContributorBranch[]
  /** ISO dates of their oldest and newest commit; '' when none is dated. */
  firstDate: string
  lastDate: string
  /** Commits per equal slice of the whole loaded window (every contributor shares it), oldest first. */
  activity: number[]
}

export interface ContributorIndex {
  /** Most commits first, then most recently active, then by name. */
  list: Contributor[]
  /** commit sha -> Contributor.key */
  keyBySha: Map<string, string>
  /** ISO dates of the oldest and newest fetched commit, which Contributor.activity spans; '' when none is dated. */
  windowStart: string
  windowEnd: string
}

export interface ContributorFocus {
  /** Shown nodes whose commit is theirs. */
  nodes: Set<string>
  /** linkKey of every shown link that starts at one of their commits or hides one in its run. */
  links: Set<string>
  /** nodes plus the tips of the branches they own commits on: whose labels stay lit. */
  labels: Set<string>
}

/** Identifies a link by its child (source) and parent (target) ids. */
export function linkKey(source: string, target: string): string {
  return `${source}>${target}`
}

const BOT_SUFFIX = /\[bot\]$/i

function normName(name: string): string {
  return name.trim().toLowerCase()
}

function timeOf(date: string): number {
  const t = Date.parse(date)
  return Number.isFinite(t) ? t : NaN
}

/** Code-point order: locale independent, hence deterministic everywhere. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

interface Tally {
  key: string
  names: Map<string, number>
  login: string | null
  avatarUrl: string | null
  commits: number
  branches: Map<string, number>
  first: number
  last: number
  activity: number[]
}

/**
 * One row per person over every fetched commit. A commit GitHub linked to no account joins the
 * account whose commits use the same author name, when exactly one does; otherwise it is counted
 * under the name alone.
 */
export function buildContributors(data: RepoData): ContributorIndex {
  const commits = Object.values(data.commits)

  // author name -> the one login seen with it, or null when several logins share the name
  const loginByName = new Map<string, string | null>()
  for (const c of commits) {
    if (!c.login) continue
    const name = normName(c.author)
    const seen = loginByName.get(name)
    if (seen === undefined) loginByName.set(name, c.login)
    else if (seen !== null && seen.toLowerCase() !== c.login.toLowerCase()) loginByName.set(name, null)
  }
  const keyOf = (c: Commit): string => {
    if (c.login) return `login:${c.login.toLowerCase()}`
    const login = loginByName.get(normName(c.author))
    return login ? `login:${login.toLowerCase()}` : `name:${normName(c.author)}`
  }

  const owner = new Map<string, string>()
  for (const node of buildFullGraph(data).nodes) owner.set(node.id, node.owner)

  let minT = Infinity
  let maxT = -Infinity
  for (const c of commits) {
    const t = timeOf(c.date)
    if (Number.isNaN(t)) continue
    if (t < minT) minT = t
    if (t > maxT) maxT = t
  }
  const span = maxT - minT
  const bucketOf = (t: number): number =>
    span > 0 ? Math.min(ACTIVITY_BUCKETS - 1, Math.floor(((t - minT) / span) * ACTIVITY_BUCKETS)) : ACTIVITY_BUCKETS - 1

  const keyBySha = new Map<string, string>()
  const tallies = new Map<string, Tally>()
  for (const c of commits) {
    const key = keyOf(c)
    keyBySha.set(c.sha, key)
    let tally = tallies.get(key)
    if (!tally) {
      tally = {
        key,
        names: new Map(),
        login: null,
        avatarUrl: null,
        commits: 0,
        branches: new Map(),
        first: Infinity,
        last: -Infinity,
        activity: new Array<number>(ACTIVITY_BUCKETS).fill(0),
      }
      tallies.set(key, tally)
    }
    tally.commits += 1
    tally.names.set(c.author, (tally.names.get(c.author) ?? 0) + 1)
    if (c.login && tally.login === null) tally.login = c.login
    if (c.avatarUrl && tally.avatarUrl === null) tally.avatarUrl = c.avatarUrl
    const branch = owner.get(c.sha)
    if (branch !== undefined) tally.branches.set(branch, (tally.branches.get(branch) ?? 0) + 1)
    const t = timeOf(c.date)
    if (!Number.isNaN(t)) {
      if (t < tally.first) tally.first = t
      if (t > tally.last) tally.last = t
      tally.activity[bucketOf(t)] += 1
    }
  }

  const list: Contributor[] = []
  for (const tally of tallies.values()) {
    let name = ''
    let uses = 0
    for (const [candidate, n] of tally.names) {
      if (n > uses || (n === uses && compareStrings(candidate, name) < 0)) {
        name = candidate
        uses = n
      }
    }
    const branches = [...tally.branches]
      .map(([branchName, n]) => ({ name: branchName, commits: n }))
      .sort((a, b) => b.commits - a.commits || compareStrings(a.name, b.name))
    list.push({
      key: tally.key,
      name,
      login: tally.login,
      avatarUrl: tally.avatarUrl,
      isBot: BOT_SUFFIX.test(tally.login ?? '') || BOT_SUFFIX.test(name),
      commits: tally.commits,
      branches,
      firstDate: Number.isFinite(tally.first) ? new Date(tally.first).toISOString() : '',
      lastDate: Number.isFinite(tally.last) ? new Date(tally.last).toISOString() : '',
      activity: tally.activity,
    })
  }

  const lastOf = (c: Contributor): number => (c.lastDate ? Date.parse(c.lastDate) : -Infinity)
  list.sort(
    (a, b) =>
      b.commits - a.commits ||
      lastOf(b) - lastOf(a) ||
      compareStrings(a.name.toLowerCase(), b.name.toLowerCase()) ||
      compareStrings(a.key, b.key),
  )
  const dated = Number.isFinite(minT)
  return {
    list,
    keyBySha,
    windowStart: dated ? new Date(minT).toISOString() : '',
    windowEnd: dated ? new Date(maxT).toISOString() : '',
  }
}

/**
 * What to keep lit for one person on the graph as shown. In skeleton view a link stands for a run
 * of hidden commits, so it stays lit when any commit in that run is theirs; full is the same graph
 * uncollapsed (pass the shown graph itself in full view) and is walked to find those runs.
 *
 * @param branches the names of the branches they own commits on, for the labels
 */
export function contributorFocus(
  shown: GraphBody,
  full: GraphBody,
  keyBySha: ReadonlyMap<string, string>,
  key: string,
  branches: Iterable<string>,
): ContributorFocus {
  const isTheirs = (sha: string): boolean => keyBySha.get(sha) === key

  const shownIds = new Set<string>()
  for (const node of shown.nodes) shownIds.add(node.id)

  // full graph: child -> parents (a commit skeleton view hides has exactly one)
  const parentsOf = new Map<string, string[]>()
  for (const link of full.links) {
    const list = parentsOf.get(link.source)
    if (list) list.push(link.target)
    else parentsOf.set(link.source, [link.target])
  }

  const nodes = new Set<string>()
  const links = new Set<string>()
  for (const node of shown.nodes) {
    const mine = isTheirs(node.id)
    if (mine) nodes.add(node.id)
    for (const first of parentsOf.get(node.id) ?? []) {
      let target = first
      let hit = mine
      // walk down the run of hidden commits to the next shown one (none in full view)
      while (!shownIds.has(target)) {
        if (!hit && isTheirs(target)) hit = true
        const next = parentsOf.get(target)
        if (!next || next.length === 0) break
        target = next[0]
      }
      if (hit) links.add(linkKey(node.id, target))
    }
  }

  const labels = new Set(nodes)
  const owned = new Set(branches)
  if (owned.size > 0) {
    for (const node of shown.nodes) {
      if (node.tips.some((tip) => owned.has(tip))) labels.add(node.id)
    }
  }
  return { nodes, links, labels }
}
