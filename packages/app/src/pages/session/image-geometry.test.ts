import { describe, expect, test } from "bun:test"
import {
  canvasToBase64,
  drawCropped,
  drawFlipped,
  drawRotated,
  mimeOf,
  paintStroke,
  type Stroke,
} from "./image-geometry"

function fakeImage(width: number, height: number): HTMLImageElement {
  const img = new Image()
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true })
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true })
  return img
}

describe("mimeOf", () => {
  test("svg maps to image/svg+xml", () => {
    expect(mimeOf("a/b/c.svg")).toBe("image/svg+xml")
  })
  test("jpg maps to image/jpeg", () => {
    expect(mimeOf("photo.JPG")).toBe("image/jpeg")
  })
  test("png maps to image/png", () => {
    expect(mimeOf("photo.png")).toBe("image/png")
  })
})

describe("drawRotated", () => {
  test("90° swaps width and height", () => {
    const out = drawRotated(fakeImage(100, 40), 1)
    expect(out.width).toBe(40)
    expect(out.height).toBe(100)
  })
  test("180° keeps dimensions", () => {
    const out = drawRotated(fakeImage(100, 40), 2)
    expect(out.width).toBe(100)
    expect(out.height).toBe(40)
  })
  test("270° swaps again", () => {
    const out = drawRotated(fakeImage(100, 40), 3)
    expect(out.width).toBe(40)
    expect(out.height).toBe(100)
  })
})

describe("drawFlipped", () => {
  test("keeps dimensions for horizontal flip", () => {
    const out = drawFlipped(fakeImage(100, 40), true, false)
    expect(out.width).toBe(100)
    expect(out.height).toBe(40)
  })
  test("keeps dimensions for vertical flip", () => {
    const out = drawFlipped(fakeImage(100, 40), false, true)
    expect(out.width).toBe(100)
    expect(out.height).toBe(40)
  })
})

describe("drawCropped", () => {
  test("outputs the selected rect size", () => {
    const out = drawCropped(fakeImage(200, 100), { x: 50, y: 20, w: 60.4, h: 30.2 })
    expect(out.width).toBe(60)
    expect(out.height).toBe(30)
  })
  test("clamps to at least 1px", () => {
    const out = drawCropped(fakeImage(200, 100), { x: 0, y: 0, w: 0.3, h: 0.2 })
    expect(out.width).toBe(1)
    expect(out.height).toBe(1)
  })
})

describe("canvasToBase64", () => {
  test("strips the dataURL prefix", () => {
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const base64 = canvasToBase64(canvas)
    expect(base64).toBeTypeOf("string")
    // happy-dom 的 toDataURL 返回 `data:image/png;base64,<payload>`，去掉前缀后不应再含逗号。
    expect(base64).not.toContain(",")
  })
})

describe("paintStroke", () => {
  test("dispatches by tool without throwing", () => {
    const canvas = document.createElement("canvas")
    canvas.width = 100
    canvas.height = 100
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no 2d context")
    const base: Stroke = {
      tool: "pen",
      color: "#ff0000",
      size: 4,
      points: [
        [10, 10],
        [40, 40],
      ],
    }
    for (const tool of ["pen", "highlighter", "arrow", "rect", "circle"] as const) {
      expect(() => paintStroke(ctx, { ...base, tool })).not.toThrow()
    }
    expect(() => paintStroke(ctx, { ...base, tool: "text", text: "hi", points: [[10, 10]] })).not.toThrow()
  })
})
