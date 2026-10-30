/**
 * Person mode's labels, on life lines: the names they show (through the RepoNamer, without the person's own
 * login), their text forms and lock room, and, drawn on a recording context, that a hidden private
 * name is never drawn or measured while "private repo" and its lock are, by default and after a
 * reveal for another login, and that a reveal for this login shows it. Also where labels go, what
 * they hit, and a profile without repos.
 */
import { describe, expect, it } from 'vitest'
import { LABEL_FONT } from '../src/components/graphUtils'
import { getTheme } from '../src/theme/themes'
import { buildLifeTimeline } from '../src/profile/timeline'
import { layoutLifeLines } from '../src/profile/lifeLinesLayout'
import { linesGeom, type LinesGeom } from '../src/profile/lifeLinesGeometry'
import { linesAnchor, linesKeepOut, linesLabelOrder } from '../src/profile/lifeLinesPaint'
import { horizonY } from '../src/profile/lifeGeometry'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import { lifeInk } from '../src/profile/lifeInk'
import { PRIVATE_REPO_LABEL, isRevealed, privateRepoKeys, repoNamer } from '../src/profile/privacy'
import {
  LIFE_LABEL_FONT,
  LOCK_PX,
  LifeLabelSet,
  labelNames,
  lifeLabelSpec,
  type LifeLabelFrame,
  type LifeLabelItems,
} from '../src/profile/useLifeLabels'
import type { LifeViewport } from '../src/profile/lifeTypes'
import type { ProfileData, ProfileRepo } from '../src/types'
import { recordingCtx } from './helpers/recordingCtx'

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

/** n commits on the first of every month of a year. */
function year(y: number, n: number): ProfileRepo['activity'] {
  return Array.from({ length: 12 }, (_, m) => ({ date: `${y}-${String(m + 1).padStart(2, '0')}-01`, commits: n }))
}

/**
 * The private repo is the busiest, so its label is placed first; a stale public copy of it is listed
 * too, as the timeline may lend a lane the public copy's fields.
 */
const PROFILE: ProfileData = {
  login: 'Me',
  name: null,
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  createdAt: iso('2019-01-10'),
  source: 'graphql',
  repos: [
    repo('Me/Secret-Plans', { createdAt: iso('2019-02-01'), stars: 40, isPrivate: true, activity: [...year(2019, 9), ...year(2020, 9)] }),
    repo('me/secret-plans', { createdAt: iso('2019-02-01'), stars: 40, isPrivate: false, activity: year(2019, 1) }),
    repo('Me/alpha', { createdAt: iso('2020-03-01'), stars: 5, activity: year(2020, 2) }),
    repo('Me/a-repo-with-a-rather-long-descriptive-name-for-testing', { createdAt: iso('2021-06-01'), activity: year(2021, 3) }),
    repo('someone/big-project', { createdAt: iso('2015-01-01'), firstActiveAt: iso('2022-05-01'), isOwn: false, activity: year(2022, 4) }),
    repo('Me/quiet', { createdAt: iso('2023-02-01'), activity: year(2023, 1) }),
  ],
  days: [],
  recent: [],
  recentFrom: null,
  milestones: [],
  restrictedContributions: 0,
  truncated: false,
  lostWindows: [],
  landed: [],
  fallback: null,
}

const VIEW: LifeViewport = { width: 1280, height: 800, top: 72, ground: 44, side: 28 }
const timeline = buildLifeTimeline(PROFILE, NOW)
const layout = layoutLifeLines(timeline, PROFILE.source)
const camera = fitLifeCamera(layout.days, VIEW)
const geoms = linesGeom(layout, camera, VIEW)
/** The label set's items: the lines, the heaviest named first. */
const itemsOf = (l: typeof layout): LifeLabelItems => ({ keys: l.lines.map((line) => line.key), order: linesLabelOrder(l) })
const keys = privateRepoKeys(PROFILE)
const ink = lifeInk(getTheme('paper'))
const SECRET = layout.byKey.get('me/secret-plans')!

/** A frame of the labels: each line's start as its anchor, none for a hidden line or one not reached by at. */
interface LinesFrame {
  geoms: LinesGeom
  view: LifeViewport
  dtMs: number
  cameraMoving: boolean
  hidden: ReadonlySet<string>
  forced: number[]
  explore: number
  at: number | null
}

function frame(over: Partial<LinesFrame> = {}): LifeLabelFrame {
  const f: LinesFrame = { geoms, view: VIEW, dtMs: 16, cameraMoving: false, hidden: new Set(), forced: [], explore: -1, at: null, ...over }
  const lines = layout.lines
  const anchor = (i: number, out: Float32Array) =>
    !f.hidden.has(lines[i].key) && !(f.at !== null && lines[i].startDay > f.at) && linesAnchor(layout, f.geoms, i, f.at, out)
  return { anchor, keepOut: linesKeepOut(layout, f.view), view: f.view, dtMs: f.dtMs, cameraMoving: f.cameraMoving, forced: f.forced, explore: f.explore }
}

