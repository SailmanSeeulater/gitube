/**
 * Person mode's three views end to end (PROFILE_SPEC.md Phase 6): the life garden, life lines and
 * the constellation share the panel (its switcher marking the view on show, its legend explaining
 * it), the inspector, the theme, the time-lapse (one clock grows each view, and the caption counts
 * the same repos in all of them), the poster (the view on show, fully grown) and the recording (one
 * canvas, the switcher locked while it records). A switch leaves the store as it was, so hidden
 * repos, the selection, the hover and the privacy reveal carry over, and the camera does too, as
 * every view spans the same days. view-switch is sent with the view by the switcher only: never on
 * opening a link, a new login or the time-lapse.
 */
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData } from '../src/analytics/umami'
import PersonApp from '../src/PersonApp'
import personAppSource from '../src/PersonApp.tsx?raw'
import PersonInspector from '../src/profile/PersonInspector'
import PersonPanel from '../src/profile/PersonPanel'
import { POSTER_GARDEN_VIEW, composeLifePoster, saveLifePoster, type PosterDeps, type PosterInput } from '../src/profile/lifePoster'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { closeLifeTimelapse, lapseCaption, openLifeTimelapse } from '../src/profile/lifeTimelapse'
import { LIFE_VIEWS, VIEW_OPTIONS, switchView } from '../src/profile/lifeViews'
import { viewInk } from '../src/profile/lifeView'
import type { LifeHover } from '../src/profile/lifeTypes'
import { leafColour } from '../src/components/gardenPaint'
import { languagePalette } from '../src/profile/lifeInk'
import { PRIVATE_REPO_LABEL, repoKey } from '../src/profile/privacy'
import { dayAt } from '../src/profile/timeline'
import { labelNames } from '../src/profile/useLifeLabels'
import { profileQueryKey } from '../src/profile/useProfileData'
import { usePersonStore, type PersonState } from '../src/profile/usePersonStore'
import type { PersonView } from '../src/share/shareUrl'
import { useGardenStore } from '../src/store/useGardenStore'
import { THEMES, getTheme } from '../src/theme/themes'
import { PHOSPHOR } from '../src/theme/console/phosphor'
import { HTOP_PALETTE } from '../src/theme/console/htop'
import { GITLOG_PALETTE } from '../src/theme/console/gitlog'
import { MINIMAP_PALETTE } from '../src/theme/console/minimap'
import type { ProfileData } from '../src/types'
import {
  FAKE_TOKEN,
  GAEARON_NOW,
  KEPANO_NOW,
  gaearonProfile,
  grow,
  growView,
  kepanoProfile,
  paintView,
  setGarden,
  setPerson,
  textOf,
  viewPainterFor,
  withPrivate,
  type Grown,
} from './helpers/personScene'
import { recordingCtx, type CtxEntry, type RecordingCtx } from './helpers/recordingCtx'

const noop = () => {}
const theme = getTheme('obsidian')
const VIEWS: PersonView[] = ['garden', 'lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap']
const PROGRESSES = [0, 0.25, 0.5, 0.75, 1]
/** What each view's legend says first, and only it. */
const INTROS: Record<PersonView, string> = {
  garden: 'each plant is a repo, rooted where their part in it starts',
  lines: 'each line is a repo, from where their part in it starts to today: thick while active, thin while dormant',
  constellation: "each star is a repo, placed where their part in it starts, in its language's row",
  phosphor: 'each stack of blocks is a repo, rising where their part in it starts',
  htop: 'each row is a repo, its meter lit where it was active',
  gitlog: 'each branch is a repo, forking off the trunk where their part in it starts',
  minimap: 'each line of code is a repo, in the order they started, its tokens where it was active',
}

