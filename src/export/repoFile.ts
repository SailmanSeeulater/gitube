/**
 * Saving a loaded repo to a file and opening it again: the RepoData behind the graph, tagged
 * with a format name and version. Opening a file costs no GitHub API requests.
 *
 * Pure. A file can come from anywhere, so parseRepoFile checks every field the graph code reads,
 * drops anything else, and only keeps links and avatars that point at GitHub.
 */
import { parseRepoUrl } from '../api/parseRepoUrl'
import type { Branch, Commit, RepoData } from '../types'

export const REPO_FILE_FORMAT = 'gitube'
/** The format name files had before the rename; they open as they always did. */
export const LEGACY_FILE_FORMAT = 'repo-garden'
export const REPO_FILE_VERSION = 1

export interface RepoFile {
  format: typeof REPO_FILE_FORMAT
  version: typeof REPO_FILE_VERSION
  /** ISO time the file was saved */
  savedAt: string
  data: RepoData
}

/** Why a file could not be opened, worded for the person who picked it. */
export class RepoFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepoFileError'
  }
}

export function serializeRepoFile(data: RepoData, now: Date = new Date()): string {
  const file: RepoFile = { format: REPO_FILE_FORMAT, version: REPO_FILE_VERSION, savedAt: now.toISOString(), data }
  return JSON.stringify(file)
}

/** 'owner-repo-gitube-2026-10-21.png' (local date); kind replaces 'gitube' ('timelapse'). */
export function exportFileName(data: Pick<RepoData, 'owner' | 'repo'>, ext: string, now: Date = new Date(), kind = 'gitube'): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${data.owner}-${data.repo}-${kind}-${day}.${ext}`
}

const SHA_RE = /^[0-9a-f]{4,64}$/i
/** GitHub logins: alphanumerics and hyphens; app accounts end in [bot]. */
const LOGIN_RE = /^[A-Za-z0-9-]{1,39}(\[bot\])?$/
const AVATAR_HOST = 'avatars.githubusercontent.com'

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(what: string): never {
  throw new RepoFileError(`the file is damaged: ${what}`)
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} is missing`)
  return value
}

function sha(value: unknown, what: string): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) fail(`${what} is not a commit sha`)
  return value
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`${what} is not a count`)
  return value
}

function avatar(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === AVATAR_HOST ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function readBranch(raw: unknown, i: number): Branch {
  if (!isObject(raw)) fail(`branch ${i + 1} is not an object`)
  const name = str(raw.name, `branch ${i + 1}'s name`)
  if (name === '') fail(`branch ${i + 1} has no name`)
  if (typeof raw.isDefault !== 'boolean') fail(`branch ${name} has no isDefault flag`)
  return {
    name,
    tipSha: sha(raw.tipSha, `branch ${name}'s tip`),
    isDefault: raw.isDefault,
    mergeBaseSha: raw.mergeBaseSha === null ? null : sha(raw.mergeBaseSha, `branch ${name}'s merge base`),
    aheadBy: count(raw.aheadBy, `branch ${name}'s aheadBy`),
    behindBy: count(raw.behindBy, `branch ${name}'s behindBy`),
    tipDate: str(raw.tipDate, `branch ${name}'s tip date`),
  }
}

function readCommit(key: string, raw: unknown, owner: string, repo: string): Commit {
  const id = sha(key, `commit key ${key.slice(0, 12)}`)
  if (!isObject(raw)) fail(`commit ${id.slice(0, 7)} is not an object`)
  if (raw.sha !== id) fail(`commit ${id.slice(0, 7)} is filed under another sha`)
  if (!Array.isArray(raw.parents)) fail(`commit ${id.slice(0, 7)} has no parent list`)
  const parents = raw.parents.map((p, j) => sha(p, `parent ${j + 1} of ${id.slice(0, 7)}`))
  // the inspector links here: only ever a github.com page
  const url = typeof raw.url === 'string' && raw.url.startsWith('https://github.com/') ? raw.url : `https://github.com/${owner}/${repo}/commit/${id}`
  const commit: Commit = {
    sha: id,
    parents,
    message: str(raw.message, `commit ${id.slice(0, 7)}'s message`),
    author: str(raw.author, `commit ${id.slice(0, 7)}'s author`),
    date: str(raw.date, `commit ${id.slice(0, 7)}'s date`),
    url,
  }
  if (typeof raw.login === 'string' && LOGIN_RE.test(raw.login)) {
    commit.login = raw.login
    const avatarUrl = avatar(raw.avatarUrl)
    if (avatarUrl) commit.avatarUrl = avatarUrl
  }
  return commit
}

/** Reads a file written by serializeRepoFile. Throws RepoFileError with a readable reason. */
export function parseRepoFile(text: string): RepoFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RepoFileError('this is not a JSON file.')
  }
  if (!isObject(parsed) || (parsed.format !== REPO_FILE_FORMAT && parsed.format !== LEGACY_FILE_FORMAT)) {
    throw new RepoFileError('this JSON file was not saved by gitube.')
  }
  if (typeof parsed.version !== 'number' || parsed.version > REPO_FILE_VERSION) {
    throw new RepoFileError('this file was saved by a newer gitube. reload the page and try again.')
  }
  if (parsed.version !== REPO_FILE_VERSION) throw new RepoFileError(`unsupported file version ${parsed.version}.`)

  const raw = parsed.data
  if (!isObject(raw)) fail('it holds no repository')
  const owner = str(raw.owner, 'the owner')
  const repo = str(raw.repo, 'the repo name')
  const ref = parseRepoUrl(`${owner}/${repo}`)
  if (!ref || ref.owner !== owner || ref.repo !== repo) fail('the repository name is not valid')

  if (!Array.isArray(raw.branches) || raw.branches.length === 0) fail('it holds no branches')
  const branches = raw.branches.map(readBranch)
  const defaultBranch = str(raw.defaultBranch, 'the default branch')
  if (!branches.some((b) => b.name === defaultBranch)) fail('the default branch is not among its branches')

  if (!isObject(raw.commits)) fail('it holds no commits')
  const commits: Record<string, Commit> = {}
  for (const [key, value] of Object.entries(raw.commits)) commits[key] = readCommit(key, value, owner, repo)
  if (Object.keys(commits).length === 0) fail('it holds no commits')

  if (typeof raw.truncated !== 'boolean') fail('the truncation flag is missing')
  if (!Array.isArray(raw.truncatedAt)) fail('the truncation list is missing')
  const truncatedAt = raw.truncatedAt.map((s, i) => sha(s, `truncation entry ${i + 1}`))

  return {
    format: REPO_FILE_FORMAT,
    version: REPO_FILE_VERSION,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    data: { owner, repo, defaultBranch, branches, commits, truncated: raw.truncated, truncatedAt },
  }
}
