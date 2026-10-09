export interface RepoRef {
  owner: string
  repo: string
}

/** GitHub user/org names: alphanumerics and single hyphens, never leading with a hyphen. */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/
/** GitHub repo names: alphanumerics, '.', '-', '_'. */
const REPO_RE = /^[A-Za-z0-9_.-]+$/
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
/** scp-like ssh form: git@github.com:owner/repo.git (optionally without the user). */
const SCP_RE = /^(?:[\w.-]+@)?(?:www\.)?github\.com:(.+)$/i
/** host-only form without a scheme: github.com/owner/repo or www.github.com/owner/repo. */
const BARE_HOST_RE = /^(?:www\.)?github\.com(?=[/?#]|$)/i

/**
 * Accepts "owner/repo", "github.com/owner/repo", "https://github.com/owner/repo(.git)(/tree/...)",
 * "git@github.com:owner/repo.git". Returns null when it cannot find owner+repo.
 */
export function parseRepoUrl(input: string): RepoRef | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s) return null

  const scp = SCP_RE.exec(s)
  if (scp) return fromPath(scp[1], false)

  if (SCHEME_RE.test(s)) {
    const url = tryUrl(s)
    if (!url || !GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null
    return fromPath(url.pathname, false)
  }

  if (BARE_HOST_RE.test(s)) {
    const url = tryUrl(`https://${s}`)
    if (!url || !GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null
    return fromPath(url.pathname, false)
  }

  // Bare "owner/repo": exactly two segments, nothing that looks like a host or URL.
  return fromPath(s, true)
}

function tryUrl(s: string): URL | null {
  try {
    return new URL(s)
  } catch {
    return null
  }
}

function fromPath(path: string, strictTwoSegments: boolean): RepoRef | null {
  // Drop query/hash remnants that may survive in non-URL forms.
  const clean = path.split(/[?#]/, 1)[0]
  let segments: string[]
  if (strictTwoSegments) {
    // Bare "owner/repo": exactly two non-empty segments, one optional trailing slash.
    segments = clean.replace(/\/$/, '').split('/')
    if (segments.length !== 2 || segments.some((seg) => seg.length === 0)) return null
  } else {
    segments = clean.split('/').filter((seg) => seg.length > 0)
    if (segments.length < 2) return null
  }

  const owner = safeDecode(segments[0])
  let repo = safeDecode(segments[1])
  if (repo.toLowerCase().endsWith('.git')) repo = repo.slice(0, -4)

  if (!owner || !repo) return null
  if (!OWNER_RE.test(owner)) return null
  if (!REPO_RE.test(repo)) return null
  if (repo === '.' || repo === '..') return null
  if (/^\.+$/.test(repo)) return null

  return { owner, repo }
}

function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}
