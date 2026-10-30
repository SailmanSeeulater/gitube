/**
 * A small padlock centred on (x, y), size px tall: the shackle stroked, the body filled. Marks a
 * private repo wherever its name or "private repo" is drawn (the labels and the poster).
 */
export function drawLock(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colour: string): void {
  const bodyW = size * 0.72
  const bodyH = size * 0.56
  const bodyTop = y + size / 2 - bodyH
  const r = size * 0.22
  ctx.beginPath()
  ctx.moveTo(x - r, bodyTop)
  ctx.lineTo(x - r, bodyTop - size * 0.1)
  ctx.arc(x, bodyTop - size * 0.1, r, Math.PI, 0)
  ctx.lineTo(x + r, bodyTop)
  ctx.strokeStyle = colour
  ctx.lineWidth = Math.max(1, size * 0.14)
  ctx.lineCap = 'round'
  ctx.stroke()
  ctx.beginPath()
  ctx.rect(x - bodyW / 2, bodyTop, bodyW, bodyH)
  ctx.fillStyle = colour
  ctx.fill()
}
