import { useEffect, useSyncExternalStore } from 'react'
import type { Chunk, ChunkState } from './chunk'

/**
 * A chunk's state, loading it while `wanted` is true: on mount, and again each time `wanted`
 * turns true after a failure (a new request is a new try, under a new URL; see lazy/chunk.ts).
 * The load starts in an effect, never during render, since it notifies the chunk's subscribers.
 * When `wanted` turns true after a failure, the state this render returned is still 'failed', but
 * the caller's own effects declared after this hook already find the new try's 'loading' in
 * chunk.state(): read that one there.
 */
export function useChunk<T>(chunk: Chunk<T>, wanted: boolean): ChunkState<T> {
  const state = useSyncExternalStore(chunk.subscribe, chunk.state, chunk.state)
  useEffect(() => {
    if (!wanted) return
    const { status } = chunk.state()
    // a failure shows through the state
    if (status === 'idle' || status === 'failed') chunk.load().catch(() => {})
  }, [chunk, wanted])
  return state
}
