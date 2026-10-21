import { describe, expect, it } from 'vitest'
import { ANCHORS, LABEL_PLACER_DEFAULTS, LabelPlacer, RectGrid, anchorOrigin, type LabelSpec, type PlacerFrame, type PlacerOptions } from './labelPlacement'

// ---------------- helpers ----------------

/** Fake text measure: 6.5 px per character. */
const CH = 6.5
const measure = (text: string) => text.length * CH
const DT = 16.7
const R = ANCHORS.indexOf('R')
const L = ANCHORS.indexOf('L')
const o = LABEL_PLACER_DEFAULTS

function mkSpec(node: number, name: string, compact?: string): LabelSpec {
  const texts = compact !== undefined ? [name, compact] : [name]
  return {
    node,
    texts,
    widths: texts.map(measure),
    fullText: name,
    fullWidth: measure(name),
    names: [name],
    nameWidths: [measure(name)],
  }
}

/** Hand-built screen-space scene: node centres, radii and per-frame speeds. */
class Scene {
  readonly sx: Float32Array
  readonly sy: Float32Array
  readonly sr: Float32Array
  readonly speed: Float32Array
  constructor(
    readonly n: number,
    public width = 600,
    public height = 400,
  ) {
    this.sx = new Float32Array(n)
    this.sy = new Float32Array(n)
    this.sr = new Float32Array(n).fill(4)
    this.speed = new Float32Array(n)
  }
  set(j: number, x: number, y: number, r = 4): this {
    this.sx[j] = x
    this.sy[j] = y
    this.sr[j] = r
    return this
  }
  /** Moves node j to (x, y), recording the displacement as its speed for the next frame. */
  move(j: number, x: number, y: number): void {
    this.speed[j] = Math.hypot(x - this.sx[j], y - this.sy[j])
    this.sx[j] = x
    this.sy[j] = y
  }
  still(): void {
    this.speed.fill(0)
  }
  frame(over: Partial<PlacerFrame> = {}): PlacerFrame {
    return {
      sx: this.sx,
      sy: this.sy,
      sr: this.sr,
      speed: this.speed,
      nodeCount: this.n,
      width: this.width,
      height: this.height,
      dtMs: DT,
      cameraMoving: false,
      ...over,
    }
  }
}

function run(p: LabelPlacer, scene: Scene, frames: number, over: Partial<PlacerFrame> = {}): void {
  for (let f = 0; f < frames; f++) p.update(scene.frame(over))
}

function placer(specs: LabelSpec[], opts: Partial<PlacerOptions> = {}, order?: number[], pinned: number[] = []): LabelPlacer {
  const p = new LabelPlacer(specs, { measure, ...opts })
  p.setOrder(Int32Array.from(order ?? specs.map((_, i) => i)), pinned)
  return p
}

const shownList = (p: LabelPlacer) => Array.from(p.shown, (v, i) => (v ? i : -1)).filter((i) => i >= 0)

function boxesOverlap(p: LabelPlacer, i: number, k: number, tol = 0): boolean {
  const ox = Math.min(p.x0[i] + p.w[i], p.x0[k] + p.w[k]) - Math.max(p.x0[i], p.x0[k])
  const oy = Math.min(p.y0[i] + p.h[i], p.y0[k] + p.h[k]) - Math.max(p.y0[i], p.y0[k])
  return ox > tol && oy > tol
}

function insideCanvas(p: LabelPlacer, i: number, scene: Scene, margin: number): boolean {
  return p.x0[i] >= margin - 1e-3 && p.y0[i] >= margin - 1e-3 && p.x0[i] + p.w[i] <= scene.width - margin + 1e-3 && p.y0[i] + p.h[i] <= scene.height - margin + 1e-3
}