/** As in personGuards: kepano's top-starred repo, his own, one he contributed to, a seedling fork and an archived one, made private. */
const KEPANO_PRIVATE = ['kepano/obsidian-skills', 'kepano/tidy', 'obsidianmd/wordgard', 'kepano/bookcover-api', 'kepano/obsidian-highlights-sidebar']
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SECRETS = KEPANO_PRIVATE.flatMap((name) => [
  new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w.-])`, 'i'),
  new RegExp(`(?<![\\w./-])${escape(name.slice(name.indexOf('/') + 1))}(?![\\w./-])`, 'i'),
])

function expectNoSecret(texts: readonly string[], where: string): void {
  const all = texts.join('\n')
  for (const secret of SECRETS) {
    const found = secret.exec(all)
    expect(found && all.slice(Math.max(0, found.index - 60), found.index + 60), `${secret} in ${where}`).toBeNull()
  }
}

let kepano: ProfileData
let gaearon: ProfileData
let secret: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
  secret = withPrivate(kepano, KEPANO_PRIVATE)
})

beforeEach(() => {
  usePersonStore.getState().resetFor('nobody')
  setPerson({ tab: 'repos', hover: null, selected: null, hidden: new Set(), search: '', revealFor: null, focus: null })
  setGarden({ panelOpen: true, rate: null, token: '', themeId: theme.id })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  useGardenStore.setState({ token: '' })
})

/** Umami's tracker stubbed in, as the app sees it once loaded. */
function stubTracker() {
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '' } })
  return umamiTrack
}

/** PersonApp's markup for a person and a view (what a ?user=…&view=… link opens), the profile in the query cache. */
function personApp(profile: ProfileData, view: PersonView | null, token: string, login = profile.login): string {
  setGarden({ token })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(profileQueryKey(login, token), { profile, cachedAt: null })
  return renderToStaticMarkup(h(QueryClientProvider, { client }, h(PersonApp, { login, request: 0, view, focusInput: false, onRepo: noop, onUser: noop })))
}

/** The switcher's checked option, from markup. */
function checkedViews(html: string): string[] {
  return [...html.matchAll(/<button type="button" role="radio" aria-checked="true"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])
}

const code = personAppSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

describe('the panel and the inspector', () => {
  it('serve every view: one canvas named for the view, the switcher on it, its legend, and the same controls', () => {
    for (const [profile, token] of [
      [kepano, FAKE_TOKEN],
      [gaearon, ''],
    ] as const) {
      for (const view of VIEWS) {
        const html = personApp(profile, view, token)
        const where = `${profile.login} ${view}`
        expect(html.match(/<canvas/g), where).toHaveLength(1)
        expect(html, where).toContain(`aria-label="${LIFE_VIEWS[view].title} of ${profile.login}:`)
        expect(html).toContain(`href="https://github.com/${profile.login}"`)
        for (const label of ['Save a poster', 'Copy a link to this view', 'Collapse panel']) expect(html, where).toContain(`aria-label="${label}"`)
        expect(html).toContain('role="radiogroup" aria-label="View"')
        expect(checkedViews(html), where).toEqual([VIEW_OPTIONS.find((o) => o.value === view)!.label])
        const text = textOf(html)
        expect(text, where).toContain(INTROS[view])
        for (const other of VIEWS) if (other !== view) expect(text, where).not.toContain(INTROS[other])
        expect(text).toContain('watch it grow')
        expect(html).not.toContain('aria-label="Time-lapse"')
      }
    }
  })

  it('opens the garden for a link that names no view', () => {
    const html = personApp(kepano, null, FAKE_TOKEN)
    expect(html).toContain('aria-label="life garden of kepano:')
    expect(checkedViews(html)).toEqual(['garden'])
  })

  it('shows the same inspector for a hovered or selected repo, whichever view is on show', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(KEPANO_NOW)
    const g = grow(kepano, KEPANO_NOW, theme)
    const key = repoKey(g.timeline.lanes[g.timeline.lanes.length - 1].repo)
    const other = repoKey(g.timeline.lanes[0].repo)
    for (const state of [{ hover: { kind: 'repo', key } }, { selected: other }, { hover: { kind: 'day', day: g.timeline.startDay + 500, milestone: null } }] as Array<
      Partial<PersonState>
    >) {
      setPerson(state)
      const inspector = renderToStaticMarkup(h(PersonInspector, { profile: g.profile, timeline: g.timeline, days: g.days, colourOf: g.colourOf, name: g.name }))
      expect(inspector.length).toBeGreaterThan(100)
      for (const view of VIEWS) expect(personApp(kepano, view, FAKE_TOKEN), `${view} ${JSON.stringify(state)}`).toContain(inspector)
    }
  })

  it('shows the switcher only when given one, and holds it while a recording runs', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const base = { profile: g.profile, timeline: g.timeline, colourOf: g.colourOf, name: g.name, privateCount: 0, revealed: false, onReveal: noop, theme }
    expect(renderToStaticMarkup(h(PersonPanel, base))).not.toContain('aria-label="View"')
    const free = renderToStaticMarkup(h(PersonPanel, { ...base, view: 'lines', onView: noop }))
    expect(checkedViews(free)).toEqual(['lines'])
    expect(free).not.toMatch(/role="radio"[^>]*disabled=""/)
    const locked = renderToStaticMarkup(h(PersonPanel, { ...base, view: 'lines', onView: noop, viewLocked: true }))
    expect(locked.match(/role="radio" aria-checked="(?:true|false)" disabled=""/g)).toHaveLength(VIEWS.length)
    expect(locked).toContain('Waits until the recording ends')
  })
})

