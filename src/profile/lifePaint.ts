/**
 * A person-mode view's frame and pointer, outside React: one painter per view, layout, theme, namer
 * and time-lapse, which paints a frame (the view's scene, then its labels over it, then the
 * time-lapse's caption while one is set) and says what is under the pointer and what a click picks,
 * from what the last frame drew. LifeView and the tests (tests/helpers/personScene.ts) build it the
 * same way, so what the tests paint and hit is what the canvas does.
 *
 * makeViewPaint drives any view's scene (lifeView.ts's LifeScene); GARDEN_SCENE is the life
 * garden's, and makeLifePaint the garden's painter as it always was. Repo names reach the canvas
 * only through the labels, built from the namer here: a scene never receives one.
 *
 * Pure: the store's hidden repos, hover and selection, the pointer and the hover's setter come in
 * as functions. It keeps only its labels and the last frame.
 */
import { leafColour, type GardenInk } from '../components/gardenPaint'
import { dayAt, type LifeTimeline } from './timeline'
import type { LifeCamera, LifeGardenLayout, LifeHover, LifeInk, LifeViewport, PlantGeom, RepoNamer } from './lifeTypes'
import type { LifeScene, LifeViewModel } from './lifeView'
import { plantGeom } from './lifeGeometry'
import { hitLifeGarden } from './lifeGardenHit'
import { paintLifeGarden, plantColour } from './lifeGardenPaint'
import { LifeLabelSet, gardenAnchor, gardenLabelItems, groundKeepOut, labelNames } from './useLifeLabels'
import type { LifePaint } from './useLifeCanvas'
import { lapseCaption, paintLapseHud } from './lifeTimelapse'

/** What a frame and a hit test read from usePersonStore, as it is at that moment. */
export interface LifePaintState {
  /** repo keys */
  hidden: ReadonlySet<string>
  hover: LifeHover
  /** repo key */
  selected: string | null
}

export interface ViewPaintOptions<L> {
  layout: L
  timeline: LifeTimeline
  ink: LifeInk
  colourOf: (language: string | null) => string
  /** the only names the labels receive */
  name: RepoNamer
  /** the person, whose own repos are labelled without the owner */
  login: string
  /**
   * the labels before these (a theme switch, the privacy toggle), of the same view: the new ones
   * take over their spots
   */
  prevLabels?: LifeLabelSet | null
  /** measures a label's text as drawn; measureLabel when left out */
  measure?: (text: string) => number
  /**
   * the time-lapse grows the view to its progress (0..1) and draws its caption over it, naming
   * title (the login when left out). While it is live (playing, recording or scrubbing; live when
   * left out) every frame asks for the next, so a recording gets a steady stream of them; otherwise
   * a frame asks for another only while the labels settle or the progress has moved since the last
   * one, so a paused time-lapse leaves the canvas still
   */
  timelapse?: { progress: { readonly current: number | null }; title?: string; live?: boolean } | null
  state: () => LifePaintState
  /** the camera moved under a still pointer, or the labels moved under it: the hover follows */
  setHover?: (hover: LifeHover) => void
  /** the pointer over the canvas while no button is down; null otherwise */
  pointer?: () => { x: number; y: number } | null
}

/** The life garden's painter options. */
export type LifePaintOptions = ViewPaintOptions<LifeGardenLayout>

export interface LifePainter {
  labels: LifeLabelSet
  /** useLifeCanvas's paint: one frame; true asks for another */
  paint: LifePaint
  /** what is under (x, y) on what the last frame drew: a label, a repo, a milestone or a day; null before the first frame */
  hitAt: (x: number, y: number) => LifeHover
  /** the repo a click at (x, y) picks: a repo or its label (a plate row picks the repo it names); null for none */
  pickAt: (x: number, y: number) => string | null
}

/** What the last frame drew from: hit tests work on what is on screen. */
interface Frame<G> {
  camera: LifeCamera
  view: LifeViewport
  geoms: G
  /** the boxes labels kept off in this view */
  keepOut: Float32Array
  /** the time-lapse's day: repos not sown by then were not drawn. null: fully grown. */
  at: number | null
}

