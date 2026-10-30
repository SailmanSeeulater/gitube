/**
 * What the app shows (App.tsx routes on it): a repo, or a person. Kept apart from App so it
 * can be read and tested without the canvas code App's repo mode brings along.
 */
import type { RepoInitial } from './RepoApp'
import { readSubject, type PersonView } from './share/shareUrl'

/**
 * A repo, or a person. request counts the person's submits, so a later phase can refetch the
 * same login the way Go refetches the same repo.
 */
export type Subject =
  | { kind: 'repo'; initial?: RepoInitial }
  | { kind: 'user'; login: string; request: number; view: PersonView | null; fromInput: boolean }

/** The subject a page address names: a ?user= link opens person mode, anything else repo mode. */
export function subjectOf(search: string): Subject {
  const read = readSubject(search)
  return read?.kind === 'user' ? { kind: 'user', login: read.login, request: 0, view: read.view, fromInput: false } : { kind: 'repo' }
}