/** Every colour the theme lets the views draw with: its ink, its language colours, and the garden's leaves of them. */
function allowedColours(g: Grown): Set<string> {
  const allowed = new Set<string>()
  const { garden, dimAlpha: _alpha, ...flat } = g.ink
  for (const value of [...Object.values(flat), ...Object.values(garden)]) allowed.add(value)
  for (const colour of [...Object.values(languagePalette(g.timeline, g.theme)), g.theme.fallback]) {
    allowed.add(colour)
    try {
      allowed.add(leafColour(colour, g.ink.garden))
    } catch {
      // not hex: the garden draws its leaves in the colour itself
    }
  }
  return allowed
}

const DRAWS = new Set(['fill', 'fillRect', 'fillText'])
const STROKES = new Set(['stroke', 'strokeRect', 'strokeText'])

/** The console views, each with its fixed palette (src/theme/console): a terminal's look whatever the theme. */
const CONSOLE_PALETTES: Partial<Record<PersonView, object>> = { phosphor: PHOSPHOR, htop: HTOP_PALETTE, gitlog: GITLOG_PALETTE, minimap: MINIMAP_PALETTE }

/** Every colour string in a palette, its lists included. */
function paletteColours(palette: object): Set<string> {
  const out = new Set<string>()
  const walk = (value: unknown) => {
    if (typeof value === 'string') out.add(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(palette)
  return out
}

describe('the theme', () => {
  it('paints every life view in the theme’s colours only, and every console view in its own palette alone, the canvas colour first, in all ten themes', () => {
    /** a console view's draws and strokes with their colours, as the first theme painted them */
    const consoleFrames = new Map<PersonView, string>()
    for (const t of THEMES) {
      const g = grow(kepano, KEPANO_NOW, t)
      const lanes = g.timeline.lanes
      const state = { hover: { kind: 'repo' as const, key: repoKey(lanes[3].repo) }, selected: repoKey(lanes[lanes.length - 2].repo) }
      for (const view of VIEWS) {
        const own = CONSOLE_PALETTES[view]
        const allowed: Set<string> = own ? paletteColours(own) : allowedColours(g)
        const canvas = own ? LIFE_VIEWS[view].ink!(g.ink).canvas : t.canvas
        const { rec } = paintView(g, view, { ...state, progress: 0.8 })
        const where = `${t.id} ${view}`
        const first = rec.log.find((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name)) as Extract<CtxEntry, { kind: 'call' }>
        expect(first.name, where).toBe('fillRect')
        expect(first.args, where).toEqual([0, 0, g.view.width * 2, g.view.height * 2])
        expect(first.style.fillStyle, where).toBe(canvas)
        const painted: string[] = []
        for (const e of rec.log) {
          if (e.kind !== 'call') continue
          if (DRAWS.has(e.name)) {
            expect(allowed.has(String(e.style.fillStyle)), `${where} ${e.name} ${String(e.style.fillStyle)}`).toBe(true)
            painted.push(`${e.name} ${String(e.style.fillStyle)}`)
          }
          if (STROKES.has(e.name)) {
            expect(allowed.has(String(e.style.strokeStyle)), `${where} ${e.name} ${String(e.style.strokeStyle)}`).toBe(true)
            painted.push(`${e.name} ${String(e.style.strokeStyle)}`)
          }
        }
        if (!own) continue
        // a console view, its labels, plates and caption included, looks the same whatever the theme
        const frame = painted.join('\n')
        if (!consoleFrames.has(view)) consoleFrames.set(view, frame)
        expect(frame === consoleFrames.get(view), `${where}: the same frame as in ${THEMES[0].id}`).toBe(true)
      }
    }
    expect([...consoleFrames.keys()]).toEqual(VIEWS.filter((view) => CONSOLE_PALETTES[view]))
  })
})

/** The entries a view's scene alone logs for g at the time-lapse's day at, with the keys in hidden left out (on g's canvas, or another). */
function sceneLog(g: Grown, view: PersonView, hidden: ReadonlySet<string>, at: number | null, viewport = g.view): CtxEntry[] {
  const { def, layout } = growView(g, view)
  const rec = recordingCtx(viewport.width * 2, viewport.height * 2)
  const camera = viewport === g.view ? g.camera : fitLifeCamera(layout.days, viewport)
  const geoms = def.scene.geoms(layout, camera, viewport)
  def.scene.paint(rec.ctx, { layout, timeline: g.timeline, geoms, camera, view: viewport, ink: g.ink, colourOf: g.colourOf, hidden, hover: null, selected: null, at })
  return rec.log
}

describe('the time-lapse', () => {
  const lives = (): Array<[string, Grown]> => [
    ['kepano', grow(kepano, KEPANO_NOW, theme)],
    ['gaearon', grow(gaearon, GAEARON_NOW, theme)],
  ]

  it('counts the same repos in every view at every progress, and draws the same caption over each', () => {
    for (const [label, g] of lives()) {
      const hidden = new Set([repoKey(g.timeline.lanes[1].repo), repoKey(g.timeline.lanes[g.timeline.lanes.length - 1].repo)])
      for (const p of PROGRESSES) {
        const captions = VIEWS.map((view) => {
          const { def, layout } = growView(g, view)
          return lapseCaption(g.timeline, { plants: def.scene.items(layout) }, p, hidden)
        })
        for (const caption of captions) expect(caption, `${label} at ${p}`).toEqual(captions[0])
        const huds = VIEWS.map((view) => {
          const { painter } = viewPainterFor(g, view, { hidden }, { timelapse: { progress: { current: p }, title: g.profile.login } })
          const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
          painter.paint(rec.ctx, g.view, g.camera, 16)
          return rec.calls('fillText').slice(-3).map((c) => String(c.args[0]))
        })
        expect(huds[0], `${label} at ${p}`).toEqual([captions[0].year, `${captions[0].sown} repo${captions[0].sown === 1 ? '' : 's'}`, `${g.profile.login} · repo-garden`])
        for (const hud of huds) expect(hud, `${label} at ${p}`).toEqual(huds[0])
      }
    }
  })

  it('draws a repo in every view exactly once the clock has sown it, so what is drawn only ever grows', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const keys = g.timeline.lanes.map((lane) => repoKey(lane.repo))
    const all = new Set(keys)
    for (const view of VIEWS) {
      const items = growView(g, view).def.scene.items(growView(g, view).layout)
      let before = new Set<string>()
      for (const p of PROGRESSES) {
        const at = dayAt(g.timeline.clock, p)
        const base = sceneLog(g, view, all, at).length
        const drawn = new Set<string>()
        for (const item of items) {
          const alone = new Set(all)
          alone.delete(item.key)
          if (sceneLog(g, view, alone, at).length > base) drawn.add(item.key)
          expect(drawn.has(item.key), `${view} ${item.key} at ${p}`).toBe(!(item.startDay > at))
        }
        for (const key of before) expect(drawn.has(key), `${view} ${key} at ${p}`).toBe(true)
        before = drawn
        // at the very start nothing has grown: the view draws its axis alone
        if (p === 0) {
          expect(drawn.size, view).toBe(0)
          expect(sceneLog(g, view, new Set(), at), view).toEqual(sceneLog(g, view, all, at))
        }
      }
      expect(before.size, view).toBe(items.length)
    }
  })
})

// ---------- the poster ----------

const NOW = new Date(2026, 9, 25, 12)

function posterRig() {
  const recs: RecordingCtx[] = []
  const measured: string[] = []
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '' } })
  const kit = { canvasToPng: vi.fn(async () => new Blob(['png'])), downloadBlob: vi.fn(), gardenFileName: () => 'kepano-life-poster.png' }
  const deps: PosterDeps = {
    loadKit: async () => kit,
    loadAvatar: async () => null,
    makeCanvas: (width, height) => {
      const rec = recordingCtx(width, height)
      recs.push(rec)
      return { width, height, getContext: (kind: string) => (kind === '2d' ? rec.ctx : null) } as unknown as HTMLCanvasElement
    },
    now: () => NOW,
    measure: (text) => {
      measured.push(text)
      return text.length * 6.5
    },
  }
  return { recs, measured, umamiTrack, kit, deps }
}

