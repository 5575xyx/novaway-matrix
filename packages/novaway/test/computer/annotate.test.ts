import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import { annotate } from "@/computer/annotate"

const require = createRequire(import.meta.url)
const { createCanvas, loadImage } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas")

const created: string[] = []

afterAll(async () => {
  await Promise.all(created.map((file) => fs.rm(file, { force: true })))
})

async function sample(width = 120, height = 80) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#204060"
  ctx.fillRect(0, 0, width, height)
  return { base64: canvas.toBuffer("image/png").toString("base64"), width, height }
}

describe("computer annotate", () => {
  test("draws a grid and reports absolute region coordinates", async () => {
    const image = await sample()
    const shot = await annotate(
      { path: "", base64: image.base64, mime: "image/png", origin: { x: 300, y: 150 } },
      {
        columns: 4,
        rows: 2,
        regions: [{ x: 10, y: 20, width: 30, height: 40, label: "Save" }],
      },
    )

    expect(shot.annotation.columns).toBe(4)
    expect(shot.annotation.rows).toBe(2)
    expect(shot.annotation.cellWidth).toBe(30)
    expect(shot.annotation.cellHeight).toBe(40)
    expect(shot.annotation.regions[0]).toMatchObject({ screenX: 310, screenY: 170, label: "Save" })
    expect(shot.path).toBe(shot.annotatedPath)

    const rendered = await loadImage(await fs.readFile(shot.path))
    expect(rendered.width).toBe(image.width)
    expect(rendered.height).toBe(image.height)
    created.push(shot.path)
  })

  test("clamps regions to the image and tolerates a missing origin", async () => {
    const image = await sample(50, 40)
    const shot = await annotate(
      { path: "", base64: image.base64, mime: "image/png" },
      { columns: 0, rows: 0, regions: [{ x: -10, y: -10, width: 0, height: 0 }] },
    )

    expect(shot.annotation.columns).toBe(1)
    expect(shot.annotation.rows).toBe(1)
    expect(shot.annotation.regions[0]).toMatchObject({ x: 0, y: 0, width: 1, height: 1, screenX: 0, screenY: 0 })
    created.push(shot.path)
  })
})
