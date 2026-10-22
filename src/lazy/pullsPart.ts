/**
 * What pullsChunk (lazy/parts.ts) loads: the pull request overlay's GitHub client and the node
 * inspector's pull request block. The ring on the canvas, the branch list's glyphs and the hook
 * that holds the data are eager and small; this waits until a repo is in.
 */
export { LOOKUP_COST, fetchPullIndex, lookupPull } from '../api/pulls'
export { default } from '../components/PrBlock'
