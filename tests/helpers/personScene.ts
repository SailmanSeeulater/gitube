/**
 * Person mode end to end, for tests: profiles replayed from the recordings through the real
 * fetchers, a life grown from one the way PersonApp grows it (timeline, colours, namer, fitted
 * camera, and life lines, the default view, laid out) and painted on a recording context by the
 * view's own painter (makeViewPaint) with its labels, any other view of it the same way (growView,
 * paintView: the view's layout of the same timeline), and the stores set so react-dom/server
 * renders what a test asked for.
 */
import { fetchProfileRest } from '../../src/api/profile'
import { fetchProfileGraphql } from '../../src/api/profileGraphql'
import { buildDayIndex, type DayIndex } from '../../src/profile/dayIndex'
import { fitLifeCamera } from '../../src/profile/lifeCamera'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP } from '../../src/profile/lifeGeometry'
import { layoutLifeLines, type LifeLinesLayout } from '../../src/profile/lifeLinesLayout'
import { linesGeom, type LinesGeom } from '../../src/profile/lifeLinesGeometry'
import { languageColour, languagePalette, lifeInk } from '../../src/profile/lifeInk'
import { makeViewPaint, type LifePaintState, type LifePainter, type ViewPaintOptions } from '../../src/profile/lifePaint'
import { viewInk, type LifeViewDef, type LifeViewModel } from '../../src/profile/lifeView'
import { LIFE_VIEWS, LINES_VIEW } from '../../src/profile/lifeViews'
import type { PersonView } from '../../src/share/shareUrl'
import type { LifeCamera, LifeInk, LifeViewport, RepoNamer } from '../../src/profile/lifeTypes'
import { isRevealed, privateRepoKeys, repoKey, repoNamer } from '../../src/profile/privacy'
import { buildLifeTimeline, type LifeTimeline } from '../../src/profile/timeline'
import type { LifeLabelSet } from '../../src/profile/useLifeLabels'
import { usePersonStore, type PersonState } from '../../src/profile/usePersonStore'
import { useAppStore, type AppState } from '../../src/store/useAppStore'
import type { Theme } from '../../src/theme/themes'
import type { ProfileData } from '../../src/types'
import { GAEARON_NOW, KEPANO_NOW, gaearonRouter, kepanoRouter, makeFetch } from './profileReplay'
import { recordingCtx, type RecordingCtx } from './recordingCtx'

/** Not a token: the recordings answer any. */
export const FAKE_TOKEN = 'test-token-not-real'

let kepano: Promise<ProfileData> | undefined
let gaearon: Promise<ProfileData> | undefined

/** kepano, 2013 to 2026, through the GraphQL tier (a token run). */
export function kepanoProfile(): Promise<ProfileData> {
  kepano ??= fetchProfileGraphql('kepano', { token: FAKE_TOKEN, fetch: makeFetch(kepanoRouter()).fetch, now: KEPANO_NOW })
  return kepano
}

/** gaearon's 301 public repos and recent pushes, through the REST tier (no token). */
export function gaearonProfile(): Promise<ProfileData> {
  gaearon ??= fetchProfileRest('gaearon', { fetch: makeFetch(gaearonRouter(() => undefined)).fetch, now: GAEARON_NOW })
  return gaearon
}

export { GAEARON_NOW, KEPANO_NOW }

/** The repos named made private, in every copy, plus a stale private copy of each name in stale (its live copy stays public). */
export function withPrivate(profile: ProfileData, names: readonly string[], stale: readonly string[] = []): ProfileData {
  const wanted = new Set(names.map(repoKey))
  const repos = profile.repos.map((repo) => (wanted.has(repoKey(repo.nameWithOwner)) ? { ...repo, isPrivate: true } : repo))
  for (const name of stale) {
    const live = profile.repos.find((repo) => repoKey(repo.nameWithOwner) === repoKey(name))
    if (!live) throw new Error(`no repo ${name}`)
    // an older copy in another case, which the timeline merges into the live one
    repos.push({ ...live, nameWithOwner: name.toUpperCase(), isPrivate: true, activity: live.activity.slice(0, 1), lastActiveAt: live.createdAt })
  }
  return { ...profile, repos }
}

/** The plot PersonApp's canvas gives a view on a laptop screen, in the canvas's frame. */
export const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

export interface Grown {
  profile: ProfileData
  timeline: LifeTimeline
  /** life lines' layout, the default view's */
  layout: LifeLinesLayout
  days: DayIndex
  theme: Theme
  ink: LifeInk
  colourOf: (language: string | null) => string
  privateKeys: ReadonlySet<string>
  name: RepoNamer
  camera: LifeCamera
  view: LifeViewport
  geoms: LinesGeom
}

/** A life as PersonApp grows it from profile, laid out as life lines, with names revealed only for revealFor's login. */
export function grow(profile: ProfileData, now: number, theme: Theme, revealFor: string | null = null, view: LifeViewport = VIEW): Grown {
  const timeline = buildLifeTimeline(profile, now)
  const layout = layoutLifeLines(timeline, profile.source)
  const palette = languagePalette(timeline, theme)
  const privateKeys = privateRepoKeys(profile)
  const camera = fitLifeCamera(layout.days, view)
  return {
    profile,
    timeline,
    layout,
    days: buildDayIndex(profile, timeline),
    theme,
    ink: lifeInk(theme),
    colourOf: (language) => languageColour(palette, language, theme),
    privateKeys,
    name: repoNamer(privateKeys, isRevealed(revealFor, profile.login)),
    camera,
    view,
    geoms: linesGeom(layout, camera, view),
  }
}

