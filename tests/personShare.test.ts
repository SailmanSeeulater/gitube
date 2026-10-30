/**
 * Person mode's share link and the Phase 5 controls (PROFILE_SPEC.md Phase 5): a copied
 * ?user=…&view=lines link reads back as the same person and view, PersonApp leaves it as it is,
 * and opening it starts clean (nothing hidden, selected or revealed, so the names a copier had
 * revealed stay hidden); the panel's copy-link and poster buttons, the strip's "replay", the
 * top bar's save menu (the poster as its image, never JSON), and PersonApp's wiring of them: the
 * time-lapse through openLifeTimelapse (the privacy toggle locked while it records), the poster
 * through saveLifePoster with the screen's namer, the reload card for a part that could not be
 * loaded, share-copy from repo mode's CopyLinkButton, and no JSON save, no fetch() and no
 * audio.
 */
import { subjectOf } from '../src/subject'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import PersonApp, { personSearch } from '../src/PersonApp'
import personAppSource from '../src/PersonApp.tsx?raw'
import ExportMenu from '../src/components/ExportMenu'
import panelSource from '../src/components/Panel.tsx?raw'
import topBarSource from '../src/components/TopBar.tsx?raw'
import { defineChunk } from '../src/lazy/chunk'
import personPanelSource from '../src/profile/PersonPanel.tsx?raw'
import PersonPanel from '../src/profile/PersonPanel'
import PersonStatus from '../src/profile/PersonStatus'
import { posterFailure, saveLifePoster, type PosterKit } from '../src/profile/lifePoster'
import { requestKey, startRequest } from '../src/profile/personRequests'
import { PRIVATE_REPO_LABEL, repoKey } from '../src/profile/privacy'
import { profileQueryKey } from '../src/profile/useProfileData'
import { usePersonStore } from '../src/profile/usePersonStore'
import { readSubject, type PersonView } from '../src/share/shareUrl'
import { getTheme } from '../src/theme/themes'
import type { ProfileData } from '../src/types'
import { FAKE_TOKEN, KEPANO_NOW, load, kepanoProfile, setApp, setPerson, withPrivate } from './helpers/personScene'
import { recordingCtx } from './helpers/recordingCtx'
import { LINES_VIEW } from '../src/profile/lifeViews'

const noop = () => {}
const theme = getTheme('obsidian')
const ORIGIN = 'https://gitube.example'

/** As in personGuards: kepano's top-starred repo, his own, one he contributed to, an uncounted fork and an archived one, made private. */
const KEPANO_PRIVATE = ['kepano/obsidian-skills', 'kepano/tidy', 'obsidianmd/wordgard', 'kepano/bookcover-api', 'kepano/obsidian-highlights-sidebar']

let kepano: ProfileData
let secret: ProfileData

beforeAll(async () => {
  kepano = await kepanoProfile()
  secret = withPrivate(kepano, KEPANO_PRIVATE)
})

beforeEach(() => {
  usePersonStore.getState().resetFor('nobody')
  setPerson({ tab: 'repos', hover: null, selected: null, hidden: new Set(), search: '', revealFor: null })
  setApp({ panelOpen: true, rate: null, token: '', themeId: theme.id })
})

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A private name, whole, with or without its owner. */
function expectNoSecret(text: string, where: string): void {
  for (const name of KEPANO_PRIVATE) {
    for (const secretName of [name, name.slice(name.indexOf('/') + 1)]) {
      const found = new RegExp(`(?<![\\w./-])${escape(secretName)}(?![\\w./-])`, 'i').exec(text)
      expect(found && text.slice(Math.max(0, found.index - 60), found.index + 60), `${secretName} in ${where}`).toBeNull()
    }
  }
}

/** What App hands PersonApp for a page address, through App's own subjectOf. */
function propsFor(href: string) {
  const read = subjectOf(new URL(href).search)
  if (read.kind !== 'user') throw new Error(`${href} opens no person`)
  return { login: read.login, request: read.request, view: read.view, focusInput: read.fromInput, onRepo: noop, onUser: noop }
}

