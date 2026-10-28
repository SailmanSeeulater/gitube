/**
 * The git log view's console palette (src/profile/gitLogPaint.ts): One Dark's editor grey with its
 * syntax colours, the look of `git log --graph` in a dark terminal. A console view keeps this look
 * whatever the app's theme is, so it lives here, apart from the themes, and is the only place its
 * colours are spelled (the 'no stray colour literals' test reads everything outside src/theme).
 *
 * Every lane colour, the foreground and the comment grey keep at least 4.5:1 against the background
 * (tests/gitLogView.test.ts checks it), so the view stays readable at any size.
 */
export interface GitLogPalette {
  /** the editor background */
  bg: string
  /** the trunk's line and commits */
  fg: string
  /** muted text: years, today, the hashes, the fork connectors */
  comment: string
  /** the horizon under the trunk, and the year gridlines */
  gutter: string
  /** branch colours by language slot: yellow, blue, purple, green, red */
  lanes: readonly string[]
  /** a branch with no language */
  plain: string
  /** milestones: the tag markers on the trunk and a longest streak's bar */
  tag: string
  /** the hovered branch's halo and the day guide */
  hover: string
  /** the selected branch's halo */
  selected: string
  /** the shared labels' plates (the "(branch-name)" refs) */
  plate: string
}

export const GITLOG_PALETTE: GitLogPalette = {
  bg: '#282c34',
  fg: '#abb2bf',
  comment: '#8f96a3',
  gutter: '#3e4451',
  lanes: ['#e5c07b', '#61afef', '#c678dd', '#98c379', '#e5737c'],
  plain: '#9da5b4',
  tag: '#d19a66',
  hover: '#56b6c2',
  selected: '#e5c07b',
  plate: '#21252b',
}
