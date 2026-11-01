import type { PptxBox } from "@novaway/core/office/pptx-edit"

// 画布拖拽的纯几何计算。放在 .ts 里是为了能直接跑单元测试：
// 组件里再算一遍「往右下拖了多少」很容易在缩放/最小尺寸上出错。

export type BoxHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move"

/** 拖动整块：按幻灯片坐标平移，尺寸不变。 */
export function moveBox(box: PptxBox, dx: number, dy: number): PptxBox {
  return {
    x: Math.round(box.x + dx),
    y: Math.round(box.y + dy),
    w: Math.max(1, Math.round(box.w)),
    h: Math.max(1, Math.round(box.h)),
  }
}

/**
 * 按把手方向改尺寸。往左/往上拖时 x/y 跟着走，所以宽高要反着加；
 * 拖到小于最小值就钉在最小值上，另一条边保持不动。
 */
export function resizeBox(box: PptxBox, handle: BoxHandle, dx: number, dy: number, min = 100000): PptxBox {
  if (handle === "move") return moveBox(box, dx, dy)
  let { x, y, w, h } = box
  if (handle.includes("w")) {
    x = box.x + dx
    w = box.w - dx
  }
  if (handle.includes("e")) w = box.w + dx
  if (handle.includes("n")) {
    y = box.y + dy
    h = box.h - dy
  }
  if (handle.includes("s")) h = box.h + dy
  if (w < min) {
    if (handle.includes("w")) x = box.x + box.w - min
    w = min
  }
  if (h < min) {
    if (handle.includes("n")) y = box.y + box.h - min
    h = min
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

/** 旋转角度归一化到 [0, 360)。 */
export function normalizeRotation(degrees: number) {
  const value = Math.round(degrees) % 360
  return value < 0 ? value + 360 : value
}

/**
 * 按「鼠标相对形状中心的角度」算旋转。0 度指针朝上，顺时针为正，
 * 和 `<a:xfrm rot>` 的方向一致。
 */
export function rotationFromPointer(input: { centerX: number; centerY: number; x: number; y: number }) {
  const raw = (Math.atan2(input.y - input.centerY, input.x - input.centerX) * 180) / Math.PI + 90
  return normalizeRotation(raw)
}