/** PersonApp's markup for a link, the profile already in the query cache as a loaded one would be. */
function openLink(href: string, profile: ProfileData, token = ''): string {
  setApp({ token })
  const props = propsFor(href)
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(profileQueryKey(props.login, token), { profile, cachedAt: null })
  return renderToStaticMarkup(h(QueryClientProvider, { client }, h(PersonApp, props)))
}

/** What opening a link runs before its first paint (PersonApp's startRequest layout effect), where react-dom/server runs no effects. */
function startLink(href: string): void {
  const { login, request } = propsFor(href)
  startRequest(usePersonStore.getState(), requestKey(login, request))
  setPerson({})
}

describe('a copied link', () => {
  it('reads back as the same person and view, for every view', () => {
    for (const view of ['lines', 'constellation', 'phosphor', 'htop', 'gitlog', 'minimap', 'helix'] as PersonView[]) {
      const href = `${ORIGIN}/${personSearch('kepano', view, '')}`
      expect(href).toBe(`${ORIGIN}/?user=kepano&view=${view}`)
      expect(readSubject(new URL(href).search)).toEqual({ kind: 'user', login: 'kepano', view })
    }
    // the login keeps its typed case, and other parameters ride along
    const tagged = `${ORIGIN}/${personSearch('Kepano', 'lines', '?utm_source=x')}`
    expect(readSubject(new URL(tagged).search)).toEqual({ kind: 'user', login: 'Kepano', view: 'lines' })
  })

  it('is left as it is when opened: PersonApp writes back the very same address', () => {
    for (const current of ['?user=kepano&view=lines', '?utm_source=x&user=kepano&view=lines', '?user=kepano&view=constellation']) {
      const { login, view } = propsFor(`${ORIGIN}/${current}`)
      // the view PersonApp holds: the link's, or life lines
      expect(personSearch(login, view ?? 'lines', current)).toBe(current)
    }
    // a link that names no view gets life lines written in
    expect(personSearch('kepano', propsFor(`${ORIGIN}/?user=kepano`).view ?? 'lines', '?user=kepano')).toBe('?user=kepano&view=lines')
    // a link from before the life garden was retired opens life lines, and the address says so
    const old = propsFor(`${ORIGIN}/?user=kepano&view=garden`)
    expect(old.view).toBe('lines')
    expect(personSearch(old.login, old.view ?? 'lines', '?user=kepano&view=garden')).toBe('?user=kepano&view=lines')
  })

  it('names only the user and the view, whatever the copier had hidden, selected, searched or revealed', () => {
    const store = usePersonStore.getState()
    store.resetFor('kepano')
    store.toggleHidden(KEPANO_PRIVATE[0])
    store.select(KEPANO_PRIVATE[1])
    store.setSearch(KEPANO_PRIVATE[2])
    store.setReveal('kepano', true)
    // the address bar PersonApp keeps, which CopyLinkButton copies as it is
    const href = `${ORIGIN}/${personSearch('kepano', 'lines', `?repo=${KEPANO_PRIVATE[3]}&branch=main`)}`
    expect([...new URL(href).searchParams.keys()].sort()).toEqual(['user', 'view'])
    expectNoSecret(decodeURIComponent(href), 'the copied link')
  })

  it('opens the same view of the same person, with the panel, the inspector, the strip and the controls', () => {
    const href = `${ORIGIN}/?user=kepano&view=lines`
    startLink(href)
    const html = openLink(href, kepano, FAKE_TOKEN)
    expect(html).toContain('aria-label="life lines of kepano:')
    expect(html).toContain('href="https://github.com/kepano"')
    expect(html).toContain('aria-label="Collapse panel"')
    expect(html).toContain('aria-label="Copy a link to this view"')
    expect(html).toContain('aria-label="Save a poster"')
    expect(html).toContain('replay')
    // the whole life on show: the time-lapse waits for its button
    expect(html).not.toContain('aria-label="Time-lapse"')
    // and no JSON save in person mode: the top bar's save menu offers the poster only
    expect(personAppSource).toContain('canExportData={false}')
  })

  it('starts clean, so names the copier revealed stay hidden for whoever opens it', () => {
    // the copier: kepano with a token, names revealed, a private repo selected and hovered
    const key = repoKey(KEPANO_PRIVATE[0])
    setPerson({ owner: 'kepano', revealFor: 'kepano', selected: key, hover: { kind: 'repo', key }, hidden: new Set([repoKey(KEPANO_PRIVATE[1])]) })
    const href = `${ORIGIN}/${personSearch('kepano', 'lines', '')}`

    // whoever opens the link: PersonApp's first request resets the store before it paints
    startLink(href)
    const state = usePersonStore.getState()
    expect(state.revealFor).toBeNull()
    expect(state.selected).toBeNull()
    expect(state.hover).toBeNull()
    expect(state.hidden.size).toBe(0)
    expect(state.search).toBe('')

    const html = openLink(href, secret, FAKE_TOKEN)
    expect(html).toContain('aria-label="life lines of kepano:')
    expect(html).toContain(PRIVATE_REPO_LABEL)
    expectNoSecret(html, 'the opened link')
  })
})

