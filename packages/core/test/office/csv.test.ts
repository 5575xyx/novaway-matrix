import { describe, expect, test } from "bun:test"
import { PDFDocument } from "pdf-lib"
import { csvEngine } from "../../src/office/csv/engine"
import { parseCsv, serializeCsv, sniffDelimiter, type CsvCell } from "../../src/office/csv/table"
import { officeFormatOf } from "../../src/office/engine/registry"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const values = (rows: CsvCell[][]) => rows.map((row) => row.map((cell) => cell.value))

describe("CSV 解析与回写", () => {
  test("注册表把 .csv 交给 CSV 引擎", () => {
    expect(officeFormatOf("report.csv")).toBe("csv")
    expect(officeFormatOf("REPORT.CSV")).toBe("csv")
  })

  test("认得出逗号 / 制表符 / 分号", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",")
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t")
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";")
    // 只有一列：退回逗号，而不是把正文里的标点当分隔符。
    expect(sniffDelimiter("hello\nworld")).toBe(",")
  })

  test("引号里的分隔符、换行、转义引号都属于同一个字段", () => {
    const table = parseCsv('a,"b,c",d\n"line1\nline2","say ""hi""",z')
    expect(values(table.rows)).toEqual([
      ["a", "b,c", "d"],
      ["line1\nline2", 'say "hi"', "z"],
    ])
  })

  test("没改动的表逐字节回写（保留原来的引号风格）", () => {
    const text = 'a,"b,c"\n1,"plain"\n'
    const table = parseCsv(text)
    expect(serializeCsv(table.rows, table.delimiter)).toBe(text)
  })
})

describe("CSV 引擎", () => {
  test("只改一个格子，其它格子的写法原样保留", async () => {
    const bytes = encoder.encode('名称,"数量,个"\n苹果,"3"\n')
    const opened = await csvEngine.open(bytes)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(values(opened.data.rows)).toEqual([
      ["名称", "数量,个"],
      ["苹果", "3"],
    ])

    const applied = await csvEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 1 }, value: 5 }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(decoder.decode(applied.data.bytes)).toBe('名称,"数量,个"\n苹果,5\n')
    expect(applied.data.changed).toEqual(["csv"])
    expect(applied.data.state.rows[1]![1]!.value).toBe("5")
  })

  test("新值里有逗号会自己加引号", async () => {
    const bytes = encoder.encode("a,b\n")
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 0, col: 1 }, value: "x,y" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(decoder.decode(applied.data.bytes)).toBe('a,"x,y"\n')
  })

  test("插入 / 删除行列，CSV 的 at 也从 1 开始", async () => {
    const bytes = encoder.encode("a,b\nc,d\n")
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(
      opened.data,
      [
        { op: "insertRows", sheet: "Sheet1", at: 2, count: 1 },
        { op: "deleteColumns", sheet: "Sheet1", at: 1, count: 1 },
      ],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(values(applied.data.state.rows)).toEqual([["b"], [""], ["d"]])
  })

  test("原文件的 CRLF 与 BOM 在写回后仍然存在", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("a,b\r\n1,2\r\n")])
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 1, col: 1 }, value: 3 }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(Array.from(applied.data.bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(decoder.decode(applied.data.bytes.slice(3))).toBe("a,b\r\n1,3\r\n")
  })

  test("没有实际改动时 changed 为空", async () => {
    const bytes = encoder.encode("a,b\n")
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(
      opened.data,
      [{ op: "setCellValue", sheet: "Sheet1", ref: { row: 0, col: 0 }, value: "a" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual([])
    expect(applied.data.bytes).toBe(bytes)
  })

  test("格式类操作被拒绝，并指向 .xlsx", async () => {
    const bytes = encoder.encode("a,b\n")
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(
      opened.data,
      [
        {
          op: "setCellStyle",
          sheet: "Sheet1",
          range: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
          style: { bold: true },
        },
      ],
      bytes,
    )
    expect(applied.ok).toBe(false)
    if (!applied.ok) {
      expect(applied.error.code).toBe("unsupported_format")
      expect(applied.error.suggestion).toContain(".xlsx")
    }
  })

  test("setText 整篇替换会重新识别分隔符", async () => {
    const bytes = encoder.encode("a,b\n")
    const opened = await csvEngine.open(bytes)
    if (!opened.ok) return
    const applied = await csvEngine.apply(opened.data, [{ op: "setText", text: "x\ty\n1\t2" }], bytes)
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.state.delimiter).toBe("\t")
    expect(values(applied.data.state.rows)).toEqual([
      ["x", "y"],
      ["1", "2"],
    ])
  })
})

describe("CSV 导出", () => {
  const source = encoder.encode('name,count\napple,3\n"pear, ripe",5\n')

  test("csv 原样，tsv 换分隔符", async () => {
    const opened = await csvEngine.open(source)
    if (!opened.ok) return
    const csv = await csvEngine.export!(opened.data, "csv", source)
    expect(csv.ok).toBe(true)
    if (csv.ok) expect(decoder.decode(csv.data)).toBe(decoder.decode(source))

    const tsv = await csvEngine.export!(opened.data, "tsv", source)
    expect(tsv.ok).toBe(true)
    if (tsv.ok) expect(decoder.decode(tsv.data).split("\n")[1]).toBe("apple\t3")
  })

  test("md 是管道表格，html 是真正的表", async () => {
    const opened = await csvEngine.open(source)
    if (!opened.ok) return
    const md = await csvEngine.export!(opened.data, "md", source)
    expect(md.ok).toBe(true)
    if (md.ok) {
      const text = decoder.decode(md.data)
      expect(text.split("\n")[0]).toBe("| name | count |")
      expect(text.split("\n")[1]).toBe("| --- | --- |")
      expect(text).toContain("| pear, ripe | 5 |")
    }
    const html = await csvEngine.export!(opened.data, "html", source)
    expect(html.ok).toBe(true)
    if (html.ok) {
      const text = decoder.decode(html.data)
      expect(text).toContain("<th>name</th>")
      expect(text).toContain("<td>apple</td>")
    }
  })

  test("json 按表头转成对象数组，空行丢掉", async () => {
    const opened = await csvEngine.open(encoder.encode("name,count\napple,3\n,\npear,5\n"))
    if (!opened.ok) return
    const result = await csvEngine.export!(opened.data, "json", source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.parse(decoder.decode(result.data))).toEqual([
      { name: "apple", count: "3" },
      { name: "pear", count: "5" },
    ])
  })

  test("CSV 也能排成 PDF（表格外形，PNG 在导出层再栅格化）", async () => {
    const opened = await csvEngine.open(source)
    if (!opened.ok) return
    const result = await csvEngine.export!(opened.data, "pdf", source)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(decoder.decode(result.data.subarray(0, 5))).toBe("%PDF-")
    const doc = await PDFDocument.load(result.data)
    expect(doc.getPageCount()).toBe(1)
  })

  test("不支持的目标给出可选清单", async () => {
    const opened = await csvEngine.open(source)
    if (!opened.ok) return
    const result = await csvEngine.export!(opened.data, "xlsx", source)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.suggestion).toContain("csv / tsv / md / html / json")
  })
})
