/**
 * Person mode's views and their switcher (lifeViews.ts, PROFILE_SPEC.md section 5 and Phase 6): the
 * registry names each view by the share link's view, switchView sends view-switch with the view (and
 * nothing else) once per real change, the panel's switcher hands its option's value on and is the
 * repo garden's Segmented to the class, and each view's scene keeps the contract the painter, the
 * labels, the time-lapse and the panel's focus rely on, on both recordings. The views' own drawing
 * code writes no colour of its own.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { EventData } from '../src/analytics/umami'
import panelSource from '../src/components/Panel.tsx?raw'
import personPanelSource from '../src/profile/PersonPanel.tsx?raw'
import { ViewSwitch } from '../src/profile/PersonPanel'
import { CONSTELLATION_VIEW, GARDEN_VIEW, LIFE_VIEWS, LINES_VIEW, VIEW_OPTIONS, switchView } from '../src/profile/lifeViews'
import { axisOf } from '../src/profile/lifeView'
import { horizonY } from '../src/profile/lifeGeometry'
import { languagePalette } from '../src/profile/lifeInk'
import { repoKey } from '../src/profile/privacy'
import { useGardenStore } from '../src/store/useGardenStore'
import type { PersonView } from '../src/share/shareUrl'
import { getTheme } from '../src/theme/themes'
import type { ProfileData } from '../src/types'
import { GAEARON_NOW, KEPANO_NOW, gaearonProfile, grow, kepanoProfile, type Grown } from './helpers/personScene'

const VIEWS: PersonView[] = ['garden', 'lines', 'constellation']
const theme = getTheme('obsidian')

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
    expect([GARDEN_VIEW.title, LINES_VIEW.title, CONSTELLATION_VIEW.title]).toEqual(['life garden', 'life lines', 'constellation'])
    expect(LIFE_VIEWS.garden).toBe(GARDEN_VIEW)
    expect(LIFE_VIEWS.lines).toBe(LINES_VIEW)
    expect(LIFE_VIEWS.constellation).toBe(CONSTELLATION_VIEW)
    expect(VIEW_OPTIONS.map((o) => o.value)).toEqual(VIEWS)
    expect(VIEW_OPTIONS.map((o) => o.label)).toEqual(['garden', 'lines', 'constellation'])
  })
})

describe('switchView', () => {
  it('sends view-switch with the view, once per real change, and sets it', () => {
    useGardenStore.setState({ token: '' })
    const umamiTrack = stubTracker()
    const set = vi.fn()
    let current: PersonView = 'garden'
    for (const next of ['lines', 'lines', 'constellation', 'garden', 'garden', 'constellation'] as PersonView[]) {
      switchView(current, next, (view) => {
        set(view)
        current = view
      })
    }
    expect(set.mock.calls).toEqual([['lines'], ['constellation'], ['garden'], ['constellation']])
    expect(umamiTrack.mock.calls).toEqual([
      ['view-switch', { view: 'lines' }],
      ['view-switch', { view: 'constellation' }],
      ['view-switch', { view: 'garden' }],
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
      switchView('garden', 'lines', () => {})
      expect(umamiTrack.mock.calls).toEqual([['view-switch', { view: 'lines' }]])
    }
  })
})

type Props = Record<string, unknown> & { children?: unknown }

/** The buttons of a rendered ViewSwitch, from its element tree. */
function buttonsOf(element: ReactElement): Array<ReactElement<Props>> {
  const children = (element.props as Props).children
  return (Array.isArray(children) ? children : [children]).filter((c): c is ReactElement<Props> => isValidElement(c))
}

describe('the switcher', () => {
  it('hands the option it was clicked on to onChange, and marks the view on show', () => {
    for (const value of VIEWS) {
      const onChange = vi.fn()
      const tree = ViewSwitch({ value, onChange })
      expect((tree.props as Props)['role']).toBe('radiogroup')
      expect((tree.props as Props)['aria-label']).toBe('View')
      const buttons = buttonsOf(tree)
      expect(buttons.map((b) => b.props.children)).toEqual(['garden', 'lines', 'constellation'])
      expect(buttons.map((b) => b.props['aria-checked'])).toEqual(VIEWS.map((v) => v === value))
      for (const b of buttons) (b.props.onClick as () => void)()
      expect(onChange.mock.calls).toEqual(VIEWS.map((v) => [v]))
      expect(buttons.every((b) => b.props.disabled === false)).toBe(true)
    }
  })

  it('waits while a recording runs', () => {
    const buttons = buttonsOf(ViewSwitch({ value: 'garden', onChange: () => {}, disabled: true }))
    expect(buttons.every((b) => b.props.disabled === true)).toBe(true)
  })

  it("is the repo garden panel's Segmented to the class, copied rather than taken from the first download", () => {
    const segmented = panelSource.slice(panelSource.indexOf('function Segmented<'), panelSource.indexOf('const VIEW_OPTIONS'))
    const copy = personPanelSource.slice(personPanelSource.indexOf('export function ViewSwitch('), personPanelSource.indexOf('function PrivacyToggle('))
    expect(segmented.length).toBeGreaterThan(200)
    expect(copy.length).toBeGreaterThan(200)
    for (const part of [
      'role="radiogroup"',
      'className="flex rounded-lg bg-garden-field p-0.5"',
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
        expect(Array.from(keepOut.slice(0, 4)), where).toEqual([0, horizonY(g.view) - 1, g.view.width, g.view.height])
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
          expect(palette.has(def.scene.itemColour(layout, i, g.ink, g.colourOf)), `${where} colour`).toBe(true)
        })
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
    ],
    { query: '?raw', import: 'default', eager: true },
  )

  it('writes no colour of its own: every colour comes from the theme', () => {
    const files = Object.keys(sources)
    expect(files.length).toBe(12)
    for (const [file, text] of Object.entries(sources)) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')
      expect(code.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i), file).toBeNull()
    }
  })

  it('never imports the repo garden’s branch metro engine', () => {
    for (const [file, text] of Object.entries(sources)) expect(text, file).not.toMatch(/(?:from|import\()\s*['"][^'"]*graph\/metro/)
  })
})