/** Seeded PRNG (mulberry32) so the property tests are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const snapshot = (p: LabelPlacer) => ({ shown: Array.from(p.shown), anchor: Array.from(p.anchor), variant: Array.from(p.variant) })

// ---------------- RectGrid ----------------

describe('RectGrid', () => {
  it('finds a box spanning several cells from each of its cells', () => {
    const g = new RectGrid(48)
    g.reset(400, 200)
    g.insert(10, 10, 150, 60, 7)
    for (const [x, y] of [
      [20, 20],
      [60, 20],
      [110, 20],
      [140, 55],
    ]) {
      expect(g.count(x, y, x + 2, y + 2)).toBe(1)
    }
    expect(g.count(160, 10, 200, 60)).toBe(0)
  })

  it('counts a box stored in several cells once, and honours excludeTag and limit', () => {
    const g = new RectGrid(48)
    g.reset(400, 200)
    g.insert(0, 0, 200, 100, 1)
    g.insert(50, 50, 60, 60, 2)
    g.insert(300, 150, 310, 160, 3)
    expect(g.count(0, 0, 400, 200)).toBe(3)
    expect(g.count(0, 0, 400, 200, 1)).toBe(2)
    expect(g.count(0, 0, 400, 200, -1, 2)).toBe(2)
    expect(g.query(40, 40, 70, 70)).toBe(2)
    const tags = Array.from(g.found.slice(0, 2), (r) => g.tag[r]).sort()
    expect(tags).toEqual([1, 2])
  })

  it('reset clears everything and the buffers grow past their initial capacity', () => {
    const g = new RectGrid(48)
    g.reset(500, 500)
    const initial = g.capacity
    const rand = rng(1)
    for (let i = 0; i < 1000; i++) {
      const x = rand() * 480
      const y = rand() * 480
      g.insert(x, y, x + 20, y + 20, i)
    }
    expect(g.capacity).toBeGreaterThan(initial)
    expect(g.count(-10, -10, 510, 510)).toBe(1000)
    g.reset(500, 500)
    expect(g.count(-10, -10, 510, 510)).toBe(0)
    g.insert(5, 5, 6, 6, 0)
    expect(g.count(0, 0, 10, 10)).toBe(1)
  })

  it('clamps boxes partly off the canvas to the edge cells', () => {
    const g = new RectGrid(48)
    g.reset(200, 100)
    g.insert(-30, -30, 10, 10, 1)
    g.insert(190, 90, 260, 160, 2)
    expect(g.count(0, 0, 5, 5)).toBe(1)
    expect(g.count(-40, -40, -20, -20)).toBe(1)
    expect(g.count(-100, -100, -50, -50)).toBe(0)
    expect(g.count(195, 95, 199, 99)).toBe(1)
    expect(g.count(240, 140, 250, 150)).toBe(1)
  })
})

// ---------------- placement ----------------

describe('LabelPlacer placement', () => {
  it('gives two tips 10 px apart two non-overlapping boxes inside the canvas margins', () => {
    const scene = new Scene(2, 400, 300).set(0, 200, 150).set(1, 210, 150)
    const p = placer([mkSpec(0, 'alpha'), mkSpec(1, 'bravo-branch')])
    run(p, scene, 40)
    expect(shownList(p)).toEqual([0, 1])
    expect(boxesOverlap(p, 0, 1)).toBe(false)
    for (const i of [0, 1]) expect(insideCanvas(p, i, scene, o.edge)).toBe(true)
  })

  it('does not run a label off the right edge: a tip near it gets a non-R anchor', () => {
    const scene = new Scene(1, 400, 300).set(0, 380, 150)
    const p = placer([mkSpec(0, 'feature/near-edge')])
    run(p, scene, 40)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).not.toBe(R)
    expect(insideCanvas(p, 0, scene, o.edge)).toBe(true)
  })

  // A canvas one label high: only R and L fit. A's L and B's R run off the canvas, and C sits
  // between them, its R colliding with B's L and its L with A's R: only two of the three fit.
  const stack = () => new Scene(3, 260, 24).set(0, 10, 12).set(1, 250, 12).set(2, 130, 12)
  const stackSpecs = () => [mkSpec(0, 'aaaaaaaa'), mkSpec(1, 'bbbbbbbb'), mkSpec(2, 'cccccccc')]

  it('hides the lowest-ranked label when only two of three fit', () => {
    const p = placer(stackSpecs(), {}, [0, 1, 2])
    run(p, stack(), 60)
    expect(shownList(p)).toEqual([0, 1])
    const q = placer(stackSpecs(), {}, [2, 0, 1])
    run(q, stack(), 60)
    expect(shownList(q)).toEqual([0, 2])
    expect(q.anchor[2]).toBe(R)
  })

  it('never lets a newcomer cover another tip disc, but lets a pinned label do it', () => {
    // A (x=10) only fits to its right, where tip B's disc sits
    const scene = () => new Scene(2, 120, 24).set(0, 10, 12).set(1, 50, 12)
    const specs = () => [mkSpec(0, 'aaaaaaaa'), mkSpec(1, 'b')]
    const p = placer(specs())
    run(p, scene(), 60)
    expect(p.shown[0]).toBe(0)
    expect(p.shown[1]).toBe(1)
    const q = placer(specs(), {}, [0, 1], [0])
    run(q, scene(), 60)
    expect(q.shown[0]).toBe(1)
    expect(q.anchor[0]).toBe(R)
    // ...drawn with a leader to its own node, since it sits on B's disc
    expect(q.leader[0]).toBe(1)
    // ...but never over another label: B, whose spots both overlap A, waits
    expect(q.shown[1]).toBe(0)
    // a pinned label with a clean spot needs no leader
    const lone = placer([mkSpec(0, 'main')], {}, [0], [0])
    run(lone, new Scene(1).set(0, 300, 200), 60)
    expect(lone.shown[0]).toBe(1)
    expect(lone.leader[0]).toBe(0)
  })

  it("prefers a pinned last-resort spot nearer another tip over one covering a tip's disc", () => {
    // one row (only R and L fit). A's R box covers tip B in both forms; wide L runs off the canvas;
    // compact L covers nothing but sits nearer to tip C than to A. Counted like a dot, B's disc made
    // wide R (0 + 8) as cheap as compact L (2 + 6); now covering a tip costs far more.
    const scene = new Scene(3, 300, 24).set(0, 60, 12).set(1, 95, 12).set(2, 8, 12)
    const specs = [mkSpec(0, 'aaaaaaaaaaaaaa', 'aaaa…'), mkSpec(1, 'b'), mkSpec(2, 'c')]
    const p = placer(specs, {}, [0, 1, 2], [0])
    run(p, scene, 60)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(L)
    expect(p.variant[0]).toBe(1)
    // no disc under it, but C is nearer: still drawn with a leader
    expect(scene.sx[1] + scene.sr[1] < p.x0[0] || scene.sx[1] - scene.sr[1] > p.x0[0] + p.w[0]).toBe(true)
    expect(p.leader[0]).toBe(1)
  })

  it('rejects a spot that sits closer to another node than to its own (ownership)', () => {
    // a commit dot (r 3) 1 px beyond the right end of the R box: R is legal for every other rule,
    // but the dot is closer to that box (1 px) than the label's own node is (the 5 px gap)
    const scene = new Scene(2, 400, 300).set(0, 200, 150).set(1, 200 + 4 + 5 + measure('topic') + 2 * o.padX + 4, 150, 3)
    const p = placer([mkSpec(0, 'topic')])
    run(p, scene, 40)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(L)
    const q = placer([mkSpec(0, 'topic')], { ownership: false })
    run(q, scene, 40)
    expect(q.anchor[0]).toBe(R)
  })

  it('applies the ownership rule to newcomers and re-searches only, not to a label keeping its spot', () => {
    const scene = new Scene(2, 400, 300).set(0, 200, 150).set(1, 380, 290, 3)
    const p = placer([mkSpec(0, 'topic')])
    run(p, scene, 40)
    expect(p.anchor[0]).toBe(R)
    // the dot drifts to just beyond the end of the label: a newcomer could not take R any more
    scene.set(1, 200 + 4 + 5 + measure('topic') + 2 * o.padX + 4, 150, 3)
    run(p, scene, 60)
    expect(p.anchor[0]).toBe(R)
    expect(p.shown[0]).toBe(1)
  })

  it('has no overlaps, keeps every box on the canvas and has no priority inversions at rest (50 random scenes)', () => {
    const W = 500
    const H = 320
    const tmp = new Float32Array(2)
    const rectDist = (x0: number, y0: number, x1: number, y1: number, px: number, py: number) =>
      Math.hypot(px < x0 ? x0 - px : px > x1 ? px - x1 : 0, py < y0 ? y0 - py : py > y1 ? py - y1 : 0)
    const hit = (a: number[], b: number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
    for (let seed = 1; seed <= 50; seed++) {
      const rand = rng(seed)
      const tips = 5 + Math.floor(rand() * 21)
      const dots = Math.floor(rand() * 21)
      const scene = new Scene(tips + dots, W, H)
      for (let j = 0; j < tips + dots; j++) scene.set(j, 20 + rand() * (W - 40), 20 + rand() * (H - 40), j < tips ? 4 + rand() * 3 : 2 + rand() * 2)
      const specs: LabelSpec[] = []
      for (let i = 0; i < tips; i++) {
        const len = 3 + Math.floor(rand() * 16)
        let name = ''
        for (let c = 0; c < len; c++) name += rand() < 0.15 ? '-' : String.fromCharCode(97 + Math.floor(rand() * 26))
        specs.push(len > 10 ? mkSpec(i, name, name.slice(0, 6) + '…') : mkSpec(i, name))
      }
      const order = specs.map((_, i) => i)
      for (let i = order.length - 1; i > 0; i--) {
        const k = Math.floor(rand() * (i + 1))
        ;[order[i], order[k]] = [order[k], order[i]]
      }
      const rank = new Int32Array(tips)
      order.forEach((li, r) => {
        rank[li] = r
      })
      const p = placer(specs, {}, order)
      run(p, scene, 200)
      const shown = shownList(p)
      for (let a = 0; a < shown.length; a++) {
        expect(insideCanvas(p, shown[a], scene, o.edge - o.oldShrink)).toBe(true)
        for (let b = a + 1; b < shown.length; b++) expect(boxesOverlap(p, shown[a], shown[b], 2 * o.oldShrink)).toBe(false)
      }
      // a hidden label: every spot that is legal for it (on the canvas, no other tip covered, no
      // other tip closer than its own node) is taken by a label that ranks higher
      const squares = Array.from({ length: tips + dots }, (_, j) => [scene.sx[j] - scene.sr[j], scene.sy[j] - scene.sr[j], scene.sx[j] + scene.sr[j], scene.sy[j] + scene.sr[j]])
      for (let i = 0; i < tips; i++) {
        if (p.shown[i]) continue
        const sp = specs[i]
        const j = sp.node
        for (let v = 0; v < sp.widths.length; v++) {
          const w = sp.widths[v] + 2 * o.padX
          for (let a = 0; a < ANCHORS.length; a++) {
            anchorOrigin(a, scene.sx[j], scene.sy[j], scene.sr[j], w, o.lineH, o.gap, tmp)
            const box = [tmp[0], tmp[1], tmp[0] + w, tmp[1] + o.lineH]
            if (box[0] < o.edge || box[1] < o.edge || box[2] > W - o.edge || box[3] > H - o.edge) continue
            let legal = true
            const dOwn = rectDist(box[0], box[1], box[2], box[3], scene.sx[j], scene.sy[j]) - scene.sr[j]
            for (let m = 0; m < tips && legal; m++) {
              if (m === j) continue
              if (hit(box, squares[m])) legal = false
              const q = o.ownerQuery
              if (hit([box[0] - q, box[1] - q, box[2] + q, box[3] + q], squares[m]) && rectDist(box[0], box[1], box[2], box[3], scene.sx[m], scene.sy[m]) - scene.sr[m] < dOwn - o.ownerTolerance) legal = false
            }
            if (!legal) continue
            const pad = o.newPad
            const padded = [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]
            const blocked = shown.some((k) => rank[k] < rank[i] && hit(padded, [p.x0[k], p.y0[k], p.x0[k] + p.w[k], p.y0[k] + p.h[k]]))
            expect(blocked, `seed ${seed}: label ${i} (rank ${rank[i]}) could take ${ANCHORS[a]}${v}`).toBe(true)
          }
        }
      }
    }
  })
})

// ---------------- hysteresis ----------------

describe('LabelPlacer hysteresis', () => {
  it('shows a newly placeable label only after 130 ms, then fades it in', () => {
    const scene = new Scene(1).set(0, 300, 200)
    const p = placer([mkSpec(0, 'main')])
    let frames = 0
    while (!p.shown[0] && frames < 50) {
      p.update(scene.frame())
      frames++
    }
    expect(frames).toBe(Math.ceil(o.showAfterMs / DT))
    const a0 = p.alpha[0]
    expect(a0).toBeGreaterThan(0)
    expect(a0).toBeLessThan(0.2)
    run(p, scene, 3)
    expect(p.alpha[0]).toBeCloseTo(Math.min(1, a0 + (3 * DT) / o.fadeInMs), 4)
    run(p, scene, 20)
    expect(p.alpha[0]).toBe(1)
  })

  // a dense cluster: 14 tips in 220 x 150 px
  function cluster(seed: number) {
    const rand = rng(seed)
    const n = 14
    const base: [number, number][] = []
    for (let j = 0; j < n; j++) base.push([190 + rand() * 220, 125 + rand() * 150])
    const scene = new Scene(n, 600, 400)
    base.forEach(([x, y], j) => scene.set(j, x, y))
    const specs = base.map((_, j) => mkSpec(j, `branch-${'x'.repeat(2 + Math.floor(rand() * 8))}`))
    return { scene, base, specs, rand }
  }

  function jitterChurn(opts: Partial<PlacerOptions>): number {
    const { scene, base, specs, rand } = cluster(7)
    const p = placer(specs, opts)
    run(p, scene, 300)
    const shown0 = Array.from(p.shown)
    let changes = 0
    let prev = snapshot(p)
    const count = () => {
      const now = snapshot(p)
      for (let i = 0; i < specs.length; i++) {
        if (!shown0[i]) continue
        if (now.shown[i] !== prev.shown[i] || (now.shown[i] && (now.anchor[i] !== prev.anchor[i] || now.variant[i] !== prev.variant[i]))) changes++
      }
      prev = now
    }
    for (let f = 0; f < 300; f++) {
      base.forEach(([x, y], j) => scene.move(j, x + (rand() * 2 - 1) * 1.5, y + (rand() * 2 - 1) * 1.5))
      p.update(scene.frame())
      count()
    }
    base.forEach(([x, y], j) => scene.move(j, x, y))
    p.update(scene.frame())
    count()
    scene.still()
    for (let f = 0; f < 120; f++) {
      p.update(scene.frame())
      count()
    }
    return changes
  }

  it('keeps shown labels put while nodes jitter by ±1.5 px, and the test can tell', () => {
    expect(jitterChurn({})).toBe(0)
    expect(jitterChurn({ sticky: false, showAfterMs: 0, admitMaxSpeed: Infinity, retryFrames: 0, calmPolish: false })).toBeGreaterThan(20)
  })

  it('never admits a hidden label whose node moves 3 px per frame', () => {
    const scene = new Scene(1).set(0, 100, 200)
    const p = placer([mkSpec(0, 'moving')])
    for (let f = 0; f < 120; f++) {
      scene.move(0, 100 + 3 * (f + 1), 200)
      p.update(scene.frame())
      expect(p.shown[0]).toBe(0)
      expect(p.busy).toBe(true)
    }
  })

  it('blocks admissions while the camera moves, but keeps labels already shown', () => {
    const scene = new Scene(2).set(0, 200, 100).set(1, 200, 300)
    const p = placer([mkSpec(0, 'shown-first'), mkSpec(1, 'later')])
    // only label 0 exists on the canvas at first
    scene.set(1, 2000, 300)
    run(p, scene, 40)
    expect(p.shown[0]).toBe(1)
    const a = p.anchor[0]
    scene.set(1, 200, 300)
    run(p, scene, 60, { cameraMoving: true })
    expect(p.shown[1]).toBe(0)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(a)
    run(p, scene, 40)
    expect(p.shown[1]).toBe(1)
  })

  it('gives a compact label at R its wide form back at rest once that fits, then stays put', () => {
    // a canvas one row high: L runs off the canvas and tip B sits in the wide R box, so A is compact
    const scene = new Scene(2, 800, 30).set(0, 30, 15).set(1, 180, 15)
    const p = placer([mkSpec(0, 'fix/app-url-mordi-subdomain', 'fix/app-…-subdomain'), mkSpec(1, 'main')])
    run(p, scene, 200)
    expect(p.anchor[0]).toBe(R)
    expect(p.variant[0]).toBe(1)
    // zoom in: B moves well clear of the wide box
    for (let f = 1; f <= 20; f++) {
      scene.set(1, 180 + 300 * (f / 20), 15)
      p.update(scene.frame({ cameraMoving: true }))
    }
    run(p, scene, 400)
    expect(p.anchor[0]).toBe(R)
    expect(p.variant[0]).toBe(0)
    expect(p.textOf(0)).toBe('fix/app-url-mordi-subdomain')
    // no churn afterwards
    let changes = 0
    for (let f = 0; f < 300; f++) {
      const a = p.anchor[0]
      const v = p.variant[0]
      p.update(scene.frame())
      if (p.anchor[0] !== a || p.variant[0] !== v) changes++
    }
    expect(changes).toBe(0)
    expect(p.busy).toBe(false)
  })

  it('keeps a compact label whose wide form never fits without re-placing it at rest', () => {
    const scene = new Scene(2, 800, 30).set(0, 30, 15).set(1, 180, 15)
    const p = placer([mkSpec(0, 'fix/app-url-mordi-subdomain', 'fix/app-…-subdomain'), mkSpec(1, 'main')])
    run(p, scene, 200)
    expect(p.variant[0]).toBe(1)
    let changes = 0
    let busyFrames = 0
    for (let f = 0; f < 600; f++) {
      const v = p.variant[0]
      p.update(scene.frame())
      if (p.variant[0] !== v) changes++
      if (p.busy) busyFrames++
    }
    expect(changes).toBe(0)
    expect(busyFrames).toBe(0)
  })

  it('lets a shown label hang over the edge while the camera moves and flips it once the camera stops', () => {
    const scene = new Scene(1, 400, 300).set(0, 200, 150)
    const p = placer([mkSpec(0, 'release/next')])
    run(p, scene, 40)
    expect(p.anchor[0]).toBe(R)
    // the camera pans the node towards the right edge: R now runs off the canvas
    for (let f = 1; f <= 20; f++) {
      scene.set(0, 200 + 9 * f, 150)
      p.update(scene.frame({ cameraMoving: true }))
      expect(p.anchor[0]).toBe(R)
      expect(p.shown[0]).toBe(1)
    }
    expect(p.x0[0] + p.w[0]).toBeGreaterThan(scene.width)
    p.update(scene.frame())
    expect(p.anchor[0]).not.toBe(R)
    expect(p.shown[0]).toBe(1)
    expect(insideCanvas(p, 0, scene, o.edge)).toBe(true)
  })

  /**
   * A calm pile too dense for every name, then 12 frames of camera motion, then a still camera:
   * frames until a label hidden at rest (with its node on the canvas) shows. 'zoom' zooms in by 1.1
   * per frame about the canvas centre; 'pan' starts with a spread pile hanging over the right edge
   * and pans it 30 px left per frame.
   */
  function revealAfterCamera(motion: 'zoom' | 'pan'): number {
    const n = 20
    const W = 800
    const H = 500
    const gx = Array.from({ length: n }, (_, j) => ((j % 5) - 2) * 14)
    const gy = Array.from({ length: n }, (_, j) => (Math.floor(j / 5) - 1.5) * 12)
    const scene = new Scene(n, W, H)
    let k = motion === 'zoom' ? 1 : 3
    let tx = motion === 'zoom' ? W / 2 : W - 20
    const project = () => {
      for (let j = 0; j < n; j++) scene.set(j, gx[j] * k + tx, gy[j] * k + H / 2)
    }
    project()
    const p = placer(Array.from({ length: n }, (_, j) => mkSpec(j, `feature/topic-${j}`)))
    const frame = (cameraMoving: boolean) => scene.frame({ cameraMoving, dtMs: 1000 / 60 })
    for (let f = 0; f < 300; f++) p.update(frame(false))
    expect(p.calm).toBe(true)
    const hiddenAtRest = Array.from(p.shown, (v, i) => v === 0 && scene.sx[i] >= 0 && scene.sx[i] <= W)
    expect(hiddenAtRest.some(Boolean)).toBe(true)
    for (let s = 0; s < 12; s++) {
      if (motion === 'zoom') k *= 1.1
      else tx -= 30
      project()
      p.update(frame(true))
    }
    for (let f = 1; f <= 120; f++) {
      p.update(frame(false))
      if (hiddenAtRest.some((h, i) => h && p.shown[i])) return f
    }
    return -1
  }

  it('takes a spot that slow drift opens in a calm scene, without waiting for a state change', () => {
    // one row: A's L runs off the canvas and tip B sits in A's R box. B then drifts right at
    // 0.1 px per frame, below the calm threshold, so the scene stays calm throughout.
    const scene = new Scene(2, 300, 24).set(0, 10, 12).set(1, 45, 12)
    const p = placer([mkSpec(0, 'aaaa'), mkSpec(1, 'b')])
    run(p, scene, 60)
    expect(p.calm).toBe(true)
    expect(p.shown[0]).toBe(0)
    // R is legal (no disc covered, B not nearer than A's own node) once B is past x = 56
    let clearAt = -1
    let shownAt = -1
    for (let f = 1; f <= 200 && shownAt < 0; f++) {
      scene.move(1, 45 + 0.1 * f, 12)
      p.update(scene.frame())
      expect(p.calm).toBe(true)
      if (clearAt < 0 && scene.sx[1] >= 56) clearAt = f
      if (p.shown[0]) shownAt = f
    }
    expect(clearAt).toBeGreaterThan(0)
    expect(shownAt).toBeGreaterThan(0)
    expect(shownAt - clearAt).toBeLessThanOrEqual(2 * o.retryFrames + Math.ceil(o.showAfterMs / DT) + 1)
    expect(p.anchor[0]).toBe(R)
  })

  for (const motion of ['zoom', 'pan'] as const) {
    it(`reveals names that fit about 130 ms after a ${motion} stops, without waiting for calm`, () => {
      const f = revealAfterCamera(motion)
      expect(f).toBeGreaterThan(0)
      expect(f).toBeLessThanOrEqual(Math.ceil(o.showAfterMs / (1000 / 60)) + 1)
    })
  }

  it('needs 30 consecutive slow frames for calm, and one fast frame resets the count', () => {
    const scene = new Scene(1).set(0, 300, 200)
    const p = placer([mkSpec(0, 'main')])
    run(p, scene, o.calmEnterFrames - 1)
    expect(p.calm).toBe(false)
    p.update(scene.frame())
    expect(p.calm).toBe(true)
    scene.speed[0] = o.calmExitSpeed + 0.1
    p.update(scene.frame())
    expect(p.calm).toBe(false)
    scene.still()
    run(p, scene, o.calmEnterFrames - 1)
    expect(p.calm).toBe(false)
    p.update(scene.frame())
    expect(p.calm).toBe(true)
    // the camera moving resets it too
    p.update(scene.frame({ cameraMoving: true }))
    expect(p.calm).toBe(false)
  })

  it('makes a fading label block newcomers but not labels already showing', () => {
    // one row (only R and L fit). D (rank 0) shows at R; A (rank 1) shows at L, its R running off
    // the canvas; B's node is off the canvas for now.
    const scene = new Scene(3, 220, 24).set(0, 190, 12).set(1, 2000, 12).set(2, 20, 12)
    const specs = [mkSpec(0, 'aaaaaaaa'), mkSpec(1, 'bbb'), mkSpec(2, 'dddddddddddd')]
    const p = placer(specs, {}, [2, 0, 1])
    run(p, scene, 60)
    expect(p.shown[2]).toBe(1)
    expect(p.anchor[2]).toBe(R)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(L)
    // A's node moves left: its L box now runs into D's label and it has no other spot, so it fades
    // out where it is, over the end of D's label. D keeps its spot.
    scene.set(0, 170, 12)
    p.update(scene.frame())
    expect(p.shown[0]).toBe(0)
    expect(p.alpha[0]).toBeGreaterThan(0)
    expect(boxesOverlap(p, 0, 2)).toBe(true)
    // B arrives; its only spot (R) lies inside A's fading box, clear of D: it waits for the fade
    scene.set(1, 118, 12)
    let waited = 0
    while (p.alpha[0] > 0) {
      p.update(scene.frame())
      expect(p.pendingMs[1]).toBe(0)
      expect(p.shown[1]).toBe(0)
      expect(p.shown[2]).toBe(1)
      expect(p.anchor[2]).toBe(R)
      waited++
    }
    expect(waited).toBeGreaterThan(0)
    run(p, scene, 30)
    expect(p.shown[1]).toBe(1)
    expect(p.anchor[1]).toBe(R)
    expect(p.shown[2]).toBe(1)
  })
})

