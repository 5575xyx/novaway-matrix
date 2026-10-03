import { describe, expect, test } from "bun:test"
import { collapseToolOutput } from "../../src/util/collapse-tool-output"

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
})

// 这里原来还有一条 collapseHint 的用例(「点击展开（还有 N 行）」),随那个函数一起删掉了:
// 工具卡的 body 换成了「行数上限 + 可滚动」,那些行没有被藏起来,只是要滚 —— 说「还有 N 行」
// 是说谎。剩下的折叠只有 execute 那一路的行内预览在用,见 src/util/collapse-tool-output 的注释。
