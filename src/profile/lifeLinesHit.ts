/**
 * What the pointer is over in the life lines: a start marker's repo, a station, a line (its body, as
 * far as the time-lapse has drawn it), a milestone marker on the horizon, or a day anywhere else.
 * Labels are hit before this, by the label placer that drew them.
 *
 * Inside a start marker's dot its repo wins, so a click there selects it even where a station rings
 * the marker; elsewhere stations come first, as they are drawn over the lines. A line (its drawn
 * stretch, or its start marker) is looked for only on the tracks within reach of the pointer, however
 * close a crowded plot packs them, the nearest winning and the earlier in paint order on a tie; lines
 * in notDrawn (the hidden ones, and those the time-lapse has not sown) are skipped, as they are not
 * drawn. Geometry is lifeLinesGeometry's, the same the painter draws with.
 */
import type { LifeCamera, LifeHover, LifeViewport } from './lifeTypes'
import { axisHover, onCanvas } from './lifeView'
import type { LifeLine, LifeLinesLayout, LineStation } from './lifeLinesLayout'
import { MARKER_RING_PX, drawnTo, rooted, stationMark, stationReached, stationRingRadius, type LinesGeom } from './lifeLinesGeometry'

/** A station's disc is hit within this distance of its centre... */
export const STATION_HIT_PX = 6
/** ...and its ring round a start marker this far beyond the ring's outer edge (outside the marker's dot). */
const STATION_RING_SLOP_PX = 1.5
/** A line is hit this far beyond the half width of its heaviest stroke, and at least MIN_LINE_HIT_PX from its middle. */
const LINE_SLOP_PX = 3
const MIN_LINE_HIT_PX = 4

/** The first index in lines (sorted by track) whose track is at least track. */
function firstOnTrack(lines: ReadonlyArray<LifeLine>, track: number): number {
  let lo = 0
  let hi = lines.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (lines[mid].track < track) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The hover at screen (sx, sy). g is linesGeom's for this camera and view. Off the canvas, or outside
 * the life's days away from anything drawn, it is null.
 */
export function hitLifeLines(
  layout: LifeLinesLayout,
  g: LinesGeom,
  camera: LifeCamera,
  view: LifeViewport,
  sx: number,
  sy: number,
  notDrawn: ReadonlySet<string>,
  at: number | null,
): LifeHover {
  if (!onCanvas(view, sx, sy)) return null
  const { lines } = layout
  const screenX = (x: number) => camera.tx + x * camera.k

  // the nearest line on the tracks within reach of the pointer, the earlier in paint order on a tie,
  // and whether the pointer is inside a start marker's dot
  let best = -1
  let onMarker = false
  if (layout.tracks > 0 && g.pitch > 0) {
    const reach = Math.max(MIN_LINE_HIT_PX, g.activePx[2] / 2 + LINE_SLOP_PX)
    const markerReach = g.stationR + LINE_SLOP_PX
    const span = Math.ceil(Math.max(reach, markerReach) / g.pitch)
    const track = Math.floor((sy - (g.trackY[0] - g.pitch / 2)) / g.pitch)
    const from = Math.max(0, track - span)
    const to = Math.min(layout.tracks - 1, track + span)
    let bestD = Infinity
    if (from <= to) {
      for (let i = firstOnTrack(lines, from); i < lines.length && lines[i].track <= to; i++) {
        const line = lines[i]
        if (notDrawn.has(line.key)) continue
        const end = drawnTo(line, layout.startDay, at)
        const drawn = end > line.x0
        const marked = rooted(line, at)
        // on its root day the time-lapse draws a line's start marker before any of its stretch
        if (!drawn && !marked) continue
        const y = g.trackY[line.track]
        // the distance to the line's drawn stretch, as a segment along its track, and to its start marker
        let d = Infinity
        let near = false
        if (drawn) {
          const a = screenX(line.x0)
          const b = screenX(end)
          const dx = sx < a ? a - sx : sx > b ? sx - b : 0
          d = Math.hypot(dx, sy - y)
          near = d <= reach
        }
        if (marked) {
          const m = Math.hypot(sx - screenX(line.x), sy - y)
          onMarker ||= m <= g.stationR
          near ||= m <= markerReach
          d = Math.min(d, m)
        }
        if (near && d < bestD) {
          best = i
          bestD = d
        }
      }
    }
  }
  if (onMarker && best >= 0) return { kind: 'repo', key: lines[best].key }

  // the nearest station on a line drawn, the earliest on a tie: a disc, or a ring round a start marker
  let station: LineStation | null = null
  let nearest = Infinity
  const ringReach = Math.max(STATION_HIT_PX, stationRingRadius(g) + MARKER_RING_PX / 2 + STATION_RING_SLOP_PX)
  for (const s of layout.stations) {
    const line = lines[s.line]
    if (line === undefined || notDrawn.has(line.key) || !stationReached(s.x, layout.startDay, at)) continue
    const mark = stationMark(line, s, g, at)
    const d = Math.hypot(sx - mark.x, sy - mark.y)
    if (d <= (mark.ring ? ringReach : STATION_HIT_PX) && d < nearest) {
      station = s
      nearest = d
    }
  }
  if (station) return { kind: 'day', day: station.day, milestone: station.index }

  if (best >= 0) return { kind: 'repo', key: lines[best].key }
  return axisHover(layout, camera, view, sx, sy)
}
