import { describe, expect, test } from "bun:test"

const FLOATING_COLLAPSED_SIZE = 144
const FLOATING_PADDING = 16
const FLOATING_HIT_WIDTH = 152
const FLOATING_HIT_HEIGHT = 152
const FLOATING_CONTENT_PAD = 16
const FLOATING_ACTIVITY_PADDING = 240
const FLOATING_WINDOW_WIDTH = FLOATING_COLLAPSED_SIZE + FLOATING_ACTIVITY_PADDING * 2

function clampFloatingPetPosition(
  position: { x: number; y: number },
  work: { x: number; y: number; width: number; height: number },
) {
  const size = FLOATING_COLLAPSED_SIZE
  const edge = FLOATING_PADDING
  const x = Math.max(work.x + edge, Math.min(position.x, work.x + work.width - size - edge))
  const y = Math.max(work.y + edge, Math.min(position.y, work.y + work.height - size - edge))
  return { x, y }
}

function getFloatingPetHitBounds(win: { x: number; y: number; width: number; height: number }) {
  const width = FLOATING_HIT_WIDTH
  const height = FLOATING_HIT_HEIGHT
  const x = Math.round(win.x + (win.width - width) / 2)
  const y = Math.round(win.y + win.height - FLOATING_CONTENT_PAD - height)
  return { x, y, width, height }
}

function isCursorOverFloatingPet(
  point: { x: number; y: number },
  hit: { x: number; y: number; width: number; height: number },
) {
  return point.x >= hit.x && point.x <= hit.x + hit.width && point.y >= hit.y && point.y <= hit.y + hit.height
}

describe("clampFloatingPetPosition", () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 }
  test("allows docking near left/right edges with only padding", () => {
    expect(clampFloatingPetPosition({ x: -100, y: 500 }, work)).toEqual({ x: 16, y: 500 })
  })
})

describe("getFloatingPetHitBounds tight pet body", () => {
  test("hit box is only slightly larger than pet body and centered", () => {
    const anchorX = 1500
    const anchorY = 900
    const win = {
      x: anchorX - FLOATING_ACTIVITY_PADDING,
      y: anchorY - 52,
      width: FLOATING_WINDOW_WIDTH,
      height: 196,
    }
    const hit = getFloatingPetHitBounds(win)
    const petLeft = hit.x + (hit.width - FLOATING_COLLAPSED_SIZE) / 2
    expect(Math.round(petLeft)).toBe(anchorX)
    expect(hit.width).toBe(152)
    expect(hit.height).toBe(152)
    // 不应再是旧的 288 超大热区
    expect(hit.width).toBeLessThan(200)
  })

  test("cursor near pet is active; a bit away is not", () => {
    const win = { x: 1000, y: 800, width: FLOATING_WINDOW_WIDTH, height: 196 }
    const hit = getFloatingPetHitBounds(win)
    const center = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 }
    expect(isCursorOverFloatingPet(center, hit)).toBe(true)
    expect(isCursorOverFloatingPet({ x: hit.x - 10, y: center.y }, hit)).toBe(false)
    expect(isCursorOverFloatingPet({ x: center.x + 120, y: center.y }, hit)).toBe(false)
  })
})
