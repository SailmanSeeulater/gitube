/**
 * Person mode's views and their switcher (lifeViews.ts, PROFILE_SPEC.md section 5 and Phase 6): the
 * registry names each view by the share link's view, switchView sends view-switch with the view (and
 * nothing else) once per real change, the panel's switcher hands its option's value on and is the
 * repo garden's Segmented to the class, and each view's scene keeps the contract the painter, the
 * labels, the time-lapse and the panel's focus rely on, on both recordings. The views' own drawing
 * code writes no colour of its own: the life views paint the theme, the console views their own fixed
 * palette (src/theme/console), labels and plates included.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { EventData } from '../src/analytics/umami'
import panelSource from '../src/components/Panel.tsx?raw'
import personPanelSource from '../src/profile/PersonPanel.tsx?raw'
import { ViewSwitch } from '../src/profile/PersonPanel'
import { CONSTELLATION_VIEW, LIFE_VIEWS, LINES_VIEW, VIEW_OPTIONS, switchView } from '../src/profile/lifeViews'
import { axisOf } from '../src/profile/lifeView'
import { horizonY } from '../src/profile/lifeGeometry'
import { languagePalette } from '../src/profile/lifeInk'
import { repoKey } from '../src/profile/privacy'
import { useGardenStore } from '../src/store/useGardenStore'
import type { PersonView } from '../src/share/shareUrl'
import { THEMES, getTheme } from '../src/theme/themes'
import { PHOSPHOR } from '../src/theme/console/phosphor'
import { HTOP_PALETTE } from '../src/theme/console/htop'
import { GITLOG_PALETTE } from '../src/theme/console/gitlog'
import { MINIMAP_PALETTE } from '../src/theme/console/minimap'
import { HELIX_PALETTE } from '../src/theme/console/helix'
import type { ProfileData } from '../src/types'
import { GAEARON_NOW, KEPANO_NOW, gaearonProfile, grow, kepanoProfile, type Grown } from './helpers/personScene'

const VIEWS: PersonView[] = ['lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap', 'helix']
const theme = getTheme('obsidian')
/** The views that paint the theme... */
const LIFE_ONLY: PersonView[] = ['lines', 'constellation']
/** ...and the console views, each its own palette's colours, whatever the theme. */
const CONSOLE_PALETTES: Partial<Record<PersonView, object>> = { phosphor: PHOSPHOR, htop: HTOP_PALETTE, gitlog: GITLOG_PALETTE, minimap: MINIMAP_PALETTE, helix: HELIX_PALETTE }

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

let kepano: ProfileData
let gaearon: ProfileData

beforeAll(async () => {
  ;[kepano, gaearon] = await Promise.all([kepanoProfile(), gaearonProfile()])
})

afterEach(() => {
  vi.unstubAllGlobals()
  useGardenStore.setState({ token: '' })
})

/** Umami's tracker stubbed in, as the app sees it once loaded. */
function stubTracker() {
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>()
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '' } })
  return umamiTrack
}

describe('the registry', () => {
  it('names each view by its share-link id, and offers them in order', () => {
    expect(Object.keys(LIFE_VIEWS)).toEqual(VIEWS)
    for (const view of VIEWS) expect(LIFE_VIEWS[view].id).toBe(view)
    expect([LINES_VIEW.title, CONSTELLATION_VIEW.title]).toEqual(['life lines', 'constellation'])
    expect(LIFE_VIEWS.lines).toBe(LINES_VIEW)
    expect(LIFE_VIEWS.constellation).toBe(CONSTELLATION_VIEW)
    expect(VIEW_OPTIONS.map((o) => o.value)).toEqual(VIEWS)
    expect(VIEW_OPTIONS.map((o) => o.label)).toEqual(['lines', 'constellation', 'phosphor', 'htop', 'git log', 'minimap', 'helix'])
  })
})

describe('switchView', () => {
  it('sends view-switch with the view, once per real change, and sets it', () => {
    useGardenStore.setState({ token: '' })
    const umamiTrack = stubTracker()
    const set = vi.fn()
    let current: PersonView = 'helix'
    for (const next of ['lines', 'lines', 'constellation', 'helix', 'helix', 'constellation'] as PersonView[]) {
      switchView(current, next, (view) => {
        set(view)
        current = view
      })
    }
    expect(set.mock.calls).toEqual([['lines'], ['constellation'], ['helix'], ['constellation']])
    expect(umamiTrack.mock.calls).toEqual([
      ['view-switch', { view: 'lines' }],
      ['view-switch', { view: 'constellation' }],
      ['view-switch', { view: 'helix' }],
      ['view-switch', { view: 'constellation' }],
    ])
  })

  it('sends nothing for the view already on show', () => {
    const umamiTrack = stubTracker()
    const set = vi.fn()
    for (const view of VIEWS) switchView(view, view, set)
    expect(set).not.toHaveBeenCalled()
    expect(umamiTrack).not.toHaveBeenCalled()
  })

  it('carries the view only, with or without a token', () => {
    for (const token of ['', 'ghp_' + 'R8vK2mW5qT9xL3nB7cJ4hF6dS1aG0eY2uI8o']) {
      useGardenStore.setState({ token })
      const umamiTrack = stubTracker()
      switchView('helix', 'lines', () => {})
      expect(umamiTrack.mock.calls).toEqual([['view-switch', { view: 'lines' }]])
    }
  })
})

