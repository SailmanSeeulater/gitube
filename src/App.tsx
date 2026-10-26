import RepoApp from './RepoApp'
// RepoApp is the first import on purpose: importing the store or the theme modules ahead of it
// makes the bundler split the first download into one more chunk.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { RepoInitial } from './RepoApp'
import { subjectOf, type Subject } from './subject'
import { writeUserShare } from './share/shareUrl'
import { personAppChunk } from './lazy/parts'
import { LazySlot, lazyPart } from './components/LazyPart'
import { useGardenStore } from './store/useGardenStore'
import { applyTheme } from './theme/applyTheme'
import { readStoredThemeId } from './theme/storage'
import { THEME_STORAGE_KEY } from './theme/themes'
import { useTheme } from './theme/useTheme'

// person mode is a chunk of its own, loaded when a login is grown or a ?user= link is opened
const PersonApp = lazyPart(personAppChunk)

/** Person mode's placeholder while it loads, and its reload notice if it cannot be loaded. */
const PERSON_FRAME = 'flex h-full w-full items-center justify-center bg-garden-bg px-4'

export default function App() {
  const [subject, setSubject] = useState<Subject>(() => subjectOf(typeof window === 'undefined' ? '' : window.location.search))
  /** a new RepoApp on each switch to a repo, so its initial runs on its mount */
  const [repoMount, setRepoMount] = useState(0)
  const theme = useTheme()

  // The DOM half of a theme switch: CSS variables, color-scheme and theme-color, before paint.
  useLayoutEffect(() => applyTheme(theme), [theme])

  // Another tab picked a theme: follow it (the storage event only fires in the other tabs).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
      const themeId = readStoredThemeId()
      if (useGardenStore.getState().themeId !== themeId) useGardenStore.setState({ themeId })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Every switch drops the store's selection first, so no hidden branch or selection of one repo
  // reaches another. The same login again (in any case) is a new request for the person on show,
  // as Grow on the same repo is, and leaves the address bar, and the view it names, alone.
  const toUser = useCallback(
    (login: string) => {
      useGardenStore.getState().resetForNewRepo()
      if (subject.kind === 'user' && subject.login.toLowerCase() === login.toLowerCase()) {
        setSubject({ ...subject, request: subject.request + 1 })
        return
      }
      // the address bar names the person before the switch, so a reload reopens person mode
      const search = writeUserShare({ login, view: null }, window.location.search)
      if (search !== window.location.search) {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
      }
      setSubject({ kind: 'user', login, request: 0, view: null, fromInput: true })
    },
    [subject],
  )

  // RepoApp's own share link effect writes ?repo= once it has the repo.
  const toRepo = useCallback((initial: RepoInitial) => {
    useGardenStore.getState().resetForNewRepo()
    setRepoMount((mount) => mount + 1)
    setSubject({ kind: 'repo', initial })
  }, [])

  if (subject.kind === 'repo') return <RepoApp key={repoMount} onUser={toUser} initial={subject.initial} />
  return (
    <LazySlot frame={PERSON_FRAME} label="loading person mode">
      <PersonApp
        login={subject.login}
        request={subject.request}
        view={subject.view}
        focusInput={subject.fromInput}
        onRepo={toRepo}
        onUser={toUser}
      />
    </LazySlot>
  )
}