// ---------------- forced and pinned ----------------

describe('LabelPlacer forced and pinned labels', () => {
  // a pile: 20 tips within 60 px
  function pile(n = 20) {
    const rand = rng(3)
    const scene = new Scene(n, 600, 400)
    for (let j = 0; j < n; j++) scene.set(j, 280 + rand() * 60, 180 + rand() * 60)
    const specs = Array.from({ length: n }, (_, j) => mkSpec(j, j === 0 ? 'main' : `feature/topic-${j}`))
    return { scene, specs }
  }

  it('shows a forced label at once with its full text on the canvas, masking the labels under it without moving them', () => {
    const scene = new Scene(3, 500, 300).set(0, 100, 150).set(1, 160, 150).set(2, 220, 152)
    const specs = [mkSpec(0, 'a-very-long-branch-name-that-is-forced', 'a-very…'), mkSpec(1, 'bb'), mkSpec(2, 'cc')]
    const p = placer(specs, {}, [1, 2, 0])
    run(p, scene, 200)
    const before = snapshot(p)
    p.setForced([0], 0)
    p.update(scene.frame())
    expect(p.forcedNow[0]).toBe(1)
    expect(p.shown[0]).toBe(1)
    expect(p.alpha[0]).toBe(1)
    expect(p.variant[0]).toBe(-1)
    expect(p.textOf(0)).toBe(specs[0].fullText)
    expect(insideCanvas(p, 0, scene, o.edge)).toBe(true)
    // the labels under the plate keep their anchors and fade out
    const under = [1, 2].filter((i) => before.shown[i] && boxesOverlap(p, 0, i))
    expect(under.length).toBeGreaterThan(0)
    run(p, scene, 10)
    for (const i of under) {
      expect(p.masked[i]).toBe(1)
      expect(p.anchor[i]).toBe(before.anchor[i])
      expect(p.alpha[i]).toBe(0)
    }
  })

  it('leaves no trace once the force ends, and a forced label that was hidden hides again at once', () => {
    const { scene, specs } = pile()
    const p = placer(specs, {}, undefined, [0])
    run(p, scene, 300)
    const before = snapshot(p)
    const hidden = before.shown.indexOf(0)
    expect(hidden).toBeGreaterThan(0)
    for (const forced of [[hidden], [before.shown.indexOf(1)], [hidden, 0]]) {
      p.setForced(forced, forced[0])
      run(p, scene, 30)
      expect(p.shown[forced[0]]).toBe(1)
      p.setForced([])
      p.update(scene.frame())
      expect(p.shown[hidden]).toBe(0)
      expect(p.alpha[hidden]).toBe(0)
      run(p, scene, 60)
      expect(snapshot(p)).toEqual(before)
    }
  })

  it('shows the pinned default-branch label even in a 20-tip pile', () => {
    const { scene, specs } = pile()
    // main ranks last but is pinned
    const order = specs.map((_, i) => i).reverse()
    const p = placer(specs, {}, order, [0])
    p.update(scene.frame())
    expect(p.shown[0]).toBe(1)
    run(p, scene, 300)
    expect(p.shown[0]).toBe(1)
    for (const k of shownList(p)) if (k !== 0) expect(boxesOverlap(p, 0, k)).toBe(false)
  })

  it('moves a pinned label off a tip that drifted under it once it is at rest and a clean spot is free', () => {
    const scene = new Scene(3, 800, 500).set(0, 400, 250).set(1, 475, 254).set(2, 200, 420)
    const p = placer([mkSpec(0, 'main'), mkSpec(1, 'test/bundled-dev-skip'), mkSpec(2, 'feat/x')], {}, [0, 1, 2], [0])
    run(p, scene, 80)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(R)
    // the other tip moves into main's R box and stops there
    for (let f = 1; f <= 30; f++) {
      scene.move(1, 475 - 45 * (f / 30), 254 - 2 * (f / 30))
      p.update(scene.frame())
    }
    scene.still()
    const inBox = () => scene.sx[1] > p.x0[0] && scene.sx[1] < p.x0[0] + p.w[0] && scene.sy[1] > p.y0[0] && scene.sy[1] < p.y0[0] + p.h[0]
    run(p, scene, 90)
    expect(p.calm).toBe(true)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(L)
    expect(inBox()).toBe(false)
    expect(p.leader[0]).toBe(0)
    expect(p.busy).toBe(false)
  })

  it('keeps a pinned label on a tip where its spot passes only the sticky edge tolerance', () => {
    // one row, 85 px wide: main's R box ends exactly at the edge margin and covers tip b; L is off
    const scene = new Scene(2, 85, 24).set(0, 40, 12, 6).set(1, 62, 12, 6)
    const p = placer([mkSpec(0, 'main'), mkSpec(1, 'b')], {}, [0, 1], [0])
    run(p, scene, 60)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(R)
    // nudged 1.5 px right: R now fails the strict edge test but sits inside the 2 px tolerance
    scene.move(0, 41.5, 12)
    scene.move(1, 63.5, 12)
    p.update(scene.frame())
    expect(p.calm).toBe(false)
    scene.still()
    run(p, scene, 300)
    expect(p.calm).toBe(true)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(R)
    expect(p.alpha[0]).toBe(1)
    expect(p.busy).toBe(false)
  })

  it("shows a search hit's match by swapping its text forms in place, and restores them after", () => {
    // one row: L runs off the canvas and tip B sits in the wide R box, so the label settles compact
    const scene = new Scene(2, 800, 30).set(0, 30, 15).set(1, 190, 15)
    const specs = [mkSpec(0, 'fix/hostname-host-…-injection', 'fix/…-injection'), mkSpec(1, 'main')]
    const p = placer(specs, {}, [0, 1])
    run(p, scene, 200)
    expect(p.anchor[0]).toBe(R)
    expect(p.textOf(0)).toBe('fix/…-injection')
    const texts = ['fix/hostname-host-…-injection', 'fix/hostname-host-…']
    p.setTextOverrides(new Map([[0, { texts, widths: texts.map(measure) }]]))
    p.setOrder(Int32Array.from([0, 1]), [0])
    run(p, scene, 5)
    expect(p.shown[0]).toBe(1)
    expect(p.anchor[0]).toBe(R)
    expect(p.textOf(0)).toContain('hostname')
    expect(p.w[0]).toBe(measure(texts[1]) + 2 * o.padX)
    // the caller's specs are never touched
    expect(specs[0].texts).toEqual(['fix/hostname-host-…-injection', 'fix/…-injection'])
    // the search ends: the label's own forms come back
    p.setTextOverrides(new Map())
    p.setOrder(Int32Array.from([0, 1]), [])
    run(p, scene, 5)
    expect(p.specs[0].texts).toEqual(specs[0].texts)
    expect(p.textOf(0)).toBe('fix/…-injection')
    // fewer forms than the current variant: clamped
    p.setVariantTexts(0, ['fix/hostname-host-…-injection'], [measure('fix/hostname-host-…-injection')])
    expect(p.variant[0]).toBe(0)
  })

  it('never lets pinned labels overlap: the lower-ranked one falls back to normal placement', () => {
    // one row: both labels only fit to the right of their nodes, and those boxes overlap
    const scene = new Scene(2, 200, 24).set(0, 10, 12).set(1, 30, 12)
    const specs = [mkSpec(0, 'aaaaaaaa'), mkSpec(1, 'bbbbbbbb')]
    const p = placer(specs, {}, [0, 1], [0, 1])
    run(p, scene, 60)
    expect(p.shown[0]).toBe(1)
    expect(p.shown[1]).toBe(0)
    const q = placer(specs, {}, [1, 0], [0, 1])
    run(q, scene, 60)
    expect(q.shown[1]).toBe(1)
    expect(q.shown[0]).toBe(0)
  })

  it('lists the hidden neighbours of a hovered hidden label on its plate', () => {
    const { scene, specs } = pile()
    const p = placer(specs, {}, undefined, [0])
    run(p, scene, 300)
    const rest = Array.from(p.shown)
    const hidden = rest.indexOf(0)
    p.setForced([hidden], hidden)
    p.update(scene.frame())
    const plate = p.plates[hidden]
    expect(plate).not.toBeNull()
    expect(plate!.explore).toBe(true)
    expect(plate!.rows[0]).toMatchObject({ kind: 'name', text: specs[hidden].fullText })
    const neighbours = plate!.rows.filter((r) => r.kind === 'neighbour')
    expect(neighbours.length).toBeGreaterThan(0)
    expect(neighbours.length).toBeLessThanOrEqual(o.plateNeighbours)
    for (const row of neighbours) {
      expect(p.shown[row.label] === 0 || p.forcedNow[row.label] === 1).toBe(true)
      const dj = specs[row.label].node
      expect(Math.hypot(scene.sx[dj] - scene.sx[hidden], scene.sy[dj] - scene.sy[hidden])).toBeLessThanOrEqual(o.plateNeighbourPx)
    }
    // rank order
    const ranks = neighbours.map((r) => Array.from(p.order).indexOf(r.label))
    expect(ranks).toEqual(ranks.slice().sort((a, b) => a - b))
    const more = plate!.rows[plate!.rows.length - 1]
    if (more.kind === 'more') expect(more.text).toMatch(/^\d+ more · zoom in$/)
    expect(p.h[hidden]).toBe(plate!.rows.length * o.lineH)
    // a hovered label that was showing gets its names only
    const visible = rest.indexOf(1, 1)
    p.setForced([visible], visible)
    p.update(scene.frame())
    expect(p.plates[visible]!.explore).toBe(false)
    expect(p.plates[visible]!.rows.every((r) => r.kind === 'name')).toBe(true)
  })

  it('keeps the hover plate neighbour rows current while the user zooms in under a still pointer', () => {
    const { scene, specs } = pile()
    const p = placer(specs, {}, undefined, [0])
    run(p, scene, 300)
    const h = Array.from(p.shown).indexOf(0)
    p.setForced([h], h)
    p.update(scene.frame())
    const before = p.plates[h]!.rows.filter((r) => r.kind !== 'name')
    expect(before.length).toBeGreaterThan(0)
    // zoom 3x about the hovered node: the neighbours spread out and most of them get room
    const cx = scene.sx[specs[h].node]
    const cy = scene.sy[specs[h].node]
    const gx = Array.from(scene.sx)
    const gy = Array.from(scene.sy)
    for (let f = 1; f <= 20; f++) {
      const k = 1 + 2 * (f / 20)
      for (let j = 0; j < scene.n; j++) scene.set(j, cx + (gx[j] - cx) * k, cy + (gy[j] - cy) * k)
      p.update(scene.frame({ cameraMoving: true }))
    }
    run(p, scene, 120)
    const plate = p.plates[h]!
    const neighbours = plate.rows.filter((r) => r.kind === 'neighbour')
    for (const row of neighbours) {
      expect(p.shown[row.label]).toBe(0)
      const dj = specs[row.label].node
      expect(Math.hypot(scene.sx[dj] - cx, scene.sy[dj] - cy)).toBeLessThanOrEqual(o.plateNeighbourPx + o.plateNeighbourSlackPx)
    }
    // the same rows as a plate built fresh in this view, unless a neighbour sits in the slack band
    const inBand = specs.some((s, k) => {
      const d = Math.hypot(scene.sx[s.node] - cx, scene.sy[s.node] - cy)
      return k !== h && !p.shown[k] && d > o.plateNeighbourPx && d <= o.plateNeighbourPx + o.plateNeighbourSlackPx
    })
    const rows = plate.rows.map((r) => `${r.kind}:${r.text}`)
    p.setForced([])
    p.update(scene.frame())
    p.setForced([h], h)
    p.update(scene.frame())
    if (!inBand) expect(p.plates[h]!.rows.map((r) => `${r.kind}:${r.text}`)).toEqual(rows)
    expect(p.h[h]).toBe(p.plates[h]!.rows.length * o.lineH)
  })

  it('does not rebuild a hover plate while nothing changes', () => {
    const { scene, specs } = pile()
    const p = placer(specs, {}, undefined, [0])
    run(p, scene, 300)
    const h = Array.from(p.shown).indexOf(0)
    p.setForced([h], h)
    p.update(scene.frame())
    const plate = p.plates[h]
    expect(plate!.rows.some((r) => r.kind === 'neighbour')).toBe(true)
    for (let f = 0; f < 300; f++) {
      p.update(scene.frame())
      expect(p.plates[h]).toBe(plate)
    }
  })

  it('keeps a listed neighbour on the plate while it wobbles across the listing radius', () => {
    // a canvas too small for any label: both stay hidden, and hovering 0 lists 1 as a neighbour
    const scene = new Scene(2, 60, 24).set(0, 15, 12).set(1, 15 + 26, 12)
    const p = placer([mkSpec(0, 'aaaaaaaa'), mkSpec(1, 'bbbbbbbb')])
    run(p, scene, 60)
    expect(shownList(p)).toEqual([])
    p.setForced([0], 0)
    p.update(scene.frame())
    const plate = p.plates[0]!
    expect(plate.rows.map((r) => r.label)).toEqual([-1, 1])
    // 29.5 px is past the 28 px radius but inside the slack: listed, and the plate is not rebuilt
    for (let f = 0; f < 60; f++) {
      scene.move(1, 15 + (f % 2 === 0 ? 29.5 : 27), 12)
      p.update(scene.frame())
      expect(p.plates[0]).toBe(plate)
    }
    // well beyond it the row goes, and the plate shrinks to the name alone
    scene.move(1, 15 + o.plateNeighbourPx + o.plateNeighbourSlackPx + 1, 12)
    p.update(scene.frame())
    expect(p.plates[0]!.rows.map((r) => r.label)).toEqual([-1])
    expect(p.h[0]).toBe(o.lineH)
    // and a fresh one within the radius is listed again
    scene.move(1, 15 + 20, 12)
    p.update(scene.frame())
    expect(p.plates[0]!.rows.map((r) => r.label)).toEqual([-1, 1])
  })

  it('puts one name per row on the plate of a multi-tip node, with +N more after eight', () => {
    const names = Array.from({ length: 11 }, (_, k) => `branch-${k}`)
    const spec: LabelSpec = { ...mkSpec(0, names.join(', ')), names, nameWidths: names.map(measure) }
    const scene = new Scene(1).set(0, 300, 200)
    const p = placer([spec])
    p.setForced([0])
    p.update(scene.frame())
    const rows = p.plates[0]!.rows
    expect(rows.slice(0, 8).map((r) => r.text)).toEqual(names.slice(0, 8))
    expect(rows[8]).toMatchObject({ kind: 'more', text: '+3 more' })
    expect(rows).toHaveLength(9)
  })

  /**
   * Hovers label 0 at rest and checks that the point it was hovered at (its box centre) keeps
   * hitting it after its plate moved to another anchor, so hover does not flicker.
   */
  function hoverKeepsHit(p: LabelPlacer, scene: Scene, variant: number): void {
    run(p, scene, 200)
    expect(p.shown[0]).toBe(1)
    expect(p.variant[0]).toBe(variant)
    const a = p.anchor[0]
    const cx = p.x0[0] + p.w[0] / 2
    const cy = p.y0[0] + p.h[0] / 2
    expect(p.hitTest(cx, cy)).toBe(0)
    p.setForced([0], 0)
    p.update(scene.frame())
    expect(p.forcedNow[0]).toBe(1)
    // the plate did not fit at the label's anchor and moved; the old box is off the plate
    expect(p.anchor[0]).not.toBe(a)
    const onPlate = cx >= p.x0[0] && cx <= p.x0[0] + p.w[0] && cy >= p.y0[0] && cy <= p.y0[0] + p.h[0]
    expect(onPlate).toBe(false)
    expect(p.hitTest(cx, cy)).toBe(0)
    p.update(scene.frame())
    expect(p.hitTest(cx, cy)).toBe(0)
    expect(p.hitTest(p.x0[0] + 2, p.y0[0] + 2)).toBe(0)
    // once the force ends the label is back in that box
    p.setForced([])
    p.update(scene.frame())
    expect(p.anchor[0]).toBe(a)
    expect(p.hitTest(cx, cy)).toBe(0)
  }

  it('keeps hitting a hovered label whose plate moved off its anchor at the right edge', () => {
    const name = 'feature/near-the-edge'
    const lw = measure(name) + 2 * o.padX
    // the R box ends 6 px inside the canvas: the 6 px wider plate cannot stay at R
    const scene = new Scene(1, 600, 400).set(0, 600 - 6 - lw - o.gap - 4, 200)
    hoverKeepsHit(placer([mkSpec(0, name)]), scene, 0)
  })

  it('keeps hitting a hovered multi-name label whose plate moved up near the bottom edge', () => {
    const names = ['main', 'dev', 'release']
    const spec: LabelSpec = { ...mkSpec(0, names.join(', ')), names, nameWidths: names.map(measure) }
    const scene = new Scene(1, 600, 400).set(0, 300, 400 - 14)
    hoverKeepsHit(placer([spec]), scene, 0)
  })

  it('keeps hitting a hovered compact label whose full-name plate moved elsewhere', () => {
    // wide fits nowhere around the node but above/below (cost 9), so compact R (cost 6) wins
    const spec = mkSpec(0, 'feature/a-really-long-x', 'feature/…-x')
    const x = 100
    const scene = new Scene(1, x + 4 + o.gap + spec.widths[1] + 2 * o.padX + 7, 300).set(0, x, 150)
    hoverKeepsHit(placer([spec]), scene, 1)
  })

  it('re-tests hover under a still pointer: keeps the hovered label on its plate or old box, drops it once it moves away', () => {
    const name = 'feature/near-the-edge'
    const lw = measure(name) + 2 * o.padX
    const scene = new Scene(2, 600, 400).set(0, 600 - 6 - lw - o.gap - 4, 200).set(1, 100, 100)
    const p = placer([mkSpec(0, name), mkSpec(1, 'other')])
    run(p, scene, 200)
    const cx = p.x0[0] + p.w[0] / 2
    const cy = p.y0[0] + p.h[0] / 2
    expect(p.hoverTest(cx, cy, -1)).toBe(0)
    p.setForced([0], 0)
    p.update(scene.frame())
    // the plate moved to another anchor: the pointer is on the old box only, and stays hovering
    expect(p.hoverTest(cx, cy, 0)).toBe(0)
    expect(p.hoverTest(p.x0[0] + 2, p.y0[0] + 2, 0)).toBe(0)
    // the other label is still found when nothing is hovered
    expect(p.hoverTest(p.x0[1] + 2, p.y0[1] + 2, -1)).toBe(1)
    expect(p.hoverTest(p.x0[1] + 2, p.y0[1] + 2, 0)).toBe(1)
    // a zoom carries the node (and both boxes) away from the still pointer
    for (let f = 1; f <= 10; f++) {
      scene.set(0, scene.sx[0] - 20 * f, 200 + 10 * f)
      p.update(scene.frame({ cameraMoving: true }))
    }
    expect(p.hoverTest(cx, cy, 0)).toBe(-1)
  })

  it('selects the tip a hover-plate neighbour row names on click, while hover stays on the plate owner', () => {
    const { scene, specs } = pile()
    const p = placer(specs, {}, undefined, [0])
    run(p, scene, 300)
    const h = Array.from(p.shown).indexOf(0)
    p.setForced([h], h)
    p.update(scene.frame())
    const rows = p.plates[h]!.rows
    const r = rows.findIndex((row) => row.kind === 'neighbour')
    expect(r).toBeGreaterThan(0)
    const x = p.x0[h] + 20
    const y = p.y0[h] + r * o.lineH + o.lineH / 2
    expect(p.hitTest(x, y)).toBe(h)
    expect(p.clickTest(x, y)).toBe(rows[r].label)
    // the name row (and a 'more' row) select the owner
    expect(p.clickTest(x, p.y0[h] + o.lineH / 2)).toBe(h)
    const more = rows.findIndex((row) => row.kind === 'more')
    if (more >= 0) expect(p.clickTest(x, p.y0[h] + more * o.lineH + o.lineH / 2)).toBe(h)
    // off the plate it is plain hitTest
    expect(p.clickTest(1, 1)).toBe(-1)
  })

  it('keeps a hovered hidden label on its plate while the pointer moves slowly from its node onto the plate', () => {
    // admission held: the label stays hidden, so hovering its node shows an explore plate at R
    const scene = new Scene(1, 600, 400).set(0, 300, 200)
    const p = placer([mkSpec(0, 'feature/topic')])
    run(p, scene, 60, { admit: false })
    expect(p.shown[0]).toBe(0)
    const nx = scene.sx[0]
    const ny = scene.sy[0]
    // node hover as Garden's pointer area gives it: the tip's ring plus 0.75 px
    const nodeHoverR = scene.sr[0] + 0.75
    let labelHover = -1
    let reached = false
    for (let dx = 0; dx <= 40 && !reached; dx++) {
      const x = nx + dx
      const y = ny
      // pointermove: label hover against the last frame's plate; then the frame: node hover wins
      labelHover = p.hoverTest(x, y, labelHover)
      const hovered = Math.hypot(x - nx, y - ny) <= nodeHoverR ? 0 : labelHover
      p.setForced(hovered >= 0 ? [hovered] : [], hovered)
      p.update(scene.frame({ admit: false }))
      expect(p.forcedNow[0], `dropped at dx = ${dx}`).toBe(1)
      reached = x >= p.x0[0] && x <= p.x0[0] + p.w[0] && y >= p.y0[0] && y <= p.y0[0] + p.h[0]
    }
    expect(reached).toBe(true)
    expect(p.anchor[0]).toBe(R)
    // the bridge is hover hysteresis for the hovered label only: no plate, no bridge
    p.setForced([])
    p.update(scene.frame({ admit: false }))
    expect(p.hitTest(nx + scene.sr[0] + 2, ny)).toBe(-1)
  })

  it('hit-tests plates before labels and maps nothing to -1', () => {
    const scene = new Scene(2, 500, 300).set(0, 100, 150).set(1, 300, 150)
    const p = placer([mkSpec(0, 'left-label'), mkSpec(1, 'right-label')])
    run(p, scene, 60)
    expect(p.hitTest(p.x0[1] + 3, p.y0[1] + 5)).toBe(1)
    expect(p.hitTest(5, 5)).toBe(-1)
    p.setForced([0])
    p.update(scene.frame())
    expect(p.hitTest(p.x0[0] + 3, p.y0[0] + 5)).toBe(0)
  })
})

