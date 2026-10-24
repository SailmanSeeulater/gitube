import type { GitHubFetchError } from '../types'
import { formatClock } from './gardenUtils'
import { AlertIcon, CloseIcon } from './icons'

/**
 * A fetch failure, bad_file (a saved garden that could not be opened), export_failed (the image
 * could not be made; for these two, message says why) or chunk_failed (a part of the app that loads
 * on demand could not be fetched, even on its retry: the connection dropped, or the tab is older
 * than the earlier builds the server keeps. A reload fetches it afresh; see lazy/chunk.ts).
 */
export type ErrorCode = GitHubFetchError['code'] | 'bad_file' | 'export_failed' | 'chunk_failed'

export interface ErrorCardProps {
  code: ErrorCode
  message?: string
  resetAt?: string | null
  onAddToken?: () => void
  /** chunk_failed's action */
  onReload?: () => void
  onDismiss?: () => void
}

interface Copy {
  title: string
  hint: string
  tokenAction?: string
  reloadAction?: string
}

function copyFor(code: ErrorCode, resetAt: string | null | undefined, message: string | undefined): Copy {
  const reset = formatClock(resetAt)
  switch (code) {
    case 'invalid_url':
      return {
        title: "that doesn't look like a GitHub repo",
        hint: 'try owner/repo, github.com/owner/repo, or a full https URL.',
      }
    case 'not_found':
      return {
        title: 'repo not found',
        hint: 'check the spelling. private repos only appear with a token that can read them.',
        tokenAction: 'add a token',
      }
    case 'rate_limited':
      return {
        title: 'GitHub rate limit reached',
        hint: `${reset ? `resets at ${reset}. ` : ''}anonymous access allows 60 requests an hour; a personal access token allows 5000.`,
        tokenAction: 'add a token',
      }
    case 'unauthorized':
      return {
        title: 'GitHub rejected the token',
        hint: 'it may be expired or missing read access to this repo. edit or clear it and try again.',
        tokenAction: 'edit token',
      }
    case 'network':
      return {
        title: "couldn't reach GitHub",
        hint: 'check your connection and press Grow again.',
      }
    case 'aborted':
      return {
        title: 'fetch cancelled',
        hint: 'press Grow to start again.',
      }
    case 'empty_repo':
      return {
        title: 'this repository has no commits',
        hint: 'push a first commit and press Grow again.',
      }
    case 'unknown':
      return {
        title: 'something went wrong',
        hint: message ? `${message} press Grow to try again.` : 'press Grow to try again.',
      }
    case 'bad_file':
      return {
        title: "couldn't open that file",
        hint: message ?? 'pick a .json file saved from repo-garden.',
      }
    case 'export_failed':
      return {
        title: "couldn't save the image",
        hint: message ? `${message}. try again, or save the data as JSON instead.` : 'try again, or save the data as JSON instead.',
      }
    case 'chunk_failed':
      return {
        title: "couldn't load that part of repo-garden",
        hint: 'the connection may have dropped, or the site was updated since this tab was opened. reload the page to fetch it again.',
        reloadAction: 'reload',
      }
  }
}

export default function ErrorCard({ code, message, resetAt, onAddToken, onReload, onDismiss }: ErrorCardProps) {
  const copy = copyFor(code, resetAt, message)
  return (
    <div
      role="alert"
      className="absolute left-1/2 top-1/2 z-20 w-[340px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-garden-border bg-garden-panel/95 p-4 text-[13px] shadow-soft backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-garden-muted">
          <AlertIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-garden-text">{copy.title}</p>
          <p className="mt-1 leading-snug text-garden-muted">{copy.hint}</p>
          {copy.tokenAction && onAddToken && (
            <button
              type="button"
              onClick={onAddToken}
              className="mt-3 rounded-lg bg-garden-accent/15 px-2.5 py-1 text-[12px] font-medium text-garden-accent hover:bg-garden-accent/25"
            >
              {copy.tokenAction}
            </button>
          )}
          {copy.reloadAction && onReload && (
            <button
              type="button"
              onClick={onReload}
              className="mt-3 rounded-lg bg-garden-accent/15 px-2.5 py-1 text-[12px] font-medium text-garden-accent hover:bg-garden-accent/25"
            >
              {copy.reloadAction}
            </button>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 text-garden-muted hover:bg-garden-hover hover:text-garden-text"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  )
}
