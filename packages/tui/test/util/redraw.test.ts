import { describe, expect, test } from "bun:test"
import { redrawSteps } from "../../src/util/redraw"

describe("redrawSteps:强制重排 + 全量重绘的步骤", () => {
  test("尺寸和真实值不一致时,一步喂真实尺寸就够", () => {
    // 这正是启动"显示不全"的形态:renderer 记的是 80x24 兜底值
    expect(redrawSteps({ current: { width: 80, height: 24 }, actual: { width: 151, height: 40 } })).toEqual([
      { width: 151, height: 40 },
    ])
  })

  test("尺寸本来就是对的:先窄 1 列再回真实尺寸,否则 processResize 直接 return", () => {
    expect(redrawSteps({ current: { width: 100, height: 30 }, actual: { width: 100, height: 30 } })).toEqual([
      { width: 99, height: 30 },
      { width: 100, height: 30 },
    ])
  })

  test("拿不到终端尺寸时退回渲染器当前尺寸,仍然能重绘", () => {
    expect(redrawSteps({ current: { width: 100, height: 30 }, actual: {} })).toEqual([
      { width: 99, height: 30 },
      { width: 100, height: 30 },
    ])
    expect(redrawSteps({ current: { width: 100, height: 30 }, actual: { width: 0, height: 0 } })).toEqual([
      { width: 99, height: 30 },
      { width: 100, height: 30 },
    ])
  })

  test("只有一列宽也不会喂出 0 或负数", () => {
    const steps = redrawSteps({ current: { width: 1, height: 1 }, actual: { width: 1, height: 1 } })
    expect(steps).toEqual([
      { width: 1, height: 1 },
      { width: 1, height: 1 },
    ])
    expect(steps.every((step) => step.width >= 1 && step.height >= 1)).toBe(true)
  })

  test("最后一步一定是真实尺寸", () => {
    for (const actual of [{ width: 151, height: 40 }, { width: 80, height: 24 }, {}]) {
      const steps = redrawSteps({ current: { width: 80, height: 24 }, actual })
      const last = steps.at(-1)!
      expect(last.width).toBe(actual.width && actual.width > 0 ? actual.width : 80)
      expect(last.height).toBe(actual.height && actual.height > 0 ? actual.height : 24)
    }
  })
})
