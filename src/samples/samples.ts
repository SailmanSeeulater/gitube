/**
 * Snapshot samples: example repos saved as gitube files and served with the site
 * (public/samples, refreshed by scripts/samples.ts). The start screen's repo chips and the rate
 * limit card open them like a dropped file, so they cost no GitHub requests.
 */
export interface Sample {
  owner: string
  repo: string
  /** a few words for the chip */
  note: string
}

export const SAMPLES: ReadonlyArray<Sample> = [
  { owner: 'junegunn', repo: 'fzf', note: 'small' },
  { owner: 'vitejs', repo: 'vite', note: 'bigger' },
  { owner: 'octocat', repo: 'Hello-World', note: 'tiny' },
]

/** Where a sample is served, relative to the site root (no leading slash, so a subpath deploy works). */
export function sampleFile(sample: Pick<Sample, 'owner' | 'repo'>): string {
  return `samples/${sample.owner}__${sample.repo}.json`
}

/** The sample for owner/repo (case-insensitive, as GitHub names are), or null. */
export function findSample(owner: string, repo: string): Sample | null {
  const o = owner.toLowerCase()
  const r = repo.toLowerCase()
  return SAMPLES.find((s) => s.owner.toLowerCase() === o && s.repo.toLowerCase() === r) ?? null
}
