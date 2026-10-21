/**
 * Recorded RepoData of real repos, from the local replay cache (replay-cache/_repodata-<owner>-<repo>.json).
 * The cache is not checked in, so loadReplay returns null when the file is absent and tests that
 * need it skip themselves (it.skipIf(!data)).
 */
import type { RepoData } from '../../src/types'

const files = import.meta.glob<RepoData>('../../replay-cache/_repodata-*.json', { eager: true, import: 'default' })

export function loadReplay(owner: string, repo: string): RepoData | null {
  const data = files[`../../replay-cache/_repodata-${owner}-${repo}.json`]
  // a fresh copy: graph builders may annotate what they are given
  return data ? (structuredClone(data) as RepoData) : null
}