type Props = Record<string, unknown> & { children?: unknown }

/** The buttons of a rendered ViewSwitch (in its rows), from its element tree. */
function buttonsOf(element: ReactElement): Array<ReactElement<Props>> {
  const children = (element.props as Props).children
  const elements = (Array.isArray(children) ? children.flat() : [children]).filter((c): c is ReactElement<Props> => isValidElement(c))
  return elements.flatMap((c) => (c.props['role'] === 'radio' ? [c] : buttonsOf(c)))
}

describe('the switcher', () => {
  it('hands the option it was clicked on to onChange, and marks the view on show', () => {
    for (const value of VIEWS) {
      const onChange = vi.fn()
      const tree = ViewSwitch({ value, onChange })
      expect((tree.props as Props)['role']).toBe('radiogroup')
      expect((tree.props as Props)['aria-label']).toBe('View')
      const buttons = buttonsOf(tree)
      expect(buttons.map((b) => b.props.children)).toEqual(['lines', 'constellation', 'phosphor', 'htop', 'git log', 'minimap', 'helix'])
      expect(buttons.map((b) => b.props['aria-checked'])).toEqual(VIEWS.map((v) => v === value))
      for (const b of buttons) (b.props.onClick as () => void)()
      expect(onChange.mock.calls).toEqual(VIEWS.map((v) => [v]))
      expect(buttons.every((b) => b.props.disabled === false)).toBe(true)
    }
  })

  it('waits while a recording runs', () => {
    const buttons = buttonsOf(ViewSwitch({ value: 'lines', onChange: () => {}, disabled: true }))
    expect(buttons.every((b) => b.props.disabled === true)).toBe(true)
  })

  it("is the repo garden panel's Segmented to the class, copied rather than taken from the first download", () => {
    const segmented = panelSource.slice(panelSource.indexOf('function Segmented<'), panelSource.indexOf('const VIEW_OPTIONS'))
    const copy = personPanelSource.slice(personPanelSource.indexOf('export function ViewSwitch('), personPanelSource.indexOf('function PrivacyToggle('))
    expect(segmented.length).toBeGreaterThan(200)
    expect(copy.length).toBeGreaterThan(200)
    // the group is the Segmented's field, stacked into rows (one per VIEW_ROWS row) and nothing else
    const groupClass = (code: string) => /role="radiogroup"[^>]*?className="([^"]+)"/.exec(code)?.[1].split(' ') ?? []
    const field = groupClass(segmented)
    expect(field).toEqual(['flex', 'rounded-lg', 'bg-garden-field', 'p-0.5'])
    const stacked = groupClass(copy)
    for (const name of field) expect(stacked, name).toContain(name)
    expect(stacked.filter((name) => !field.includes(name))).toEqual(['flex-col', 'gap-0.5'])
    expect(copy).toContain('{VIEW_ROWS.map((row) => (')
    expect(copy).toContain('className="flex">')
    for (const part of [
      'role="radiogroup"',
      'role="radio"',
      'aria-checked={active}',
      'className={`flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors ${',
      "active ? 'bg-garden-hover text-garden-accent' : 'text-garden-muted hover:text-garden-text'",
    ]) {
      expect(segmented, part).toContain(part)
      expect(copy, part).toContain(part)
    }
    // not exported from the eager panel for this
    expect(panelSource).not.toMatch(/export function Segmented/)
    expect(personPanelSource).not.toMatch(/import \{[^}]*Segmented/)
  })
})

