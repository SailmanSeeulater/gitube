/**
 * The life poster (PROFILE_SPEC.md section 6, "Time-lapse and export"): one PNG of the view on show
 * (any of person mode's views), framed with the person's avatar, their login, their span of years
 * and their top three milestones, in the active theme's colours (a console view's own, on its dark
 * screen, for a console view).
 *
 * The view is painted again off screen by the canvas's own painter (makeViewPaint), fully grown,
 * with the whole life fitted and no hover or selection, so the poster never carries the screen's
 * zoom, its hover rings and plates, or a half-grown time-lapse. It hides what the panel's eyes hide,
 * and every repo name comes through the screen's namer: a poster shows a private name only while
 * the privacy toggle shows it on screen, and its file is named after the login alone.
 *
 * The avatar is drawn through an <img crossOrigin="anonymous"> (the avatar host allows any origin),
 * never a fetch, which the page's connect-src would block. An avatar that fails to load (no CORS,
 * a timeout) gives a placeholder, never a tainted canvas. The encoder and the download come from
 * the exporters chunk; no JSON is ever saved in person mode. A save that fails says why through
 * posterFailure: the reload card when that chunk could not be loaded, the reason otherwise.
 */
import { track } from '../analytics/umami'
import { isChunkLoadError } from '../lazy/chunk'
import { exportersChunk } from '../lazy/parts'
import type { Theme } from '../theme/themes'
import type { ProfileData } from '../types'
import type { LifeMilestone, LifeTimeline } from './timeline'
import type { LifeInk, LifeViewport, RepoNamer, ShownName } from './lifeTypes'
import { viewInk, type LifeViewDef, type LifeViewModel } from './lifeView'
import { fitLifeCamera } from './lifeCamera'
import { drawLock } from './drawLock'
import { GROUND_MARKS_PX, VIEW_TOP } from './lifeGeometry'
import { lifeInk } from './lifeInk'
import { makeViewPaint, type LifePaintState } from './lifePaint'
import { shownMilestoneRepo } from './privacy'

/** The poster in CSS px... */
export const POSTER_WIDTH = 1600
export const POSTER_HEIGHT = 1000
/** ...drawn at this many pixels per px whatever the screen's ratio: a 3200 x 2000 PNG. */
export const POSTER_SCALE = 2
/** The avatar's size on the poster, in px; it is asked for at POSTER_SCALE times that. */
export const POSTER_AVATAR_PX = 96

/** The frame's margin, which the view's sides keep too. */
const PAD = 56
const AVATAR_GAP = 28
/** The header: the avatar, with room under it. */
const HEADER_PX = PAD + POSTER_AVATAR_PX + 20
/** The milestones and the credit under the view. */
const FOOT_PX = 190
/** Where the view's image goes on the poster: under the header, over the milestones. */
export const POSTER_PLOT = Object.freeze({ x: 0, y: HEADER_PX, width: POSTER_WIDTH, height: POSTER_HEIGHT - HEADER_PX - FOOT_PX })
/** The off-screen view's viewport (every view's): no status strip to clear under its ground marks. */
export const POSTER_GARDEN_VIEW: LifeViewport = Object.freeze({
  width: POSTER_PLOT.width,
  height: POSTER_PLOT.height,
  top: VIEW_TOP,
  ground: GROUND_MARKS_PX + 12,
  side: PAD,
})

/** The labels settle within this many frames (the label placer's watchdog stops it sooner)... */
const SETTLE_FRAMES = 400
/** ...each as long as the canvas host ever lets one be, so they settle in as few as they can. */
const SETTLE_DT_MS = 64
/** An avatar that has not loaded by then is left out. */
const AVATAR_TIMEOUT_MS = 8000
const AVATAR_HOST = 'avatars.githubusercontent.com'

/** The app's label and mono fonts (gardenUtils), spelled out here so person mode takes nothing more from the first download. */
const SANS = 'Inter, ui-sans-serif, system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const LOCK_SIZE = 12
const TWO_PI = Math.PI * 2

/** The poster's milestones: the kinds that say most about a life first. */
const KIND_RANK: ReadonlyArray<LifeMilestone['kind']> = ['top-repo', 'longest-streak', 'first-repo', 'first-pr', 'first-issue', 'language-switch', 'joined']

export interface PosterMilestone {
  /** GitHub's day key, as written */
  day: string
  label: string
  /** the milestone's repo as the screen shows it; null for one without a repo */
  repo: ShownName | null
}