/** Runs frames until the labels are at rest (or n frames); returns whether they are still busy. */
function settle(labels: LifeLabelSet, f: LifeLabelFrame = frame(), n = 400): boolean {
  let busy = true
  for (let i = 0; i < n && busy; i++) busy = labels.update(f)
  return busy
}

/** A measure that remembers what it was asked to measure. */
function recordingMeasure() {
  const measured: string[] = []
  return { measured, measure: (text: string) => (measured.push(text), text.length * 6.5) }
}

const dot = () => ink.accent

/** Draws a settled label set (with the secret repo hovered, so its plate shows) and returns every text drawn or measured. */
function drawn(revealFor: string | null) {
  const names = labelNames(layout.lines, timeline, repoNamer(keys, isRevealed(revealFor, PROFILE.login)), PROFILE.login)
  const { measured, measure } = recordingMeasure()
  const labels = new LifeLabelSet(itemsOf(layout), names, measure)
  settle(labels)
  const rec = recordingCtx()
  labels.draw(rec.ctx, ink, dot)
  settle(labels, frame({ forced: [SECRET], explore: SECRET }))
  labels.draw(rec.ctx, ink, dot)
  const filled = rec.calls('fillText').map((c) => String(c.args[0]))
  return { labels, rec, filled, texts: [...rec.texts(), ...measured] }
}

describe('labelNames', () => {
  it('names every repo through the namer, without the owner of the person’s own repos', () => {
    const names = labelNames(layout.lines, timeline, repoNamer(keys, false), 'me')
    const byKey = (key: string) => names[layout.byKey.get(key)!]
    expect(byKey('me/secret-plans')).toEqual({ text: PRIVATE_REPO_LABEL, locked: true })
    expect(byKey('me/alpha')).toEqual({ text: 'alpha', locked: false })
    expect(byKey('someone/big-project')).toEqual({ text: 'someone/big-project', locked: false })
    const shown = labelNames(layout.lines, timeline, repoNamer(keys, true), 'ME')
    expect(shown[layout.byKey.get('me/secret-plans')!].locked).toBe(true)
    expect(shown[layout.byKey.get('me/secret-plans')!].text.toLowerCase()).toBe('secret-plans')
  })
})

describe('lifeLabelSpec', () => {
  const measure = (text: string) => text.length * 6.5

  it('keeps room for the lock in every width of a locked name', () => {
    const spec = lifeLabelSpec(3, { text: PRIVATE_REPO_LABEL, locked: true }, measure)
    expect(spec).toMatchObject({ node: 3, texts: [PRIVATE_REPO_LABEL], fullText: PRIVATE_REPO_LABEL, names: [PRIVATE_REPO_LABEL] })
    expect(spec.widths).toEqual([measure(PRIVATE_REPO_LABEL) + LOCK_PX])
    expect(spec.fullWidth).toBe(measure(PRIVATE_REPO_LABEL) + LOCK_PX)
    expect(lifeLabelSpec(0, { text: 'alpha', locked: false }, measure).widths).toEqual([measure('alpha')])
  })

  it('cuts a long name to a wide and a compact form, and keeps the full name for its plate', () => {
    const long = 'a-repo-with-a-rather-long-descriptive-name-for-testing'
    const spec = lifeLabelSpec(0, { text: long, locked: false }, measure)
    expect(spec.texts).toHaveLength(2)
    expect(spec.widths[1]).toBeLessThanOrEqual(spec.widths[0] - 8)
    expect(spec.widths[0]).toBeLessThanOrEqual(200)
    expect(spec.texts.every((t) => t.endsWith('…'))).toBe(true)
    expect(spec.fullText).toBe(long)
  })
})

