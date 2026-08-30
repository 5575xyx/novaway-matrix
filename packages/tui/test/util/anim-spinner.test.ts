import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { animColors, animFrames } from "../../src/util/anim-spinner"

describe("anim spinner 帧生成", () => {
  test("确定性:同一列同一帧永远同一个字符", () => {
    expect(animFrames(7, 30)).toEqual(animFrames(7, 30))
  })

  test("每帧每列一个字符,宽度正确", () => {
    for (const frame of animFrames(7, 60)) {
      expect(frame).toHaveLength(7)
    }
  })

  test("字符全部来自 38 字符池或未出生的 .", () => {
    const pool = new Set("0123456789abcdefABCDEF~!@#$£€%^&*()+=_")
    pool.add(".")
    for (const frame of animFrames(7, 80)) {
      for (const ch of frame) {
        expect(pool.has(ch)).toBe(true)
      }
    }
  })

  test("错峰出生:第 0 帧有列还是 .,第 20 帧后全部出生", () => {
    const frames = animFrames(7, 30)
    expect(frames[0]!.includes(".")).toBe(true)
    expect(frames[20]!.includes(".")).toBe(false)
    expect(frames[29]!.includes(".")).toBe(false)
  })

  test("扰动能动起来:相邻帧不完全相同", () => {
    const frames = animFrames(7, 40)
    const changed = frames.some((frame, i) => i > 0 && frame !== frames[i - 1])
    expect(changed).toBe(true)
  })
})

describe("anim spinner 颜色波", () => {
  const base = RGBA.fromHex("#ff60ff")

  test("色相不变,只调明暗", () => {
    const color = animColors(base)(0, 0, 120, 7) as RGBA
    // 纯缩放:各通道都 ≤ 原通道且比例一致(RGBA 内部按 8bit 量化,比例留 2% 容差)
    expect(color.r).toBeLessThanOrEqual(base.r + 1e-6)
    expect(Math.abs(color.r / base.r - color.g / base.g)).toBeLessThan(0.02)
  })

  test("沿列滚动:相位随帧推进,同一列的颜色会周期性变化", () => {
    const col0 = (frame: number) => animColors(base)(frame, 0, 120, 7) as RGBA
    // 相位 (col + frame) % totalChars,第 7 帧回到和第 0 帧相同的相位
    expect(col0(7)!.r).toBeCloseTo(col0(0)!.r, 5)
    expect(col0(3)!.r).not.toBeCloseTo(col0(0)!.r, 2)
  })
})