describe('the controls', () => {
  it('puts the poster and copy-link buttons in the panel header, the poster only when it can be saved', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const base = { profile: g.profile, timeline: g.timeline, colourOf: g.colourOf, name: g.name, privateCount: 0, revealed: false, onReveal: noop, theme }
    const withPoster = renderToStaticMarkup(h(PersonPanel, { ...base, onPoster: noop }))
    expect(withPoster).toContain('aria-label="Save a poster"')
    expect(withPoster).toContain('aria-label="Copy a link to this view"')
    // login, poster, link, collapse: in that order, as repo mode's panel has its buttons
    const order = ['href="https://github.com/kepano"', 'aria-label="Save a poster"', 'aria-label="Copy a link to this view"', 'aria-label="Collapse panel"'].map((s) =>
      withPoster.indexOf(s),
    )
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]))).toBe(true)

    const without = renderToStaticMarkup(h(PersonPanel, base))
    expect(without).not.toContain('Save a poster')
    expect(without).toContain('aria-label="Copy a link to this view"')

    // a poster on its way: the button waits
    const busy = renderToStaticMarkup(h(PersonPanel, { ...base, onPoster: noop, posterBusy: true }))
    const tag = (html: string) => /<button[^>]*aria-label="Save a poster"[^>]*>/.exec(html)?.[0] ?? ''
    expect(tag(busy)).toMatch(/disabled=""/)
    expect(tag(busy)).toContain('animate-pulse')
    expect(tag(withPoster)).not.toMatch(/disabled=""|animate-pulse/)
  })

  it('offers the time-lapse from the status strip only when given one', () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const base = { profile: g.profile, timeline: g.timeline, cachedAt: null, hasToken: true, onRefresh: noop, onAddToken: noop }
    const offered = renderToStaticMarkup(h(PersonStatus, { ...base, onTimelapse: noop }))
    expect(offered).toContain('replay')
    expect(offered).toContain('record it as a video')
    expect(renderToStaticMarkup(h(PersonStatus, base))).not.toContain('replay')
  })

  it("offers the top bar's image save apart from its data save, the data following the image when not given (repo mode)", () => {
    const menu = (flags: { canExport: boolean; canExportData?: boolean }) =>
      renderToStaticMarkup(h(ExportMenu, { id: 'menu', ...flags, onExportImage: noop, onExportData: noop, onOpenFile: noop, onClose: noop, buttonRef: { current: null } }))
    /** each item's label, and whether it is offered */
    const items = (html: string) =>
      [...html.matchAll(/<button([^>]*)>(?:(?!<\/button>).)*?<span class="block text-ui-text">([^<]*)<\/span>/g)].map((m) => [m[2], !/\sdisabled=""/.test(m[1])])
    const all = (image: boolean, data: boolean) => [
      ['Save image (PNG)', image],
      ['Save data (JSON)', data],
      ['Open a saved file…', true],
    ]
    // repo mode, as it always was
    expect(items(menu({ canExport: true }))).toEqual(all(true, true))
    expect(items(menu({ canExport: false }))).toEqual(all(false, false))
    // person mode: the poster, never JSON
    expect(items(menu({ canExport: true, canExportData: false }))).toEqual(all(true, false))
    expect(items(menu({ canExport: false, canExportData: false }))).toEqual(all(false, false))
    // the top bar passes it on as it is, and repo mode leaves it out
    expect(topBarSource).toContain('canExportData?: boolean')
    expect(topBarSource).toContain('canExportData={canExportData}')
  })

  it("copies the address bar and sends share-copy with no data, through repo mode's button", () => {
    expect(personPanelSource).toMatch(/^import \{ CopyLinkButton \} from '\.\.\/components\/Panel'$/m)
    const button = panelSource.slice(panelSource.indexOf('export function CopyLinkButton()'))
    expect(button.length).toBeLessThan(panelSource.length)
    const body = button.slice(0, button.indexOf('\n}\n'))
    expect(body).toContain('navigator.clipboard?.writeText(window.location.href)')
    expect(body.match(/track\(/g)).toHaveLength(1)
    expect(body).toContain("track('share-copy')")
  })
})

