import { describe, expect, test } from "bun:test"
import { applyTextEdit, caret, changeCase, convertIndent, joinLines } from "../../src/office/text/commands"
import {
  dateText,
  insertCallout,
  insertCodeBlock,
  insertFootnote,
  insertInlineMath,
  insertLink,
  insertMarkdownImage,
  insertMathBlock,
  insertProperties,
  insertRule,
  insertTable,
  wordAt,
} from "../../src/office/text/markdown"

const nl = String.fromCharCode(10)
const lines = (...items: string[]) => items.join(nl)

describe("Markdown 插入", () => {
  test("脚注：引用落在光标处，定义追加在文末，光标停在定义后面", () => {
    const text = "正文"
    const edit = insertFootnote(text, caret(2))
    const next = applyTextEdit(text, edit)
    expect(next).toBe("正文[^1]" + nl + nl + "[^1]: ")
    expect(edit.selection).toEqual(caret(next.length))
  })

  test("脚注编号跳过已经用过的", () => {
    const text = "a[^1] b"
    const next = applyTextEdit(text, insertFootnote(text, caret(6)))
    expect(next).toContain("[^2]")
    expect(next.endsWith("[^2]: ")).toBe(true)
  })

  test("Callout：没有选区时插一个空块，光标在正文行", () => {
    const text = "段落"
    const edit = insertCallout(text, caret(2), "note", "标题")
    expect(applyTextEdit(text, edit)).toBe("段落" + nl + "> [!note] 标题" + nl + "> ")
    expect(lines("段落", "> [!note] 标题", "> ")).toContain("> [!note]")
  })

  test("Callout：有选区时把选中的行整体引用", () => {
    const text = lines("一", "二")
    const edit = insertCallout(text, { anchor: 0, head: text.length }, "tip", "注意")
    expect(applyTextEdit(text, edit)).toBe(lines("> [!tip] 注意", "> 一", "> 二"))
  })

  test("公式块：选区内容包进 $$，光标落在公式里", () => {
    const text = "x + y"
    const edit = insertMathBlock(text, { anchor: 0, head: text.length })
    expect(applyTextEdit(text, edit)).toBe(lines("$$", "x + y", "$$") + nl)
    expect(edit.selection).toEqual(caret(3 + "x + y".length))
  })

  test("图片：没有选区时插入占位符并选中它", () => {
    const text = "看这里"
    const edit = insertMarkdownImage(text, caret(3), "a.png")
    expect(applyTextEdit(text, edit)).toBe("看这里![](a.png)")
    expect(edit.selection).toEqual({ anchor: 7, head: 12 })
  })

  test("属性块：没有就插一份，已有就只把光标放进去", () => {
    const empty = ""
    const created = insertProperties(empty, caret(0), { title: "笔记", date: "2026-11-04" })
    const text = applyTextEdit(empty, created)
    expect(text).toBe(lines("---", "title: 笔记", "tags: ", "date: 2026-11-04", "---") + nl)
    expect(created.selection.head).toBe(text.indexOf("tags: ") + "tags: ".length)

    const existing = lines("---", "title: a", "---", "正文")
    const again = insertProperties(existing, caret(0), { title: "b" })
    expect(applyTextEdit(existing, again)).toBe(existing)
    expect(again.start).toBe(existing.indexOf(nl + "---"))
  })
})

describe("编辑器语义", () => {
  test("没有选区时大小写转换作用于光标所在的单词", () => {
    const text = "hello world"
    const word = wordAt(text, 8)
    expect(word).toEqual({ anchor: 6, head: 11 })
    expect(applyTextEdit(text, changeCase(text, word, "title")!)).toBe("hello World")
    expect(wordAt("中文 词", 4)).toEqual({ anchor: 3, head: 4 })
  })

  test("合并行：光标在一行时只合并当前行和下一行", () => {
    const text = lines("一", "二", "三")
    const edit = joinLines(text, caret(0), false)!
    expect(applyTextEdit(text, edit)).toBe(lines("一 二", "三"))
    // AI 的整篇语义保持不变。
    expect(applyTextEdit(text, joinLines(text, caret(0))!)).toBe("一 二 三")
  })

  test("缩进转换按列计算，tab 与空格混用也能对齐", () => {
    const text = lines("    a", "  " + String.fromCharCode(9) + "b")
    const edit = convertIndent(text, caret(0), true, 4)!
    expect(applyTextEdit(text, edit)).toBe(lines(String.fromCharCode(9) + "a", String.fromCharCode(9) + "b"))

    const back = convertIndent(lines(String.fromCharCode(9) + "a"), caret(0), false, 4)!
    expect(applyTextEdit(lines(String.fromCharCode(9) + "a"), back)).toBe("    a")
  })
})

describe("更多 Markdown 插入（对齐 palette.rs 的命令集）", () => {
  test("代码块包住选区，空选区时光标落在围栏里", () => {
    const text = lines("a", "b")
    const wrapped = insertCodeBlock(text, { anchor: 0, head: text.length }, "ts")
    expect(applyTextEdit(text, wrapped)).toBe(lines("```ts", "a", "b", "```") + nl)
    expect(wrapped.selection).toEqual(caret("```ts".length + 1 + "a".length + 1 + "b".length))
  })

  test("表格：表头 / 分隔线 / 空行一次给全，光标在第一个表头", () => {
    const text = ""
    const edit = insertTable(text, caret(0), 1, 2)
    expect(applyTextEdit(text, edit)).toBe(lines("| 列1 | 列2 |", "| --- | --- |", "|  |  |") + nl)
    expect(edit.selection).toEqual(caret(2))
  })

  test("分隔线独占一行", () => {
    const text = "段落"
    const edit = insertRule(text, caret(2))
    expect(applyTextEdit(text, edit)).toBe("段落" + nl + "---" + nl)
  })

  test("行内公式与链接：选区变成内容，光标停在可以直接输入的位置", () => {
    const text = "能量"
    const math = insertInlineMath(text, { anchor: 0, head: 2 })
    expect(applyTextEdit(text, math)).toBe("$能量$")
    expect(math.selection).toEqual({ anchor: 1, head: 3 })

    const plain = "看这里"
    const link = insertLink(plain, { anchor: 1, head: 3 })
    expect(applyTextEdit(plain, link)).toBe("看[这里](https://)")
    // 有选区时选中的是 URL 占位符，粘贴地址即可。
    expect(link.selection).toEqual({ anchor: 1 + 1 + 2 + 2, head: 1 + 1 + 2 + 2 + "https://".length })

    const empty = insertLink("", caret(0))
    expect(applyTextEdit("", empty)).toBe("[链接文字](https://)")
    expect(empty.selection).toEqual({ anchor: 1, head: 5 })
  })

  test("日期 / 时间用本地时区", () => {
    const when = new Date(2026, 10, 4, 9, 5)
    expect(dateText(when, "date")).toBe("2026-11-04")
    expect(dateText(when, "time")).toBe("09:05")
    expect(dateText(when, "datetime")).toBe("2026-11-04 09:05")
  })
})
