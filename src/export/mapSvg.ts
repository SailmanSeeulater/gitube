/**
 * The map as an SVG: on its own (to put in a README), or framed as a transit poster with the repo
 * as its title, the stats, a key of its lines and the date. Drawn from the same MetroLayout the
 * canvas paints (a metro map or a coral), in the active theme, with the same station glyphs, so a
 * saved map looks like the one on screen at its natural size.
 *
 * Pure: strings in, strings out, no DOM (image.ts turns a poster into a PNG). Every text is escaped;
 * fonts are system stacks, since an SVG drawn as an image cannot load web fonts.
 */
import type { MetroLayout } from '../graph/metro'
import {
  METRO_LINE_WIDTH,
  METRO_SCALE,
  bleachMix,
  bleachStep,
  buildMetroView,
  metroCommitGlyph,
  metroStationRadius,
} from '../components/metroView'
import { releaseText } from '../components/releases'
import { blendHex, type Theme } from '../theme/themes'
import type { GraphNode, RepoData, ViewMode } from '../types'

export interface MapSvgInput {
  /** the layout of the graph on screen, preferably with its labels placed (MetroOptions.labels) */
  layout: MetroLayout
  /** the graph's nodes (the one the layout was made from) */
  nodes: readonly GraphNode[]
  /** branch name -> colour in the active theme */
  palette: Readonly<Record<string, string>>
  theme: Theme
  data: Pick<RepoData, 'owner' | 'repo' | 'defaultBranch' | 'branches' | 'commits' | 'language' | 'tags'>
  /** when it was drawn (the poster's date, and how long ago each line moved) */
  now: Date
  /** what the poster calls the drawing */
  layoutName: 'metro' | 'coral' | string
  viewMode: ViewMode
}

export interface SvgPicture {
  svg: string
  width: number
  height: number
}

export const SITE = 'gitube.latesailor.dev'
const SANS = "Inter, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace"

/** Branch names in the layout's own font size (lane units), drawn in a monospace face so its width estimate holds. */
const LABEL_PX = 0.375 * METRO_SCALE
const RELEASE_FONT = 10
const RELEASE_H = 16
const RELEASE_PAD = 6
const RELEASE_GAP = 4
const RELEASE_HALF_W = 3.5
const RELEASE_HALF_H = 6
const POLYP_GLOW = 5
const POLYP_ALPHA = 0.28
/** a tip name drawn without a layout label (the coral places none) is cut to this many characters */
const TIP_CHARS = 28
const MONO_CHAR = 0.6

type Box = [number, number, number, number]

/** Text safe inside an SVG element or attribute. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'))
}

const n = (v: number) => (Math.round(v * 100) / 100).toString()

function overlaps(boxes: readonly Box[], b: Box): boolean {
  return boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

interface DrawnMap {
  /** SVG elements in graph units */
  body: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The map's elements, in the canvas's own units (METRO_SCALE per lane), and how far they reach. */
