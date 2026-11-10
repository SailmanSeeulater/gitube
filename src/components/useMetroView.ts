import { useEffect, useMemo, useRef } from 'react'
import type { MetroLayout, MetroOptions } from '../graph/metro'
import type { Graph, RepoData, ViewMode } from '../types'
import { buildMetroView, mergeLaneHints, metroOptionsFor, type MetroView } from './metroView'

/** graph/metro's metroLayout or graph/coral's coralLayout, which App loads on demand (lazy/parts.ts metroChunk, coralChunk). */
export type MetroLayoutFn = (graph: Graph, data: RepoData, opts?: MetroOptions) => MetroLayout

/**
 * The metro (or coral) layout of the graph on screen, or null while metroLayout is null (organic
 * mode, or the engine not loaded yet). Lanes are remembered per repo and handed back as prevLanes, so
 * hiding or showing a branch, the stale filter and the skeleton | full switch move as few other
 * lines as possible.
 */
export function useMetroView(graph: Graph | null, data: RepoData | null, viewMode: ViewMode, metroLayout: MetroLayoutFn | null): MetroView | null {
  const hintsRef = useRef<{ data: RepoData | null; hints: Map<string, number> | null }>({ data: null, hints: null })

  const layout = useMemo(() => {
    if (!metroLayout || !graph || !data) return null
    const memory = hintsRef.current
    const prev = memory.data === data ? memory.hints : null
    return metroLayout(graph, data, metroOptionsFor(viewMode, prev ?? undefined))
  }, [metroLayout, graph, data, viewMode])

  useEffect(() => {
    if (!layout || !data) return
    const memory = hintsRef.current
    hintsRef.current = { data, hints: mergeLaneHints(memory.data === data ? memory.hints : null, layout.laneHints) }
  }, [layout, data])

  // route pieces name their end nodes by index in graph.nodes, the order RepoGraph's node arrays keep
  return useMemo(() => (layout && graph ? buildMetroView(layout, graph.nodes) : null), [layout, graph])
}
