/**
 * PNG export of the graph as it is on screen, and the browser download both exports share.
 * Browser only (canvas, Blob, object URLs).
 */
import type { Theme } from '../theme/themes'

export interface ImageCaption {
  /** 'owner/repo', bottom left */
  title: string
  /** view, layout, counts, the selection: after the title, muted */
  detail: string
  /** bottom right, muted */
  credit: string
}

/** Caption band under the graph, in CSS px (scaled by the canvas's pixel ratio). */
const CAPTION_PX = 34
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * The graph canvas over the theme's canvas colour (force-graph paints its background with CSS, so
 * the canvas itself is transparent), with a caption band underneath. Keeps the canvas's own pixel
 * ratio, so a HiDPI screen gives a HiDPI image.
 */
export function composeGraphImage(source: HTMLCanvasElement, theme: Theme, caption: ImageCaption): HTMLCanvasElement {
  const cssWidth = source.getBoundingClientRect().width || source.width
  const ratio = source.width / cssWidth || 1
  const band = Math.round(CAPTION_PX * ratio)
  const out = document.createElement('canvas')
  out.width = source.width
  out.height = source.height + band
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('canvas 2D context unavailable')

  ctx.fillStyle = theme.canvas
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(source, 0, 0)

  const y = source.height + band / 2
  const pad = Math.round(14 * ratio)
  ctx.fillStyle = theme.panelBorder
  ctx.fillRect(0, source.height, out.width, Math.max(1, Math.round(ratio)))
  ctx.textBaseline = 'middle'

  ctx.font = `600 ${Math.round(13 * ratio)}px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.text
  ctx.fillText(caption.title, pad, y)
  const titleWidth = ctx.measureText(caption.title).width

  ctx.font = `${Math.round(12 * ratio)}px ${FONT}`
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.muted
  ctx.fillText(caption.credit, out.width - pad, y)
  const creditWidth = ctx.measureText(caption.credit).width

  // the detail gets whatever room is left between the two
  const room = out.width - 2 * pad - titleWidth - creditWidth - Math.round(24 * ratio)
  if (room > 0 && caption.detail) {
    ctx.textAlign = 'left'
    ctx.fillStyle = theme.textDim
    ctx.fillText(fitText(ctx, caption.detail, room), pad + titleWidth + Math.round(12 * ratio), y)
  }
  return out
}

/** text cut to maxWidth with an ellipsis */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : ''
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the image'))), 'image/png')
  })
}

/** Hands a blob to the browser as a file download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // some browsers read the URL after click() returns
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
