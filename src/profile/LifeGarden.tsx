/**
 * The life garden (PROFILE_SPEC.md section 5, view 1), person mode's default view: one GitHub
 * user's repos as plants along a horizon of time, each rooted where the person's part in it starts.
 * The canvas, its pointer and its labels are LifeView's (LifeViewCanvas.tsx), which every view shares; this is that host
 * with the garden in it.
 */
import type { Theme } from '../theme/themes'
import type { LifeTimeline } from './timeline'
import type { LifeGardenLayout, RepoNamer } from './lifeTypes'
import LifeView, { type LifeViewProps } from './LifeViewCanvas'
import { GARDEN_VIEW } from './lifeViews'

export interface LifeGardenProps {
  timeline: LifeTimeline
  layout: LifeGardenLayout
  theme: Theme
  colourOf: (language: string | null) => string
  /** the only names the canvas ever receives */
  name: RepoNamer
  /** the person, for the canvas's label (and the time-lapse caption when it names no title) */
  login: string
  /** the time-lapse (LifeView's) */
  timelapse?: LifeViewProps['timelapse']
}

export default function LifeGarden(props: LifeGardenProps) {
  return <LifeView def={GARDEN_VIEW} {...props} />
}