function posterInput(g: Grown, view: PersonView, hidden: ReadonlySet<string> = new Set()): PosterInput {
  const { def, layout } = growView(g, view)
  return { profile: g.profile, timeline: g.timeline, view: def, layout, theme: g.theme, colourOf: g.colourOf, name: g.name, hidden }
}

/** The entries of the last frame painted on an off-screen plot: from its last canvas fill. */
function lastFrame(rec: RecordingCtx): CtxEntry[] {
  let start = 0
  rec.log.forEach((e, i) => {
    if (e.kind === 'call' && e.name === 'setTransform' && e.args[0] === 1 && e.args[3] === 1) start = i
  })
  return rec.log.slice(start)
}

const count = (log: CtxEntry[], name: string) => log.filter((e) => e.kind === 'call' && e.name === name).length

describe('the poster', () => {
  it('draws the view on show, fully grown, and none of another view’s marks', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const plots = Object.fromEntries(
      VIEWS.map((view) => {
        const r = posterRig()
        composeLifePoster(posterInput(g, view), null, r.deps)
        return [view, lastFrame(r.recs[0])]
      }),
    ) as Record<PersonView, CtxEntry[]>
    // the garden's stems and heads (drawTip's petals) are its own
    expect(count(plots.garden, 'quadraticCurveTo')).toBeGreaterThan(g.timeline.lanes.length)
    for (const view of ['lines', 'constellation'] as const) {
      expect(count(plots[view], 'quadraticCurveTo'), view).toBe(0)
      expect(count(plots[view], 'ellipse'), view).toBe(0)
    }
    // a line per repo, a star per repo
    expect(plots.lines.filter((e) => e.kind === 'call' && e.name === 'stroke' && e.style.lineWidth !== 1).length).toBeGreaterThan(g.timeline.lanes.length)
    expect(count(plots.constellation, 'arc')).toBeGreaterThan(g.timeline.lanes.length)
    // fully grown, the whole life fitted: every mark of the view as the scene draws it with no time-lapse (no lock here, so every arc is the view's)
    for (const view of ['lines', 'constellation'] as const) {
      const grownArcs = count(sceneLog(g, view, new Set(), null, POSTER_GARDEN_VIEW), 'arc')
      expect(count(plots[view], 'arc'), view).toBe(grownArcs)
      expect(grownArcs, view).toBeGreaterThan(count(sceneLog(g, view, new Set(), dayAt(g.timeline.clock, 0.5), POSTER_GARDEN_VIEW), 'arc'))
    }
  })

  it('draws no hover or selection, whatever the store holds, and leaves out what the eyes hide', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const key = repoKey(g.timeline.lanes[g.timeline.lanes.length - 3].repo)
    for (const view of ['lines', 'constellation'] as const) {
      const plain = posterRig()
      composeLifePoster(posterInput(g, view), null, plain.deps)
      setPerson({ hover: { kind: 'repo', key }, selected: key })
      const held = posterRig()
      composeLifePoster(posterInput(g, view), null, held.deps)
      setPerson({ hover: null, selected: null })
      expect(held.recs[0].log, view).toEqual(plain.recs[0].log)
      const plot = lastFrame(plain.recs[0])
      const strokes = plot.filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && e.name === 'stroke')
      // no hover ring or plate, and nothing dimmed for a selection (the inspected ring can share the accent with a language)
      expect(strokes.some((e) => e.style.strokeStyle === g.ink.hoverRing || e.style.strokeStyle === g.ink.labelPlateRing), view).toBe(false)
      expect(plot.some((e) => e.kind === 'call' && e.style.globalAlpha === g.ink.dimAlpha), view).toBe(false)

      const hidden = posterRig()
      composeLifePoster(posterInput(g, view, new Set([key])), null, hidden.deps)
      expect(lastFrame(hidden.recs[0]).length, view).toBeLessThan(plot.length)
      const name = g.timeline.lanes[g.timeline.lanes.length - 3].repo.replace(/^kepano\//i, '')
      expect(hidden.recs[0].texts(), view).not.toContain(name)
    }
  })

  it('shows no private name while hidden or revealed for another login, and shows them once revealed for this one', () => {
    for (const view of ['lines', 'constellation'] as const) {
      for (const revealFor of [null, 'someone-else']) {
        const r = posterRig()
        composeLifePoster(posterInput(grow(secret, KEPANO_NOW, theme, revealFor), view), null, r.deps)
        expectNoSecret([...r.recs.flatMap((rec) => rec.texts()), ...r.measured], `${view} poster, revealed for ${revealFor}`)
        expect(r.recs.flatMap((rec) => rec.texts())).toContain(PRIVATE_REPO_LABEL)
      }
      const r = posterRig()
      composeLifePoster(posterInput(grow(secret, KEPANO_NOW, theme, 'kepano'), view), null, r.deps)
      const shown = r.recs.flatMap((rec) => rec.texts()).join('\n')
      expect(SECRETS.some((s) => s.test(shown)), view).toBe(true)
    }
  })

  it('saves any view and sends poster-export once, with no data', async () => {
    for (const view of VIEWS) {
      const r = posterRig()
      await saveLifePoster(posterInput(grow(kepano, KEPANO_NOW, theme), view), r.deps)
      expect(r.kit.downloadBlob).toHaveBeenCalledTimes(1)
      expect(r.umamiTrack.mock.calls, view).toEqual([['poster-export']])
    }
  })
})