export interface Painted {
  rec: RecordingCtx
  /** every text the labels measured */
  measured: string[]
  labels: LifeLabelSet
  /** the painter that drew it, for its hit test and its clicks on what it drew */
  painter: LifePainter
}

/** A context that draws nothing, for the frames before the one a test reads. */
export function quietCtx(width: number, height: number): CanvasRenderingContext2D {
  const canvas = { width, height }
  const noop = () => undefined
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => (prop === 'canvas' ? canvas : prop === 'measureText' ? () => ({ width: 0 }) : noop),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
}

/** Life lines' painter for g, as the canvas makes it, with the store's state held as given and every measured text kept. */
export function painterFor(
  g: Grown,
  state: Partial<LifePaintState> = {},
  over: Partial<ViewPaintOptions<LifeLinesLayout>> = {},
): { painter: LifePainter; measured: string[] } {
  const measured: string[] = []
  const measure = (text: string) => {
    measured.push(text)
    return text.length * 6.5
  }
  const now: LifePaintState = { hidden: new Set(), hover: null, selected: null, ...state }
  const painter = makeViewPaint(LINES_VIEW.scene, {
    layout: g.layout,
    timeline: g.timeline,
    ink: g.ink,
    colourOf: g.colourOf,
    name: g.name,
    login: g.profile.login,
    measure,
    state: () => now,
    ...over,
  })
  return { painter, measured }
}

/**
 * One frame of life lines as the canvas paints it, by its own painter: the view, then its labels once
 * they have settled (the frames before go to a quiet context), with the hovered and selected repos on plates.
 * progress is the time-lapse's (0..1), off when left out.
 */
export function paint(g: Grown, over: Partial<LifePaintState> & { progress?: number } = {}): Painted {
  const { progress, ...state } = over
  const timelapse = progress === undefined ? null : { progress: { current: progress } }
  const { painter, measured } = painterFor(g, state, { timelapse })
  const quiet = quietCtx(g.view.width * 2, g.view.height * 2)
  for (let i = 0; i < 400; i++) {
    painter.paint(quiet, g.view, g.camera, 16)
    if (!painter.labels.placer.busy) break
  }
  const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
  painter.paint(rec.ctx, g.view, g.camera, 16)
  return { rec, measured, labels: painter.labels, painter }
}

/** A view of a grown life, as PersonApp lays it out: the view and its layout of the same timeline. */
export interface GrownView {
  def: LifeViewDef
  layout: LifeViewModel
}

/** The view named, laid out from g's timeline as PersonApp lays it out (LIFE_VIEWS[view].layout). */
export function growView(g: Grown, view: PersonView): GrownView {
  const def = LIFE_VIEWS[view]
  return { def, layout: def.layout(g.timeline, g.profile.source) }
}

/** A view's painter for g, as LifeView makes it, with the store's state held as given and every measured text kept. */
export function viewPainterFor(
  g: Grown,
  view: PersonView,
  state: Partial<LifePaintState> = {},
  over: Partial<ViewPaintOptions<LifeViewModel>> = {},
): { painter: LifePainter; measured: string[]; grown: GrownView } {
  const grown = growView(g, view)
  const measured: string[] = []
  const measure = (text: string) => {
    measured.push(text)
    return text.length * 6.5
  }
  const now: LifePaintState = { hidden: new Set(), hover: null, selected: null, ...state }
  const painter = makeViewPaint(grown.def.scene, {
    layout: grown.layout,
    timeline: g.timeline,
    ink: viewInk(g.ink, grown.def),
    colourOf: g.colourOf,
    name: g.name,
    login: g.profile.login,
    measure,
    state: () => now,
    ...over,
  })
  return { painter, measured, grown }
}

/**
 * One frame of a view as LifeView paints it, by its own painter, as paint() does life lines': the
 * view, then its labels once they have settled, with the hovered and selected repos on plates.
 * progress is the time-lapse's (0..1), off when left out.
 */
export function paintView(g: Grown, view: PersonView, over: Partial<LifePaintState> & { progress?: number } = {}): Painted & { grown: GrownView } {
  const { progress, ...state } = over
  const timelapse = progress === undefined ? null : { progress: { current: progress } }
  const { painter, measured, grown } = viewPainterFor(g, view, state, { timelapse })
  const quiet = quietCtx(g.view.width * 2, g.view.height * 2)
  for (let i = 0; i < 400; i++) {
    painter.paint(quiet, g.view, g.camera, 16)
    if (!painter.labels.placer.busy) break
  }
  const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
  painter.paint(rec.ctx, g.view, g.camera, 16)
  return { rec, measured, labels: painter.labels, painter, grown }
}

/**
 * Server rendering reads a store's initial state (useSyncExternalStore's server snapshot), so what
 * a test sets goes into both, as pulls-ui does. (Each test file has its own copy of the stores.)
 */
export function setPerson(partial: Partial<PersonState>): void {
  usePersonStore.setState(partial)
  Object.assign(usePersonStore.getInitialState(), usePersonStore.getState())
}

export function setApp(partial: Partial<AppState>): void {
  useAppStore.setState(partial)
  Object.assign(useAppStore.getInitialState(), partial)
}

/** The markup's text, tags and attributes taken out, entities read back. */
export function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}