/** A view's painter: its scene driven frame by frame, with the labels and the time-lapse's caption over it. */
export function makeViewPaint<L extends LifeViewModel, G>(scene: LifeScene<L, G>, opts: ViewPaintOptions<L>): LifePainter {
  const { layout, timeline, ink, colourOf, state, timelapse = null } = opts
  const items = scene.items(layout)
  const labels = new LifeLabelSet(
    { keys: items.map((item) => item.key), order: scene.labelOrder(layout) },
    labelNames(items, timeline, opts.name, opts.login),
    opts.measure,
    opts.prevLabels ?? null,
  )
  const indexOf = (key: string | null): number => (key !== null ? (layout.byKey.get(key) ?? -1) : -1)
  const sown = (i: number, at: number | null) => !(at !== null && items[i].startDay > at)
  let frame: Frame<G> | null = null
  /** the time-lapse progress the last frame drew; null before the first */
  let drawnProgress: number | null = null

  /** the repos a hit skips: the hidden ones, and those the time-lapse has not sown yet, which were not drawn */
  const notDrawn = (hidden: ReadonlySet<string>, at: number | null): ReadonlySet<string> => {
    if (at === null) return hidden
    const out = new Set(hidden)
    for (const item of items) if (item.startDay > at) out.add(item.key)
    return out
  }

  const hitAt = (x: number, y: number): LifeHover => {
    if (frame === null) return null
    const { hover, hidden } = state()
    const { at } = frame
    const label = labels.hit(x, y, hover?.kind === 'repo' ? indexOf(hover.key) : -1)
    if (label >= 0 && sown(label, at)) return { kind: 'repo', key: items[label].key }
    return scene.hit(layout, frame.geoms, frame.camera, frame.view, x, y, notDrawn(hidden, at), at)
  }

  const pickAt = (x: number, y: number): string | null => {
    const label = labels.click(x, y)
    if (label >= 0) return items[label].key
    const hit = hitAt(x, y)
    return hit?.kind === 'repo' ? hit.key : null
  }

  const paint: LifePaint = (ctx, view, camera, dtMs) => {
    const { hidden, hover, selected } = state()
    const prev = frame
    const same = prev !== null && prev.view === view
    const geoms = same && prev.camera === camera ? prev.geoms : scene.geoms(layout, camera, view)
    const keepOut = same ? prev.keepOut : scene.keepOut(layout, view)
    const cameraMoving = same && prev.camera !== camera
    const p = timelapse ? Math.min(1, Math.max(0, timelapse.progress.current ?? 1)) : 1
    const at = timelapse ? dayAt(timeline.clock, p) : null
    const moved = !Object.is(p, drawnProgress)
    drawnProgress = p
    frame = { camera, view, geoms, keepOut, at }
    scene.paint(ctx, { layout, timeline, geoms, camera, view, ink, colourOf, hidden, hover, selected, at })
    const hovered = hover?.kind === 'repo' ? indexOf(hover.key) : -1
    const picked = indexOf(selected)
    const forced = [hovered, picked].filter((i) => i >= 0)
    // a hidden repo, or one not sown yet, has no label and blocks none
    const anchor = (i: number, out: Float32Array) => !hidden.has(items[i].key) && sown(i, at) && scene.anchor(layout, geoms, i, at, out)
    const busy = labels.update({ anchor, keepOut, view, dtMs, cameraMoving, forced, explore: hovered })
    labels.draw(ctx, ink, (i) => scene.itemColour(layout, i, ink, colourOf), picked)
    // the time-lapse's caption over everything, so a recording carries it
    if (timelapse) paintLapseHud(ctx, view, ink, lapseCaption(timeline, { plants: items }, p, hidden), p, timelapse.title ?? opts.login)
    // the camera moved under a still pointer: the hover follows what is under it now
    const pointer = opts.pointer?.() ?? null
    if (pointer !== null && (cameraMoving || busy)) opts.setHover?.(hitAt(pointer.x, pointer.y))
    // a paused time-lapse asks for frames only while its progress moves (the play's last step, a scrub)
    return busy || (timelapse !== null && (timelapse.live !== false || moved))
  }

  return { labels, paint, hitAt, pickAt }
}

/** Leaves are a language colour turned green: blended once per colour per theme (its garden ink). */
const leafCache = new WeakMap<GardenInk, (colour: string) => string>()

function leafOf(garden: GardenInk): (colour: string) => string {
  let of = leafCache.get(garden)
  if (of === undefined) {
    const leaves = new Map<string, string>()
    of = (colour) => {
      let leaf = leaves.get(colour)
      if (leaf === undefined) {
        // a palette colour need not be hex (Obsidian's cycles in hsl), which leafColour cannot blend
        try {
          leaf = leafColour(colour, garden)
        } catch {
          leaf = colour
        }
        leaves.set(colour, leaf)
      }
      return leaf
    }
    leafCache.set(garden, of)
  }
  return of
}

/** The life garden's scene (PROFILE_SPEC.md section 5, view 1): its plants, drawn, hit and labelled by the garden's own modules. */
export const GARDEN_SCENE: LifeScene<LifeGardenLayout, PlantGeom[]> = {
  items: (layout) => layout.plants,
  geoms: (layout, camera, view) => layout.plants.map((plant) => plantGeom(plant, camera, view)),
  paint: (ctx, input) => paintLifeGarden(ctx, { ...input, leafOf: leafOf(input.ink.garden) }),
  hit: (layout, geoms, camera, view, sx, sy, notDrawn) => hitLifeGarden(layout, geoms, camera, view, sx, sy, notDrawn),
  anchor: gardenAnchor,
  labelOrder: (layout) => gardenLabelItems(layout).order,
  keepOut: (_layout, view) => groundKeepOut(view),
  itemColour: (layout, i, ink, colourOf) => plantColour(layout.plants[i], ink, colourOf),
}

/** The life garden's painter, as LifeGarden has always made it. */
export function makeLifePaint(opts: LifePaintOptions): LifePainter {
  return makeViewPaint(GARDEN_SCENE, opts)
}
