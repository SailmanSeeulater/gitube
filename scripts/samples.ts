/**
 * Refresh the snapshot samples the start screen's repo chips open (public/samples).
 *
 *   GITHUB_TOKEN=$(gh auth token) npx tsx scripts/samples.ts
 *
 * Fetches each repo in SAMPLES live with the token, the way the app would, and saves it as a
 * gitube file. Opening a sample costs a visitor no GitHub requests, so a first click always
 * draws a map, even with the hourly anonymous budget spent.
 */
import { writeFileSync } from 'node:fs'
import { fetchRepoData } from '../src/api/github'
import { serializeRepoFile } from '../src/export/repoFile'
import { SAMPLES, sampleFile } from '../src/samples/samples'

const token = process.env.GITHUB_TOKEN?.trim()
if (!token) {
  console.error('set GITHUB_TOKEN (for example GITHUB_TOKEN=$(gh auth token)): the samples are too big for the anonymous budget')
  process.exit(2)
}

for (const sample of SAMPLES) {
  const data = await fetchRepoData({ owner: sample.owner, repo: sample.repo }, { token })
  const path = `public/${sampleFile(sample)}`
  writeFileSync(path, serializeRepoFile(data))
  console.log(`${sample.owner}/${sample.repo}: ${data.branches.length} branches, ${Object.keys(data.commits).length} commits -> ${path}`)
}
