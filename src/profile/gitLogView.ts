/**
 * The git log view (person mode's console views): `git log --graph` along the shared time axis. The
 * person's timeline is the trunk; each repo a branch forking off it at its root day and running on
 * its own lane to its last activity, with its commits; milestones are tags on the trunk. Layout in
 * gitLogLayout, screen geometry in gitLogGeometry, drawing in gitLogPaint, the hit test in gitLogHit;
 * the palette is src/theme/console/gitlog.ts.
 */
import type { LifeViewDef } from './lifeView'
import { layoutGitLog, type GitLogLayout } from './gitLogLayout'
import { gitLogGeom, type GitLogGeom } from './gitLogGeometry'
import { hitGitLog } from './gitLogHit'
import { branchColour, consoleInk, gitLogAnchor, gitLogKeepOut, gitLogLabelOrder, paintGitLog } from './gitLogPaint'

export const GITLOG_VIEW: LifeViewDef<GitLogLayout, GitLogGeom> = {
  id: 'gitlog',
  title: 'git log',
  layout: layoutGitLog,
  scene: {
    items: (layout) => layout.branches,
    geoms: gitLogGeom,
    paint: paintGitLog,
    hit: hitGitLog,
    anchor: gitLogAnchor,
    labelOrder: gitLogLabelOrder,
    keepOut: gitLogKeepOut,
    itemColour: (layout, i) => branchColour(layout.branches[i]),
  },
  ink: consoleInk,
}
