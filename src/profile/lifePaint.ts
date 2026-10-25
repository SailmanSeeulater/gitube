/**
 * The life garden's frame and pointer, outside React: one painter per layout, theme, namer and
 * time-lapse, which paints a frame (the garden, then its labels over it) and says what is under the
 * pointer and what a click picks, from what the last frame drew. LifeGarden and the tests
 * (tests/helpers/personScene.ts) build it the same way, so what the tests paint and hit is what
 * the canvas does.
 *
 * Pure: the store's hidden repos, hover and selection, the pointer and the hover's setter come in
 * as functions. It keeps only its labels, its leaf colours and the last frame.
 */
import { leafColour } from '../components/gardenPaint'
import { dayAt, type LifeTimeline } from './timeline'
import type { LifeCamera, LifeGardenLayout, LifeHover, LifeInk, LifeViewport, PlantGeom, RepoNamer } from './lifeTypes'
import { plantGeom } from './lifeGeometry'
import { hitLifeGarden } from './lifeGardenHit'
import { paintLifeGarden, plantColour } from './lifeGardenPaint'
import { LifeLabelSet, labelNames } from './useLifeLabels'
import type { LifePaint } from './useLifeCanvas'

/** What a frame and a hit test read from usePersonStore, as it is at that moment. */
export interface LifePaintState {
  /** repo keys */
  hidden: ReadonlySet<string>
  hover: LifeHover
  /** repo key */
  selected: string | null
}

export interface LifePaintOptions {
  layout: LifeGardenLayout
  timeline: LifeTimeline
  ink: LifeInk
  colourOf: (language: string | null) => string
  /** the only names the labels receive */
  name: RepoNamer
  /** the person, whose own repos are labelled without the owner */
  login: string
  /** the labels before these (a theme switch, the privacy toggle): the new ones take over their spots */
  prevLabels?: LifeLabelSet | null
  /** measures a label's text as drawn; measureLabel when left out */
  measure?: (text: string) => number
  /** Phase 5: the time-lapse grows the garden to its progress (0..1); frames keep coming while it is set */
  timelapse?: { progress: { readonly current: number | null } } | null
  state: () => LifePaintState
  /** the camera moved under a still pointer, or the labels moved under it: the hover follows */
  setHover?: (hover: LifeHover) => void
  /** the pointer over the canvas while no button is down; null otherwise */
  pointer?: () => { x: number; y: number } | null
}

export interface LifePainter {
  labels: LifeLabelSet
  /** useLifeCanvas's paint: one frame; true asks for another */
  paint: LifePaint
  /** what is under (x, y) on what the last frame drew: a label, a plant, a milestone or a day; null before the first frame */
  hitAt: (x: number, y: number) => LifeHover
  /** the repo a click at (x, y) picks: a plant or its label (a plate row picks the plant it names); null for none */
  pickAt: (x: number, y: number) => string | null
}

/** What the last frame drew from: hit tests work on what is on screen. */
interface Frame {
  camera: LifeCamera
  view: LifeViewport
  geoms: PlantGeom[]
}

export function makeLifePaint(opts: LifePaintOptions): LifePainter {
  const { layout, timeline, ink, colourOf, state, timelapse = null } = opts
  const labels = new LifeLabelSet(layout, labelNames(layout, timeline, opts.name, opts.login), opts.measure, opts.prevLabels ?? null)
  // leaves are a language colour turned green; blended once per colour
  const leaves = new Map<string, string>()
  const leafOf = (colour: string): string => {
    let leaf = leaves.get(colour)
    if (leaf === undefined) {
      try {
        leaf = leafColour(colour, ink.garden)
      } catch {
        leaf = colour
      }
      leaves.set(colour, leaf)
    }
    return leaf
  }
  const indexOf = (key: string | null): number => (key !== null ? (layout.byKey.get(key) ?? -1) : -1)
  let frame: Frame | null = null

  const hitAt = (x: number, y: number): LifeHover => {
    if (frame === null) return null
    const { hover, hidden } = state()
    const label = labels.hit(x, y, hover?.kind === 'repo' ? indexOf(hover.key) : -1)
    if (label >= 0) return { kind: 'repo', key: layout.plants[label].key }
    return hitLifeGarden(layout, frame.geoms, frame.camera, frame.view, x, y, hidden)
  }

  const pickAt = (x: number, y: number): string | null => {
    const label = labels.click(x, y)
    if (label >= 0) return layout.plants[label].key
    const hit = hitAt(x, y)
    return hit?.kind === 'repo' ? hit.key : null
  }

  const paint: LifePaint = (ctx, view, camera, dtMs) => {
    const { hidden, hover, selected } = state()
    const prev = frame
    const same = prev !== null && prev.view === view
    const geoms = same && prev.camera === camera ? prev.geoms : layout.plants.map((plant) => plantGeom(plant, camera, view))
    const cameraMoving = same && prev.camera !== camera
    frame = { camera, view, geoms }
    const at = timelapse ? dayAt(timeline.clock, Math.min(1, Math.max(0, timelapse.progress.current ?? 1))) : null
    paintLifeGarden(ctx, { layout, timeline, geoms, camera, view, ink, colourOf, leafOf, hidden, hover, selected, at })
    const hovered = hover?.kind === 'repo' ? indexOf(hover.key) : -1
    const picked = indexOf(selected)
    const forced = [hovered, picked].filter((i) => i >= 0)
    const busy = labels.update({ geoms, view, dtMs, cameraMoving, hidden, forced, explore: hovered, at })
    labels.draw(ctx, ink, (i) => plantColour(layout.plants[i], ink, colourOf), picked)
    // the camera moved under a still pointer: the hover follows what is under it now
    const pointer = opts.pointer?.() ?? null
    if (pointer !== null && (cameraMoving || busy)) opts.setHover?.(hitAt(pointer.x, pointer.y))
    return busy || timelapse !== null
  }

  return { labels, paint, hitAt, pickAt }
}
