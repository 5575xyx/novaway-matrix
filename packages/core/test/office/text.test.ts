
import { describe, expect, test } from "bun:test"
import { decodeText, encodeText } from "../../src/office/text/format"
import {
  applyTextEdit,
  caret,
  changeCase,
  commentPrefix,
  convertIndent,
  duplicateLines,
  formatJson,
  indentLines,
  joinLines,
  lineOfOffset,
  moveLines,
  offsetOfLine,
  reverseLines,
  selectedLines,
  sortLines,
  toggleComment,
  trimTrailing,
  uniqueLines,
} from "../../src/office/text/commands"

describe("编码与换行保留", () => {
  test("UTF-8 无 BOM：原样写回，一个字节都不变", () => {
    const bytes = new TextEncoder().encode("第一行\n第二行\n")
    const decoded = decodeText(bytes)
    expect(decoded.format).toEqual({ encoding: "utf-8", bom: false, eol: "\n" })
    expect(encodeText(decoded.text, decoded.format)).toEqual(bytes)
  })

  test("CRLF 文件：内存里是 \n，写回仍是 CRLF", () => {
    const bytes = new TextEncoder().encode("a\r\nb\r\n")
    const decoded = decodeText(bytes)
    expect(decoded.text).toBe("a\nb\n")
    expect(decoded.format.eol).toBe("\r\n")
    expect(new TextDecoder().decode(encodeText(decoded.text, decoded.format))).toBe("a\r\nb\r\n")
  })

  test("UTF-8 BOM 保留", () => {
    const plain = new TextEncoder().encode("你好")
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...plain])
    const decoded = decodeText(bytes)
    expect(decoded.format.bom).toBe(true)
    expect(encodeText(decoded.text, decoded.format)).toEqual(bytes)
  })

  test("UTF-16LE 往返", () => {
    const text = "中文 abc\n第二行"
    const bytes = encodeText(text, { encoding: "utf-16le", bom: true, eol: "\n" })
    const decoded = decodeText(bytes)
    expect(decoded.text).toBe(text)
    expect(decoded.format.encoding).toBe("utf-16le")
    expect(encodeText(decoded.text, decoded.format)).toEqual(bytes)
  })

  test("GBK 文件按 GBK 读回，不被当成乱码 UTF-8", () => {
    // “中文” 的 GBK 编码
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const decoded = decodeText(gbk)
    expect(decoded.text).toBe("中文")
    expect(decoded.format.encoding).toBe("gbk")
    expect(encodeText(decoded.text, decoded.format)).toEqual(gbk)
  })
})

describe("行命令", () => {
  const text = "b\na\nc\n"

  test("排序覆盖的行，不动其它行", () => {
    const edit = sortLines(text, { anchor: 0, head: 0 })!
    expect(applyTextEdit(text, edit)).toBe("a\nb\nc\n")
  })

  test("去重", () => {
    const source = "a\nb\na\n"
    const edit = uniqueLines(source, { anchor: 0, head: 0 })!
    expect(applyTextEdit(source, edit)).toBe("a\nb\n")
  })

  test("反转", () => {
    const edit = reverseLines("a\nb\nc", { anchor: 0, head: 0 })!
    expect(applyTextEdit("a\nb\nc", edit)).toBe("c\nb\na")
  })

  test("合并成一行", () => {
    const source = "a\n\nb\n"
    const edit = joinLines(source, { anchor: 0, head: 0 })!
    expect(applyTextEdit(source, edit)).toBe("a b")
  })

  test("多行选区只改选中的行", () => {
    const source = "x\nb\na\ny\n"
    const selected = selectedLines(source, { anchor: 2, head: 5 })
    expect(selected.lines).toEqual(["b", "a"])
    const edit = sortLines(source, { anchor: 2, head: 5 })!
    expect(applyTextEdit(source, edit)).toBe("x\na\nb\ny\n")
  })

  test("没有变化时返回 undefined，不产生空的撤销步骤", () => {
    expect(sortLines("a\nb\n", { anchor: 0, head: 0 })).toBeUndefined()
  })

  test("大小写转换只作用于选区", () => {
    const source = "hello world"
    const edit = changeCase(source, { anchor: 0, head: 5 }, "upper")!
    expect(applyTextEdit(source, edit)).toBe("HELLO world")
  })

  test("去行尾空格；Markdown 保留硬换行", () => {
    const source = "a   \nb  \n"
    expect(applyTextEdit(source, trimTrailing(source, caret(0))!)).toBe("a\nb\n")
    expect(applyTextEdit(source, trimTrailing(source, caret(0), true)!)).toBe("a\nb  \n")
  })

  test("缩进转换（tab ↔ 空格）", () => {
    const source = "\ta\n\tb\n"
    const toSpaces = convertIndent(source, caret(0), false, 2)!
    expect(applyTextEdit(source, toSpaces)).toBe("  a\n  b\n")
    const back = convertIndent("  a\n  b\n", caret(0), true, 2)!
    expect(applyTextEdit("  a\n  b\n", back)).toBe("\ta\n\tb\n")
  })

  test("缩进与反缩进", () => {
    const source = "a\nb\n"
    const indented = indentLines(source, caret(0), "  ")!
    expect(applyTextEdit(source, indented)).toBe("  a\n  b\n")
    const outdented = indentLines("  a\n  b\n", caret(0), "  ", true)!
    expect(applyTextEdit("  a\n  b\n", outdented)).toBe("a\nb\n")
  })

  test("上移一行", () => {
    const source = "a\nb\n"
    const edit = moveLines(source, caret(2), -1)!
    expect(applyTextEdit(source, edit)).toBe("b\na\n")
  })

  test("复制与删除整行", () => {
    const source = "a\nb\n"
    expect(applyTextEdit(source, duplicateLines(source, caret(0))!)).toBe("a\na\nb\n")
    expect(applyTextEdit(source, { ...duplicateLines(source, caret(2))!, start: 2, end: 4, text: "" })).toBe("a\n")
  })

  test("行注释开与关", () => {
    const source = "a\nb\n"
    const marker = commentPrefix("ts")!
    const commented = toggleComment(source, caret(0), marker)!
    expect(applyTextEdit(source, commented)).toBe("// a\n// b\n")
    const uncommented = toggleComment("// a\n// b\n", caret(0), marker)!
    expect(applyTextEdit("// a\n// b\n", uncommented)).toBe("a\nb\n")
  })

  test("JSON 格式化与压缩", () => {
    const compact = formatJson('{"a":1,"b":[1,2]}', caret(0), "  ")!
    expect(compact.text).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
    const minified = formatJson('{\n  "a": 1\n}', caret(0))!
    expect(minified.text).toBe('{"a":1}')
  })

  test("非法 JSON 抛出可读错误", () => {
    expect(() => formatJson("{oops", caret(0))).toThrow("不是合法的 JSON")
  })
})

describe("偏移与行号", () => {
  test("行号 ↔ 偏移", () => {
    const text = "aa\nbb\ncc"
    expect(offsetOfLine(text, 1)).toBe(0)
    expect(offsetOfLine(text, 2)).toBe(3)
    expect(offsetOfLine(text, 9)).toBe(text.length)
    expect(lineOfOffset(text, 4)).toBe(2)
  })
})