const rankOf = (kind: LifeMilestone['kind']) => {
  const rank = KIND_RANK.indexOf(kind)
  return rank < 0 ? KIND_RANK.length : rank
}
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The top `count` milestones, the same whatever order they come in: ranked by kind (KIND_RANK),
 * then day, then label (only language switches repeat, on distinct days, so no repo name is ever
 * compared), and shown in day order. Each repo goes through the namer.
 */
export function posterMilestones(milestones: readonly LifeMilestone[], name: RepoNamer, count = 3): PosterMilestone[] {
  const byRank = (a: LifeMilestone, b: LifeMilestone) => rankOf(a.kind) - rankOf(b.kind) || order(a.day, b.day) || order(a.label, b.label)
  const picked = [...milestones].sort(byRank).slice(0, Math.max(0, count))
  picked.sort((a, b) => order(a.day, b.day) || byRank(a, b))
  return picked.map((m) => ({ day: m.day, label: m.label, repo: shownMilestoneRepo(m, name) }))
}

/** '2013–2026', or '2026' for a life within one year: from GitHub's day keys, as the status strip writes it. */
export function posterYears(timeline: Pick<LifeTimeline, 'start' | 'today'>): string {
  const from = timeline.start.slice(0, 4)
  const to = timeline.today.slice(0, 4)
  return from === to ? from : `${from}–${to}`
}

/** 'gitube · Oct 25, 2026' */
export function posterCredit(now: Date, locale?: string): string {
  return `gitube · ${now.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}`
}

/**
 * The avatar at px pixels (GitHub serves any size through s=), only from GitHub's avatar host over
 * https; null for anything else. The size differs from the panel's, so this CORS request never
 * meets the panel's plain image in the cache.
 */
export function posterAvatarUrl(avatarUrl: string, px: number): string | null {
  let url: URL
  try {
    url = new URL(avatarUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST || url.username || url.password) return null
  url.searchParams.set('s', String(Math.round(px)))
  return url.toString()
}

/**
 * Loads the avatar as an image the canvas may export: crossOrigin is set before src, so the image
 * is fetched with CORS and leaves the canvas untainted, and no referrer goes with it. Resolves null
 * on an error (a host without CORS fails here), on a timeout, or for a null url. Never a fetch.
 */
export function loadPosterAvatar(url: string | null, timeoutMs = AVATAR_TIMEOUT_MS): Promise<HTMLImageElement | null> {
  if (url === null || typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (value: HTMLImageElement | null) => {
      clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(value)
    }
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => done(img)
    img.onerror = () => done(null)
    timer = setTimeout(() => done(null), timeoutMs)
    img.src = url
  })
}

export interface PosterGarden {
  /** the view's layout */
  layout: LifeViewModel
  /** the view on show */
  view: LifeViewDef
  timeline: LifeTimeline
  ink: LifeInk
  colourOf: (language: string | null) => string
  /** the screen's namer, so the poster shows only what the screen does */
  name: RepoNamer
  login: string
  /** repo keys the panel's eyes hide */
  hidden: ReadonlySet<string>
  /** measures a label's text as drawn; measureLabel when left out */
  measure?: (text: string) => number
}

/**
 * The view as the canvas paints it, fully grown (no time-lapse), the whole life fitted to view,
 * with no hover and no selection whatever the store holds. Paints until the labels have settled
 * (paint() asks for no more frames) or maxFrames, each frame over the last, under the device
 * transform the caller set.
 */
export function paintPosterGarden(ctx: CanvasRenderingContext2D, view: LifeViewport, garden: PosterGarden, maxFrames = SETTLE_FRAMES): void {
  const { layout, timeline, ink, colourOf, name, login, hidden, measure } = garden
  const state: LifePaintState = { hidden, hover: null, selected: null }
  const painter = makeViewPaint(garden.view.scene, { layout, timeline, ink, colourOf, name, login, measure, timelapse: null, state: () => state })
  const camera = fitLifeCamera(layout.days, view)
  for (let frame = 0; frame < Math.max(1, maxFrames); frame++) {
    if (!painter.paint(ctx, view, camera, SETTLE_DT_MS)) break
  }
}

export interface PosterText {
  login: string
  /** posterYears */
  years: string
  milestones: PosterMilestone[]
  /** posterCredit */
  credit: string
}

/** text cut to maxWidth with an ellipsis, measured as drawn */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : ''
}

/** A small diamond, as the views mark a milestone on their horizon. */
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string): void {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.fillStyle = colour
  ctx.fill()
}