describe("each view's scene", () => {
  const lives = (): Array<[string, Grown]> => [
    ['kepano (graphql)', grow(kepano, KEPANO_NOW, theme)],
    ['gaearon (rest)', grow(gaearon, GAEARON_NOW, theme)],
  ]

  it('lays out every lane once, keyed by repo, rooted at its root day and sown on its first day, over the shared axis', () => {
    for (const [label, g] of lives()) {
      const axis = axisOf(g.timeline)
      for (const view of VIEWS) {
        const def = LIFE_VIEWS[view]
        const layout = def.layout(g.timeline, g.profile.source)
        const items = def.scene.items(layout)
        const where = `${label} ${view}`
        expect(items.length, where).toBe(g.timeline.lanes.length)
        expect([...items.map((item) => item.lane)].sort((a, b) => a - b), where).toEqual(g.timeline.lanes.map((_, i) => i))
        items.forEach((item, i) => {
          const lane = g.timeline.lanes[item.lane]
          expect(item.key).toBe(repoKey(lane.repo))
          expect(layout.byKey.get(item.key)).toBe(i)
          expect(item.startDay).toBe(lane.startDay)
          expect(item.x).toBe(lane.rootDay - g.timeline.startDay + 0.5)
        })
        expect(layout.byKey.size, where).toBe(items.length)
        const { startDay, todayDay, days, years, languages, milestones } = layout
        expect({ startDay, todayDay, days, years, languages, milestones }, where).toEqual(axis)
      }
    }
  })

  it('orders every label once, keeps them off the ground, and anchors each grown repo on the canvas', () => {
    for (const [label, g] of lives()) {
      const palette = new Set([...Object.values(languagePalette(g.timeline, theme)), theme.fallback, g.ink.dry])
      for (const view of VIEWS) {
        const def = LIFE_VIEWS[view]
        const layout = def.layout(g.timeline, g.profile.source)
        const items = def.scene.items(layout)
        const where = `${label} ${view}`
        const order = Array.from(def.scene.labelOrder(layout))
        expect([...order].sort((a, b) => a - b), where).toEqual(items.map((_, i) => i))
        const keepOut = def.scene.keepOut(layout, g.view)
        expect(keepOut.length % 4, where).toBe(0)
        const boxes = Array.from({ length: keepOut.length / 4 }, (_, b) => Array.from(keepOut.slice(b * 4, b * 4 + 4)))
        const ground = [0, horizonY(g.view) - 1, g.view.width, g.view.height]
        // the ground first in a life view; a console view keeps a box over all of it (the git log's reaches up over its
        // tags on the trunk), and its chrome (header, gutter, strip) clear too
        if (LIFE_ONLY.includes(view)) expect(boxes[0], where).toEqual(ground)
        else {
          const covers = (box: number[]) => box[0] <= ground[0] && box[1] <= ground[1] && box[2] >= ground[2] && box[3] >= ground[3]
          expect(boxes.some(covers), where).toBe(true)
        }
        const own = CONSOLE_PALETTES[view]
        const colours = own ? paletteColours(own) : palette
        const geoms = def.scene.geoms(layout, g.camera, g.view)
        const out = new Float32Array(3)
        items.forEach((_, i) => {
          expect(def.scene.anchor(layout, geoms, i, null, out), `${where} ${i}`).toBe(true)
          const [x, y, r] = out
          expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r), `${where} ${i}`).toBe(true)
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(g.view.width)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(horizonY(g.view) + 1)
          expect(r).toBeGreaterThanOrEqual(0)
          expect(colours.has(def.scene.itemColour(layout, i, g.ink, g.colourOf)), `${where} colour`).toBe(true)
        })
      }
    }
  })

  it("gives a console view its own ink, in its palette alone and the same in every theme, and the life views the theme's", () => {
    for (const view of VIEWS) {
      const def = LIFE_VIEWS[view]
      const own = CONSOLE_PALETTES[view]
      if (!own) {
        expect(def.ink, view).toBeUndefined()
        continue
      }
      expect(def.ink, view).toBeTypeOf('function')
      const colours = paletteColours(own)
      let first: string | null = null
      for (const t of THEMES) {
        const g = grow(kepano, KEPANO_NOW, t)
        const ink = def.ink!(g.ink)
        const { dimAlpha, ...rest } = ink
        // every colour the shared pieces read is the console's, and so is the dimming of the repos a selection leaves out
        expect(dimAlpha).toBeGreaterThan(0)
        expect(dimAlpha).toBeLessThan(1)
        for (const [name, value] of Object.entries(rest)) expect(colours.has(value), `${view} ${t.id} ${name}: ${value}`).toBe(true)
        const shown = JSON.stringify({ ...rest, dimAlpha })
        first ??= shown
        expect(shown, `${view} ${t.id}`).toBe(first)
        // applied twice (the host, then the paint), it is the same ink
        expect(def.ink!(ink), `${view} ${t.id}`).toEqual(ink)
      }
    }
  })

  it('lays out the same timeline the same way twice', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    for (const view of VIEWS) {
      const def = LIFE_VIEWS[view]
      expect(JSON.stringify(def.layout(g.timeline, 'graphql'), (_k, v) => (v instanceof Map ? [...v] : v))).toBe(
        JSON.stringify(def.layout(g.timeline, 'graphql'), (_k, v) => (v instanceof Map ? [...v] : v)),
      )
    }
  })
})

describe("the views' drawing code", () => {
  const sources = import.meta.glob<string>(
    [
      '../src/profile/lifeAxis.ts',
      '../src/profile/lifeView.ts',
      '../src/profile/lifeViews.ts',
      '../src/profile/LifeViewCanvas.tsx',
      '../src/profile/lifeLines*.ts',
      '../src/profile/constellation*.ts',
      // the console views: their colours are their palettes', under src/theme/console
      '../src/profile/phosphor*.ts',
      '../src/profile/htop*.ts',
      '../src/profile/gitLog*.ts',
      '../src/profile/minimap*.ts',
      '../src/profile/helix*.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
  )

  it('writes no colour of its own: every colour comes from the theme, or a console view\'s palette under src/theme/console', () => {
    const files = Object.keys(sources)
    expect(files.length).toBe(36)
    for (const [file, text] of Object.entries(sources)) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      expect(code.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i), file).toBeNull()
    }
  })

  it('never imports the repo garden’s branch metro engine', () => {
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/(?:from|import\()\s*['"][^'"]*graph\/metro/)
  })
})
