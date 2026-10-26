/**
 * Person mode end to end, for tests: profiles replayed from the recordings through the real
 * fetchers, the life garden grown from one the way PersonApp grows it (timeline, layout, colours,
 * namer, fitted camera) and painted on a recording context by LifeGarden's own painter
 * (makeLifePaint) with its labels, and the stores set so react-dom/server renders what a test
 * asked for.
 */
import { fetchProfileRest } from '../../src/api/profile'
import { fetchProfileGraphql } from '../../src/api/profileGraphql'
import { buildDayIndex, type DayIndex } from '../../src/profile/dayIndex'
import { fitLifeCamera } from '../../src/profile/lifeCamera'
import { layoutLifeGarden } from '../../src/profile/lifeGardenLayout'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, plantGeom } from '../../src/profile/lifeGeometry'
import { languageColour, languagePalette, lifeInk } from '../../src/profile/lifeInk'
import { makeLifePaint, type LifePaintOptions, type LifePaintState, type LifePainter } from '../../src/profile/lifePaint'
import type { LifeCamera, LifeGardenLayout, LifeInk, LifeViewport, PlantGeom, RepoNamer } from '../../src/profile/lifeTypes'
import { isRevealed, privateRepoKeys, repoKey, repoNamer } from '../../src/profile/privacy'
import { buildLifeTimeline, type LifeTimeline } from '../../src/profile/timeline'
import type { LifeLabelSet } from '../../src/profile/useLifeLabels'
import { usePersonStore, type PersonState } from '../../src/profile/usePersonStore'
import { useGardenStore, type GardenState } from '../../src/store/useGardenStore'
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

/** The plot PersonApp's canvas gives the garden on a laptop screen, in LifeGarden's frame. */
export const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

export interface Grown {
  profile: ProfileData
  timeline: LifeTimeline
  layout: LifeGardenLayout
  days: DayIndex
  theme: Theme
  ink: LifeInk
  colourOf: (language: string | null) => string
  privateKeys: ReadonlySet<string>
  name: RepoNamer
  camera: LifeCamera
  view: LifeViewport
  geoms: PlantGeom[]
}

/** The life garden as PersonApp grows it from profile, with names revealed only for revealFor's login. */
export function grow(profile: ProfileData, now: number, theme: Theme, revealFor: string | null = null, view: LifeViewport = VIEW): Grown {
  const timeline = buildLifeTimeline(profile, now)
  const layout = layoutLifeGarden(timeline, profile.source)
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
    geoms: layout.plants.map((plant) => plantGeom(plant, camera, view)),
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

/** LifeGarden's painter for g, as LifeGarden makes it, with the store's state held as given and every measured text kept. */
export function painterFor(
  g: Grown,
  state: Partial<LifePaintState> = {},
  over: Partial<LifePaintOptions> = {},
): { painter: LifePainter; measured: string[] } {
  const measured: string[] = []
  const measure = (text: string) => {
    measured.push(text)
    return text.length * 6.5
  }
  const now: LifePaintState = { hidden: new Set(), hover: null, selected: null, ...state }
  const painter = makeLifePaint({
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
 * One frame as LifeGarden paints it, by its own painter: the garden, then its labels once they have
 * settled (the frames before go to a quiet context), with the hovered and selected plants on plates.
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

/**
 * Server rendering reads a store's initial state (useSyncExternalStore's server snapshot), so what
 * a test sets goes into both, as pulls-ui does. (Each test file has its own copy of the stores.)
 */
export function setPerson(partial: Partial<PersonState>): void {
  usePersonStore.setState(partial)
  Object.assign(usePersonStore.getInitialState(), usePersonStore.getState())
}

export function setGarden(partial: Partial<GardenState>): void {
  useGardenStore.setState(partial)
  Object.assign(useGardenStore.getInitialState(), partial)
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
