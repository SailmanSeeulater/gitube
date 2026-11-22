/** A release name on the map is cut to this many characters (the inspector shows them whole). */
export const RELEASE_MAX_CHARS = 18

/** What a release pill says: the first tag, cut short, and how many more share the commit. */
export function releaseText(tags: readonly string[]): string {
  const first = tags[0] ?? ''
  const name = first.length > RELEASE_MAX_CHARS ? `${first.slice(0, RELEASE_MAX_CHARS - 1)}…` : first
  return tags.length > 1 ? `${name} +${tags.length - 1}` : name
}