function drawMap(input: MapSvgInput): DrawnMap {
  const { layout, theme, palette } = input
  const view = buildMetroView(layout, input.nodes)
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const b = layout.bounds
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const X = (x: number) => (x - cx) * METRO_SCALE
  const Y = (y: number) => (y - cy) * METRO_SCALE
  const bleached = (colour: string, bleach: number) => {
    const step = bleachStep(bleach)
    return step === 0 ? colour : blendHex(theme.fallback, colour, bleachMix(step))
  }
  const colourOf = (branch: string) => palette[branch] ?? theme.fallback
  const out: string[] = []
  const boxes: Box[] = []
  let [minX, maxX] = view.bbox.x
  let [minY, maxY] = view.bbox.y
  const reach = (box: Box) => {
    minX = Math.min(minX, box[0])
    minY = Math.min(minY, box[1])
    maxX = Math.max(maxX, box[2])
    maxY = Math.max(maxY, box[3])
  }

  // truncated history: a dashed lead-in before each root
  for (const s of view.stubs) {
    out.push(
      `<line x1="${n(s.x0)}" y1="${n(s.y0)}" x2="${n(s.x1)}" y2="${n(s.y1)}" stroke="${colourOf(s.colorBranch)}" stroke-width="1.2" stroke-dasharray="4 4" opacity="${theme.metroStubAlpha}"/>`,
    )
  }
  // lines: muted and dashed first, lane changes next, plain runs on top (the view's order)
  for (const r of view.routes) {
    const pts: string[] = []
    for (let k = 0; k < r.pts.length; k += 2) pts.push(`${n(r.pts[k])},${n(r.pts[k + 1])}`)
    const width = (r.muted || r.dashed ? METRO_LINE_WIDTH * 0.65 : METRO_LINE_WIDTH) * r.weight
    const alpha = r.muted ? theme.metroMutedAlpha : theme.metroLineAlpha
    out.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${bleached(colourOf(r.colorBranch), r.bleach)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round" opacity="${alpha}"${r.dashed ? ' stroke-dasharray="5 4"' : ''}/>`,
    )
  }
  // run markers: a break across the line (two bars over a cut in the canvas colour), '+N' beside it
  for (const badge of view.badges) {
    const half = Math.max(3.5, (METRO_LINE_WIDTH * badge.weight) / 2 + 1)
    const bars: string[] = []
    for (const side of [-0.5, 0.5]) {
      const bx = badge.x + badge.dx * 3.5 * side
      const by = badge.y + badge.dy * 3.5 * side
      bars.push(`M${n(bx + badge.dy * half)} ${n(by - badge.dx * half)}L${n(bx - badge.dy * half)} ${n(by + badge.dx * half)}`)
    }
    const d = bars.join('')
    out.push(`<path d="${d}" stroke="${theme.derived.textHalo}" stroke-width="3.5"/><path d="${d}" stroke="${theme.derived.runMark}" stroke-width="1.5"/>`)
  }

  // stations, as RepoGraph paints them at a zoom of 1
  const ring = 1.5
  for (const [id, p] of view.targets) {
    const node = nodeById.get(id)
    if (!node) continue
    const kind = view.stations.get(id)
    const faded = view.bleach?.get(id) ?? 0
    const colour = bleached(colourOf(node.owner), faded)
    const bead = kind === 'commit' && !node.isTip ? metroCommitGlyph(1, view.commitGap.get(id)) : null
    const r = bead ? bead.r : metroStationRadius(kind, node.isTip)
    const x = n(p.x)
    const y = n(p.y)
    if (node.isTip && view.polyps?.has(id)) out.push(`<circle cx="${x}" cy="${y}" r="${n(r + POLYP_GLOW)}" fill="${colour}" opacity="${POLYP_ALPHA}"/>`)
    if (node.isTip) {
      out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${colour}" stroke="${theme.stationRing}" stroke-width="${ring}"/>`)
    } else if (node.tags && kind !== 'interchange' && kind !== 'origin') {
      // across its line: upright on a metro map, level on a coral's rising stalk
      const [hw, hh] = view.wholeFit ? [RELEASE_HALF_H, RELEASE_HALF_W] : [RELEASE_HALF_W, RELEASE_HALF_H]
      const round = Math.min(hw, hh)
      out.push(
        `<rect x="${n(p.x - hw)}" y="${n(p.y - hh)}" width="${2 * hw}" height="${2 * hh}" rx="${round}" fill="${theme.stationRing}"/>`,
        `<rect x="${n(p.x - hw + ring)}" y="${n(p.y - hh + ring)}" width="${2 * (hw - ring)}" height="${2 * (hh - ring)}" rx="${round - ring}" fill="${theme.derived.stationCore}"/>`,
      )
    } else if (kind === 'interchange') {
      out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${theme.stationRing}"/><circle cx="${x}" cy="${y}" r="${n(r * 0.5)}" fill="${theme.derived.stationCore}"/>`)
    } else if (kind === 'origin') {
      out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${theme.derived.stationCore}" stroke="${colour}" stroke-width="${ring}"/>`)
    } else if (bead) {
      out.push(`<circle cx="${x}" cy="${y}" r="${n(bead.r)}" fill="${colour}"/><circle cx="${x}" cy="${y}" r="${n(bead.core)}" fill="${theme.derived.stationCore}"/>`)
    } else {
      out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${colour}"/>`)
    }
  }

  // branch names: where the layout placed them, else (the coral places none) right of each tip
  const label = (text: string, x: number, y: number, angle: number, width: number) => {
    out.push(
      `<text transform="translate(${n(x)} ${n(y)})${angle ? ` rotate(${n(angle)})` : ''}" font-family="${MONO}" font-size="${n(LABEL_PX)}" fill="${theme.text}" stroke="${theme.derived.textHalo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${escapeXml(text)}</text>`,
    )
    // the text's box, turned with it
    const rad = (angle * Math.PI) / 180
    const corners = [
      [0, -LABEL_PX * 0.8],
      [width, -LABEL_PX * 0.8],
      [0, LABEL_PX * 0.25],
      [width, LABEL_PX * 0.25],
    ].map(([u, v]) => [x + u * Math.cos(rad) - v * Math.sin(rad), y + u * Math.sin(rad) + v * Math.cos(rad)])
    const box: Box = [
      Math.min(...corners.map((c) => c[0])),
      Math.min(...corners.map((c) => c[1])),
      Math.max(...corners.map((c) => c[0])),
      Math.max(...corners.map((c) => c[1])),
    ]
    boxes.push(box)
    reach(box)
  }
  if (layout.labels.length > 0) {
    for (const l of layout.labels) label(l.text, X(l.tx), Y(l.ty), l.angle, l.width * METRO_SCALE)
  } else {
    for (const [id, p] of view.targets) {
      const node = nodeById.get(id)
      if (!node?.isTip) continue
      const text = cut(node.tips[0] ?? '', TIP_CHARS) + (node.tips.length > 1 ? ` +${node.tips.length - 1}` : '')
      label(text, p.x + metroStationRadius(view.stations.get(id), true) + 5, p.y + LABEL_PX * 0.35, 0, text.length * LABEL_PX * MONO_CHAR)
    }
  }

  // releases: a pill under (else over) each tagged station, newest first, where it covers nothing
  const tagged = input.nodes
    .filter((node) => node.tags !== undefined && node.tags.length > 0 && view.targets.has(node.id))
    .sort((a, c) => (a.commit.date < c.commit.date ? 1 : a.commit.date > c.commit.date ? -1 : a.id < c.id ? -1 : 1))
  const clear = 7
  for (const node of tagged) {
    const at = view.targets.get(node.id)
    if (!at) continue
    const text = releaseText(node.tags ?? [])
    const w = text.length * RELEASE_FONT * MONO_CHAR + 2 * RELEASE_PAD
    const gap = Math.max(metroStationRadius(view.stations.get(node.id), node.isTip), RELEASE_HALF_H) + RELEASE_GAP
    // under the station, else over it; on a coral, whose stalk rises, right of it, else left
    const spots = view.wholeFit
      ? [
          [at.x + gap, at.y - RELEASE_H / 2],
          [at.x - gap - w, at.y - RELEASE_H / 2],
        ]
      : [
          [at.x - w / 2, at.y + gap],
          [at.x - w / 2, at.y - gap - RELEASE_H],
        ]
    let box: Box | null = null
    for (const [x0, y0] of spots) {
      const candidate: Box = [x0, y0, x0 + w, y0 + RELEASE_H]
      if (overlaps(boxes, candidate)) continue
      let covers = false
      for (const [id, p] of view.targets) {
        if (id !== node.id && p.x > candidate[0] - clear && p.x < candidate[2] + clear && p.y > candidate[1] - clear && p.y < candidate[3] + clear) {
          covers = true
          break
        }
      }
      if (!covers) {
        box = candidate
        break
      }
    }
    if (!box) continue
    boxes.push(box)
    reach(box)
    out.push(
      `<rect x="${n(box[0])}" y="${n(box[1])}" width="${n(w)}" height="${RELEASE_H}" rx="${RELEASE_H / 2}" fill="${theme.badgeBg}" stroke="${theme.accent}" stroke-width="1.2"/>`,
      `<text x="${n((box[0] + box[2]) / 2)}" y="${n(box[1] + RELEASE_H / 2 + 0.5)}" font-family="${MONO}" font-size="${RELEASE_FONT}" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${theme.text}">${escapeXml(text)}</text>`,
    )
  }

  // the '+N' beside each run marker, where no name or release took the spot (those say more)
  for (const badge of view.badges) {
    if (badge.textY === null) continue
    const tx = badge.textX ?? badge.x
    const half = badge.text.length * 2.6 + 2
    if (overlaps(boxes, [tx - half, badge.textY - 5, tx + half, badge.textY + 5])) continue
    out.push(
      `<text x="${n(tx)}" y="${n(badge.textY)}" font-family="${SANS}" font-size="9" text-anchor="middle" dominant-baseline="central" fill="${theme.derived.runMark}" stroke="${theme.derived.textHalo}" stroke-width="2.5" paint-order="stroke">${escapeXml(badge.text)}</text>`,
    )
  }

  const margin = 8
  return { body: out.join(''), minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }
}

