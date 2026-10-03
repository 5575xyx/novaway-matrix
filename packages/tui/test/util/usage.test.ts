import { describe, expect, test } from "bun:test"
import { usageLabel, type SessionUsage } from "../../src/util/usage"
import { Locale } from "../../src/util/locale"

// 「77.1K (12%) · $0.42」= 5 + 1 + 5 + 3 + 5 = 19 列;「77.1K」= 5 列。
const FULL = { tokens: 77_112, context: "77.1K (12%)", cost: "$0.42" } satisfies SessionUsage
const NO_COST = { tokens: 77_112, context: "77.1K (12%)" } satisfies SessionUsage
const NO_PCT = { tokens: 77_112, context: "77.1K" } satisfies SessionUsage

describe("usageLabel:窄终端上宁可整段不画,也不显示被裁成半截的假数字", () => {
  test("列够时原样输出,上下文与花费都在", () => {
    expect(usageLabel(FULL, 19)).toBe("77.1K (12%) · $0.42")
    expect(usageLabel(FULL, 40)).toBe("77.1K (12%) · $0.42")
  })

  test("差一点时先丢花费,再丢百分比,最后整段不画", () => {
    // 18 列:整串放不下,但单是「百分比」放得下 → 先丢花费。
    expect(Locale.displayWidth("77.1K (12%)")).toBe(11)
    expect(usageLabel(FULL, 18)).toBe("77.1K (12%)")
    // 11 列:百分比刚好卡住。
    expect(usageLabel(FULL, 11)).toBe("77.1K (12%)")
    // 8 列:百分比也放不下 → 只剩 token 粗档。
    expect(usageLabel(FULL, 8)).toBe("77.1K")
    // 3 列:连粗档都放不下 → 空串(整段不画)。
    expect(usageLabel(FULL, 3)).toBe("")
    expect(usageLabel(FULL, 0)).toBe("")
  })

  test("本来就没有花费/百分比时,直接从最短的那档起", () => {
    expect(usageLabel(NO_COST, 11)).toBe("77.1K (12%)")
    expect(usageLabel(NO_COST, 5)).toBe("77.1K")
    expect(usageLabel(NO_COST, 4)).toBe("")
    expect(usageLabel(NO_PCT, 40)).toBe("77.1K")
    expect(usageLabel(NO_PCT, 4)).toBe("")
  })
})
