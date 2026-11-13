import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import type { Screenshot } from "./computer"

export type Region = { x: number; y: number; width: number; height: number; label?: string }

export type Annotation = {
  columns: number
  rows: number
  cellWidth: number
  cellHeight: number
  /** Region boxes converted from the annotated image to absolute screen coordinates. */
  regions: (Region & { screenX: number; screenY: number })[]
}

export type AnnotatedScreenshot = Screenshot & { annotation: Annotation; annotatedPath: string }

type CanvasModule = typeof import("@napi-rs/canvas")
let canvasModule: CanvasModule | undefined

function canvas() {
  canvasModule ??= createRequire(import.meta.url)("@napi-rs/canvas") as CanvasModule
  return canvasModule
}

type Context2D = import("@napi-rs/canvas").SKRSContext2D

function label(value: string, x: number, y: number, ctx: Context2D) {
  const metrics = ctx.measureText(value)
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)"
  ctx.fillRect(x, y, metrics.width + 8, 16)
  ctx.fillStyle = "#7ce7ff"
  ctx.fillText(value, x + 4, y + 12)
}

/**
 * Draw a coordinate grid (and optional region boxes) over a screenshot.
 *
 * The grid answers the question the model keeps getting wrong: "where is this
 * pixel in absolute screen space". Cell labels are printed as absolute screen
 * coordinates, so a decision can be made by reading a label instead of doing
 * arithmetic on a crop. Region boxes are re-numbered 1..n for discussion.
 */
export async function annotate(
  screenshot: Screenshot,
  options: { columns?: number; rows?: number; regions?: readonly Region[] } = {},
): Promise<AnnotatedScreenshot> {
  const { createCanvas, loadImage } = canvas()
  const image = await loadImage(Buffer.from(screenshot.base64, "base64"))
  const sprite = createCanvas(image.width, image.height)
  const ctx = sprite.getContext("2d")
  ctx.drawImage(image, 0, 0)

  const columns = Math.max(1, Math.floor(options.columns ?? 6))
  const rows = Math.max(1, Math.floor(options.rows ?? 4))
  const cellWidth = image.width / columns
  const cellHeight = image.height / rows
  const origin = screenshot.origin ?? { x: 0, y: 0 }

  ctx.strokeStyle = "rgba(0, 160, 255, 0.55)"
  ctx.lineWidth = 1
  ctx.font = "11px sans-serif"
  ctx.textBaseline = "top"
  for (let column = 1; column < columns; column++) {
    const x = Math.round(column * cellWidth) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, image.height)
    ctx.stroke()
  }
  for (let row = 1; row < rows; row++) {
    const y = Math.round(row * cellHeight) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(image.width, y)
    ctx.stroke()
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = Math.round(column * cellWidth) + 2
      const y = Math.round(row * cellHeight) + 2
      label(`${origin.x + Math.round(column * cellWidth)},${origin.y + Math.round(row * cellHeight)}`, x, y, ctx)
    }
  }

  const regions = (options.regions ?? []).map((region, index) => {
    const box = {
      x: Math.max(0, Math.round(region.x)),
      y: Math.max(0, Math.round(region.y)),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height)),
    }
    ctx.strokeStyle = "#ff4d4f"
    ctx.lineWidth = 2
    ctx.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2)
    ctx.fillStyle = "#ff4d4f"
    ctx.fillRect(box.x + 1, box.y + 1, 18, 16)
    ctx.fillStyle = "#ffffff"
    ctx.fillText(region.label ?? String(index + 1), box.x + 5, box.y + 3)
    return { ...region, ...box, screenX: origin.x + box.x, screenY: origin.y + box.y }
  })

  const png = sprite.toBuffer("image/png")
  const file = path.join(os.tmpdir(), `novaway-annotated-${process.pid}-${Date.now()}.png`)
  await fs.writeFile(file, png)
  return {
    ...screenshot,
    path: file,
    annotatedPath: file,
    base64: png.toString("base64"),
    annotation: { columns, rows, cellWidth, cellHeight, regions },
  }
}
