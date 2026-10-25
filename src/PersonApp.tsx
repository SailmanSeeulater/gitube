import { useCallback, useEffect, useRef, useState } from 'react'
import { parseSubject } from './api/parseSubject'
import type { RepoInitial } from './RepoApp'
import type { PersonView } from './share/shareUrl'
import TopBar from './components/TopBar'
import ErrorCard from './components/ErrorCard'

export interface PersonAppProps {
  /** as typed (GitHub compares logins case-insensitively) */
  login: string
  /** counts the grows of this login, so a new one can refetch it */
  request: number
  /** the view a ?user= link named, carried through unchanged */
  view: PersonView | null
  /** reached from the input, whose element the switch replaced: focus this one's input */
  focusInput: boolean
  /** a repo typed, or a saved file opened or dropped: back to the repo garden */
  onRepo: (initial: RepoInitial) => void
  /** a login typed */
  onUser: (login: string) => void
}

const noop = () => {}

/** Person mode (?user=). A placeholder for now: the shared top bar and the login. */
export default function PersonApp({ login, focusInput, onRepo, onUser }: PersonAppProps) {
  const [input, setInput] = useState(login)
  const [invalidUrl, setInvalidUrl] = useState(false)
  const [tokenOpen, setTokenOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // the input takes both kinds, as in the repo garden
  const submit = useCallback(() => {
    const subject = parseSubject(input)
    if (!subject) {
      setInvalidUrl(true)
      return
    }
    setInvalidUrl(false)
    if (subject.kind === 'repo') onRepo({ input })
    else onUser(subject.login)
  }, [input, onRepo, onUser])

  // a switch from the repo garden's input lands typing in this one, as Grow leaves it in the input
  useEffect(() => {
    if (focusInput) inputRef.current?.focus()
    // on mount only: later grows keep this input, and its focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleToken = useCallback(() => setTokenOpen((open) => !open), [])
  const openFile = useCallback((file: File) => onRepo({ file }), [onRepo])

  // a saved .json dropped anywhere on the page opens it in the repo garden
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      const file = event.dataTransfer?.files[0]
      if (file) openFile(file)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFile])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setInvalidUrl(false)
      setTokenOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="relative h-full w-full overflow-hidden bg-garden-bg text-garden-text">
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4">
        <p className="font-mono text-[13px] text-garden-text">{login}</p>
        <p className="text-[12px] text-garden-muted">person mode coming soon</p>
      </div>

      <TopBar
        value={input}
        onChange={setInput}
        onSubmit={submit}
        inputRef={inputRef}
        tokenOpen={tokenOpen}
        onToggleToken={toggleToken}
        busy={false}
        canExport={false}
        onExportImage={noop}
        onExportData={noop}
        onOpenFile={openFile}
        besidePanel={false}
      />

      {invalidUrl && <ErrorCard code="invalid_url" onDismiss={() => setInvalidUrl(false)} />}
    </div>
  )
}
