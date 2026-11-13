import { describe, expect, test } from "bun:test"
import { DocumentSession } from "../../src/office/engine/session"
import { engineFor, officeFormatOf } from "../../src/office/engine/registry"
import { markdownEngine, textEngine } from "../../src/office/text/engine"

const encoder = new TextEncoder()
const LF = String.fromCharCode(10)

describe("纯文本引擎", () => {
  test("注册表把 .txt / .md 交给文本引擎", () => {
    expect(officeFormatOf("notes.txt")).toBe("text")
    expect(officeFormatOf("README.md")).toBe("markdown")
    expect(engineFor("text")).toBe(textEngine)
    expect(engineFor("markdown")).toBe(markdownEngine)
    expect(markdownEngine.format).toBe("markdown")
  })

  test("setText 保留原文件的 CRLF 与 BOM", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("a\r\nb")])
    const opened = await textEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.data.text).toBe("a\nb")
    expect(opened.data.format.eol).toBe("\r\n")
    expect(opened.data.format.bom).toBe(true)

    const applied = await textEngine.apply(opened.data, [{ op: "setText", text: "x\ny" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(Array.from(applied.data.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(applied.data.bytes.slice(3))).toBe("x\r\ny")
  })

  test("行命令只改文字，不改编码", async () => {
    const bytes = encoder.encode("b\na\n")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(opened.data, [{ op: "sortLines" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(new TextDecoder().decode(applied.data.bytes)).toBe("a\nb\n")
    expect(applied.data.state.text).toBe("a\nb\n")
  })

  test("倒序、去重、合并、注释都能通过 op 调用", async () => {
    const bytes = encoder.encode("b\na\nb\n")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(
      opened.data,
      [{ op: "uniqueLines" }, { op: "reverseLines" }, { op: "joinLines" }, { op: "toggleComment", marker: "#" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.text).toBe("# a b")
  })

  test("行移动 / 复制 / 删除：省略区间只动第一行", async () => {
    const bytes = encoder.encode("a\nb\nc")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return

    const down = await textEngine.apply(opened.data, [{ op: "moveLines", direction: "down" }], bytes)
    expect(down.ok).toBe(true)
    if (!down.ok) return
    expect(down.data.state.text).toBe("b\na\nc")

    const up = await textEngine.apply(opened.data, [{ op: "moveLines", direction: "up", start: 4, end: 5 }], bytes)
    expect(up.ok).toBe(true)
    if (!up.ok) return
    expect(up.data.state.text).toBe("a\nc\nb")

    // 第一行已经不能再往上：明确失败，不是静默成功。
    const stuck = await textEngine.apply(opened.data, [{ op: "moveLines", direction: "up" }], bytes)
    expect(stuck.ok).toBe(false)
    if (!stuck.ok) expect(stuck.error.code).toBe("invalid_params")

    const duplicated = await textEngine.apply(opened.data, [{ op: "duplicateLines", start: 0, end: 1 }], bytes)
    expect(duplicated.ok).toBe(true)
    if (!duplicated.ok) return
    expect(duplicated.data.state.text).toBe("a\na\nb\nc")

    const deleted = await textEngine.apply(opened.data, [{ op: "deleteLines", start: 0, end: 1 }], bytes)
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.data.state.text).toBe("b\nc")
  })

  test("JSON 非法时失败且不返回新字节", async () => {
    const bytes = encoder.encode("{oops}")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(opened.data, [{ op: "formatJson", indent: "  " }], bytes)
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.code).toBe("invalid_params")
  })

  test("没有实际改动时 changed 为空", async () => {
    const bytes = encoder.encode("a\nb\n")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const applied = await textEngine.apply(opened.data, [{ op: "sortLines" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual([])
    expect(applied.data.bytes).toBe(bytes)
  })

  test("changeCase 默认作用整篇，也能只改一段区间", async () => {
    const bytes = encoder.encode("hello world\nsecond line")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return

    const all = await textEngine.apply(opened.data, [{ op: "changeCase", mode: "upper" }], bytes)
    expect(all.ok).toBe(true)
    if (!all.ok) return
    expect(all.data.state.text).toBe("HELLO WORLD\nSECOND LINE")

    // [0, 5) = "hello"；区间之外的 "second line" 保持原样。
    const part = await textEngine.apply(opened.data, [{ op: "changeCase", mode: "title", start: 0, end: 11 }], bytes)
    expect(part.ok).toBe(true)
    if (!part.ok) return
    expect(part.data.state.text).toBe("Hello World\nsecond line")
  })

  test("Markdown 块命令：标题 / 列表 / 引用走同一条 op 路径", async () => {
    const source = ["一", "二"].join(LF)
    const bytes = encoder.encode(source)
    const opened = await markdownEngine.open(bytes)
    if (!opened.ok) return

    const heading = await markdownEngine.apply(
      opened.data,
      [{ op: "setHeading", level: 2, start: 0, end: source.length }],
      bytes,
    )
    expect(heading.ok).toBe(true)
    if (!heading.ok) return
    expect(heading.data.state.text).toBe(["## 一", "## 二"].join(LF))

    const listed = await markdownEngine.apply(
      opened.data,
      [{ op: "toggleList", kind: "ordered", start: 0, end: source.length }],
      bytes,
    )
    expect(listed.ok).toBe(true)
    if (!listed.ok) return
    expect(listed.data.state.text).toBe(["1. 一", "2. 二"].join(LF))

    const quoted = await markdownEngine.apply(opened.data, [{ op: "toggleQuote", start: 0, end: source.length }], bytes)
    expect(quoted.ok).toBe(true)
    if (!quoted.ok) return
    expect(quoted.data.state.text).toBe(["> 一", "> 二"].join(LF))
  })

  test("标题只给 Markdown；级别非法时明确报错", async () => {
    const bytes = encoder.encode("a")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const notMarkdown = await textEngine.apply(opened.data, [{ op: "setHeading", level: 1, start: 0, end: 1 }], bytes)
    expect(notMarkdown.ok).toBe(false)
    if (!notMarkdown.ok) expect(notMarkdown.error.code).toBe("unsupported_format")

    const md = await markdownEngine.open(bytes)
    if (!md.ok) return
    const bad = await markdownEngine.apply(md.data, [{ op: "setHeading", level: 9, start: 0, end: 1 }], bytes)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe("invalid_params")
  })

  test("changeCase 的区间越界给出可读错误", async () => {
    const bytes = encoder.encode("abc")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const bad = await textEngine.apply(opened.data, [{ op: "changeCase", mode: "upper", start: 2, end: 99 }], bytes)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe("invalid_params")
  })

  test("convertIndent 在 tab 与空格之间转换", async () => {
    const bytes = encoder.encode("\tone\n\t\ttwo\nplain")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return

    const spaces = await textEngine.apply(opened.data, [{ op: "convertIndent", toTabs: false, width: 2 }], bytes)
    expect(spaces.ok).toBe(true)
    if (!spaces.ok) return
    expect(spaces.data.state.text).toBe("  one\n    two\nplain")

    const tabs = await textEngine.apply(
      spaces.data.state,
      [{ op: "convertIndent", toTabs: true, width: 2 }],
      spaces.data.bytes,
    )
    expect(tabs.ok).toBe(true)
    if (!tabs.ok) return
    expect(tabs.data.state.text).toBe("\tone\n\t\ttwo\nplain")
  })

  test("convertIndent 的宽度必须是 1 到 8", async () => {
    const bytes = encoder.encode("a")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const bad = await textEngine.apply(opened.data, [{ op: "convertIndent", toTabs: true, width: 0 }], bytes)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe("invalid_params")
  })

  test("setSpanText 只接受整篇（第 1 段）", async () => {
    const bytes = encoder.encode("a")
    const opened = await textEngine.open(bytes)
    if (!opened.ok) return
    const bad = await textEngine.apply(opened.data, [{ op: "setSpanText", paragraph: 2, text: "b" }], bytes)
    expect(bad.ok).toBe(false)
    const good = await textEngine.apply(opened.data, [{ op: "setSpanText", paragraph: 1, text: "b" }], bytes)
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(good.data.state.text).toBe("b")
  })

  test("recordExternal：外部算好的字节也进同一条撤销栈", async () => {
    const session = await DocumentSession.open(textEngine, encoder.encode("a"))
    if (!session.ok) return
    const before = session.data.bytes
    const after = encoder.encode("外部改的")

    const recorded = await session.data.recordExternal(before, after, "画布编辑")
    expect(recorded.ok).toBe(true)
    expect(session.data.bytes).toBe(after)
    expect(session.data.canUndo).toBe(true)
    expect(session.data.undoLabel).toBe("画布编辑")

    // 撤销回到记录前的那一版。
    const undone = session.data.undo()
    expect(undone.ok).toBe(true)
    expect(new TextDecoder().decode(session.data.bytes)).toBe("a")

    // 字节对不上（期间有别的写入）时拒绝，而不是把新内容硬塞进来。
    const conflict = await session.data.recordExternal(encoder.encode("别的内容"), encoder.encode("x"), "覆盖")
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.error.code).toBe("conflict")
  })

  test("会话保存版本语义：保存期间的新修改不会被标干净", async () => {
    const bytes = encoder.encode("a")
    const session = await DocumentSession.open(textEngine, bytes)
    if (!session.ok) return
    const revision = session.data.saveRevision()
    await session.data.apply([{ op: "setText", text: "b" }], "改文字")
    expect(session.data.markSaved(revision)).toBe(false)
    expect(session.data.dirty).toBe(true)
    expect(session.data.markSaved(session.data.saveRevision())).toBe(true)
    expect(session.data.dirty).toBe(false)
  })
})

describe("文本引擎的二进制兜底", () => {
  test("PNG 字节不会被当成文本打开", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    const opened = await textEngine.open(png)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.code).toBe("open_failed")
  })

  test("正常的 UTF-8 中文不会被误判", async () => {
    const opened = await textEngine.open(encoder.encode("中文\nutf-8"))
    expect(opened.ok).toBe(true)
  })
})

describe("Markdown 属性操作", () => {
  const encoder = new TextEncoder()

  test("setProperty / deleteProperty 只改属性区那一行", async () => {
    const source = "---\ntitle: 旧\n# 注释\n---\n\n正文"
    const opened = await markdownEngine.open(encoder.encode(source))
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await markdownEngine.apply(
      opened.data,
      [
        { op: "setProperty", key: "tags", value: ["工作", "2026"] },
        { op: "setProperty", key: "title", value: "新" },
        { op: "deleteProperty", key: "draft" },
      ],
      encoder.encode(source),
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const next = new TextDecoder().decode(applied.data.bytes)
    // "2026" 看着像数字，加引号才不会在别的 YAML 解析器里变成整数。
    expect(next).toBe('---\ntitle: 新\n# 注释\ntags: [工作, "2026"]\n---\n\n正文')
  })

  test("没有属性区时会新建", async () => {
    const source = "# 正文"
    const opened = await markdownEngine.open(encoder.encode(source))
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await markdownEngine.apply(
      opened.data,
      [{ op: "setProperty", key: "draft", value: true }],
      encoder.encode(source),
    )
    if (!applied.ok) throw new Error(applied.error.message)
    expect(new TextDecoder().decode(applied.data.bytes)).toBe("---\ndraft: true\n---\n# 正文")
  })

  test("纯文本没有属性区", async () => {
    const opened = await textEngine.open(encoder.encode("hello"))
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await textEngine.apply(
      opened.data,
      [{ op: "setProperty", key: "draft", value: true }],
      encoder.encode("hello"),
    )
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error.code).toBe("unsupported_format")
  })

  test("DOCX export lazily loads document creation without an import cycle", async () => {
    const opened = await markdownEngine.open(encoder.encode("# Release"))
    if (!opened.ok) throw new Error(opened.error.message)
    const exported = await markdownEngine.export!(opened.data, "docx", encoder.encode("# Release"))
    expect(exported.ok).toBe(true)
    if (exported.ok) expect(exported.data.byteLength).toBeGreaterThan(0)
  })
})
