/**
 * The canvas every person-mode view shares (PROFILE_SPEC.md section 5): life lines, the
 * constellation or a console view, as def says, along one time axis. Hover a repo or its label for the repo,
 * or the ground for the day (the inspector follows the hover in usePersonStore), click to select,
 * drag or scroll to move through time.
 *
 * It reads and writes usePersonStore's hidden repos, hover, selection and focus. The canvas paints
 * from the store directly, so a hover repaints without a render; the frame, the hit test and the
 * click are makeViewPaint's (lifePaint.ts), which the tests drive too. Every repo name it draws
 * comes from the name prop, the view's RepoNamer, and none ever reaches the DOM: the canvas's label
 * names the view, the person, their repo count and years only.
 *
 * A new view is a new painter on the same canvas: every view lays the life out over the same days,
 * so the camera (its zoom and pan) carries over, the selected repo stays in view, and a recording
 * of the canvas keeps going. Only the labels start afresh, as they sit elsewhere in another view.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { Theme } from '../theme/themes'
import type { LifeTimeline } from './timeline'
import type { LifeHover, RepoNamer } from './lifeTypes'
import { viewInk, type LifeViewDef, type LifeViewModel } from './lifeView'
import { lifeInk } from './lifeInk'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP } from './lifeGeometry'
import { revealLifeCamera } from './lifeCamera'
import { makeViewPaint } from './lifePaint'
import type { LifeLabelSet } from './useLifeLabels'
import { useLifeCanvas } from './useLifeCanvas'
import { usePersonStore } from './usePersonStore'

/** the glide that brings a repo or a day the panel asked for into view */
const FOCUS_GLIDE_MS = 420

export interface LifeViewProps<L extends LifeViewModel = LifeViewModel> {
  /** the view on show */
  def: LifeViewDef<L>
  /** def's layout of the timeline */
  layout: L
  timeline: LifeTimeline
  theme: Theme
  colourOf: (language: string | null) => string
  /** the only names the canvas ever receives */
  name: RepoNamer
  /** the person, for the canvas's label (and the time-lapse caption when it names no title) */
  login: string
  /**
   * the time-lapse draws the view up to its progress (0..1), which the controls write every frame,
   * under a caption naming title; keep its identity while it is on, as the painter is made per value
   */
  timelapse?: { progress: RefObject<number>; title: string; live?: boolean } | null
}

const setHover = (hover: LifeHover) => usePersonStore.getState().setHover(hover)

/** The canvas's label: "<view> of <login>: N repos, Y to Z". */
export function lifeViewLabel(title: string, login: string, count: number, timeline: Pick<LifeTimeline, 'eras'>): string {
  const first = timeline.eras[0]?.year
  const last = timeline.eras[timeline.eras.length - 1]?.year
  const years = first === undefined || last === undefined ? '' : first === last ? `, ${first}` : `, ${first} to ${last}`
  return `${title} of ${login}: ${count} repo${count === 1 ? '' : 's'}${years}`
}

export default function LifeView<L extends LifeViewModel>({ def, layout, timeline, theme, colourOf, name, login, timelapse = null }: LifeViewProps<L>) {
  const ink = useMemo(() => viewInk(lifeInk(theme), def), [theme, def])
  /** the pointer over the canvas while no button is down; null otherwise */
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  /** the last painter's labels and its view: the next one takes over their spots by repo key, in the same view only */
  const labelsRef = useRef<{ id: LifeViewDef['id']; labels: LifeLabelSet } | null>(null)
  const painter = useMemo(
    () =>
      makeViewPaint(def.scene, {
        layout,
        timeline,
        ink,
        colourOf,
        name,
        login,
        prevLabels: labelsRef.current?.id === def.id ? labelsRef.current.labels : null,
        timelapse,
        state: usePersonStore.getState,
        setHover,
        pointer: () => pointerRef.current,
      }),
    [def, layout, timeline, ink, colourOf, name, login, timelapse],
  )
  useEffect(() => {
    labelsRef.current = { id: def.id, labels: painter.labels }
  }, [def, painter])
  const { hitAt, pickAt } = painter

  // a new person (or a life that now starts elsewhere) is fitted; a refetch of the same one, or
  // another view of it, keeps the camera
  const canvas = useLifeCanvas({
    days: layout.days,
    top: VIEW_TOP,
    ground: VIEW_GROUND,
    side: VIEW_SIDE,
    paint: painter.paint,
    fitKey: `${login.toLowerCase()} ${layout.startDay}`,
  })
  const { invalidate, getCamera, getView, setCamera, wasDrag, fit } = canvas

  // the time-lapse opens on the whole life, so nothing appears off screen and a recording starts on the whole horizon
  const lapsing = timelapse !== null
  useEffect(() => {
    if (lapsing) fit(0)
    // only the time-lapse opening fits the camera; fit is new with every view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lapsing])

  // hiding a repo, the hover and the selection repaint without a render
  useEffect(
    () =>
      usePersonStore.subscribe((s, prev) => {
        if (s.hidden !== prev.hidden || s.hover !== prev.hover || s.selected !== prev.selected) invalidate()
      }),
    [invalidate],
  )

  // the panel asked for a repo or a day: glide it into view
  const focus = usePersonStore((s) => s.focus)
  useEffect(() => {
    if (focus === null) return
    const camera = getCamera()
    const view = getView()
    if (camera === null || view === null) return
    let x = focus.kind === 'day' ? focus.day - layout.startDay + 0.5 : Number.NaN
    if (focus.kind === 'repo') {
      const i = layout.byKey.get(focus.key)
      const item = i === undefined ? undefined : def.scene.items(layout)[i]
      if (item === undefined) return
      x = item.x
    }
    setCamera(revealLifeCamera(camera, x, layout.days, view), FOCUS_GLIDE_MS)
    // only a new focus request moves the camera, not a new layout, view or size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const pointAt = (e: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    // no hover while a drag pans the camera
    if (e.buttons !== 0) {
      pointerRef.current = null
      return
    }
    const point = pointAt(e)
    pointerRef.current = point
    const hover = hitAt(point.x, point.y)
    setHover(hover)
    e.currentTarget.style.cursor = hover?.kind === 'repo' ? 'pointer' : ''
  }

  const onPointerLeave = () => {
    pointerRef.current = null
    setHover(null)
  }

  // a click on a repo or its label selects it (again: deselects); anywhere else clears the selection
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (wasDrag()) return
    const { x, y } = pointAt(e)
    const key = pickAt(x, y)
    const store = usePersonStore.getState()
    store.select(key !== null && key !== store.selected ? key : null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key !== 'Escape') return
    usePersonStore.getState().clearSelection()
  }

  const label = lifeViewLabel(def.title, login, def.scene.items(layout).length, timeline)

  return (
    <div ref={canvas.hostRef} className="h-full w-full">
      <canvas
        ref={canvas.canvasRef}
        role="img"
        aria-label={label}
        tabIndex={0}
        style={{ display: 'block', touchAction: 'none' }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
