import { describe, expect, test } from "bun:test"
import { decodeFileText, encodeFileText } from "../../src/file/encoding"

const bytes = (...values: number[]) => new Uint8Array(values)

describe("文件读写编码", () => {
  test("纯 UTF-8 文件原样往返", () => {
    const original = new TextEncoder().encode("第一行\n第二行\n")
    expect(decodeFileText(original)).toBe("第一行\n第二行\n")
    expect(encodeFileText("第一行\n第二行\n", original)).toEqual(original)
  })

  test("CRLF 换行符在写回时恢复", () => {
    const original = new TextEncoder().encode("a\r\nb\r\n")
    expect(decodeFileText(original)).toBe("a\nb\n")
    expect(new TextDecoder().decode(encodeFileText("a\nb\nc\n", original))).toBe("a\r\nb\r\nc\r\n")
  })

  test("UTF-8 BOM 不会丢", () => {
    const original = bytes(0xef, 0xbb, 0xbf, ...new TextEncoder().encode("hi\n"))
    expect(decodeFileText(original)).toBe("hi\n")
    expect(Array.from(encodeFileText("hi\nthere\n", original).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  test("GBK 中文按原编码解码并写回", () => {
    // GBK 的「中文」= D6 D0 CE C4
    const original = bytes(0xd6, 0xd0, 0xce, 0xc4)
    expect(decodeFileText(original)).toBe("中文")
    expect(Array.from(encodeFileText("中文", original))).toEqual([0xd6, 0xd0, 0xce, 0xc4])
  })

  test("新建文件用 UTF-8 + LF，并把 CRLF 归一", () => {
    expect(new TextDecoder().decode(encodeFileText("a\r\nb"))).toBe("a\nb")
  })
})