describe('the recording', () => {
  it('records the one canvas every view paints on, and holds the switcher while it records', () => {
    // one host, kept across views: no key to remount it, so the canvas (and a capture of it) survives a switch
    const host = /<LifeView\s[^>]*\/>/.exec(code)?.[0] ?? ''
    expect(host).toContain('def={def}')
    expect(host).toContain('timelapse={lifeLapse}')
    expect(host).not.toContain('key=')
    expect(code.match(/<LifeView\b/g)).toHaveLength(1)
    expect(code).toContain("const getCanvas = useCallback(() => canvasHostRef.current?.querySelector('canvas') ?? null, [])")
    expect(code).toMatch(/<PersonPanel\s[^>]*viewLocked=\{lapseRecording\}/)
    // a poster in the making locks it too: its namer is taken at the click
    expect(code).toMatch(/<PersonPanel\s[^>]*revealLocked=\{lapseRecording \|\| posterBusy\}/)
  })

  it('paints the caption over every view while the time-lapse is on, and keeps asking for frames while it is live', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    for (const view of VIEWS) {
      const { painter } = viewPainterFor(g, view, {}, { timelapse: { progress: { current: 0.6 }, title: 'kepano', live: true } })
      const rec = recordingCtx(g.view.width * 2, g.view.height * 2)
      expect(painter.paint(rec.ctx, g.view, g.camera, 33), view).toBe(true)
      expect(String(rec.calls('fillText').at(-1)?.args[0]), view).toBe('kepano · repo-garden')
      // in the view's own ink: a console view's caption reads on its dark screen whatever the theme
      const ink = viewInk(g.ink, LIFE_VIEWS[view])
      expect(rec.calls('fillRect').some((c) => c.style.fillStyle === ink.accent && c.args[1] === g.view.height - 3), view).toBe(true)
    }
  })
})

