import { expect, test } from "bun:test"
import { moveBox, normalizeRotation, resizeBox, rotationFromPointer } from "./pptx-box"

// 用真实量级的 EMU（1 cm ≈ 360000），否则会被最小尺寸钳住。
const box = { x: 1000000, y: 2000000, w: 4000000, h: 3000000 }

test("拖动整块：只平移，尺寸不变", () => {
  expect(moveBox(box, 100000, -50000)).toEqual({ x: 1100000, y: 1950000, w: 4000000, h: 3000000 })
})

test("右下角拖大，左上角不动", () => {
  expect(resizeBox(box, "se", 500000, 250000)).toEqual({ x: 1000000, y: 2000000, w: 4500000, h: 3250000 })
})

test("左上角拖动：位置跟着走，宽高反向变", () => {
  expect(resizeBox(box, "nw", 200000, 100000)).toEqual({ x: 1200000, y: 2100000, w: 3800000, h: 2900000 })
})

test("单边把手只改一个方向", () => {
  expect(resizeBox(box, "e", 300000, 999)).toEqual({ x: 1000000, y: 2000000, w: 4300000, h: 3000000 })
  expect(resizeBox(box, "n", 999, -400000)).toEqual({ x: 1000000, y: 1600000, w: 4000000, h: 3400000 })
})

test("拖过头时钉在最小尺寸，另一条边不动", () => {
  const tiny = resizeBox(box, "w", 99999999, 0)
  expect(tiny.w).toBe(100000)
  expect(tiny.x).toBe(box.x + box.w - 100000)
  expect(tiny.h).toBe(box.h)
})

test("旋转角度归一化到 [0,360)", () => {
  expect(normalizeRotation(-90)).toBe(270)
  expect(normalizeRotation(360)).toBe(0)
  expect(normalizeRotation(725)).toBe(5)
})

test("鼠标在正上方 = 0 度，正右方 = 90 度", () => {
  const center = { centerX: 0, centerY: 0 }
  expect(rotationFromPointer({ ...center, x: 0, y: -10 })).toBe(0)
  expect(rotationFromPointer({ ...center, x: 10, y: 0 })).toBe(90)
  expect(rotationFromPointer({ ...center, x: 0, y: 10 })).toBe(180)
  expect(rotationFromPointer({ ...center, x: -10, y: 0 })).toBe(270)
})
