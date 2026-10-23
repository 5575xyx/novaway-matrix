import { describe, expect, test } from "bun:test"
import { detectColumns, fromHex, orderByColumns, pdfLines, readNumbersBefore } from "@/knowledge/pdf/layout"
import { pdfToText } from "@/knowledge/extract"

const identity = (value: string) => value

/** 构造一段 BT 块：每行先 Tm 定位，再 Tj 输出。 */
function block(lines: Array<{ text: string; x: number; y: number }>) {
  return lines.map((line) => `1 0 0 1 ${line.x} ${line.y} Tm (${line.text}) Tj`).join("\n")
}

describe("pdf layout lexing", () => {
  test("reads text with Tm coordinates", () => {
    const lines = pdfLines(block([{ text: "hello", x: 72, y: 700 }]), identity)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ text: "hello", x: 72, y: 700 })
  })

  test("handles Td relative moves", () => {
    const lines = pdfLines("72 700 Td (first) Tj 0 -14 Td (second) Tj", identity)
    expect(lines.map((line) => line.text)).toEqual(["first", "second"])
  })

  test("splits lines on T* breaks", () => {
    const lines = pdfLines("72 700 Td (a) T* (b) T* (c)", identity)
    expect(lines.map((line) => line.text)).toEqual(["a", "b", "c"])
  })

  test("reads hex strings too", () => {
    const lines = pdfLines("72 700 Td <48656c6c6f> Tj", identity)
    expect(lines[0].text).toBe("Hello")
  })

  test("collects numbers preceding an operator", () => {
    const source = "1 0 0 1 100 200 Tm"
    expect(readNumbersBefore(source, source.indexOf("Tm"))).toEqual([1, 0, 0, 1, 100, 200])
  })

  test("decodes hex payloads byte by byte", () => {
    expect(fromHex("414243")).toBe("ABC")
  })
})

describe("pdf column detection", () => {
  const twoColumn = [
    ...Array.from({ length: 6 }, (_, index) => ({ text: "L" + index, x: 72, y: 700 - index * 14, index })),
    ...Array.from({ length: 6 }, (_, index) => ({ text: "R" + index, x: 330, y: 700 - index * 14, index: index + 6 })),
  ]

  test("detects a two-column page", () => {
    expect(detectColumns(twoColumn)).toBe("double")
  })

  test("keeps a single-column page alone", () => {
    const single = Array.from({ length: 10 }, (_, index) => ({
      text: "line " + index,
      x: 72,
      y: 700 - index * 14,
      index,
    }))
    expect(detectColumns(single)).toBe("single")
    expect(orderByColumns(single).map((line) => line.text)).toEqual(single.map((line) => line.text))
  })

  test("reorders columns left first, top to bottom", () => {
    const ordered = orderByColumns(twoColumn)
    expect(ordered.slice(0, 6).map((line) => line.text)).toEqual(["L0", "L1", "L2", "L3", "L4", "L5"])
    expect(ordered.slice(6).map((line) => line.text)).toEqual(["R0", "R1", "R2", "R3", "R4", "R5"])
  })

  test("ignores pages with too few positioned lines", () => {
    expect(detectColumns([{ x: 72 }, { x: 330 }])).toBe("single")
  })
})

describe("pdfToText two-column reordering", () => {
  /** 生成一个最小可解析的 PDF：内容流未压缩，直接内联。 */
  function pdf(content: string) {
    return Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Length " +
        content.length +
        " >>\nstream\n" +
        content +
        "\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
      "latin1",
    )
  }

  test("reads left column before right column", () => {
    const content =
      "BT\n" +
      "1 0 0 1 72 700 Tm (left one) Tj\n" +
      "1 0 0 1 330 700 Tm (right one) Tj\n" +
      "1 0 0 1 72 686 Tm (left two) Tj\n" +
      "1 0 0 1 330 686 Tm (right two) Tj\n" +
      "1 0 0 1 72 672 Tm (left three) Tj\n" +
      "1 0 0 1 330 672 Tm (right three) Tj\n" +
      "1 0 0 1 72 658 Tm (left four) Tj\n" +
      "1 0 0 1 330 658 Tm (right four) Tj\n" +
      "ET"
    const lines = pdfToText(pdf(content)).split("\n").filter(Boolean)
    expect(lines.slice(0, 4)).toEqual(["left one", "left two", "left three", "left four"])
    expect(lines.slice(4)).toEqual(["right one", "right two", "right three", "right four"])
  })

  test("keeps single-column order untouched", () => {
    const content =
      "BT\n" +
      Array.from({ length: 10 }, (_, index) => `1 0 0 1 72 ${700 - index * 14} Tm (line ${index}) Tj`).join("\n") +
      "\nET"
    const lines = pdfToText(pdf(content)).split("\n").filter(Boolean)
    expect(lines).toEqual(Array.from({ length: 10 }, (_, index) => "line " + index))
  })
})