// ---------------- busy, gating and inheritance ----------------

describe('LabelPlacer busy, gated frames and inheritance', () => {
  it('is busy while pending, fading or moving, settles within a few static frames and stays settled', () => {
    const scene = new Scene(3).set(0, 100, 100).set(1, 300, 200).set(2, 500, 300)
    const p = placer([mkSpec(0, 'one'), mkSpec(1, 'two'), mkSpec(2, 'three')])
    p.update(scene.frame())
    expect(p.busy).toBe(true)
    let settledAt = -1
    for (let f = 1; f < 500; f++) {
      p.update(scene.frame())
      if (!p.busy && settledAt < 0) settledAt = f
      if (settledAt >= 0) expect(p.busy).toBe(false)
    }
    // 30 calm frames plus the last fade-in, then at most ~10 more
    expect(settledAt).toBeGreaterThan(0)
    expect(settledAt).toBeLessThanOrEqual(o.calmEnterFrames + 10)
    p.update(scene.frame({ cameraMoving: true }))
    expect(p.busy).toBe(true)
  })

  it('turns busy off through the watchdog once a calm, motionless scene has kept it on for 180 frames', () => {
    // a hidden label held back for good (admit stays false) keeps busy on every frame; nothing moves
    const scene = new Scene(2).set(0, 100, 100).set(1, 400, 300)
    const p = placer([mkSpec(0, 'main'), mkSpec(1, 'held')], {}, [0, 1], [0])
    let offAt = -1
    for (let f = 1; f <= 400; f++) {
      p.update(scene.frame({ admit: false }))
      if (!p.busy && offAt < 0) offAt = f
    }
    expect(p.calm).toBe(true)
    expect(p.shown[1]).toBe(0)
    // (the first frame changes admit, which re-arms it: 180 quiet frames after that one)
    expect(offAt).toBe(o.watchdogFrames + 1)
    // any motion re-arms it
    scene.speed[1] = 0.5
    p.update(scene.frame({ admit: false }))
    expect(p.busy).toBe(true)
  })

  /**
   * The app only delivers frames while busy (autoPauseRedraw={!labelsBusy}) once the layout has
   * stopped. Run a motion phase, then step only while busy: the outcome must equal a continuous run,
   * and a hover cycle stepped the same way must leave no trace.
   */
  it('reaches the same calm state with gated frames as with continuous ones (gated frames)', () => {
    const rand = rng(11)
    const n = 24
    const start: [number, number][] = []
    const end: [number, number][] = []
    for (let j = 0; j < n; j++) {
      const x = 150 + rand() * 300
      const y = 100 + rand() * 200
      end.push([x, y])
      start.push([x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120])
    }
    const specs = end.map((_, j) => mkSpec(j, `topic/${'q'.repeat(3 + (j % 9))}-${j}`, `t${j}…`))
    const make = () => {
      const scene = new Scene(n, 600, 400)
      start.forEach(([x, y], j) => scene.set(j, x, y))
      const p = placer(specs, {}, undefined, [0])
      // motion phase: every frame is delivered (the engine is running)
      for (let f = 1; f <= 90; f++) {
        const t = 1 - Math.pow(1 - f / 90, 3)
        start.forEach(([x, y], j) => scene.move(j, x + (end[j][0] - x) * t, y + (end[j][1] - y) * t))
        p.update(scene.frame())
      }
      scene.still()
      return { scene, p }
    }
    const cont = make()
    run(cont.p, cont.scene, 400)
    const gated = make()
    let delivered = 0
    for (let f = 0; f < 400 && gated.p.busy; f++) {
      gated.p.update(gated.scene.frame())
      delivered++
    }
    expect(gated.p.busy).toBe(false)
    expect(gated.p.calm).toBe(true)
    expect(delivered).toBeLessThan(400)
    expect(snapshot(gated.p)).toEqual(snapshot(cont.p))
    // hover cycle, one frame per change and then only while busy
    const rest = snapshot(gated.p)
    const step = () => {
      gated.p.update(gated.scene.frame())
      for (let f = 0; f < 400 && gated.p.busy; f++) gated.p.update(gated.scene.frame())
    }
    for (const target of [3, 7, rest.shown.indexOf(0)]) {
      if (target < 0) continue
      gated.p.setForced([target], target)
      step()
      expect(gated.p.forcedNow[target]).toBe(1)
      gated.p.setForced([])
      step()
      expect(snapshot(gated.p)).toEqual(rest)
    }
  })

  it('copies state by node from the previous placer, so a surviving label keeps its spot at full alpha', () => {
    const scene = new Scene(3, 500, 300).set(0, 100, 150).set(1, 250, 150).set(2, 400, 150)
    const prev = placer([mkSpec(0, 'alpha'), mkSpec(1, 'beta'), mkSpec(2, 'gamma')])
    run(prev, scene, 60)
    expect(shownList(prev)).toEqual([0, 1, 2])
    // the rebuilt graph lost 'alpha' and gained 'delta'; labels are listed in a new order
    const next = new LabelPlacer([mkSpec(2, 'gamma'), mkSpec(1, 'beta'), mkSpec(0, 'delta')], { measure })
    const prevIndexOf = (i: number) => [2, 1, -1][i]
    expect(next.inheritFrom(prev, prevIndexOf)).toBe(2)
    expect(next.shown[0]).toBe(1)
    expect(next.alpha[0]).toBe(1)
    expect(next.anchor[0]).toBe(prev.anchor[2])
    expect(next.shown[2]).toBe(0)
    next.update(scene.frame())
    expect(next.shown[0]).toBe(1)
    expect(next.alpha[0]).toBe(1)
    expect(next.anchor[0]).toBe(prev.anchor[2])
    expect(next.shown[1]).toBe(1)
    expect(next.shown[2]).toBe(0)
  })

  it('holds hidden non-pinned labels back while admit is false, without touching pinned or shown ones', () => {
    const scene = new Scene(3).set(0, 100, 100).set(1, 300, 200).set(2, 500, 300)
    const p = placer([mkSpec(0, 'main'), mkSpec(1, 'two'), mkSpec(2, 'three')], {}, [0, 1, 2], [0])
    run(p, scene, 120, { admit: false })
    expect(shownList(p)).toEqual([0])
    expect(p.calm).toBe(true)
    expect(p.busy).toBe(true)
    run(p, scene, 30)
    expect(shownList(p)).toEqual([0, 1, 2])
  })

  it('moves a label placed during the hold to a clearly cheaper spot when admission opens', () => {
    // main is pinned and shown during the hold; two tips crowd its R and L, so it goes above (T)
    const crowd = () => new Scene(3).set(0, 300, 200).set(1, 320, 200).set(2, 280, 200)
    const specs = () => [mkSpec(0, 'main'), mkSpec(1, 'right'), mkSpec(2, 'left')]
    const T = ANCHORS.indexOf('T')
    for (const reseatOnAdmit of [true, false]) {
      const scene = crowd()
      const p = placer(specs(), { reseatOnAdmit, polishByCost: false }, [0, 1, 2], [0])
      p.update(scene.frame({ admit: false }))
      expect(p.shown[0]).toBe(1)
      expect(p.anchor[0]).toBe(T)
      // the layout spreads out while admission is still held: main keeps its spot
      scene.set(1, 420, 200).set(2, 180, 200)
      run(p, scene, 10, { admit: false })
      expect(p.anchor[0]).toBe(T)
      p.update(scene.frame())
      expect(p.anchor[0]).toBe(reseatOnAdmit ? R : T)
    }
  })

  it('counts hidden names on the canvas, ignoring labels whose node is off it', () => {
    const scene = new Scene(3, 260, 24).set(0, 10, 12).set(1, 250, 12).set(2, 130, 12)
    const p = placer([mkSpec(0, 'aaaaaaaa'), mkSpec(1, 'bbbbbbbb'), mkSpec(2, 'cccccccc')])
    run(p, scene, 60)
    expect(p.hiddenCount()).toBe(1)
    scene.set(2, 5000, 12)
    run(p, scene, 5)
    expect(p.hiddenCount()).toBe(0)
  })
})

