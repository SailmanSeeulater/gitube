import { useEffect, useMemo, useRef } from 'react'
import { metroLayout } from '../graph/metro'
import type { Graph, RepoData, ViewMode } from '../types'
import { buildMetroView, mergeLaneHints, metroOptionsFor, type MetroView } from './metroView'

/**
 * The metro layout of the graph on screen, or null when metro mode is off. Lanes are remembered
 * per repo and handed back as prevLanes, so hiding or showing a branch, the stale filter and the
 * skeleton | full switch move as few other lines as possible.
 */
export function useMetroView(graph: Graph | null, data: RepoData | null, viewMode: ViewMode, enabled: boolean): MetroView | null {
  const hintsRef = useRef<{ data: RepoData | null; hints: Map<string, number> | null }>({ data: null, hints: null })

  const layout = useMemo(() => {
    if (!enabled || !graph || !data) return null
    const memory = hintsRef.current
    const prev = memory.data === data ? memory.hints : null
    return metroLayout(graph, data, metroOptionsFor(viewMode, prev ?? undefined))
  }, [enabled, graph, data, viewMode])

  useEffect(() => {
    if (!layout || !data) return
    const memory = hintsRef.current
    hintsRef.current = { data, hints: mergeLaneHints(memory.data === data ? memory.hints : null, layout.laneHints) }
  }, [layout, data])

  return useMemo(() => (layout ? buildMetroView(layout) : null), [layout])
}