/** The map on its own, framed with the repo's name and where it came from: an image for a README. */
export function mapSvg(input: MapSvgInput): SvgPicture {
  const map = drawMap(input)
  const { theme, data } = input
  const pad = 32
  const band = 40
  const mapW = map.maxX - map.minX
  const mapH = map.maxY - map.minY
  const width = Math.ceil(Math.max(mapW + 2 * pad, 420))
  const height = Math.ceil(mapH + 2 * pad + band)
  const title = `${data.owner}/${data.repo}`
  const left = (width - mapW) / 2 - map.minX
  return {
    width,
    height,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${title}: a tube map of its branches, drawn by gitube`)}">` +
      `<title>${escapeXml(title)} · gitube</title>` +
      `<rect width="${width}" height="${height}" fill="${theme.canvas}"/>` +
      `<g transform="translate(${n(left)} ${n(pad - map.minY)})">${map.body}</g>` +
      `<line x1="0" y1="${height - band}" x2="${width}" y2="${height - band}" stroke="${theme.panelBorder}"/>` +
      `<text x="${pad / 2 + 4}" y="${height - band / 2}" font-family="${SANS}" font-size="13" font-weight="600" dominant-baseline="central" fill="${theme.text}">${escapeXml(title)}</text>` +
      `<text x="${width - pad / 2 - 4}" y="${height - band / 2}" font-family="${SANS}" font-size="12" text-anchor="end" dominant-baseline="central" fill="${theme.muted}">${SITE}</text>` +
      `</svg>`,
  }
}

