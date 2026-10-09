/**
 * Skeleton-mode contraction: keep only the structurally interesting commits (tips, forks,
 * merges, roots) and splice every linear run of removed commits into a single link whose
 * collapsedCount says how many commits it hides.
 *
 * Pure and deterministic. O(nodes + links).
 */
import type { GraphLink, GraphNode } from '../types'
import type { GraphBody } from './build'

/** A node survives skeleton mode when it is a tip, a fork point, a merge or a root. */
export function isSkeletonNode(node: GraphNode): boolean {
  return node.isTip || node.isFork || node.isMerge || node.isRoot
}

/**
 * Collapse a full graph into its skeleton.
 *
 * By construction every node that is not a tip/fork/merge/root has exactly one child link
 * and exactly one parent link (no children -> it would be a tip; 2+ children -> fork;
 * 0 parents -> root; 2+ parents -> merge). Such a node sits on exactly one chain, so from
 * each kept node we follow each parent link down the chain of removed nodes until the next
 * kept node and emit one link with collapsedCount = number of removed nodes passed. Each
 * removed node is visited exactly once, hence O(nodes + links).
 *
 * The link keeps the owner of its child end. Kept nodes are returned untouched: flags and
 * reach are not re-derived. As a guard against malformed input, a node whose link degree
 * breaks the invariant above is kept rather than collapsed.
 */
export function collapseToSkeleton<G extends GraphBody>(graph: G): G {
  const { nodes, links } = graph

  // Parent links grouped by child (source), and child-link count per parent (target).
  const parentLinks = new Map<string, GraphLink[]>()
  const childLinkCount = new Map<string, number>()
  for (const link of links) {
    const list = parentLinks.get(link.source)
    if (list) list.push(link)
    else parentLinks.set(link.source, [link])
    childLinkCount.set(link.target, (childLinkCount.get(link.target) ?? 0) + 1)
  }

  const keep = new Set<string>()
  for (const node of nodes) {
    const parents = parentLinks.get(node.id)?.length ?? 0
    const children = childLinkCount.get(node.id) ?? 0
    if (isSkeletonNode(node) || parents !== 1 || children !== 1) keep.add(node.id)
  }

  const keptNodes = nodes.filter((node) => keep.has(node.id))
  const keptLinks: GraphLink[] = []
  for (const node of keptNodes) {
    for (const link of parentLinks.get(node.id) ?? []) {
      let target = link.target
      // Carry over counts the input links already hold so that collapsing an already
      // collapsed graph is a no-op; for a full graph every input count is 0.
      let collapsedCount = link.collapsedCount
      while (!keep.has(target)) {
        const next = parentLinks.get(target)
        if (!next) break // dangling target in the input: pass it through unchanged
        collapsedCount += 1 + next[0].collapsedCount
        target = next[0].target
      }
      keptLinks.push({ source: node.id, target, collapsedCount, owner: link.owner })
    }
  }

  return { ...graph, nodes: keptNodes, links: keptLinks }
}