/**
 * The poster's frame, in CSS px under the device transform the caller set: the canvas colour over
 * the whole backing store, the header (the avatar clipped to a circle, or a placeholder circle with
 * the login's initial; the login big and the years muted under it), the view's image in the plot,
 * a column per milestone (its day muted in mono, its label, and its repo as shown, with a lock when
 * locked), and the credit bottom right. Colours come from the theme only.
 */
export function paintPosterFrame(
  ctx: CanvasRenderingContext2D,
  text: PosterText,
  theme: Theme,
  garden: CanvasImageSource | null,
  avatar: CanvasImageSource | null,
): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.fillStyle = theme.canvas
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = 1
  if (garden) ctx.drawImage(garden, POSTER_PLOT.x, POSTER_PLOT.y, POSTER_PLOT.width, POSTER_PLOT.height)

  // the avatar in a circle, or a placeholder circle with the login's initial
  const r = POSTER_AVATAR_PX / 2
  const cx = PAD + r
  const cy = PAD + r
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TWO_PI)
  if (avatar) {
    ctx.clip()
    ctx.drawImage(avatar, PAD, PAD, POSTER_AVATAR_PX, POSTER_AVATAR_PX)
  } else {
    ctx.fillStyle = theme.hover
    ctx.fill()
    ctx.font = `600 40px ${SANS}`
    ctx.fillStyle = theme.muted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text.login.slice(0, 1).toUpperCase(), cx, cy + 1)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TWO_PI)
  ctx.strokeStyle = theme.panelBorder
  ctx.lineWidth = 1.5
  ctx.stroke()

  // the login and the years beside it
  const tx = PAD + POSTER_AVATAR_PX + AVATAR_GAP
  const room = POSTER_WIDTH - tx - PAD
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `600 44px ${SANS}`
  ctx.fillStyle = theme.text
  ctx.fillText(fitText(ctx, text.login, room), tx, cy + 6)
  ctx.font = `22px ${SANS}`
  ctx.fillStyle = theme.muted
  ctx.fillText(fitText(ctx, text.years, room), tx, cy + 40)

  // a rule under the view, then a column per milestone
  const footTop = POSTER_PLOT.y + POSTER_PLOT.height
  ctx.fillStyle = theme.panelBorder
  ctx.fillRect(PAD, footTop + 12, POSTER_WIDTH - 2 * PAD, 1)
  const columns = Math.max(1, text.milestones.length)
  const colW = (POSTER_WIDTH - 2 * PAD) / Math.max(3, columns)
  const dayY = footTop + 52
  if (text.milestones.length === 0) {
    ctx.font = `20px ${SANS}`
    ctx.fillStyle = theme.muted
    ctx.fillText('no milestones yet', PAD, dayY + 30)
  }
  text.milestones.forEach((m, i) => {
    const x = PAD + i * colW
    const width = colW - 32
    diamond(ctx, x + 5, dayY - 5, 5, theme.accent)
    ctx.font = `14px ${MONO}`
    ctx.fillStyle = theme.muted
    ctx.fillText(m.day, x + 18, dayY)
    ctx.font = `500 20px ${SANS}`
    ctx.fillStyle = theme.text
    ctx.fillText(fitText(ctx, m.label, width), x, dayY + 30)
    if (m.repo) {
      const lock = m.repo.locked ? LOCK_SIZE + 6 : 0
      if (m.repo.locked) drawLock(ctx, x + LOCK_SIZE / 2, dayY + 53, LOCK_SIZE, theme.muted)
      ctx.font = `15px ${SANS}`
      ctx.fillStyle = theme.muted
      ctx.fillText(fitText(ctx, m.repo.text, width - lock), x + lock, dayY + 58)
    }
  })

  ctx.font = `13px ${SANS}`
  ctx.fillStyle = theme.muted
  ctx.textAlign = 'right'
  ctx.fillText(text.credit, POSTER_WIDTH - PAD, POSTER_HEIGHT - 30)
  ctx.restore()
}

/**
 * The frame round a console view: the theme with every colour paintPosterFrame reads taken from the
 * console's ink, so the avatar, the login, the years and the milestones read on its dark screen.
 */
function consoleFrame(theme: Theme, ink: LifeInk): Theme {
  return {
    ...theme,
    canvas: ink.canvas,
    text: ink.text,
    muted: ink.muted,
    accent: ink.accent,
    hover: ink.labelPlateFill,
    panelBorder: ink.labelPlateRing,
  }
}

export interface PosterInput {
  profile: ProfileData
  timeline: LifeTimeline
  /** the view's layout */
  layout: LifeViewModel
  /** the view on show, drawn as the canvas draws it */
  view: LifeViewDef
  theme: Theme
  /** language -> colour in the theme, the one the canvas paints with */
  colourOf: (language: string | null) => string
  /** the screen's namer, as the privacy toggle has it now */
  name: RepoNamer
  /** repo keys the panel's eyes hide */
  hidden: ReadonlySet<string>
}

