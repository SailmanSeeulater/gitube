/**
 * A view's painter outside React (makeViewPaint), on life lines: its frame (the view under its
 * labels, from the store's state at each frame), names only through the namer, a hit test and a
 * click on what the last frame drew and never on a hidden repo, and the hover following the camera
 * under a still pointer. Also the padlock drawn beside a private repo's name.
 */
import { describe, expect, it, vi } from 'vitest'
import { getTheme, type Theme } from '../src/theme/themes'
import { buildLifeTimeline, type LifeTimeline } from '../src/profile/timeline'
import { VIEW_GROUND, VIEW_SIDE, VIEW_TOP, horizonY } from '../src/profile/lifeGeometry'
import { fitLifeCamera, panLifeCamera, zoomLifeCamera } from '../src/profile/lifeCamera'
import { languageColour, languagePalette, lifeInk } from '../src/profile/lifeInk'
import { drawLock } from '../src/profile/drawLock'
import { makeViewPaint, type LifePaintState, type LifePainter, type ViewPaintOptions } from '../src/profile/lifePaint'
import { LINES_VIEW } from '../src/profile/lifeViews'
import type { LifeLinesLayout } from '../src/profile/lifeLinesLayout'
import { linesGeom } from '../src/profile/lifeLinesGeometry'
import { linesAnchor } from '../src/profile/lifeLinesPaint'
import { PRIVATE_REPO_LABEL, privateRepoKeys, repoNamer } from '../src/profile/privacy'
import { LIFE_LABEL_FONT } from '../src/profile/useLifeLabels'
import type { LifeCamera, LifeHover, LifeInk, LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { recordingCtx, type RecordingCtx } from './helpers/recordingCtx'

/** 2024-06-15 12:00 in Los Angeles (PDT). */
const NOW = Date.parse('2024-06-15T19:00:00Z')
const iso = (day: string) => `${day}T20:00:00Z`

function repo(nameWithOwner: string, over: Partial<ProfileRepo> = {}): ProfileRepo {
  const createdAt = over.createdAt ?? iso('2020-01-01')
  return {
    nameWithOwner,
    createdAt,
    firstActiveAt: createdAt,
    lastActiveAt: createdAt,
    isOwn: true,
    language: 'TypeScript',
    languageColor: null,
    stars: 0,
    forks: 0,
    isFork: false,
    isArchived: false,
    isPrivate: false,
    activity: [],
    ...over,
  }
}

/** A commit on the first of each month from..to (inclusive, 'YYYY-MM'). */
function monthly(from: string, to: string, commits = 2): ProfileRepo['activity'] {
  const out: ProfileRepo['activity'] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push({ date: `${y}-${String(m).padStart(2, '0')}-01`, commits })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

function profile(over: Partial<ProfileData> = {}): ProfileData {
  return {
    login: 'Me',
    name: null,
    avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    createdAt: iso('2019-01-10'),
    source: 'graphql',
    repos: [],
    days: [],
    recent: [],
    recentFrom: null,
    milestones: [{ kind: 'joined', date: iso('2019-01-10'), label: 'joined GitHub' }],
    restrictedContributions: 0,
    truncated: false,
    lostWindows: [],
    landed: [],
    fallback: null,
    ...over,
  }
}

/**
 * A token profile with one of each kind of repo: a starred one, a private one, an archived one with
 * stars, a fork, a repo they only contributed to, and a starred repo GitHub counted no commits to.
 */
const REPOS: ProfileRepo[] = [
  repo('Me/alpha', { createdAt: iso('2019-02-01'), stars: 120, activity: monthly('2019-02', '2021-06', 4) }),
  repo('Me/Secret-Plans', { createdAt: iso('2020-03-01'), language: 'Rust', stars: 30, isPrivate: true, activity: monthly('2020-03', '2024-05', 3) }),
  repo('Me/old-thing', { createdAt: iso('2019-06-01'), language: 'JavaScript', stars: 15, isArchived: true, activity: monthly('2019-06', '2019-12') }),
  repo('Me/forked-lib', { createdAt: iso('2021-01-10'), language: 'Go', isFork: true, activity: monthly('2021-01', '2021-03', 1) }),
  repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-05-01'), isOwn: false, language: null, activity: monthly('2022-05', '2023-02', 5) }),
  repo('Me/empty-uncounted', { createdAt: iso('2023-08-01'), stars: 5 }),
]

const PRIVATE = ['me/secret-plans']

/** The canvas's frame on a laptop screen. */
const VIEW: LifeViewport = { width: 1280, height: 800, top: VIEW_TOP, ground: VIEW_GROUND, side: VIEW_SIDE }

interface Scene {
  timeline: LifeTimeline
  layout: LifeLinesLayout
  theme: Theme
  ink: LifeInk
  colourOf: (language: string | null) => string
  camera: LifeCamera
}

function scene(p: ProfileData = profile({ repos: REPOS }), theme: Theme = getTheme('obsidian')): Scene {
  const timeline = buildLifeTimeline(p, NOW)
  const layout = LINES_VIEW.layout(timeline, p.source) as LifeLinesLayout
  const palette = languagePalette(timeline, theme)
  return {
    timeline,
    layout,
    theme,
    ink: lifeInk(theme),
    colourOf: (language) => languageColour(palette, language, theme),
    camera: fitLifeCamera(layout.days, VIEW),
  }
}

/** Where each line's label is anchored, fully drawn: its start marker. */
function anchors(s: Scene, camera: LifeCamera = s.camera): Array<{ key: string; x: number; y: number }> {
  const g = linesGeom(s.layout, camera, VIEW)
  const out = new Float32Array(3)
  return s.layout.lines.flatMap((line, i) => (linesAnchor(s.layout, g, i, null, out) ? [{ key: line.key, x: out[0], y: out[1] }] : []))
}

/** Calls of one method, as plain argument lists. */
const argsOf = (rec: RecordingCtx, name: string) => rec.calls(name).map((c) => c.args)

describe("makeViewPaint: a view's frame, hit test and click (on life lines)", () => {
  /** The view's painter for s, as the canvas makes it, the store's state as given (and changeable), every measured label text kept. */
  function painterFor(s: Scene, state: Partial<LifePaintState> = {}, revealed = false, over: Partial<ViewPaintOptions<LifeLinesLayout>> = {}) {
    const measured: string[] = []
    const store: LifePaintState = { hidden: new Set(), hover: null, selected: null, ...state }
    const painter = makeViewPaint(LINES_VIEW.scene, {
      layout: s.layout,
      timeline: s.timeline,
      ink: s.ink,
      colourOf: s.colourOf,
      name: repoNamer(privateRepoKeys(profile({ repos: REPOS })), revealed),
      login: 'Me',
      measure: (text) => {
        measured.push(text)
        return text.length * 6.5
      },
      state: () => store,
      ...over,
    })
    return { painter, measured, store }
  }

  /** Frames until the labels settle (at most 400), then one more on a recording context, as the canvas loop paints them. */
  function settle(painter: LifePainter, camera: LifeCamera): { rec: RecordingCtx; frames: boolean[] } {
    const frames: boolean[] = []
    for (let i = 0; i < 400; i++) {
      frames.push(painter.paint(recordingCtx(VIEW.width * 2, VIEW.height * 2).ctx, VIEW, camera, 16))
      if (!frames[i]) break
    }
    const rec = recordingCtx(VIEW.width * 2, VIEW.height * 2)
    frames.push(painter.paint(rec.ctx, VIEW, camera, 16))
    return { rec, frames }
  }

  const drawn = (rec: RecordingCtx) => argsOf(rec, 'fillText').map(([text]) => String(text))

  it("paints the view, then its labels over it, from the store's state at each frame", () => {
    const s = scene()
    const { painter, store } = painterFor(s)
    const { rec, frames } = settle(painter, s.camera)
    // more frames while the labels appear, none once they rest
    expect(frames[0]).toBe(true)
    expect(frames.at(-2)).toBe(false)
    expect(frames.at(-1)).toBe(false)
    // the canvas colour first, then the view, then the labels in their font, the owner left off
    const first = rec.log.find((e) => e.kind === 'call' && /^(fill|fillRect|stroke|fillText)$/.test(e.name))
    expect(first).toMatchObject({ kind: 'call', name: 'fillRect', args: [0, 0, VIEW.width * 2, VIEW.height * 2] })
    const labels = rec.calls('fillText').filter((c) => c.style.font === LIFE_LABEL_FONT)
    expect(labels.map((c) => c.args[0])).toContain('alpha')
    expect(rec.log.indexOf(labels[0])).toBeGreaterThan(rec.log.findIndex((e) => e.kind === 'call' && e.name === 'fillText' && e.args[0] === 'today'))
    expect(drawn(rec).some((text) => text.startsWith('Me/'))).toBe(false)

    // a selection made in the store shows on the next frame: the others dimmed, the selected one on a plate
    store.selected = 'me/alpha'
    const picked = settle(painter, s.camera).rec
    expect(picked.calls('stroke').some((c) => c.style.globalAlpha === s.ink.dimAlpha)).toBe(true)
    expect(picked.calls('fill').some((c) => c.style.fillStyle === s.ink.labelPlateFill)).toBe(true)

    // the time-lapse keeps frames coming, and draws only what has appeared: nothing to hit at its start
    const lapse = painterFor(s, {}, false, { timelapse: { progress: { current: 0 } } }).painter
    expect(lapse.paint(recordingCtx().ctx, VIEW, s.camera, 16)).toBe(true)
    settle(lapse, s.camera)
    for (const anchor of anchors(s)) expect(lapse.hitAt(anchor.x, anchor.y)?.kind).not.toBe('repo')
  })

  it('labels a repo only by what the namer shows', () => {
    const s = scene()
    const secret = s.layout.byKey.get(PRIVATE[0])!
    expect(secret).toBeGreaterThanOrEqual(0)
    for (const state of [{ hover: { kind: 'repo', key: PRIVATE[0] } as LifeHover }, { selected: PRIVATE[0] }, {}]) {
      const hidden = painterFor(s, state)
      const { rec } = settle(hidden.painter, s.camera)
      for (const text of [...rec.texts(), ...hidden.measured]) expect(text.toLowerCase()).not.toContain('secret')
      if (Object.keys(state).length > 0) expect(drawn(rec)).toContain(PRIVATE_REPO_LABEL)

      const shown = painterFor(s, state, true)
      const named = settle(shown.painter, s.camera).rec
      expect(shown.measured).toContain('Secret-Plans')
      if (Object.keys(state).length > 0) expect(drawn(named)).toContain('Secret-Plans')
    }
  })

  it('hit tests and clicks what the last frame drew, and never a hidden repo', () => {
    const s = scene()
    const { painter, store } = painterFor(s)
    // nothing drawn yet: nothing to hit
    expect(painter.hitAt(VIEW.width / 2, VIEW.height / 2)).toBeNull()
    expect(painter.pickAt(VIEW.width / 2, VIEW.height / 2)).toBeNull()
    settle(painter, s.camera)

    // a line's start is that repo, until it is hidden
    const heads = anchors(s)
    const free = heads.filter((head) => {
      const hit = painter.hitAt(head.x, head.y)
      return hit?.kind === 'repo' && hit.key === head.key && painter.pickAt(head.x, head.y) === head.key
    })
    expect(free.length).toBeGreaterThanOrEqual(3)
    for (const head of free) {
      store.hidden = new Set([head.key])
      settle(painter, s.camera)
      const hit = painter.hitAt(head.x, head.y)
      expect(hit?.kind === 'repo' && hit.key === head.key, head.key).toBe(false)
      expect(painter.pickAt(head.x, head.y)).not.toBe(head.key)
      store.hidden = new Set()
    }
    settle(painter, s.camera)

    // a label is its repo's, to the hover and to a click
    const placer = painter.labels.placer
    const shown = s.layout.lines.findIndex((_, i) => placer.alpha[i] > 0.5 && !placer.forcedNow[i])
    expect(shown).toBeGreaterThanOrEqual(0)
    const x = placer.x0[shown] + placer.w[shown] / 2
    const y = placer.y0[shown] + placer.h[shown] / 2
    expect(painter.hitAt(x, y)).toEqual({ kind: 'repo', key: s.layout.lines[shown].key })
    expect(painter.pickAt(x, y)).toBe(s.layout.lines[shown].key)
    // the ground is a day
    expect(painter.hitAt(VIEW.width / 2, horizonY(VIEW) + 20)).toMatchObject({ kind: 'day' })
    expect(painter.pickAt(VIEW.width / 2, horizonY(VIEW) + 20)).toBeNull()
  })

  it('moves the hover with the camera under a still pointer, and only then', () => {
    const s = scene()
    const alpha = anchors(s).find((anchor) => anchor.key === 'me/alpha')!
    const pointer = { x: alpha.x, y: alpha.y }
    const setHover = vi.fn()
    const { painter } = painterFor(s, {}, false, { setHover, pointer: () => pointer })
    settle(painter, s.camera)
    // while the labels appear the hover follows them, and it lands on the repo under the pointer
    expect(setHover).toHaveBeenLastCalledWith({ kind: 'repo', key: 'me/alpha' })
    setHover.mockClear()
    painter.paint(recordingCtx().ctx, VIEW, s.camera, 16)
    expect(setHover).not.toHaveBeenCalled()
    // the camera moves: what is under the pointer now is hovered
    // (zoomed in round the pointer, then panned so the pointer falls before the line starts)
    const moved = panLifeCamera(zoomLifeCamera(s.camera, 3, pointer.x, s.layout.days, VIEW), 400, s.layout.days, VIEW)
    painter.paint(recordingCtx().ctx, VIEW, moved, 16)
    expect(setHover).toHaveBeenCalledTimes(1)
    expect(setHover.mock.calls[0][0]).toEqual(painter.hitAt(pointer.x, pointer.y))
    expect(setHover.mock.calls[0][0]).not.toEqual({ kind: 'repo', key: 'me/alpha' })

    // no pointer over the canvas: the hover is left alone
    const still = vi.fn()
    const away = painterFor(s, {}, false, { setHover: still, pointer: () => null }).painter
    settle(away, s.camera)
    away.paint(recordingCtx().ctx, VIEW, moved, 16)
    expect(still).not.toHaveBeenCalled()
  })
})

describe('drawLock', () => {
  it('draws a padlock inside its box, in the one colour given', () => {
    const rec = recordingCtx()
    drawLock(rec.ctx, 50, 40, 8, 'ink')
    for (const colour of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(colour).toBe('ink')
    const [x, y, w, h] = argsOf(rec, 'rect')[0] as number[]
    expect(x).toBeGreaterThanOrEqual(46)
    expect(x + w).toBeLessThanOrEqual(54)
    expect(y + h).toBeCloseTo(44)
    expect(rec.calls('arc').some((c) => c.args[3] === Math.PI && c.args[4] === 0)).toBe(true)
    for (const name of ['moveTo', 'lineTo', 'arc']) {
      for (const [px, py] of argsOf(rec, name) as number[][]) {
        expect(px).toBeGreaterThanOrEqual(46)
        expect(px).toBeLessThanOrEqual(54)
        expect(py).toBeGreaterThanOrEqual(36)
        expect(py).toBeLessThanOrEqual(44)
      }
    }
  })
})

