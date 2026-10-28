/**
 * The phosphor view's layout: a green-phosphor monitor where each repo is a stack of square blocks
 * rising from the ground line at the x of its root day, like the life garden's plants made of
 * blocks. A stack's height is the garden's plant height (the same activity measure), its blocks run
 * through the lane's days from the ground up (dormant stretches dimmer), and its head block carries
 * the star signal (bigger for starred repos).
 *
 * World units as in every view: x is days since the timeline's start (a root sits in its day's
 * middle), heights are shares of the plot. The stacks are read off the garden's own layout, so they
 * stand where its plants are rooted and as tall as they grow; nothing here is seeded at all, let
 * alone from a name. Pure and deterministic: the same timeline gives the same layout.
 */
import type { ProfileData } from '../types'
import { layoutLifeGarden } from './lifeGardenLayout'
import type { LifeStemPart } from './lifeTypes'
import type { LifeTimeline } from './timeline'
import { axisOf, type LifeViewItem, type LifeViewModel } from './lifeView'

/** One repo as the phosphor view draws it. */
export interface PhosphorStack extends LifeViewItem {
  /** 0..1 of the plot: the garden's plant height for the lane */
  height: number
  /** 0..1, log-scaled stars (bloomOfStars): how much bigger the head block is */
  head: number
  stars: number
  /** archived: drawn dim */
  dry: boolean
  /** a token profile's lane GitHub counted no commits to: drawn faint */
  seedling: boolean
  /** a repo they only contributed to: a hollow head */
  visiting: boolean
  fork: boolean
  language: string | null
  /** the lane's last day number */
  endDay: number
  /** the lane's active and dormant stretches by stack time (0 at the ground, 1 at the head) */
  parts: LifeStemPart[]
}

export interface PhosphorLayout extends LifeViewModel {
  /** in paint order: the tallest first (behind), then x, then lane order; byKey indexes it */
  stacks: PhosphorStack[]
}

function comparePaint(a: PhosphorStack, b: PhosphorStack): number {
  return b.height - a.height || a.x - b.x || a.lane - b.lane
}

/** The phosphor view of a timeline; source says whether lanes weigh commits (graphql) or active days (rest). */
export function layoutPhosphor(timeline: LifeTimeline, source: ProfileData['source']): PhosphorLayout {
  const axis = axisOf(timeline)
  const garden = layoutLifeGarden(timeline, source)
  const stacks = garden.plants.map((plant): PhosphorStack => {
    const lane = timeline.lanes[plant.lane]
    return {
      lane: plant.lane,
      key: plant.key,
      startDay: plant.startDay,
      x: plant.x,
      height: plant.height,
      head: plant.bloom,
      stars: lane.stars,
      dry: plant.dry,
      seedling: plant.seedling,
      visiting: plant.visiting,
      fork: plant.cutting,
      language: plant.language,
      endDay: plant.endDay,
      parts: plant.parts,
    }
  })
  stacks.sort(comparePaint)
  return { ...axis, byKey: new Map(stacks.map((stack, i) => [stack.key, i])), stacks }
}