describe('a switch', () => {
  it('leaves the store as it was: hidden repos, selection, hover, focus, reveal, tab and search', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const [a, b, c] = [3, 7, 11].map((i) => repoKey(g.timeline.lanes[i].repo))
    const store = usePersonStore.getState()
    store.resetFor('kepano')
    store.toggleHidden(a)
    store.select(b)
    store.setHover({ kind: 'repo', key: c })
    store.focusOn({ kind: 'repo', key: b })
    store.setReveal('kepano', true)
    store.setTab('milestones')
    store.setSearch('obs')
    const before = { ...usePersonStore.getState() }
    stubTracker()
    let view: PersonView = 'garden'
    for (const next of ['lines', 'constellation', 'garden'] as PersonView[]) switchView(view, next, (v) => (view = v))
    expect(view).toBe('garden')
    const after = usePersonStore.getState()
    for (const field of Object.keys(before) as Array<keyof typeof before>) expect(Object.is(after[field], before[field]), field).toBe(true)
  })

  it('carries the hidden repos, the selection, the hover and the reveal into every view', () => {
    const g = grow(secret, KEPANO_NOW, theme, 'kepano')
    const lanes = g.timeline.lanes
    const hidden = repoKey(lanes[5].repo)
    const selected = repoKey(lanes[lanes.length - 4].repo)
    const hovered = repoKey('kepano/obsidian-skills')
    for (const view of VIEWS) {
      const { rec, labels, painter, grown } = paintView(g, view, { hidden: new Set([hidden]), selected, hover: { kind: 'repo', key: hovered } })
      const items = grown.def.scene.items(grown.layout)
      const at = (key: string) => grown.layout.byKey.get(key)!
      // the hidden repo: no label, and nothing to hit where it would be
      expect(labels.placer.shown[at(hidden)], view).toBe(0)
      const geoms = grown.def.scene.geoms(grown.layout, g.camera, g.view)
      const spot = new Float32Array(3)
      expect(grown.def.scene.anchor(grown.layout, geoms, at(hidden), null, spot)).toBe(true)
      expect(painter.hitAt(spot[0], spot[1]), view).not.toEqual({ kind: 'repo', key: hidden })
      // the selection: marked, every other repo dimmed, in the view's own ink (a console view's, whatever the theme)
      const ink = viewInk(g.ink, grown.def)
      expect(rec.log.some((e) => e.kind === 'call' && (e.name === 'stroke' || e.name === 'fill') && e.style.globalAlpha === ink.dimAlpha), view).toBe(true)
      if (!grown.def.ink) {
        // a life view rings the selected and the hovered repo
        expect(rec.calls('stroke').some((e) => e.style.strokeStyle === ink.inspectedRing), view).toBe(true)
        expect(rec.calls('stroke').some((e) => e.style.strokeStyle === ink.hoverRing), view).toBe(true)
      } else {
        // a console view marks them its own way (phosphor's frames, htop's cursor bar, the editor's line bands, the git
        // log's halos): each changes what the scene draws, and the selection's mark is in its inspected colour
        const scene = (selected: string | null, hover: LifeHover) => {
          const r = recordingCtx(g.view.width * 2, g.view.height * 2)
          grown.def.scene.paint(r.ctx, { layout: grown.layout, timeline: g.timeline, geoms, camera: g.camera, view: g.view, ink, colourOf: g.colourOf, hidden: new Set([hidden]), hover, selected, at: null })
          return JSON.stringify(r.log)
        }
        const plain = scene(null, null)
        expect(scene(selected, null), view).not.toBe(plain)
        expect(scene(null, { kind: 'repo', key: hovered }), view).not.toBe(plain)
        const marks = [...rec.calls('stroke'), ...rec.calls('strokeRect'), ...rec.calls('fill'), ...rec.calls('fillRect')]
        expect(marks.some((e) => (e.name.startsWith('stroke') ? e.style.strokeStyle : e.style.fillStyle) === ink.inspectedRing), view).toBe(true)
      }
      // the hover: on a plate naming it as the namer does, revealed for this login
      const names = labelNames(items, g.timeline, g.name, g.profile.login)
      expect(labels.placer.plates[at(hovered)]?.rows[0].text, view).toBe(names[at(hovered)].text)
      expect(names[at(hovered)].text, view).toBe('obsidian-skills')
      expect(rec.texts(), view).toContain('obsidian-skills')
    }
  })

  it('keeps the camera: every view spans the same days from the same start', () => {
    for (const g of [grow(kepano, KEPANO_NOW, theme), grow(gaearon, GAEARON_NOW, theme)]) {
      const spans = VIEWS.map((view) => {
        const { layout } = growView(g, view)
        return [layout.startDay, layout.todayDay, layout.days]
      })
      for (const span of spans) expect(span).toEqual([g.layout.startDay, g.layout.todayDay, g.layout.days])
    }
    // the host is fitted per person, never per view
    expect(code).toMatch(/<LifeView\s[^>]*login=\{profile\.login\}/)
  })

  it('keeps the time-lapse where it was: only a new person, request or profile closes it', () => {
    expect(code).toContain('useLayoutEffect(() => closeLapse(), [asked, profile, closeLapse])')
    const closeDeps = /const closeLapse = useCallback\([\s\S]*?\n {2}\)/.exec(code)?.[0] ?? ''
    expect(closeDeps).toContain('[]')
    expect(closeDeps).not.toMatch(/\bview\b/)
  })
})

describe('view-switch', () => {
  it('is sent by the switcher only, through switchView, and PersonApp sends nothing itself', () => {
    expect(code).toContain('const pickView = useCallback((next: PersonView) => switchView(view, next, setView), [view])')
    expect(code.match(/switchView\(/g)).toHaveLength(1)
    // the view changes nowhere else
    expect(code.match(/\bsetView\b/g)).toHaveLength(2)
    expect(code).toMatch(/<PersonPanel\s[^>]*view=\{view\}\s+onView=\{pickView\}/)
    expect(code).not.toMatch(/\btrack\(/)
    // the address bar follows the view
    expect(code).toMatch(/\}, \[login, view\]\)/)
  })

  it('is not sent on opening a link, for a new login, or by the time-lapse', () => {
    const umamiTrack = stubTracker()
    for (const view of [null, ...VIEWS]) personApp(kepano, view, FAKE_TOKEN)
    personApp(gaearon, 'constellation', '')
    const progress = { current: 1 }
    openLifeTimelapse(progress, noop)
    closeLifeTimelapse(progress, noop)
    expect(umamiTrack.mock.calls.filter(([event]) => event === 'view-switch')).toEqual([])
    expect(umamiTrack.mock.calls).toEqual([['timelapse-play']])
  })
})
