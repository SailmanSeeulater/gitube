/**
 * Share links: the page URL names what is on show, so a copied link opens the same garden.
 *
 * Repo mode: ?repo=owner/repo, plus &branch=<name> or &by=<login> (a contributor without a GitHub
 * account: &by=name:<author name>), and &vs=owner/repo for a garden battle.
 * Person mode: ?user=<login>, plus &view=<view> for the chosen view (lines, constellation or a
 * console view). A link from before the life garden was retired, &view=garden, opens lines. A repo
 * wins when a link names both.
 *
 * Pure: reads and writes query strings only.
 */
import { parseRepoUrl, type RepoRef } from '../api/parseRepoUrl'
import { parseLogin } from '../api/parseSubject'

export interface ShareState {
  repo: RepoRef | null
  branch: string | null
  /** Contributor.key ('login:<login>' or 'name:<name>') */
  person: string | null
  /** the other repo of a garden battle; absent (or null) when there is none */
  vs?: RepoRef | null
}

/** The person mode views a share link can name. */
export type PersonView = 'lines' | 'constellation' | 'phosphor' | 'htop' | 'gitlog' | 'minimap' | 'helix'

const NAME_PREFIX = 'name:'
const LOGIN_PREFIX = 'login:'
const PERSON_VIEWS = new Set(['lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap', 'helix'])
/** Views a link may still name that are gone, and the view each now opens. */
const RETIRED_VIEWS: Readonly<Record<string, PersonView>> = { garden: 'lines' }

/** Reads a location.search string. Anything malformed is dropped, never thrown. */
export function readShareState(search: string): ShareState {
  const params = new URLSearchParams(search)
  const repoParam = params.get('repo')
  const repo = repoParam ? parseRepoUrl(repoParam) : null
  if (!repo) return { repo: null, branch: null, person: null }
  const branch = params.get('branch') || null
  const by = params.get('by')?.trim() || null
  let person: string | null = null
  if (by !== null) person = by.toLowerCase().startsWith(NAME_PREFIX) ? by.toLowerCase() : `${LOGIN_PREFIX}${by.toLowerCase()}`
  const vsParam = params.get('vs')
  const vs = vsParam ? parseRepoUrl(vsParam) : null
  // one selection at a time, as in the app
  return { repo, branch, person: branch !== null ? null : person, ...(vs ? { vs } : {}) }
}

/**
 * What a location.search string opens: a repo with its share state, a user with their view, or
 * null for neither. A ?repo= that parses wins, and user and view are then ignored; otherwise a
 * ?user= that parses as a login (so @login and github.com URLs work, as ?repo= takes URLs) is the
 * subject, and branch, by and vs are ignored. &view= counts only when it names a view exactly, or a
 * retired one (garden opens lines).
 */
export function readSubject(
  search: string,
): { kind: 'repo'; share: ShareState } | { kind: 'user'; login: string; view: PersonView | null } | null {
  const share = readShareState(search)
  if (share.repo) return { kind: 'repo', share }
  const params = new URLSearchParams(search)
  const userParam = params.get('user')
  const login = userParam ? parseLogin(userParam) : null
  if (!login) return null
  const viewParam = params.get('view')
  const view =
    viewParam === null ? null : PERSON_VIEWS.has(viewParam) ? (viewParam as PersonView) : Object.hasOwn(RETIRED_VIEWS, viewParam) ? RETIRED_VIEWS[viewParam] : null
  return { kind: 'user', login, view }
}

/**
 * The query string for a state, '' when no repo is on show. Other parameters in `current` are kept,
 * so links carrying something else (a campaign tag, say) still work.
 */
export function writeShareState(state: ShareState, current = ''): string {
  const params = new URLSearchParams(current)
  params.delete('repo')
  params.delete('branch')
  params.delete('by')
  params.delete('vs')
  params.delete('user')
  params.delete('view')
  if (state.repo) {
    params.set('repo', `${state.repo.owner}/${state.repo.repo}`)
    if (state.branch !== null) params.set('branch', state.branch)
    else if (state.person !== null) {
      params.set('by', state.person.startsWith(LOGIN_PREFIX) ? state.person.slice(LOGIN_PREFIX.length) : state.person)
    }
    if (state.vs) params.set('vs', `${state.vs.owner}/${state.vs.repo}`)
  }
  return toQuery(params)
}

/**
 * The query string for a user on show, with &view= when a view is given. The repo's own parameters
 * go; every other parameter in `current` is kept, as in writeShareState.
 */
export function writeUserShare(state: { login: string; view: PersonView | null }, current = ''): string {
  const params = new URLSearchParams(current)
  params.delete('repo')
  params.delete('branch')
  params.delete('by')
  params.delete('vs')
  params.delete('user')
  params.delete('view')
  params.set('user', state.login)
  if (state.view !== null) params.set('view', state.view)
  return toQuery(params)
}

function toQuery(params: URLSearchParams): string {
  // owner/repo and branch names read better with their slashes left alone
  const query = params.toString().replace(/%2F/gi, '/').replace(/%3A/gi, ':')
  return query ? `?${query}` : ''
}
