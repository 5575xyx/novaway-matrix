import { describe, expect, test } from "bun:test"
import { applyTextEdit, caret } from "../../src/office/text/commands"
import { setHeading, toggleList, toggleQuote } from "../../src/office/text/markdown"

const apply = (text: string, edit: ReturnType<typeof setHeading>) => (edit ? applyTextEdit(text, edit) : text)

describe("Markdown 块级转换", () => {
  test("标题：加前缀、再点一次取消，光标留在原地附近", () => {
    const text = "标题"
    const once = setHeading(text, caret(1), 2)!
    expect(apply(text, once)).toBe("## 标题")
    // 光标原来在「标」后面，加了 `## ` 之后仍在「标」后面。
    expect(once.selection.anchor).toBe(4)

    const twice = setHeading("## 标题", caret(4), 2)!
    expect(apply("## 标题", twice)).toBe("标题")
  })

  test("标题：选中的多行一起改，代码围栏里的不动", () => {
    const text = ["a", "```", "# 代码里的", "```", "b"].join("\n")
    const edit = setHeading(text, { anchor: 0, head: text.length }, 1)!
    expect(apply(text, edit)).toBe(["# a", "```", "# 代码里的", "```", "# b"].join("\n"))
  })

  test("列表：无序 / 有序 / 任务列表互转", () => {
    const text = ["一", "二"].join("\n")
    const bullet = toggleList(text, { anchor: 0, head: text.length }, "bullet")!
    expect(apply(text, bullet)).toBe(["一", "二"].join("\n").replace(/^/gm, "- "))

    const ordered = toggleList("- 一\n- 二", { anchor: 0, head: 7 }, "ordered")!
    expect(apply("- 一\n- 二", ordered)).toBe("1. 一\n2. 二")

    const task = toggleList("1. 一\n2. 二", { anchor: 0, head: 9 }, "task")!
    expect(apply("1. 一\n2. 二", task)).toBe("- [ ] 一\n- [ ] 二")
  })

  test("列表：整组都是同一种时取消，缩进保留", () => {
    const text = ["  - 一", "  - 二"].join("\n")
    const edit = toggleList(text, { anchor: 0, head: text.length }, "bullet")!
    expect(apply(text, edit)).toBe(["  一", "  二"].join("\n"))
  })

  test("引用：加/去 `> `，空行跳过", () => {
    const text = ["一", "", "二"].join("\n")
    const quoted = toggleQuote(text, { anchor: 0, head: text.length })!
    expect(apply(text, quoted)).toBe(["> 一", "", "> 二"].join("\n"))

    const plain = toggleQuote("> 一\n> 二", { anchor: 0, head: 7 })!
    expect(apply("> 一\n> 二", plain)).toBe("一\n二")
  })

  test("没有可改的行时返回 undefined（不会悄悄改动）", () => {
    expect(toggleQuote("\n\n", caret(0))).toBeUndefined()
    expect(setHeading("```\nx\n```", caret(5), 1)).toBeUndefined()
  })
})

describe("Markdown 任务勾选", () => {
  test("翻转光标所在行的任务状态，其它行不动", async () => {
    const { toggleTask } = await import("../../src/office/text/markdown")
    const text = ["- [ ] 一", "- [x] 二"].join(String.fromCharCode(10))
    const second = text.indexOf("二")
    const edit = toggleTask(text, caret(second))!
    expect(apply(text, edit as never)).toBe(["- [ ] 一", "- [ ] 二"].join(String.fromCharCode(10)))

    const first = toggleTask(text, caret(3))!
    expect(apply(text, first as never)).toBe(["- [x] 一", "- [x] 二"].join(String.fromCharCode(10)))
  })

  test("多行选区里只改任务项；普通段落不变成任务", async () => {
    const { toggleTask } = await import("../../src/office/text/markdown")
    const LF = String.fromCharCode(10)
    const text = ["- [ ] 一", "普通段落", "1. [X] 数字任务"].join(LF)
    const edit = toggleTask(text, { anchor: 0, head: text.length })!
    expect(apply(text, edit as never)).toBe(["- [x] 一", "普通段落", "1. [ ] 数字任务"].join(LF))
  })

  test("不是任务行时返回 undefined", async () => {
    const { toggleTask } = await import("../../src/office/text/markdown")
    expect(toggleTask("- 普通列表", caret(0))).toBeUndefined()
    expect(toggleTask("```" + String.fromCharCode(10) + "- [ ] x", caret(6))).toBeUndefined()
  })
})