/** '3 days ago', '5 months ago', '2 years ago' (or 'today'), from now. */
export function ago(iso: string, now: Date): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((now.getTime() - t) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30.44)
  if (months < 18) return `${months} months ago`
  return `${Math.round(days / 365.25)} years ago`
}

export interface PosterLine {
  name: string
  colour: string
  detail: string
}

/** The poster's key: the default line first, then the others by when they last moved, newest first. */
export function posterLines(input: Pick<MapSvgInput, 'nodes' | 'palette' | 'theme' | 'data' | 'now'>): PosterLine[] {
  const drawn = new Set<string>()
  for (const node of input.nodes) for (const tip of node.tips) drawn.add(tip)
  const branches = input.data.branches.filter((branch) => drawn.has(branch.name))
  const isDefault = (name: string) => name === input.data.defaultBranch
  branches.sort((a, c) => Number(isDefault(c.name)) - Number(isDefault(a.name)) || (a.tipDate < c.tipDate ? 1 : a.tipDate > c.tipDate ? -1 : 0))
  return branches.map((branch) => {
    const moved = ago(branch.tipDate, input.now)
    const detail = isDefault(branch.name)
      ? `the main line${moved ? ` · moved ${moved}` : ''}`
      : `${branch.aheadBy} ahead${moved ? ` · moved ${moved}` : ''}`
    return { name: branch.name, colour: input.palette[branch.name] ?? input.theme.fallback, detail }
  })
}

const POSTER_MIN_W = 1400
const POSTER_MAX_W = 3600
const POSTER_PAD = 96
const KEY_COL_W = 420
const KEY_ROW_H = 46
const KEY_MAX = 24

/**
 * The map as a transit poster: the repo as its title and its numbers under it, the map, a key of its
 * lines (when each last moved), and the date and where it was drawn at the foot. As wide as the map
 * needs, between POSTER_MIN_W and POSTER_MAX_W (a longer map is scaled down to fit).
 */
