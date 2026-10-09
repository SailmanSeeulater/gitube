import type { FetchOptions, RepoData } from '../types'
import type { RepoRef } from './parseRepoUrl'

/**
 * Fetch everything needed to draw the branch graph for a repo using the GitHub REST API
 * from the browser (no clone). See PLAN.md section 3 for the request plan.
 */
export async function fetchRepoData(_ref: RepoRef, _opts: FetchOptions = {}): Promise<RepoData> {
  throw new Error('not implemented')
}