// ---------------- performance guard ----------------

// skippable on slow or shared CI machines with SKIP_PERF_TESTS=1
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

describe.skipIf(env.SKIP_PERF_TESTS === '1')('LabelPlacer performance', () => {
  it('updates 200 tips and 400 nodes in well under 1 ms per frame on average', () => {
    const rand = rng(5)
    const tips = 200
    const n = 400
    const W = 1042
    const H = 768
    const scene = new Scene(n, W, H)
    const base: [number, number][] = []
    for (let j = 0; j < n; j++) {
      base.push([60 + rand() * (W - 120), 60 + rand() * (H - 120)])
      scene.set(j, base[j][0], base[j][1], j < tips ? 4 : 2.5)
    }
    const specs = Array.from({ length: tips }, (_, i) => {
      const name = `feature/${'abcdefghij'.slice(0, 2 + (i % 8))}-${i}`
      return mkSpec(i, name, name.slice(0, 8) + '…')
    })
    const p = placer(specs, {}, undefined, [0])
    // warm up
    run(p, scene, 60)
    let total = 0
    for (let f = 0; f < 600; f++) {
      // jitter during the first half, a hover change every 50 frames during the second
      if (f < 300) base.forEach(([x, y], j) => scene.move(j, x + (rand() - 0.5) * 2, y + (rand() - 0.5) * 2))
      else {
        scene.still()
        if (f % 50 === 0) p.setForced([Math.floor(rand() * tips)], -1)
      }
      const t0 = performance.now()
      p.update(scene.frame())
      total += performance.now() - t0
    }
    expect(total / 600).toBeLessThan(1)
  })
})