export function posterSvg(input: MapSvgInput): SvgPicture {
  const map = drawMap(input)
  const { theme, data } = input
  const mapW = map.maxX - map.minX
  const mapH = map.maxY - map.minY
  const width = Math.round(Math.min(POSTER_MAX_W, Math.max(POSTER_MIN_W, mapW + 2 * POSTER_PAD)))
  const scale = Math.min(1, (width - 2 * POSTER_PAD) / mapW)

  const lines = posterLines(input)
  const shown = lines.slice(0, KEY_MAX)
  const cols = Math.max(1, Math.floor((width - 2 * POSTER_PAD) / KEY_COL_W))
  const rows = Math.ceil(shown.length / cols) + (lines.length > KEY_MAX ? 1 : 0)

  const headerH = 210
  const mapTop = headerH
  const mapBoxH = mapH * scale
  const keyTop = mapTop + mapBoxH + 80
  const keyH = 44 + rows * KEY_ROW_H
  const footTop = keyTop + keyH + 36
  const height = Math.ceil(footTop + 72)

  const commits = Object.keys(data.commits).length
  const releases = data.tags?.length ?? 0
  const stats = [
    data.language,
    `${lines.length} line${lines.length === 1 ? '' : 's'}`,
    `${commits.toLocaleString('en-US')} commit${commits === 1 ? '' : 's'}`,
    releases > 0 ? `${releases} release${releases === 1 ? '' : 's'}` : null,
    `${input.layoutName === 'coral' ? 'grown as a coral' : 'drawn as a metro map'}${input.viewMode === 'full' ? ', every commit' : ''}`,
  ].filter((s): s is string => Boolean(s))
  const date = input.now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const out: string[] = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${data.owner}/${data.repo}: a tube map poster drawn by gitube`)}">`,
    `<title>${escapeXml(`${data.owner}/${data.repo}`)} · gitube</title>`,
    `<rect width="${width}" height="${height}" fill="${theme.canvas}"/>`,
    // a band in the default line's colour along the top, as on a line's own poster
    `<rect width="${width}" height="10" fill="${theme.derived.defaultBranchColour}"/>`,
    `<text x="${POSTER_PAD}" y="118" font-family="${SANS}" font-size="64" font-weight="700" letter-spacing="-1.5" fill="${theme.text}"><tspan fill="${theme.muted}" font-weight="500">${escapeXml(data.owner)}/</tspan>${escapeXml(data.repo)}</text>`,
    `<text x="${POSTER_PAD}" y="164" font-family="${SANS}" font-size="22" fill="${theme.textDim}">${escapeXml(stats.join('  ·  '))}</text>`,
    `<g transform="translate(${n((width - mapW * scale) / 2)} ${n(mapTop)}) scale(${n(scale)}) translate(${n(-map.minX)} ${n(-map.minY)})">${map.body}</g>`,
    `<text x="${POSTER_PAD}" y="${keyTop}" font-family="${SANS}" font-size="15" font-weight="600" letter-spacing="2" fill="${theme.muted}">LINES</text>`,
  )
  shown.forEach((line, i) => {
    const x = POSTER_PAD + (i % cols) * KEY_COL_W
    const y = keyTop + 44 + Math.floor(i / cols) * KEY_ROW_H
    out.push(
      `<line x1="${x}" y1="${y - 6}" x2="${x + 34}" y2="${y - 6}" stroke="${line.colour}" stroke-width="7" stroke-linecap="round"/>`,
      `<text x="${x + 50}" y="${y - 6}" font-family="${MONO}" font-size="16" dominant-baseline="central" fill="${theme.text}">${escapeXml(cut(line.name, 26))}</text>`,
      `<text x="${x + 50}" y="${y + 13}" font-family="${SANS}" font-size="13" dominant-baseline="central" fill="${theme.muted}">${escapeXml(line.detail)}</text>`,
    )
  })
  if (lines.length > KEY_MAX) {
    const y = keyTop + 44 + Math.ceil(shown.length / cols) * KEY_ROW_H
    out.push(`<text x="${POSTER_PAD}" y="${y - 6}" font-family="${SANS}" font-size="14" dominant-baseline="central" fill="${theme.muted}">and ${lines.length - KEY_MAX} more lines</text>`)
  }
  out.push(
    `<line x1="${POSTER_PAD}" y1="${footTop}" x2="${width - POSTER_PAD}" y2="${footTop}" stroke="${theme.panelBorder}"/>`,
    `<text x="${POSTER_PAD}" y="${footTop + 38}" font-family="${SANS}" font-size="16" dominant-baseline="central" fill="${theme.muted}">Drawn ${escapeXml(date)} from github.com/${escapeXml(data.owner)}/${escapeXml(data.repo)}</text>`,
    `<text x="${width - POSTER_PAD}" y="${footTop + 38}" font-family="${SANS}" font-size="16" font-weight="600" text-anchor="end" dominant-baseline="central" fill="${theme.accent}">${SITE}</text>`,
    `</svg>`,
  )
  return { svg: out.join(''), width, height }
}
