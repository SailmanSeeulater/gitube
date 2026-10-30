/**
 * The life poster (PROFILE_SPEC.md section 6 and Phase 5): which three milestones it shows and in
 * what order, its years, the avatar's URL and how it loads (an <img> with CORS, never fetch()), the
 * frame on a recording context (texts, the clipped avatar or its placeholder, the view in its
 * plot, the lock, theme colours only), the view painted off screen fully grown with no hover or
 * selection, and saving it: one PNG named after the login, then poster-export with no data, nothing
 * sent on a failure. Private names stay hidden in everything it draws or measures until revealed.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportFileName } from '../src/export/repoFile'
import type { EventData } from '../src/analytics/umami'
import { fitLifeCamera } from '../src/profile/lifeCamera'
import {
  POSTER_AVATAR_PX,
  POSTER_VIEWPORT,
  POSTER_HEIGHT,
  POSTER_PLOT,
  POSTER_SCALE,
  POSTER_WIDTH,
  composeLifePoster,
  loadPosterAvatar,
  paintPosterFrame,
  paintPosterView,
  posterAvatarUrl,
  posterCredit,
  posterMilestones,
  posterYears,
  saveLifePoster,
  type PosterDeps,
  type PosterView,
  type PosterInput,
  type PosterKit,
  type PosterText,
} from '../src/profile/lifePoster'
import { PRIVATE_REPO_LABEL, repoKey, repoNamer } from '../src/profile/privacy'
import type { LifeMilestone } from '../src/profile/timeline'
import { LIFE_LABEL_FONT } from '../src/profile/useLifeLabels'
import { usePersonStore } from '../src/profile/usePersonStore'
import { LINES_VIEW } from '../src/profile/lifeViews'
import { useAppStore } from '../src/store/useAppStore'
import { THEMES, getTheme, type Theme } from '../src/theme/themes'
import type { ProfileData } from '../src/types'
import { KEPANO_NOW, grow, kepanoProfile, painterFor, setPerson, withPrivate, type Grown } from './helpers/personScene'
import { recordingCtx, type CtxEntry, type RecordingCtx } from './helpers/recordingCtx'

const theme = getTheme('obsidian')

/** As in personGuards: the top-starred repo (a derived milestone names it), his own, one he contributed to, a seedling fork, an archived one. */
const KEPANO_PRIVATE = ['kepano/obsidian-skills', 'kepano/tidy', 'obsidianmd/wordgard', 'kepano/bookcover-api', 'kepano/obsidian-highlights-sidebar']
const KEPANO_STALE = ['kepano/aloha']
const SECRET_NAMES = [...KEPANO_PRIVATE, ...KEPANO_STALE]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A private name, whole, with or without its owner (the labels drop the person's own login). */
const SECRETS = SECRET_NAMES.flatMap((name) => [
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
let secret: ProfileData

beforeAll(async () => {
  kepano = await kepanoProfile()
  secret = withPrivate(kepano, KEPANO_PRIVATE, KEPANO_STALE)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useAppStore.setState({ token: '' })
})

const milestone = (kind: LifeMilestone['kind'], day: string, label: string, repo?: string): LifeMilestone => ({
  kind,
  date: `${day}T20:00:00Z`,
  day,
  label,
  ...(repo ? { repo } : {}),
})

const MILESTONES: LifeMilestone[] = [
  milestone('joined', '2013-03-01', 'Joined GitHub'),
  milestone('first-repo', '2013-04-02', 'first repo', 'me/first'),
  milestone('first-pr', '2013-05-03', 'First pull request', 'other/lib'),
  milestone('first-issue', '2013-05-10', 'First issue', 'other/lib'),
  milestone('top-repo', '2015-02-02', 'most starred repo: 900 stars', 'me/plans'),
  milestone('language-switch', '2016-01-01', 'Ruby to Go'),
  milestone('longest-streak', '2018-06-01', 'longest streak: 40 days'),
  milestone('language-switch', '2019-04-01', 'Go to Rust'),
]

describe('posterMilestones', () => {
  const name = repoNamer(new Set(), false)

  it('picks three by kind and shows them in day order', () => {
    expect(posterMilestones(MILESTONES, name)).toEqual([
      { day: '2013-04-02', label: 'first repo', repo: { text: 'me/first', locked: false } },
      { day: '2015-02-02', label: 'most starred repo: 900 stars', repo: { text: 'me/plans', locked: false } },
      { day: '2018-06-01', label: 'longest streak: 40 days', repo: null },
    ])
  })

  it('gives the same three whatever order the milestones come in', () => {
    const expected = posterMilestones(MILESTONES, name)
    const reversed = [...MILESTONES].reverse()
    const rotated = [...MILESTONES.slice(3), ...MILESTONES.slice(0, 3)]
    const interleaved = MILESTONES.filter((_, i) => i % 2 === 1).concat(MILESTONES.filter((_, i) => i % 2 === 0))
    for (const input of [reversed, rotated, interleaved]) expect(posterMilestones(input, name)).toEqual(expected)
  })

  it('breaks a tie of kinds by day', () => {
    const switches = [MILESTONES[7], MILESTONES[0], MILESTONES[5], milestone('language-switch', '2017-07-01', 'Go to Elixir')]
    expect(posterMilestones(switches, name, 2).map((m) => m.label)).toEqual(['Ruby to Go', 'Go to Elixir'])
  })

  it('shows all of fewer than three, and none of none', () => {
    expect(posterMilestones([MILESTONES[5], MILESTONES[0]], name).map((m) => m.day)).toEqual(['2013-03-01', '2016-01-01'])
    expect(posterMilestones([], name)).toEqual([])
  })

  it('names a private repo as the screen does: hidden and locked, or revealed and still locked', () => {
    const keys = new Set([repoKey('me/plans')])
    const hidden = posterMilestones(MILESTONES, repoNamer(keys, false))
    expect(hidden[1].repo).toEqual({ text: PRIVATE_REPO_LABEL, locked: true })
    expect(JSON.stringify(hidden)).not.toContain('me/plans')
    expect(posterMilestones(MILESTONES, repoNamer(keys, true))[1].repo).toEqual({ text: 'me/plans', locked: true })
  })

  it('takes the top repo and two more from a real life', () => {
    const g = grow(secret, KEPANO_NOW, theme)
    const picked = posterMilestones(g.timeline.milestones, g.name)
    expect(picked).toHaveLength(3)
    expect([...picked].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))).toEqual(picked)
    const top = g.timeline.milestones.find((m) => m.kind === 'top-repo')!
    expect(picked.find((m) => m.label === top.label)?.repo).toEqual({ text: PRIVATE_REPO_LABEL, locked: true })
    expect(posterMilestones(g.timeline.milestones, grow(secret, KEPANO_NOW, theme, 'kepano').name).find((m) => m.label === top.label)?.repo).toEqual({
      text: 'kepano/obsidian-skills',
      locked: true,
    })
  })
})

describe('posterYears and posterCredit', () => {
  it('spans the years from GitHub day keys, or names one', () => {
    expect(posterYears({ start: '2013-03-01', today: '2026-10-25' })).toBe('2013–2026')
    expect(posterYears({ start: '2026-01-04', today: '2026-10-25' })).toBe('2026')
  })

  it('credits the app with the day', () => {
    expect(posterCredit(new Date(2026, 9, 25, 12), 'en-US')).toBe('gitube · Oct 25, 2026')
  })
})

describe('posterAvatarUrl', () => {
  const px = POSTER_AVATAR_PX * POSTER_SCALE

  it('asks for the poster size, with ? or &', () => {
    expect(posterAvatarUrl('https://avatars.githubusercontent.com/u/1', px)).toBe(`https://avatars.githubusercontent.com/u/1?s=${px}`)
    expect(posterAvatarUrl('https://avatars.githubusercontent.com/u/1?v=4', px)).toBe(`https://avatars.githubusercontent.com/u/1?v=4&s=${px}`)
    // a size already there gives way, so the request never matches the panel's cached one
    expect(posterAvatarUrl('https://avatars.githubusercontent.com/u/1?s=64&v=4', px)).toBe(`https://avatars.githubusercontent.com/u/1?s=${px}&v=4`)
  })

  it("takes only GitHub's avatar host over https", () => {
    for (const url of [
      'http://avatars.githubusercontent.com/u/1',
      'https://evil.example/u/1',
      'https://avatars.githubusercontent.com.evil.example/u/1',
      'https://user:pw@avatars.githubusercontent.com/u/1',
      'javascript:alert(1)',
      'not a url',
      '',
    ]) {
      expect(posterAvatarUrl(url, px), url).toBeNull()
    }
  })
})

/** An Image stand-in that notes which properties were set, in order. */
function fakeImages() {
  const made: FakeImage[] = []
  class FakeImage {
    readonly sets: string[] = []
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    private crossOriginValue: string | null = null
    private referrerValue = ''
    private srcValue = ''
    constructor() {
      made.push(this)
    }
    get crossOrigin() {
      return this.crossOriginValue
    }
    set crossOrigin(value: string | null) {
      this.sets.push('crossOrigin')
      this.crossOriginValue = value
    }
    get referrerPolicy() {
      return this.referrerValue
    }
    set referrerPolicy(value: string) {
      this.sets.push('referrerPolicy')
      this.referrerValue = value
    }
    get src() {
      return this.srcValue
    }
    set src(value: string) {
      this.sets.push('src')
      this.srcValue = value
    }
  }
  vi.stubGlobal('Image', FakeImage)
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  return { made, fetchSpy }
}

describe('loadPosterAvatar', () => {
  const url = `https://avatars.githubusercontent.com/u/1?s=${POSTER_AVATAR_PX * POSTER_SCALE}`

  it('loads through an <img> with CORS and no referrer, set before its src, and never fetch()', async () => {
    const { made, fetchSpy } = fakeImages()
    const loading = loadPosterAvatar(url)
    expect(made).toHaveLength(1)
    const img = made[0]
    expect(img.crossOrigin).toBe('anonymous')
    expect(img.referrerPolicy).toBe('no-referrer')
    expect(img.src).toBe(url)
    expect(img.sets.indexOf('crossOrigin')).toBeLessThan(img.sets.indexOf('src'))
    expect(img.sets.indexOf('referrerPolicy')).toBeLessThan(img.sets.indexOf('src'))
    img.onload?.()
    await expect(loading).resolves.toBe(img)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('gives null on an error (as a host without CORS fails), on a timeout, and for no url', async () => {
    const { made, fetchSpy } = fakeImages()
    const failing = loadPosterAvatar(url)
    made[0].onerror?.()
    await expect(failing).resolves.toBeNull()

    vi.useFakeTimers()
    const slow = loadPosterAvatar(url, 1000)
    vi.advanceTimersByTime(999)
    let settled = false
    void slow.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(slow).resolves.toBeNull()
    // a load after the timeout changes nothing
    expect(made[1].onload).toBeNull()

    await expect(loadPosterAvatar(null)).resolves.toBeNull()
    expect(made).toHaveLength(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ---------- the frame ----------

const PLOT_IMAGE = { tag: 'the view image' } as unknown as CanvasImageSource
const AVATAR = { tag: 'the avatar' } as unknown as CanvasImageSource

const TEXT: PosterText = {
  login: 'kepano',
  years: '2013–2026',
  milestones: [
    { day: '2013-04-02', label: 'first repo', repo: { text: 'kepano/kepano.com', locked: false } },
    { day: '2015-02-02', label: 'most starred repo: 900 stars', repo: { text: PRIVATE_REPO_LABEL, locked: true } },
    { day: '2018-06-01', label: 'longest streak: 40 days', repo: null },
  ],
  credit: 'gitube · Oct 25, 2026',
}

function frame(text: PosterText, avatar: CanvasImageSource | null, t: Theme = theme): RecordingCtx {
  const rec = recordingCtx(POSTER_WIDTH * POSTER_SCALE, POSTER_HEIGHT * POSTER_SCALE)
  rec.ctx.setTransform(POSTER_SCALE, 0, 0, POSTER_SCALE, 0, 0)
  rec.clear()
  paintPosterFrame(rec.ctx, text, t, PLOT_IMAGE, avatar)
  return rec
}

const indexOfCall = (rec: RecordingCtx, name: string, from = 0) => rec.log.findIndex((e, i) => i >= from && e.kind === 'call' && e.name === name)

/** Every colour string a theme holds, its derived ones included. */
function themeColours(t: Theme): Set<unknown> {
  const out = new Set<unknown>()
  for (const value of [...Object.values(t), ...Object.values(t.derived)]) if (typeof value === 'string') out.add(value)
  return out
}

describe('paintPosterFrame', () => {
  it('fills the whole backing store with the canvas colour first', () => {
    const rec = frame(TEXT, AVATAR)
    const fill = rec.calls('fillRect')[0]
    expect(fill.args).toEqual([0, 0, POSTER_WIDTH * POSTER_SCALE, POSTER_HEIGHT * POSTER_SCALE])
    expect(fill.style.fillStyle).toBe(theme.canvas)
    expect(rec.calls('setTransform')[0].args).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('writes the login, the years, each milestone and the credit', () => {
    const drawn = frame(TEXT, AVATAR).calls('fillText').map((c) => String(c.args[0]))
    for (const text of [TEXT.login, TEXT.years, TEXT.credit]) expect(drawn).toContain(text)
    for (const m of TEXT.milestones) {
      expect(drawn).toContain(m.day)
      expect(drawn).toContain(m.label)
      if (m.repo) expect(drawn).toContain(m.repo.text)
    }
  })

  it('draws the avatar clipped to a circle, and the view into its plot', () => {
    const rec = frame(TEXT, AVATAR)
    const images = rec.calls('drawImage')
    expect(images.map((c) => c.args)).toEqual([
      [PLOT_IMAGE, POSTER_PLOT.x, POSTER_PLOT.y, POSTER_PLOT.width, POSTER_PLOT.height],
      [AVATAR, expect.any(Number), expect.any(Number), POSTER_AVATAR_PX, POSTER_AVATAR_PX],
    ])
    const avatarAt = rec.log.indexOf(images[1])
    const clipAt = indexOfCall(rec, 'clip')
    expect(clipAt).toBeGreaterThan(-1)
    expect(clipAt).toBeLessThan(avatarAt)
    const arc = rec.log.slice(0, clipAt).filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && e.name === 'arc').pop()
    expect(arc?.args[2]).toBe(POSTER_AVATAR_PX / 2)
    // the plot lies between the header and the milestones, across the whole width
    expect(POSTER_PLOT.y).toBeGreaterThan(POSTER_AVATAR_PX)
    expect(POSTER_PLOT.y + POSTER_PLOT.height).toBeLessThan(POSTER_HEIGHT - 100)
    expect(POSTER_VIEWPORT).toMatchObject({ width: POSTER_PLOT.width, height: POSTER_PLOT.height })
  })

  it('draws a placeholder circle with the initial when there is no avatar', () => {
    const rec = frame(TEXT, null)
    expect(rec.calls('drawImage').map((c) => c.args[0])).toEqual([PLOT_IMAGE])
    expect(rec.calls('clip')).toHaveLength(0)
    const arcAt = indexOfCall(rec, 'arc')
    const fill = rec.log.slice(arcAt).find((e) => e.kind === 'call' && e.name === 'fill') as Extract<CtxEntry, { kind: 'call' }>
    expect(fill.style.fillStyle).toBe(theme.hover)
    expect(rec.calls('fillText').map((c) => c.args[0])).toContain('K')
  })

  it('draws a lock beside a locked name only', () => {
    expect(frame(TEXT, AVATAR).calls('rect')).toHaveLength(1)
    const open = { ...TEXT, milestones: TEXT.milestones.map((m) => ({ ...m, repo: m.repo && { ...m.repo, locked: false } })) }
    expect(frame(open, AVATAR).calls('rect')).toHaveLength(0)
  })

  it('says so when there are no milestones', () => {
    const drawn = frame({ ...TEXT, milestones: [] }, AVATAR).calls('fillText').map((c) => c.args[0])
    expect(drawn).toContain('no milestones yet')
  })

  it('cuts a long name to its column', () => {
    const long = 'x'.repeat(400)
    const rec = frame({ ...TEXT, milestones: [{ day: '2020-01-01', label: long, repo: { text: long, locked: true } }] }, AVATAR)
    const cut = rec.calls('fillText').filter((c) => String(c.args[0]).startsWith('xxx'))
    expect(cut).toHaveLength(2)
    for (const c of cut) expect(String(c.args[0]).endsWith('…')).toBe(true)
  })

  it('paints in theme colours only, with finite numbers, in every theme', () => {
    for (const t of THEMES) {
      const rec = frame(TEXT, null, t)
      const colours = themeColours(t)
      for (const value of [...rec.sets('fillStyle'), ...rec.sets('strokeStyle')]) expect(colours.has(value), `${t.id}: ${String(value)}`).toBe(true)
      for (const c of rec.calls('fillText')) expect(colours.has(c.style.fillStyle), t.id).toBe(true)
      for (const entry of rec.log) {
        if (entry.kind !== 'call') continue
        for (const arg of entry.args) if (typeof arg === 'number') expect(Number.isFinite(arg), `${t.id}: ${entry.name}`).toBe(true)
      }
    }
  })
})

// ---------- the view off screen (life lines) ----------

function posterView(g: Grown, hidden: ReadonlySet<string> = new Set(), measured: string[] = []): PosterView {
  return {
    layout: g.layout,
    view: LINES_VIEW,
    timeline: g.timeline,
    ink: g.ink,
    colourOf: g.colourOf,
    name: g.name,
    login: g.profile.login,
    hidden,
    measure: (text) => {
      measured.push(text)
      return text.length * 6.5
    },
  }
}

function viewRec(): RecordingCtx {
  const rec = recordingCtx(POSTER_VIEWPORT.width * POSTER_SCALE, POSTER_VIEWPORT.height * POSTER_SCALE)
  rec.ctx.setTransform(POSTER_SCALE, 0, 0, POSTER_SCALE, 0, 0)
  rec.clear()
  return rec
}

/** Where each frame starts: the painter's fill of the whole backing store. */
const frameStarts = (log: readonly CtxEntry[]) =>
  log.flatMap((e, i) => (e.kind === 'call' && e.name === 'setTransform' && e.args.join() === '1,0,0,1,0,0' ? [i] : []))

/** The last frame painted. */
function lastFrame(rec: RecordingCtx): CtxEntry[] {
  const starts = frameStarts(rec.log)
  return rec.log.slice(starts[starts.length - 1] ?? 0)
}

const countCalls = (log: readonly CtxEntry[], name: string) => log.filter((e) => e.kind === 'call' && e.name === name).length
const drawnTexts = (log: readonly CtxEntry[]) =>
  log.flatMap((e) => (e.kind === 'call' && (e.name === 'fillText' || e.name === 'strokeText') ? [String(e.args[0])] : []))

/** One frame by life lines' painter in the poster's viewport, fitted. */
function referenceFrame(g: Grown, state: Parameters<typeof painterFor>[1], progress?: number): RecordingCtx {
  const { painter } = painterFor(g, state, { timelapse: progress === undefined ? null : { progress: { current: progress } } })
  const rec = viewRec()
  painter.paint(rec.ctx, POSTER_VIEWPORT, fitLifeCamera(g.layout.days, POSTER_VIEWPORT), 16)
  return rec
}

describe('paintPosterView', () => {
  beforeEach(() => {
    usePersonStore.getState().resetFor('nobody')
    setPerson({ hover: null, selected: null, hidden: new Set() })
  })

  it('paints the view fully grown, until its labels settle', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const rec = viewRec()
    paintPosterView(rec.ctx, POSTER_VIEWPORT, posterView(g))
    const frames = frameStarts(rec.log).length
    expect(frames).toBeGreaterThan(1)
    expect(frames).toBeLessThan(400)
    const last = lastFrame(rec)
    const strokes = countCalls(last, 'lineTo')
    expect(strokes).toBe(countCalls(referenceFrame(g, {}).log, 'lineTo'))
    expect(strokes).toBeGreaterThan(countCalls(referenceFrame(g, {}, 0.5).log, 'lineTo'))
    // the labels are drawn, fully faded in
    const labels = last.filter((e): e is Extract<CtxEntry, { kind: 'call' }> => e.kind === 'call' && e.name === 'fillText' && e.style.font === LIFE_LABEL_FONT)
    expect(labels.length).toBeGreaterThan(5)
    expect(labels.every((e) => e.style.globalAlpha === 1)).toBe(true)
  })

  it('stops at maxFrames', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const rec = viewRec()
    paintPosterView(rec.ctx, POSTER_VIEWPORT, posterView(g), 3)
    expect(frameStarts(rec.log)).toHaveLength(3)
  })

  it('draws no hover or selection, whatever the store holds', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const plain = viewRec()
    paintPosterView(plain.ctx, POSTER_VIEWPORT, posterView(g))
    const key = g.layout.lines[0].key
    const hover = { kind: 'repo' as const, key }
    setPerson({ hover, selected: key })
    const held = viewRec()
    paintPosterView(held.ctx, POSTER_VIEWPORT, posterView(g))
    expect(held.log).toEqual(plain.log)
    // the painter would show them: rings and a plate
    const shown = referenceFrame(g, { hover, selected: key })
    expect(shown.log).not.toEqual(referenceFrame(g, {}).log)
    expect(shown.calls('stroke').some((c) => c.style.strokeStyle === g.ink.labelPlateRing)).toBe(true)
    expect(lastFrame(plain).some((e) => e.kind === 'call' && e.name === 'stroke' && e.style.strokeStyle === g.ink.labelPlateRing)).toBe(false)
  })

  it('leaves out what the eyes hide', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const all = viewRec()
    paintPosterView(all.ctx, POSTER_VIEWPORT, posterView(g))
    // the line with the most parts
    const line = [...g.layout.lines].sort((a, b) => b.parts.length - a.parts.length)[0]
    const without = viewRec()
    paintPosterView(without.ctx, POSTER_VIEWPORT, posterView(g, new Set([line.key])))
    // its parts go, as the painter leaves them out for the eye
    const strokes = countCalls(lastFrame(without), 'lineTo')
    expect(strokes).toBe(countCalls(referenceFrame(g, { hidden: new Set([line.key]) }).log, 'lineTo'))
    expect(strokes).toBeLessThan(countCalls(lastFrame(all), 'lineTo'))
    const label = g.timeline.lanes[line.lane].repo.replace(/^kepano\//i, '')
    expect(drawnTexts(lastFrame(without))).not.toContain(label)
  })

  it('draws and measures no private name while hidden, and the names once revealed', () => {
    const hiddenMeasured: string[] = []
    const hidden = viewRec()
    paintPosterView(hidden.ctx, POSTER_VIEWPORT, posterView(grow(secret, KEPANO_NOW, theme), new Set(), hiddenMeasured))
    expectNoSecret([...hidden.texts(), ...hiddenMeasured], 'the hidden view')
    expect(drawnTexts(lastFrame(hidden))).toContain(PRIVATE_REPO_LABEL)

    // revealed for another login: still hidden
    const otherMeasured: string[] = []
    const other = viewRec()
    paintPosterView(other.ctx, POSTER_VIEWPORT, posterView(grow(secret, KEPANO_NOW, theme, 'someone-else'), new Set(), otherMeasured))
    expectNoSecret([...other.texts(), ...otherMeasured], 'the view revealed for another login')

    const shownMeasured: string[] = []
    const shown = viewRec()
    paintPosterView(shown.ctx, POSTER_VIEWPORT, posterView(grow(secret, KEPANO_NOW, theme, 'kepano'), new Set(), shownMeasured))
    const shownText = [...shown.texts(), ...shownMeasured].join('\n')
    expect(SECRETS.some((s) => s.test(shownText))).toBe(true)
  })
})

// ---------- composing and saving ----------

function inputOf(g: Grown, hidden: ReadonlySet<string> = new Set()): PosterInput {
  return { profile: g.profile, timeline: g.timeline, layout: g.layout, view: LINES_VIEW, theme: g.theme, colourOf: g.colourOf, name: g.name, hidden }
}

interface Rig {
  deps: Partial<PosterDeps>
  recs: RecordingCtx[]
  canvases: HTMLCanvasElement[]
  measured: string[]
  avatarUrls: Array<string | null>
  kit: PosterKit & { canvasToPng: ReturnType<typeof vi.fn>; downloadBlob: ReturnType<typeof vi.fn> }
  umamiTrack: ReturnType<typeof vi.fn<(event: string, data?: EventData) => unknown>>
  fetchSpy: ReturnType<typeof vi.fn>
  /** what happened, in order */
  steps: string[]
}

const NOW = new Date(2026, 9, 25, 12)
const PNG = new Blob(['not really a png'])

function rig(over: Partial<PosterDeps> = {}): Rig {
  const recs: RecordingCtx[] = []
  const canvases: HTMLCanvasElement[] = []
  const measured: string[] = []
  const avatarUrls: Array<string | null> = []
  const steps: string[] = []
  const umamiTrack = vi.fn<(event: string, data?: EventData) => unknown>(() => steps.push('track'))
  vi.stubGlobal('window', { umami: { track: umamiTrack }, location: { search: '' } })
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  const kit = {
    canvasToPng: vi.fn(async () => PNG),
    downloadBlob: vi.fn(() => steps.push('download')),
    exportFileName,
  }
  const deps: Partial<PosterDeps> = {
    loadKit: async () => kit,
    loadAvatar: async (url) => {
      avatarUrls.push(url)
      return AVATAR
    },
    makeCanvas: (width, height) => {
      const rec = recordingCtx(width, height)
      recs.push(rec)
      const canvas = { width, height, getContext: (kind: string) => (kind === '2d' ? rec.ctx : null) } as unknown as HTMLCanvasElement
      canvases.push(canvas)
      return canvas
    },
    now: () => NOW,
    measure: (text) => {
      measured.push(text)
      return text.length * 6.5
    },
    ...over,
  }
  return { deps, recs, canvases, measured, avatarUrls, kit, umamiTrack, fetchSpy, steps }
}

describe('composeLifePoster', () => {
  it('paints the view off screen, then frames it, at the poster scale', () => {
    const r = rig()
    const g = grow(kepano, KEPANO_NOW, theme)
    const poster = composeLifePoster(inputOf(g), AVATAR, r.deps as PosterDeps)
    expect(r.canvases).toHaveLength(2)
    const [plot, frameRec] = r.recs
    expect([r.canvases[0].width, r.canvases[0].height]).toEqual([POSTER_PLOT.width * POSTER_SCALE, POSTER_PLOT.height * POSTER_SCALE])
    expect(poster).toBe(r.canvases[1])
    expect([poster.width, poster.height]).toEqual([POSTER_WIDTH * POSTER_SCALE, POSTER_HEIGHT * POSTER_SCALE])
    expect(plot.calls('setTransform')[0].args).toEqual([POSTER_SCALE, 0, 0, POSTER_SCALE, 0, 0])
    expect(frameRec.calls('setTransform')[0].args).toEqual([POSTER_SCALE, 0, 0, POSTER_SCALE, 0, 0])
    expect(frameRec.calls('drawImage').map((c) => c.args[0])).toEqual([r.canvases[0], AVATAR])
    const drawn = frameRec.calls('fillText').map((c) => String(c.args[0]))
    expect(drawn).toContain('kepano')
    expect(drawn).toContain(posterYears(g.timeline))
    expect(drawn).toContain(posterCredit(NOW))
    for (const m of posterMilestones(g.timeline.milestones, g.name)) expect(drawn).toContain(m.label)
  })

  it('throws without a 2D context', () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const deps = rig({ makeCanvas: (width, height) => ({ width, height, getContext: () => null }) as unknown as HTMLCanvasElement }).deps
    expect(() => composeLifePoster(inputOf(g), null, deps as PosterDeps)).toThrow('canvas 2D context unavailable')
  })
})

describe('saveLifePoster', () => {
  it('downloads one PNG named after the login, then sends poster-export with no data', async () => {
    const r = rig()
    const g = grow(kepano, KEPANO_NOW, theme)
    await saveLifePoster(inputOf(g), r.deps)
    expect(r.kit.canvasToPng).toHaveBeenCalledTimes(1)
    expect(r.kit.canvasToPng.mock.calls[0][0]).toBe(r.canvases[1])
    expect(r.kit.downloadBlob.mock.calls).toEqual([[PNG, 'kepano-life-poster-2026-10-25.png']])
    expect(r.umamiTrack.mock.calls).toEqual([['poster-export']])
    expect(r.steps).toEqual(['download', 'track'])
    // the avatar at twice its drawn size, from GitHub's avatar host only
    expect(r.avatarUrls).toHaveLength(1)
    expect(r.avatarUrls[0]).toMatch(/^https:\/\/avatars\.githubusercontent\.com\//)
    expect(new URL(r.avatarUrls[0]!).searchParams.get('s')).toBe(String(POSTER_AVATAR_PX * POSTER_SCALE))
    expect(r.fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps every private name out of the poster, its file name and its event while hidden', async () => {
    const r = rig()
    const g = grow(secret, KEPANO_NOW, theme)
    // the eyes hide one of them too
    await saveLifePoster(inputOf(g, new Set([repoKey('kepano/tidy')])), r.deps)
    expectNoSecret([...r.recs.flatMap((rec) => rec.texts()), ...r.measured], 'the poster')
    expectNoSecret([JSON.stringify(r.kit.downloadBlob.mock.calls), JSON.stringify(r.umamiTrack.mock.calls)], 'the download and the event')
    const frameTexts = r.recs[1].calls('fillText').map((c) => String(c.args[0]))
    expect(frameTexts).toContain(PRIVATE_REPO_LABEL)
    // its lock
    expect(r.recs[1].calls('rect').length).toBeGreaterThan(0)
  })

  it('shows the private names once revealed for this login', async () => {
    const r = rig()
    await saveLifePoster(inputOf(grow(secret, KEPANO_NOW, theme, 'kepano')), r.deps)
    expect(r.recs[1].calls('fillText').map((c) => String(c.args[0]))).toContain('kepano/obsidian-skills')
    expect(r.kit.downloadBlob.mock.calls[0][1]).toBe('kepano-life-poster-2026-10-25.png')
  })

  it('draws the placeholder when the avatar fails, and still saves', async () => {
    const r = rig({ loadAvatar: async () => Promise.reject(new Error('no avatar')) })
    await saveLifePoster(inputOf(grow(kepano, KEPANO_NOW, theme)), r.deps)
    expect(r.recs[1].calls('drawImage').map((c) => c.args[0])).toEqual([r.canvases[0]])
    expect(r.umamiTrack.mock.calls).toEqual([['poster-export']])
  })

  it('rejects and sends nothing when encoding, the exporters or the canvas fail', async () => {
    const g = grow(kepano, KEPANO_NOW, theme)
    const encoding = rig()
    encoding.kit.canvasToPng.mockRejectedValueOnce(new Error('could not encode the image'))
    await expect(saveLifePoster(inputOf(g), encoding.deps)).rejects.toThrow('could not encode the image')
    expect(encoding.kit.downloadBlob).not.toHaveBeenCalled()
    expect(encoding.umamiTrack).not.toHaveBeenCalled()

    const chunk = rig({ loadKit: async () => Promise.reject(new Error("couldn't load part of the app")) })
    await expect(saveLifePoster(inputOf(g), chunk.deps)).rejects.toThrow("couldn't load part of the app")
    expect(chunk.umamiTrack).not.toHaveBeenCalled()

    const noCanvas = rig({ makeCanvas: (width, height) => ({ width, height, getContext: () => null }) as unknown as HTMLCanvasElement })
    await expect(saveLifePoster(inputOf(g), noCanvas.deps)).rejects.toThrow('canvas 2D context unavailable')
    expect(noCanvas.kit.downloadBlob).not.toHaveBeenCalled()
    expect(noCanvas.umamiTrack).not.toHaveBeenCalled()
    for (const r of [encoding, chunk, noCanvas]) expect(r.fetchSpy).not.toHaveBeenCalled()
  })
})