describe('LifeLabelSet', () => {
  it("draws in the font measureLabel measures with", () => {
    expect(LIFE_LABEL_FONT).toBe(`12px ${LABEL_FONT}`)
    const { rec } = drawn(null)
    expect(rec.calls('fillText').length).toBeGreaterThan(0)
    for (const call of rec.calls('fillText')) expect(call.style.font).toBe(LIFE_LABEL_FONT)
  })

  it.each([
    ['hidden by default', null],
    ['hidden after a reveal for another login', 'someone'],
  ])('never draws or measures a private name %s, and draws "private repo" with its lock', (_case, revealFor) => {
    const { filled, texts, rec, labels } = drawn(revealFor)
    for (const text of texts) expect(text.toLowerCase()).not.toContain('secret')
    expect(labels.placer.shown[SECRET]).toBe(1)
    expect(filled).toContain(PRIVATE_REPO_LABEL)
    // the lock: a shackle arc from PI to 0, on the label and on its plate
    expect(rec.calls('arc').filter((c) => c.args[3] === Math.PI && c.args[4] === 0).length).toBeGreaterThanOrEqual(2)
    // the hover plate names the hovered repo as shown
    expect(labels.placer.plates[SECRET]?.rows[0].text).toBe(PRIVATE_REPO_LABEL)
  })

  it('draws a private name revealed for this login, still with its lock', () => {
    const { filled, rec } = drawn('me')
    expect(filled.some((text) => text.toLowerCase().includes('secret-plans'))).toBe(true)
    expect(filled).not.toContain(PRIVATE_REPO_LABEL)
    expect(rec.calls('arc').some((c) => c.args[3] === Math.PI && c.args[4] === 0)).toBe(true)
  })

  it('keeps labels off the ground and draws text over a halo in the canvas colour', () => {
    const { rec } = drawn(null)
    for (const call of rec.calls('fillText')) expect(Number(call.args[2])).toBeLessThan(horizonY(VIEW))
    expect(rec.calls('strokeText').every((c) => c.style.strokeStyle === ink.textHalo)).toBe(true)
    expect(rec.calls('fill').some((c) => c.style.fillStyle === ink.labelPlateFill)).toBe(true)
  })

  it('drops the label of a hidden line, and of one the time-lapse has not reached', () => {
    const names = labelNames(layout.lines, timeline, repoNamer(keys, true), 'Me')
    const alpha = layout.byKey.get('me/alpha')!
    const labels = new LifeLabelSet(itemsOf(layout), names)
    settle(labels)
    expect(labels.placer.shown[alpha]).toBe(1)
    settle(labels, frame({ hidden: new Set(['me/alpha']), forced: [alpha], explore: alpha }))
    const rec = recordingCtx()
    labels.draw(rec.ctx, ink, dot)
    expect(rec.calls('fillText').map((c) => c.args[0])).not.toContain('alpha')
    expect(labels.placer.forcedLabels).not.toContain(alpha)

    const early = new LifeLabelSet(itemsOf(layout), names)
    settle(early, frame({ at: layout.lines[alpha].startDay - 1 }))
    expect(early.placer.shown[alpha]).toBe(0)
  })

  it('hits a shown label and its plate', () => {
    const names = labelNames(layout.lines, timeline, repoNamer(keys, false), 'Me')
    const labels = new LifeLabelSet(itemsOf(layout), names)
    settle(labels)
    const p = labels.placer
    const i = Array.from({ length: p.n }, (_, k) => k).find((k) => p.shown[k] && p.alpha[k] >= 0.5)!
    expect(i).toBeDefined()
    const x = p.x0[i] + p.w[i] / 2
    const y = p.y0[i] + p.h[i] / 2
    expect(labels.hit(x, y)).toBe(i)
    expect(labels.click(x, y)).toBe(i)
    expect(labels.hit(-50, -50)).toBe(-1)
  })

  it('dims every label but the selected one', () => {
    const names = labelNames(layout.lines, timeline, repoNamer(keys, false), 'Me')
    const labels = new LifeLabelSet(itemsOf(layout), names)
    settle(labels)
    const rec = recordingCtx()
    labels.draw(rec.ctx, ink, dot, SECRET)
    const alphas = new Set(rec.calls('fillText').map((c) => c.style.globalAlpha))
    expect(alphas).toContain(ink.dimAlpha)
    expect(alphas).toContain(1)
  })

  it('takes over the spots of the set before when the names change', () => {
    const hidden = new LifeLabelSet(itemsOf(layout), labelNames(layout.lines, timeline, repoNamer(keys, false), 'Me'))
    settle(hidden)
    const shown = new LifeLabelSet(itemsOf(layout), labelNames(layout.lines, timeline, repoNamer(keys, true), 'Me'), undefined, hidden)
    expect(Array.from(shown.placer.shown)).toEqual(Array.from(hidden.placer.shown))
  })

  it('handles a profile without repos', () => {
    const empty = buildLifeTimeline({ ...PROFILE, repos: [], source: 'rest' }, NOW)
    const emptyLayout = layoutLifeLines(empty, 'rest')
    const labels = new LifeLabelSet(itemsOf(emptyLayout), [])
    expect(settle(labels, frame({ geoms: linesGeom(emptyLayout, camera, VIEW) }))).toBe(false)
    const rec = recordingCtx()
    labels.draw(rec.ctx, ink, dot)
    expect(rec.calls('fillText')).toHaveLength(0)
    expect(labels.hit(10, 10)).toBe(-1)
  })
})
