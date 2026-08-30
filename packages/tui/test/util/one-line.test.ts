import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("oneLine:保证一行文本只占一行", () => {
  test("换行、回车、制表全部折成单个空格", () => {
    const out = Locale.oneLine("第一行\n第二行\r\n\t第三行", 200)
    expect(out).toBe("第一行 第二行 第三行")
    expect(out).not.toContain("\n")
    expect(out).not.toContain("\r")
    expect(out).not.toContain("\t")
  })

  test("控制字符不会漏进渲染层", () => {
    // 响铃 / ESC / NUL 混进"一行"里同样会让渲染错位
    const out = Locale.oneLine("a\u0007b\u001bc\u0000d", 200)
    expect(out).toBe("a b c d")
  })

  test("超长按 len 截断,并带省略号", () => {
    const out = Locale.oneLine("甲".repeat(500), 40)
    expect(out.length).toBe(40)
    expect(out.endsWith("…")).toBe(true)
  })

  test("先压平再截断:不能因为前面一堆换行就把有效内容截没了", () => {
    expect(Locale.oneLine("\n\n\n\n\n\n\n\n\n\nabc", 10)).toBe("abc")
  })

  test("空串和纯空白返回空串", () => {
    expect(Locale.oneLine("", 10)).toBe("")
    expect(Locale.oneLine("  \n\t ", 10)).toBe("")
  })
})
