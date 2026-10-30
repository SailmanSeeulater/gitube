/**
 * Person mode's icons, drawn like components/icons.tsx, and a repo name with its lock. The lock is
 * person mode's own; the eye and the chevrons are copies of the eager set's. Each binding a lazy
 * chunk imports from an eager module is one more export of the first-load entry, which person mode
 * keeps to what it cannot do without.
 */
import type { SVGProps } from 'react'
import type { ShownName } from './lifeTypes'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 14, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

/** A padlock: a private repo, its name hidden or shown. */
export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/** A repo name as the namer shows it, then a lock if the repo is private, its name hidden or not. */
export function ShownRepoName({ shown }: { shown: ShownName }) {
  return (
    <>
      <span className="truncate">{shown.text}</span>
      {shown.locked && (
        <span className="shrink-0 text-ui-muted" title="private repo">
          <LockIcon size={12} />
        </span>
      )}
    </>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  )
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17.6 17.6 0 0 1-2.9 3.7M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 7 9.5 7a9 9 0 0 0 4.1-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  )
}
