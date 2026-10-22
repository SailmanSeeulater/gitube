import { useEffect, useSyncExternalStore } from 'react'
import type { Chunk, ChunkState } from './chunk'

/**
 * A chunk's state, loading it while `wanted` is true: on mount, and again each time `wanted`
 * turns true after a failure (a new request is a new try). The load starts in an effect, never
 * during render, since it notifies the chunk's subscribers.
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
