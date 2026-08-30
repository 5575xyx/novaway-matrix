import { describe, expect, test } from "bun:test"
import { collapseHint, collapseToolOutput } from "../../src/util/collapse-tool-output"

describe("工具输出折叠", () => {
  test("没超行也没超字符就原样返回", () => {
    const result = collapseToolOutput("a\nb", 3, 100)
    expect(result).toEqual({ output: "a\nb", overflow: false, hidden: 0 })
  })

  test("按行折叠时报出藏了几行", () => {
    const result = collapseToolOutput("1\n2\n3\n4\n5", 2, 100)
    expect(result.overflow).toBe(true)
    expect(result.hidden).toBe(3)
    expect(result.output).toBe("1\n2\n…")
  })

  test("单行超长按字符截断,不谎报行数", () => {
    const result = collapseToolOutput("x".repeat(50), 3, 10)
    expect(result.overflow).toBe(true)
    expect(result.hidden).toBe(0)
    expect(result.output).toHaveLength(10)
    expect(result.output.endsWith("…")).toBe(true)
  })

  test("提示语:知道行数就写出来,不知道就只说展开", () => {
    expect(collapseHint(false, 12)).toBe("点击展开（还有 12 行）")
    expect(collapseHint(false, 0)).toBe("点击展开")
    expect(collapseHint(true, 12)).toBe("点击折叠")
  })
})