/** The exporters chunk's part the poster uses. */
export interface PosterKit {
  canvasToPng(canvas: HTMLCanvasElement): Promise<Blob>
  downloadBlob(blob: Blob, fileName: string): void
  gardenFileName(data: { owner: string; repo: string }, ext: string, now?: Date, kind?: string): string
}

export interface PosterDeps {
  loadKit: () => Promise<PosterKit>
  loadAvatar: (url: string | null) => Promise<CanvasImageSource | null>
  /** a canvas of width x height backing pixels */
  makeCanvas: (width: number, height: number) => HTMLCanvasElement
  now: () => Date
  /** measures a garden label's text as drawn; measureLabel when left out */
  measure?: (text: string) => number
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D context unavailable')
  return ctx
}

function browserCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** The poster on a new canvas (POSTER_WIDTH x POSTER_HEIGHT at POSTER_SCALE): the view off screen first, then the frame round it. */
export function composeLifePoster(
  input: PosterInput,
  avatar: CanvasImageSource | null,
  deps: Pick<PosterDeps, 'makeCanvas' | 'now' | 'measure'>,
): HTMLCanvasElement {
  const { profile, timeline, layout, view, theme, colourOf, name, hidden } = input
  const plot = deps.makeCanvas(POSTER_PLOT.width * POSTER_SCALE, POSTER_PLOT.height * POSTER_SCALE)
  const plotCtx = context2d(plot)
  plotCtx.setTransform(POSTER_SCALE, 0, 0, POSTER_SCALE, 0, 0)
  const ink = viewInk(lifeInk(theme), view)
  paintPosterGarden(plotCtx, POSTER_GARDEN_VIEW, { layout, view, timeline, ink, colourOf, name, login: profile.login, hidden, measure: deps.measure })

  const poster = deps.makeCanvas(POSTER_WIDTH * POSTER_SCALE, POSTER_HEIGHT * POSTER_SCALE)
  const ctx = context2d(poster)
  ctx.setTransform(POSTER_SCALE, 0, 0, POSTER_SCALE, 0, 0)
  const text: PosterText = {
    login: profile.login,
    years: posterYears(timeline),
    milestones: posterMilestones(timeline.milestones, name),
    credit: posterCredit(deps.now()),
  }
  paintPosterFrame(ctx, text, view?.ink ? consoleFrame(theme, ink) : theme, plot, avatar)
  return poster
}

/**
 * Saves the poster as `<login>-life-poster-<day>.png`: the exporters and the avatar load side by
 * side (an avatar that fails is left out), the poster is composed and encoded, the browser
 * downloads it, and then poster-export is sent, with no data. Any other failure rejects (a
 * ChunkLoadError when the exporters could not be loaded), and nothing is sent.
 */
export async function saveLifePoster(input: PosterInput, deps: Partial<PosterDeps> = {}): Promise<void> {
  const loadKit = deps.loadKit ?? (() => exportersChunk.load())
  const loadAvatar = deps.loadAvatar ?? ((url: string | null) => loadPosterAvatar(url))
  const now = (deps.now ?? (() => new Date()))()
  const url = posterAvatarUrl(input.profile.avatarUrl, POSTER_AVATAR_PX * POSTER_SCALE)
  const [kit, avatar] = await Promise.all([loadKit(), loadAvatar(url).catch(() => null)])
  const poster = composeLifePoster(input, avatar, { makeCanvas: deps.makeCanvas ?? browserCanvas, now: () => now, measure: deps.measure })
  const blob = await kit.canvasToPng(poster)
  kit.downloadBlob(blob, kit.gardenFileName({ owner: input.profile.login, repo: 'life' }, 'png', now, 'poster'))
  track('poster-export')
}

/** The error card a failed save shows (ErrorCard's codes). */
export type PosterFailure = { code: 'chunk_failed' } | { code: 'export_failed'; message: string }

/**
 * What a failed saveLifePoster shows: chunk_failed (its card offers a reload) when the exporters
 * chunk could not be loaded, even on its retry, as the repo garden's saves do, so the card never
 * shows a module URL; export_failed with the reason for anything else (the canvas would not encode,
 * say).
 */
export function posterFailure(error: unknown): PosterFailure {
  if (isChunkLoadError(error)) return { code: 'chunk_failed' }
  return { code: 'export_failed', message: error instanceof Error ? error.message : String(error) }
}
