import { BARE_HOST_RE, GITHUB_HOSTS, SCHEME_RE, parseRepoUrl, safeDecode, tryUrl, type RepoRef } from './parseRepoUrl'

/** What the main input names: a repo for the repo garden, or a GitHub user for person mode. */
export type Subject = { kind: 'repo'; repo: RepoRef } | { kind: 'user'; login: string }

/**
 * GitHub logins: 1 to 39 alphanumerics or hyphens, never leading with a hyphen. Doubled and
 * trailing hyphens are allowed on purpose: legacy accounts have them, and a wrongly accepted login
 * costs one 404 where a wrongly rejected one locks that person out.
 */
const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
/** github.com routes that fit the login grammar but are not a user, compared lowercased. */
const RESERVED_ROUTES = new Set([
  'about', 'account', 'apps', 'codespaces', 'collections', 'contact', 'dashboard', 'enterprise', 'enterprises',
  'explore', 'features', 'issues', 'join', 'login', 'logout', 'marketplace', 'new', 'notifications',
  'organizations', 'orgs', 'pricing', 'pulls', 'search', 'sessions', 'settings', 'signup', 'site', 'sponsors',
  'topics', 'trending', 'users',
])

/**
 * Reads the main input. Repo forms go first, through parseRepoUrl, so whatever names a repo today
 * still names the same repo; otherwise a login. Returns null when it is neither.
 */
export function parseSubject(input: string): Subject | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s) return null

  const repo = parseRepoUrl(s)
  if (repo) return { kind: 'repo', repo }
  const login = parseLogin(s)
  return login ? { kind: 'user', login } : null
}

/**
 * Accepts "login", "login/", "@login" and "github.com/login" (with or without a scheme, a
 * trailing slash, ?query or #hash). Returns the login as typed, or null.
 */
export function parseLogin(input: string): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s) return null

  let login: string
  if (s.startsWith('@')) {
    login = s.slice(1)
  } else if (SCHEME_RE.test(s) || BARE_HOST_RE.test(s)) {
    const url = tryUrl(SCHEME_RE.test(s) ? s : `https://${s}`)
    if (!url || !GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null
    // Exactly one path segment, one optional trailing slash.
    const path = /^\/([^/]+)\/?$/.exec(url.pathname)
    if (!path) return null
    login = safeDecode(path[1])
  } else {
    // Bare "login": one optional trailing slash.
    login = s.replace(/\/$/, '')
  }

  if (!LOGIN_RE.test(login)) return null
  if (RESERVED_ROUTES.has(login.toLowerCase())) return null
  return login
}