describe("PersonApp's Phase 5 wiring", () => {
  const code = personAppSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

  it('opens and closes the time-lapse through lifeTimelapse, which sends timelapse-play', () => {
    expect(code).toContain('openLifeTimelapse(lapseProgress,')
    expect(code).toContain('closeLifeTimelapse(lapseProgress,')
    // the canvas fills in with the controls' progress, captioned with the login only, and repaints
    // only while the controls say it is live (playing, recording or scrubbing)
    expect(code).toContain('{ progress: lapseProgress, title: profile.login, live: lapseLive }')
    expect(code).toContain('onLiveChange={setLapseLive}')
    expect(code).toContain('timelapse={lifeLapse}')
    expect(code).toMatch(/<PersonTimelapse[\s\S]*?progress=\{lapseProgress\}/)
    // a new login, request or profile closes it before paint
    expect(code).toContain('useLayoutEffect(() => closeLapse(), [asked, profile, closeLapse])')
  })

  it("saves the poster with the screen's namer and the eyes' hidden repos", () => {
    // the view on show, as the canvas draws it
    expect(code).toMatch(/saveLifePoster\(\{ profile, timeline, view: def, layout, theme, colourOf, name, hidden: usePersonStore\.getState\(\)\.hidden \}\)/)
    expect(code).toContain('onPoster={layout ? savePoster : undefined}')
  })

  it("saves the poster from the top bar's image save too (once at a time), and never JSON", () => {
    expect(code).toMatch(/<TopBar\s[^>]*canExport=\{layout !== null && !posterBusy\}\s+canExportData=\{false\}\s+onExportImage=\{savePoster\}\s+onExportData=\{noop\}/)
  })

  it('tells the time-lapse what the toggle shows, and locks the toggle while it records', () => {
    expect(code).toMatch(/<PersonTimelapse\s[^>]*revealed=\{revealed\}/)
    expect(code).toMatch(/<PersonTimelapse\s[^>]*onRecordingChange=\{setLapseRecording\}/)
    // a poster in the making locks it too: its namer is taken at the click
    expect(code).toMatch(/<PersonPanel\s[^>]*revealLocked=\{lapseRecording \|\| posterBusy\}/)
    // closing the time-lapse unlocks it, whatever the controls said last
    expect(code).toMatch(/closeLifeTimelapse\(lapseProgress, \(\) => \{\s*setLapseOpen\(false\)\s*setLapseRecording\(false\)\s*\}\)/)
    expect(code.match(/setLapseRecording\b/g)).toHaveLength(3)
  })

  it('shows the reload card when the time-lapse or the poster could not load a part, ahead of the other cards', () => {
    expect(code).toContain('{!invalidUrl && chunkFailed && <ErrorCard code="chunk_failed" onReload={reloadPage} onDismiss={() => setChunkFailed(false)} />}')
    expect(code).toMatch(/<PersonTimelapse\s[^>]*onChunkFailed=\{showChunkFailed\}/)
    expect(code).toContain('const showChunkFailed = useCallback(() => setChunkFailed(true), [])')
    // the poster: the reload card for its chunk, export_failed with the reason for the rest
    expect(code).toContain('const failure = posterFailure(err)')
    expect(code).toContain("if (failure.code === 'chunk_failed') setChunkFailed(true)")
    expect(code).toContain('else setPosterError(failure.message)')
    expect(code).toContain('{!invalidUrl && !chunkFailed && posterError !== null && (')
    expect(code).toContain('{!invalidUrl && !chunkFailed && posterError === null && error && errorCopy && !isFetching && error !== closedError && (')
  })

  it('sends no event of its own, and takes no exporter, recorder, fetch, JSON save or audio', () => {
    expect(code).not.toMatch(/\btrack\(/)
    expect(code).not.toMatch(/\bfetch\(/)
    expect(code).not.toContain('serializeRepoFile')
    expect(code).not.toMatch(/from '\.\/export\//)
    expect(code).not.toMatch(/from '\.\/audio\//)
    expect(code).not.toMatch(/videoChunk|exportersChunk/)
    // the address bar is still written in one place only (personGuards pins how)
    expect(code.match(/replaceState\(/g)).toHaveLength(1)
    expect(code.match(/writeUserShare\(/g)).toHaveLength(1)
  })
})

describe('a failed poster save', () => {
  const CHUNK_URL = `${ORIGIN}/assets/exporters-Ab12Cd34.js`
  const failedImport = (url: string) => new TypeError(`Failed to fetch dynamically imported module: ${url}`)
  /** The exporters chunk as lazy/parts.ts defines it, on a dropped connection: its retry, under a new URL, fails too. */
  const unreachableExporters = () =>
    defineChunk<PosterKit>(() => Promise.reject(failedImport(CHUNK_URL)), {
      origin: ORIGIN,
      wait: async () => {},
      importUrl: (url) => Promise.reject(failedImport(url)),
    })

  it('shows the reload card when the exporters chunk could not be loaded, never its module URL', async () => {
    const error = await unreachableExporters()
      .load()
      .catch((err: unknown) => err)
    // what the export_failed card used to show
    expect(error instanceof Error && error.message).toContain(`${CHUNK_URL}?retry=1`)
    expect(posterFailure(error)).toEqual({ code: 'chunk_failed' })
  })

  it('keeps export_failed, with its reason, for anything else', () => {
    expect(posterFailure(new Error('could not encode the image'))).toEqual({ code: 'export_failed', message: 'could not encode the image' })
    expect(posterFailure(new Error('canvas 2D context unavailable'))).toEqual({ code: 'export_failed', message: 'canvas 2D context unavailable' })
    expect(posterFailure('the canvas was lost')).toEqual({ code: 'export_failed', message: 'the canvas was lost' })
  })

  it("reads saveLifePoster's own rejections: its chunk, or its encoder", async () => {
    const g = load(kepano, KEPANO_NOW, theme)
    const input = { profile: g.profile, timeline: g.timeline, layout: g.layout, view: LINES_VIEW, theme, colourOf: g.colourOf, name: g.name, hidden: new Set<string>() }
    const makeCanvas = (width: number, height: number) => {
      const rec = recordingCtx(width, height)
      return { width, height, getContext: (kind: string) => (kind === '2d' ? rec.ctx : null) } as unknown as HTMLCanvasElement
    }
    const deps = { loadAvatar: async () => null, makeCanvas, now: () => new Date(KEPANO_NOW), measure: (text: string) => text.length * 6.5 }
    /** what the save rejected with: null when it saved */
    const rejection = (save: Promise<void>) => save.then(() => null, (err: unknown) => err)

    const exporters = unreachableExporters()
    expect(posterFailure(await rejection(saveLifePoster(input, { ...deps, loadKit: () => exporters.load() })))).toEqual({ code: 'chunk_failed' })

    const kit: PosterKit = {
      canvasToPng: () => Promise.reject(new Error('could not encode the image')),
      downloadBlob: noop,
      exportFileName: () => 'kepano-life-poster.png',
    }
    expect(posterFailure(await rejection(saveLifePoster(input, { ...deps, loadKit: async () => kit })))).toEqual({
      code: 'export_failed',
      message: 'could not encode the image',
    })
  })
})
