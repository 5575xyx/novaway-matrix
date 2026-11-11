import { afterAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PDFDocument } from "pdf-lib"
import { OfficeCommand } from "../../src/cli/cmd/office"

const NL = String.fromCharCode(10)
let dir = ""

/** 一张 1×1 的最小 JPEG，用来在 PDF 上放一张可调整的图片。 */
function tinyJpeg(): Uint8Array {
  const base64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
  return new Uint8Array(Buffer.from(base64, "base64"))
}

async function workspace() {
  if (!dir) dir = await mkdtemp(path.join(tmpdir(), "novaway-office-"))
  return dir
}

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

/**
 * 直接调命令 handler，不 spawn 整个 CLI：测的是同一份参数处理 + 引擎路径，
 * 也避免每个用例 5 秒的进程启动。
 */
async function office(input: Record<string, unknown>) {
  const logs: string[] = []
  const errors: string[] = []
  const originalLog = console.log
  const originalError = console.error
  const previousExit = process.exitCode
  console.log = (...args: unknown[]) => void logs.push(args.map(String).join(" "))
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "))
  process.exitCode = 0
  try {
    await (OfficeCommand.handler as any)({ json: true, force: false, ...input }, {})
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  const code = process.exitCode ?? 0
  process.exitCode = previousExit
  const line = logs.map((item) => item.trim()).find((item) => item.startsWith("{"))
  return {
    code,
    stdout: logs.join(NL),
    stderr: errors.join(NL),
    json: line ? (JSON.parse(line) as { ok: boolean; data?: any; error?: any }) : undefined,
  }
}

describe("office CLI", () => {
  test("markdown：get / set / add / remove / export 都只改目标行", async () => {
    const root = await workspace()
    const file = path.join(root, "note.md")
    expect((await office({ action: "create", file, title: "笔记" })).json?.ok).toBe(true)

    const before = await readFile(file, "utf8")
    expect((await office({ action: "get", file, target: "/body/p[1]" })).json?.data.value.text).toBe("# 笔记")

    expect((await office({ action: "set", file, target: "/body/p[1]", value: "value=新标题" })).json?.ok).toBe(true)
    expect(await readFile(file, "utf8")).toContain("新标题")

    expect((await office({ action: "add", file, target: "/body", type: "paragraph", text: "加一段" })).json?.ok).toBe(
      true,
    )
    expect(await readFile(file, "utf8")).toContain("加一段")

    expect((await office({ action: "remove", file, target: "/body/p[1]" })).json?.ok).toBe(true)
    const after = await readFile(file, "utf8")
    expect(after).not.toContain("新标题")
    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)

    const out = path.join(root, "note.txt")
    expect((await office({ action: "export", file, target: out })).json?.data.format).toBe("txt")
    expect((await readFile(out, "utf8")).length).toBeGreaterThan(0)
  })

  test("xlsx：路径改写单元格、加工作表、读区域", async () => {
    const root = await workspace()
    const file = path.join(root, "q.xlsx")
    expect((await office({ action: "create", file })).json?.ok).toBe(true)
    expect((await office({ action: "set", file, target: "/Sheet1/B2", value: "value=1280" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/Sheet1/B2" })).json?.data.value.value).toBe(1280)
    expect((await office({ action: "add", file, target: "/Sheet2", type: "sheet" })).json?.ok).toBe(true)
    expect((await office({ action: "set", file, target: "/Sheet2", value: "name=数据" })).json?.ok).toBe(true)
    expect((await office({ action: "view", file, target: "text" })).stdout).toContain("数据")

    // 标签颜色：写入后 get 能读到，空值再清除（改名后按新名字定位）。
    expect((await office({ action: "set", file, target: "/数据", value: "tabColor=4472C4" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/数据" })).json?.data.value.tabColor).toBe("FF4472C4")
    expect((await office({ action: "set", file, target: "/数据", value: "tabColor=" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/数据" })).json?.data.value.tabColor).toBeUndefined()

    // remove 区域 = 清空单元格（不是删行删列）。
    expect((await office({ action: "remove", file, target: "/Sheet1/A1:B1" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/Sheet1/A1" })).json?.data.value.empty).toBe(true)
    expect((await office({ action: "get", file, target: "/Sheet1/A2" })).json?.data.value.text).toBe("")

    const range = (await office({ action: "get", file, target: "/Sheet1/A1:B2" })).json?.data.value
    expect(range.rows.length).toBe(2)
  })

  test("view outline：Markdown 只列标题，带行号", async () => {
    const root = await workspace()
    const file = path.join(root, "outline.md")
    await writeFile(file, ["# 标题", "", "正文", "", "## 小节", "", "### 更细"].join(NL))
    const result = await office({ action: "view", file, target: "outline" })
    expect(result.json?.ok).toBe(true)
    const outline = result.json?.data.outline as Array<{ level: number; text: string; line: number }>
    expect(outline.map((item) => item.text)).toEqual(["标题", "小节", "更细"])
    expect(outline.map((item) => item.level)).toEqual([1, 2, 3])
    expect(outline[1]?.line).toBe(5)
    expect(result.stdout).toContain("第 5 行")
  })

  test("view outline：docx 按标题样式给路径", async () => {
    const root = await workspace()
    const file = path.join(root, "outline.docx")
    expect((await office({ action: "create", file, title: "合同" })).json?.ok).toBe(true)
    expect(
      (await office({ action: "set", file, target: "/body/p[1]", value: "value=正文", style: "Heading1" })).json?.ok,
    ).toBe(true)
    const outline = (await office({ action: "view", file, target: "outline" })).json?.data.outline as Array<{
      level: number
      text: string
      path: string
    }>
    const heading = outline.find((item) => item.path === "/body/p[1]")
    expect(heading?.level).toBe(1)
    expect(heading?.text).toBe("正文")
  })

  test("docx：命名样式、插图表格、分页符", async () => {
    const root = await workspace()
    const file = path.join(root, "c.docx")
    expect((await office({ action: "create", file, title: "合同" })).json?.ok).toBe(true)
    expect(
      (await office({ action: "set", file, target: "/body/p[1]", value: "value=正文", style: "Heading1" })).json?.ok,
    ).toBe(true)
    const rows = JSON.stringify([
      ["项目", "金额"],
      ["合计", "120"],
    ])
    expect((await office({ action: "add", file, target: "/body", type: "table", rows })).json?.ok).toBe(true)
    expect((await office({ action: "add", file, target: "/body", type: "pagebreak" })).json?.ok).toBe(true)
    const view = (await office({ action: "view", file, target: "text" })).stdout
    expect(view).toContain("Heading1")
    expect(view).toContain("合计")
  })

  test("docx：删除线 / 高亮 / 行距 / 首行缩进 / 清除格式", async () => {
    const root = await workspace()
    const file = path.join(root, "format.docx")
    expect((await office({ action: "create", file, title: "格式" })).json?.ok).toBe(true)
    expect(
      (
        await office({
          action: "set",
          file,
          target: "/body/p[1]",
          strike: true,
          highlight: "FFF2A8",
          lineSpacing: 1.5,
          firstLineIndent: 24,
        })
      ).json?.ok,
    ).toBe(true)

    const { docxEngine } = await import("@novaway/core/office/engine/docx")
    const opened = await docxEngine.open(new Uint8Array(await readFile(file)))
    if (!opened.ok) throw new Error(opened.error.message)
    const paragraph = opened.data.paragraphs[0]!
    expect(paragraph.strike).toBe(true)
    expect(paragraph.highlight).toBe("FFF2A8")
    expect(paragraph.lineSpacing).toBe(1.5)
    expect(paragraph.firstLineIndent).toBe(24)

    expect((await office({ action: "set", file, target: "/body/p[1]", clear: true })).json?.ok).toBe(true)
    const cleared = await docxEngine.open(new Uint8Array(await readFile(file)))
    if (!cleared.ok) throw new Error(cleared.error.message)
    expect(cleared.data.paragraphs[0]!.strike).toBeUndefined()
    expect(cleared.data.paragraphs[0]!.highlight).toBeUndefined()
  })

  test("docx：表格插行、改单元格走 ops 通道", async () => {
    const root = await workspace()
    const file = path.join(root, "table.docx")
    expect((await office({ action: "create", file, title: "表格" })).json?.ok).toBe(true)
    const rows = JSON.stringify([
      ["项目", "金额"],
      ["合计", "120"],
    ])
    expect((await office({ action: "add", file, target: "/body", type: "table", rows })).json?.ok).toBe(true)

    const edited = await office({
      action: "set",
      file,
      target: "/body",
      ops: JSON.stringify([
        { op: "insertTableRow", table: 1, at: 2 },
        { op: "setTableCellText", table: 1, row: 2, col: 2, text: "256" },
      ]),
    })
    expect(edited.json?.ok).toBe(true)

    const { docxEngine } = await import("@novaway/core/office/engine/docx")
    const opened = await docxEngine.open(new Uint8Array(await readFile(file)))
    if (!opened.ok) throw new Error(opened.error.message)
    const texts = opened.data.paragraphs.map((item) => item.text)
    expect(texts).toContain("项目")
    expect(texts).toContain("256")
    // 插了一行、表里原有 4 段 + 新行 2 段。
    expect(opened.data.paragraphs.filter((item) => item.inTable).length).toBe(6)
  })

  test("pptx：按路径改形状、加文本框、删形状", async () => {
    const root = await workspace()
    const file = path.join(root, "p.pptx")
    expect((await office({ action: "create", file, title: "季度汇报" })).json?.ok).toBe(true)
    const slide = (await office({ action: "get", file, target: "/slide[1]" })).json?.data.value
    expect(slide.shapes[0].paragraphs[0]).toBe("季度汇报")
    expect(
      (await office({ action: "add", file, target: "/slide[1]", type: "textbox", text: "新文本框" })).json?.ok,
    ).toBe(true)
    expect((await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.shapes.length).toBe(2)
    expect((await office({ action: "remove", file, target: "/slide[1]/shape[2]" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.shapes.length).toBe(1)
  })

  test("pptx：插入预设形状（--type shape）", async () => {
    const root = await workspace()
    const file = path.join(root, "shape.pptx")
    expect((await office({ action: "create", file, title: "形状" })).json?.ok).toBe(true)
    const added = await office({
      action: "add",
      file,
      target: "/slide[1]",
      type: "shape",
      shape: "ellipse",
      fill: "4472C4",
      text: "合计",
    })
    expect(added.json?.ok).toBe(true)
    const shapes = (await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.shapes
    expect(shapes.length).toBe(2)
    expect(shapes[1].name).toContain("椭圆")
    expect(shapes[1].paragraphs[0]).toBe("合计")
  })

  test("add /：根路径往末尾加工作表、幻灯片、PDF 页", async () => {
    const root = await workspace()
    const book = path.join(root, "root.xlsx")
    expect((await office({ action: "create", file: book })).json?.ok).toBe(true)
    expect((await office({ action: "add", file: book, target: "/", type: "sheet", name: "汇总" })).json?.ok).toBe(true)
    expect((await office({ action: "view", file: book, target: "text" })).stdout).toContain("汇总")

    const deck = path.join(root, "root.pptx")
    expect((await office({ action: "create", file: deck, title: "首页" })).json?.ok).toBe(true)
    expect((await office({ action: "add", file: deck, target: "/", type: "slide" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file: deck, target: "/slide[2]" })).json?.ok).toBe(true)

    const pdf = path.join(root, "root.pdf")
    expect((await office({ action: "create", file: pdf, title: "第一页" })).json?.ok).toBe(true)
    expect((await office({ action: "add", file: pdf, target: "/", type: "page" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file: pdf, target: "/page[2]" })).json?.ok).toBe(true)
  })

  test("docx：remove /body/table[N] 删掉整张表", async () => {
    const root = await workspace()
    const file = path.join(root, "table-remove.docx")
    expect((await office({ action: "create", file, title: "表格" })).json?.ok).toBe(true)
    const rows = JSON.stringify([
      ["项目", "金额"],
      ["合计", "120"],
    ])
    expect((await office({ action: "add", file, target: "/body", type: "table", rows })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/body/table[1]" })).json?.data.value.paragraphs.length).toBe(4)
    expect((await office({ action: "remove", file, target: "/body/table[1]" })).json?.ok).toBe(true)
    const after = await office({ action: "get", file, target: "/body/table[1]" })
    expect(after.json?.ok).toBe(false)
    expect(after.json?.error.code).toBe("not_found")
  })

  test("pptx：备注、隐藏页与形状改名", async () => {
    const root = await workspace()
    const file = path.join(root, "meta.pptx")
    expect((await office({ action: "create", file, title: "备注页" })).json?.ok).toBe(true)

    expect((await office({ action: "set", file, target: "/slide[1]", value: "notes=讲者提示" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.notes).toBe("讲者提示")

    expect((await office({ action: "set", file, target: "/slide[1]", value: "hidden=true" })).json?.ok).toBe(true)
    const slide = (await office({ action: "get", file, target: "/slide[1]" })).json?.data.value
    expect(slide.hidden).toBe(true)
    expect((await office({ action: "view", file, target: "outline" })).json?.data.summary).toContain("隐藏")

    expect((await office({ action: "set", file, target: "/slide[1]", value: "hidden=false" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.hidden).toBe(false)

    const renamed = await office({ action: "set", file, target: "/slide[1]/shape[1]", value: "name=主标题" })
    expect(renamed.json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.shapes[0].name).toBe("主标题")

    // 换版式：按序号指定，get 能看到新款式的名字。
    const layout = await office({ action: "set", file, target: "/slide[1]", value: "layout=1" })
    expect(layout.json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/slide[1]" })).json?.data.value.layout).toBeTruthy()
  })

  test("pptx：加页时按序号选版式，新页可用", async () => {
    const root = await workspace()
    const file = path.join(root, "layout.pptx")
    expect((await office({ action: "create", file, title: "版式测试" })).json?.ok).toBe(true)
    const added = await office({ action: "add", file, target: "/slide[1]", type: "slide", layout: "1" })
    expect(added.json?.ok).toBe(true)
    expect(added.json?.data.applied).toBe(1)
    const second = await office({ action: "get", file, target: "/slide[2]" })
    expect(second.json?.ok).toBe(true)
    expect(second.json?.data.value.slide).toBe(2)
  })

  test("create 能新建真正的 PDF", async () => {
    const root = await workspace()
    const file = path.join(root, "blank.pdf")
    const created = await office({ action: "create", file, title: "Invoice" })
    expect(created.json?.ok).toBe(true)
    expect(created.json?.data.kind).toBe("pdf")
    const bytes = new Uint8Array(await readFile(file))
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-")
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  test("错误路径返回结构化错误，不写坏文件", async () => {
    const root = await workspace()
    const file = path.join(root, "bad.md")
    expect((await office({ action: "create", file, title: "x" })).json?.ok).toBe(true)
    const before = await readFile(file, "utf8")
    const failed = await office({ action: "set", file, target: "/body/p[99]", value: "value=y" })
    expect(failed.json?.ok).toBe(false)
    expect(failed.json?.error.code).toBe("not_found")
    expect(failed.code).toBe(1)
    expect(await readFile(file, "utf8")).toBe(before)
  })

  test("pdf：export --pages 提取页面、split --every 切分", async () => {
    const root = await workspace()
    const file = path.join(root, "report.pdf")
    const doc = await PDFDocument.create()
    for (let page = 0; page < 3; page += 1) doc.addPage([595, 842])
    await writeFile(file, await doc.save())

    const out = path.join(root, "picked.pdf")
    const extracted = await office({ action: "export", file, target: out, pages: "1,3" })
    expect(extracted.json?.ok).toBe(true)
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(2)

    const split = await office({ action: "split", file, target: path.join(root, "part"), every: 2 })
    expect(split.json?.ok).toBe(true)
    expect(split.json?.data.files.length).toBe(2)
    expect((await PDFDocument.load(await readFile(path.join(root, "part-2.pdf")))).getPageCount()).toBe(1)
  })

  test("pdf：按路径原地替换文字", async () => {
    const root = await workspace()
    const file = path.join(root, "draft.pdf")
    const { PDFDocument, PDFArray, PDFRef, PDFRawStream, StandardFonts, decodePDFRawStream } = await import("pdf-lib")
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("Draft report", { x: 50, y: 700, size: 20, font })
    await writeFile(file, await doc.save())

    const replaced = await office({ action: "set", file, target: "/page[1]", value: "find=Draft", replace: "Final" })
    expect(replaced.json?.ok).toBe(true)

    const reopened = await PDFDocument.load(await readFile(file))
    const contents = reopened.getPage(0).node.Contents()
    const chunks: Uint8Array[] = []
    const collect = (value: unknown) => {
      if (value instanceof PDFRef) {
        const looked = reopened.context.lookup(value)
        if (looked instanceof PDFRawStream) chunks.push(decodePDFRawStream(looked).decode())
      }
    }
    if (contents instanceof PDFArray)
      for (let index = 0; index < contents.size(); index += 1) collect(contents.get(index))
    else collect(contents)
    const text = chunks.map((bytes) => new TextDecoder("windows-1252").decode(bytes)).join("")
    // pdf-lib 把字符串写成十六进制："Final" = 46696E616C
    expect(text.toUpperCase()).toContain("46696E616C")
    expect(text.toUpperCase()).not.toContain("4472616674")

    const missing = await office({ action: "set", file, target: "/page[1]", value: "find=Missing", replace: "x" })
    expect(missing.json?.ok).toBe(false)
    expect(missing.json?.error.code).toBe("not_found")
  })

  test("pdf：view text / get 页 能读出正文", async () => {
    const root = await workspace()
    const file = path.join(root, "read.pdf")
    const { PDFDocument, StandardFonts } = await import("pdf-lib")
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("Invoice 123.45", { x: 50, y: 700, size: 16, font })
    await writeFile(file, await doc.save())

    const view = await office({ action: "view", file, target: "text" })
    expect(view.json?.ok).toBe(true)
    expect(view.json?.data.text).toContain("Invoice 123.45")
    expect(view.json?.data.pages[0].page).toBe(1)

    const got = await office({ action: "get", file, target: "/page[1]" })
    expect(got.json?.data.value.text).toContain("Invoice 123.45")
  })

  test("pdf：读出、移动、缩放、旋转页面上已有的图片", async () => {
    const root = await workspace()
    const file = path.join(root, "img.pdf")
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const image = await doc.embedJpg(tinyJpeg())
    page.drawImage(image, { x: 50, y: 300, width: 100, height: 50 })
    await writeFile(file, await doc.save())

    // get /page[N] 直接给出图片序号和左上角框，CLI 用户不用猜。
    const read = await office({ action: "get", file, target: "/page[1]" })
    expect(read.json?.data.value.images.length).toBe(1)
    expect(read.json?.data.value.images[0].x).toBeCloseTo(50, 1)
    expect(read.json?.data.value.images[0].y).toBeCloseTo(492, 1)
    expect(read.json?.data.value.images[0].width).toBeCloseTo(100, 1)

    const moved = await office({
      action: "set",
      file,
      target: "/page[1]",
      imageIndex: 1,
      x: 200,
      y: 100,
      width: 120,
      height: 60,
    })
    expect(moved.json?.ok).toBe(true)

    const after = await office({ action: "get", file, target: "/page[1]" })
    expect(after.json?.data.value.images[0].x).toBeCloseTo(200, 1)
    expect(after.json?.data.value.images[0].y).toBeCloseTo(100, 1)
    expect(after.json?.data.value.images[0].width).toBeCloseTo(120, 1)

    // 只给 rotation：绕中心转，宽高互换。
    const rotated = await office({ action: "set", file, target: "/page[1]", imageIndex: 1, rotation: 90 })
    expect(rotated.json?.ok).toBe(true)
    const turned = await office({ action: "get", file, target: "/page[1]" })
    expect(turned.json?.data.value.images[0].rotation).toBe(90)
    expect(turned.json?.data.value.images[0].width).toBeCloseTo(60, 1)
    expect(turned.json?.data.value.images[0].height).toBeCloseTo(120, 1)

    // 和面板 / AI 同一条命令，也能走 run 的 JSON 参数。
    const ran = await office({
      action: "run",
      file,
      target: "setPageImageBox",
      params: JSON.stringify({ page: 1, index: 1, x: 40, y: 40 }),
    })
    expect(ran.json?.ok).toBe(true)
    expect(ran.json?.data.command).toBe("setPageImageBox")

    const missing = await office({ action: "set", file, target: "/page[1]", imageIndex: 9, x: 1 })
    expect(missing.json?.ok).toBe(false)
    expect(missing.json?.error.code).toBe("not_found")
  })

  test("pdf：把另一份 PDF 的页面插进来", async () => {
    const root = await workspace()
    const target = path.join(root, "main.pdf")
    const source = path.join(root, "extra.pdf")
    const main = await PDFDocument.create()
    main.addPage([595, 842])
    main.addPage([595, 842])
    await writeFile(target, await main.save())
    const extra = await PDFDocument.create()
    extra.addPage([300, 300])
    extra.addPage([400, 400])
    await writeFile(source, await extra.save())

    const added = await office({ action: "add", file: target, target: "/page[1]", type: "pages", from: source })
    expect(added.json?.ok).toBe(true)
    expect(added.json?.data.applied).toBe(1)
    const merged = await PDFDocument.load(new Uint8Array(await readFile(target)))
    expect(merged.getPageCount()).toBe(4)
    expect(Math.round(merged.getPage(1).getWidth())).toBe(300)

    // --pages 只拿指定页，按给定顺序插入。
    const picked = path.join(root, "picked.pdf")
    await writeFile(picked, await main.save())
    const subset = await office({
      action: "add",
      file: picked,
      target: "/page[1]",
      type: "pages",
      from: source,
      pages: "2",
    })
    expect(subset.json?.ok).toBe(true)
    const one = await PDFDocument.load(new Uint8Array(await readFile(picked)))
    expect(one.getPageCount()).toBe(3)
    expect(Math.round(one.getPage(1).getWidth())).toBe(400)

    const bad = await office({ action: "add", file: target, target: "/page[1]", type: "pages" })
    expect(bad.json?.ok).toBe(false)
    expect(bad.json?.error.code).toBe("invalid_params")
  })

  test("pdf：merge 按顺序合并多份 PDF", async () => {
    const root = await workspace()
    const a = path.join(root, "a.pdf")
    const b = path.join(root, "b.pdf")
    const c = path.join(root, "c.pdf")
    const docA = await PDFDocument.create()
    docA.addPage([300, 300])
    await writeFile(a, await docA.save())
    const docB = await PDFDocument.create()
    docB.addPage([400, 400])
    docB.addPage([500, 500])
    await writeFile(b, await docB.save())
    const docC = await PDFDocument.create()
    docC.addPage([600, 600])
    await writeFile(c, await docC.save())

    const out = path.join(root, "merged.pdf")
    const merged = await office({ action: "merge", file: a, target: b, files: c, out })
    expect(merged.json?.ok).toBe(true)
    expect(merged.json?.data.pages).toBe(4)
    const result = await PDFDocument.load(new Uint8Array(await readFile(out)))
    expect(result.getPageCount()).toBe(4)
    expect(Math.round(result.getPage(0).getWidth())).toBe(300)
    expect(Math.round(result.getPage(3).getWidth())).toBe(600)

    const missingOut = await office({ action: "merge", file: a, target: b })
    expect(missingOut.json?.ok).toBe(false)
    expect(missingOut.json?.error.code).toBe("invalid_params")
  })

  test("旧格式 export 另存为 docx：写出的是真正的 OOXML 包", async () => {
    const root = await workspace()
    const file = path.join(root, "old.rtf")
    await writeFile(
      file,
      String.raw`{\rtf1\ansi{\fonttbl{\f0 Helvetica;}}\f0 \u23395?\u24230?\u24635?\u32467?\par \u31532?\u20108?\u27573?\par}`,
    )
    const out = path.join(root, "old.docx")
    const exported = await office({ action: "export", file, target: out })
    expect(exported.json?.ok).toBe(true)
    expect(exported.json?.data.format).toBe("docx")

    const bytes = new Uint8Array(await readFile(out))
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const { docxEngine } = await import("@novaway/core/office/engine/docx")
    const opened = await docxEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    expect(opened.data.paragraphs.map((item) => item.text)).toContain("第二段")
  })

  test("旧格式：odt 按路径读 / 改 / 加 / 删，写回仍是合法 ODF", async () => {
    const root = await workspace()
    const file = path.join(root, "note.odt")
    const { buildZip } = await import("@novaway/core/office/pptx-edit")
    const encoder = new TextEncoder()
    const xml =
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h>标题</text:h><text:p>第一段</text:p><text:p>第二段</text:p></office:text></office:body></office:document-content>'
    await writeFile(
      file,
      buildZip([
        { name: "mimetype", data: encoder.encode("application/vnd.oasis.opendocument.text") },
        { name: "content.xml", data: encoder.encode(xml) },
      ]),
    )

    expect((await office({ action: "get", file, target: "/body" })).json?.data.value.paragraphs).toBe(3)
    expect((await office({ action: "get", file, target: "/body/p[2]" })).json?.data.value.text).toBe("第一段")

    expect((await office({ action: "set", file, target: "/body/p[2]", value: "改过的段落" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/body/p[2]" })).json?.data.value.text).toBe("改过的段落")

    expect((await office({ action: "add", file, target: "/body", type: "paragraph", text: "新增" })).json?.ok).toBe(
      true,
    )
    expect((await office({ action: "get", file, target: "/body/p[1]" })).json?.data.value.text).toBe("新增")

    expect((await office({ action: "remove", file, target: "/body/p[1]" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/body" })).json?.data.value.paragraphs).toBe(3)
    expect((await office({ action: "view", file, target: "text" })).stdout).toContain("改过的段落")

    // 越界不写坏文件
    const before = await readFile(file)
    const failed = await office({ action: "set", file, target: "/body/p[99]", value: "x" })
    expect(failed.json?.ok).toBe(false)
    expect(failed.json?.error.code).toBe("not_found")
    expect(Buffer.compare(await readFile(file), before)).toBe(0)
  })

  test("旧格式：ods 按 A1 坐标改单元格", async () => {
    const root = await workspace()
    const file = path.join(root, "book.ods")
    const { buildZip } = await import("@novaway/core/office/pptx-edit")
    const encoder = new TextEncoder()
    const xml =
      '<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="数据"><table:table-row><table:table-cell><text:p>项目</text:p></table:table-cell><table:table-cell><text:p>金额</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>合计</text:p></table:table-cell><table:table-cell><text:p>120</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>'
    await writeFile(
      file,
      buildZip([
        { name: "mimetype", data: encoder.encode("application/vnd.oasis.opendocument.spreadsheet") },
        { name: "content.xml", data: encoder.encode(xml) },
      ]),
    )

    expect((await office({ action: "get", file, target: "/数据/B2" })).json?.data.value.text).toBe("120")
    expect((await office({ action: "set", file, target: "/数据/B2", value: "256" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/数据/B2" })).json?.data.value.text).toBe("256")
    expect((await office({ action: "view", file, target: "text" })).stdout).toContain("256")

    const formula = await office({ action: "set", file, target: "/数据/B2", value: "=SUM(B1:B2)" })
    expect(formula.json?.ok).toBe(false)
    expect(formula.json?.error.code).toBe("unsupported_format")
  })

  test("拼错的命令 / 操作名给出最接近的候选", async () => {
    const root = await workspace()
    const file = path.join(root, "typo.md")
    expect((await office({ action: "create", file, title: "x" })).json?.ok).toBe(true)

    const badCommand = await office({ action: "veiw", file })
    expect(badCommand.json?.ok).toBe(false)
    expect(badCommand.json?.error.code).toBe("unknown_command")
    expect(badCommand.json?.error.suggestion).toContain("view")

    const badOp = await office({
      action: "set",
      file,
      ops: JSON.stringify([{ op: "setParagraphtext", paragraph: 1, text: "x" }]),
    })
    expect(badOp.json?.ok).toBe(false)
    expect(badOp.json?.error.suggestion).toContain("setParagraphText")
  })

  test("commands / guide 给 Agent 的能力清单", async () => {
    const commands = (await office({ action: "commands" })).json
    expect(commands?.data.ops).toContain("addTable")
    expect(commands?.data.formats).toContain("pdf")
    expect((await office({ action: "guide" })).json?.data.guide).toContain("路径寻址")
  })

  test("view 的三种模式：outline / text / json", async () => {
    const root = await workspace()
    const file = path.join(root, "modes.md")
    await writeFile(file, ["# 标题", "", "正文"].join(NL))

    const outline = await office({ action: "view", file, target: "outline" })
    expect(outline.json?.data.mode).toBe("outline")
    expect(outline.json?.data.outline.map((item: { text: string }) => item.text)).toEqual(["标题"])

    const text = await office({ action: "view", file, target: "text" })
    expect(text.json?.data.mode).toBe("text")
    expect(text.json?.data.summary).toContain("正文")

    const json = await office({ action: "view", file, target: "json" })
    expect(json.json?.data.mode).toBe("json")
    expect(json.json?.data.state.text).toContain("正文")

    const bad = await office({ action: "view", file, target: "tree-view" })
    expect(bad.json?.error.code).toBe("usage")
    expect(bad.json?.error.candidates).toContain("outline")
  })

  test("commands 按格式过滤，完整命令名附带参数说明", async () => {
    const word = (await office({ action: "commands", file: "word" })).json?.data
    expect(word.ops).toContain("insertParagraph")
    expect(word.ops).not.toContain("setCellValue")

    const sheet = (await office({ action: "commands", file: "xlsx" })).json?.data
    expect(sheet.ops).toContain("setCellValue")
    expect(sheet.ops).not.toContain("addSlide")

    const exact = (await office({ action: "commands", file: "pdf", target: "rotatePage" })).json?.data
    expect(exact.op).toBe("rotatePage")
    expect(exact.params).toContain("degrees")
    expect(exact.usage).toContain("run")

    const keyword = (await office({ action: "commands", file: "slides", target: "shape" })).json?.data
    expect(keyword.ops).toContain("addShape")
    expect(keyword.hints.addShape).toBeTruthy()

    const miss = await office({ action: "commands", file: "word", target: "teleport" })
    expect(miss.json?.error.code).toBe("not_found")
    expect((miss.json?.error.candidates as string[]).length).toBeGreaterThan(0)
  })

  test("run：按命令 id + --params 改文档", async () => {
    const root = await workspace()
    const file = path.join(root, "run.docx")
    expect((await office({ action: "create", file, title: "报告" })).json?.ok).toBe(true)

    const inserted = await office({
      action: "run",
      file,
      target: "insertParagraph",
      params: JSON.stringify({ after: 1, text: "第二段" }),
    })
    expect(inserted.json?.ok).toBe(true)
    expect(inserted.json?.data.command).toBe("insertParagraph")
    expect(inserted.json?.data.saved).toBe(true)
    expect((await office({ action: "get", file, target: "/body/p[2]" })).json?.data.value.text).toBe("第二段")

    const bold = await office({
      action: "run",
      file,
      target: "setParagraphStyle",
      params: JSON.stringify({ paragraph: 2, style: { bold: true } }),
    })
    expect(bold.json?.ok).toBe(true)

    const unknown = await office({ action: "run", file, target: "setParagrap", params: "{}" })
    expect(unknown.json?.error.code).toBe("unknown_command")
    expect(unknown.json?.error.suggestion).toContain("setParagraph")
    expect(unknown.json?.error.candidates).toContain("setParagraphText")
  })

  test("单文件 batch：get / set / add / remove / command 全有或全无", async () => {
    const root = await workspace()
    const file = path.join(root, "batch.docx")
    expect((await office({ action: "create", file, title: "初稿" })).json?.ok).toBe(true)

    const ok = await office({
      action: "batch",
      file,
      commands: JSON.stringify([
        { set: "/body/p[1]", props: { text: "标题" } },
        { add: "/body/p[1]", type: "paragraph", props: { text: "补充" } },
        { get: "/body/p[2]" },
        { command: "setParagraphStyle", params: { paragraph: 1, style: { bold: true } } },
      ]),
    })
    expect(ok.json?.ok).toBe(true)
    const results = ok.json?.data.results as Array<{ status: string; result?: { text?: string } }>
    expect(results.map((item) => item.status)).toEqual(["ok", "ok", "ok", "ok"])
    expect(results[2]?.result?.text).toBe("补充")
    expect(ok.json?.data.saved).toBe(true)

    const before = await readFile(file)
    const failed = await office({
      action: "batch",
      file,
      commands: JSON.stringify([
        { set: "/body/p[1]", props: { text: "改了一半" } },
        { set: "/body/p[99]", props: { text: "越界" } },
        { set: "/body/p[2]", props: { text: "不该执行" } },
      ]),
    })
    expect(failed.json?.ok).toBe(false)
    expect(failed.json?.error.code).toBe("batch_failed")
    const detail = failed.json?.error.details.results as Array<{ status: string }>
    expect(detail.map((item) => item.status)).toEqual(["ok", "failed", "skipped"])
    expect(Buffer.compare(await readFile(file), before)).toBe(0)
  })

  test("batch：--keep-going 继续执行并汇总，--dry-run 不写盘", async () => {
    const root = await workspace()
    const file = path.join(root, "keep.docx")
    expect((await office({ action: "create", file, title: "x" })).json?.ok).toBe(true)

    const kept = await office({
      action: "batch",
      file,
      keepGoing: true,
      dryRun: true,
      commands: JSON.stringify([
        { set: "/body/p[99]", props: { text: "越界" } },
        { set: "/body/p[1]", props: { text: "还能改" } },
      ]),
    })
    expect(kept.json?.ok).toBe(false)
    expect(kept.json?.error.code).toBe("batch_failed")
    const results = kept.json?.error.details.results as Array<{ status: string }>
    expect(results.map((item) => item.status)).toEqual(["failed", "ok"])
    expect((await office({ action: "get", file, target: "/body/p[1]" })).json?.data.value.text).not.toBe("还能改")

    const dry = await office({
      action: "set",
      file,
      target: "/body/p[1]",
      value: "text=不落盘",
      dryRun: true,
    })
    expect(dry.json?.data.dryRun).toBe(true)
    expect(dry.json?.data.saved).toBe(false)
    expect((await office({ action: "get", file, target: "/body/p[1]" })).json?.data.value.text).not.toBe("不落盘")
  })

  test("--out 写到副本，原文件不动", async () => {
    const root = await workspace()
    const file = path.join(root, "source.docx")
    const copy = path.join(root, "copy.docx")
    expect((await office({ action: "create", file, title: "原稿" })).json?.ok).toBe(true)
    const original = await readFile(file)

    const result = await office({ action: "set", file, target: "/body/p[1]", value: "text=副本内容", out: copy })
    expect(result.json?.ok).toBe(true)
    expect(result.json?.data.path).toBe(copy)
    expect(result.json?.data.source).toBe(file)
    expect(Buffer.compare(await readFile(file), original)).toBe(0)
    expect((await office({ action: "get", file: copy, target: "/body/p[1]" })).json?.data.value.text).toBe("副本内容")
  })

  test("values:=[[…]] 从左上角铺开写单元格", async () => {
    const root = await workspace()
    const file = path.join(root, "matrix.xlsx")
    expect((await office({ action: "create", file })).json?.ok).toBe(true)

    const written = await office({
      action: "set",
      file,
      target: "/Sheet1/B2",
      value: 'values:=[["项目","金额"],["合计",120]]',
    })
    expect(written.json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/Sheet1/B2" })).json?.data.value.text).toBe("项目")
    expect((await office({ action: "get", file, target: "/Sheet1/C2" })).json?.data.value.text).toBe("金额")
    expect((await office({ action: "get", file, target: "/Sheet1/C3" })).json?.data.value.value).toBe(120)

    const viaOption = await office({
      action: "set",
      file,
      target: "/Sheet1/A1",
      values: JSON.stringify([["表头"], ["数据"]]),
    })
    expect(viaOption.json?.ok).toBe(true)
    expect((await office({ action: "get", file, target: "/Sheet1/A2" })).json?.data.value.text).toBe("数据")
  })

  test("/body/block[N]、/sheet[N] 和 shape[@id=…] 寻址", async () => {
    const root = await workspace()
    const doc = path.join(root, "alias.docx")
    expect((await office({ action: "create", file: doc, title: "标题" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file: doc, target: "/body/block[1]" })).json?.data.value.text).toBe("标题")

    const book = path.join(root, "alias.xlsx")
    expect((await office({ action: "create", file: book })).json?.ok).toBe(true)
    expect((await office({ action: "add", file: book, target: "/Sheet2", type: "sheet" })).json?.ok).toBe(true)
    expect((await office({ action: "set", file: book, target: "/sheet[2]", value: "name=汇总" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file: book, target: "/sheet[2]/A1" })).json?.ok).toBe(true)

    const deck = path.join(root, "alias.pptx")
    expect((await office({ action: "create", file: deck, title: "季度汇报" })).json?.ok).toBe(true)
    expect(
      (await office({ action: "add", file: deck, target: "/slide[1]", type: "textbox", text: "备注" })).json?.ok,
    ).toBe(true)
    const shapes = (await office({ action: "get", file: deck, target: "/slide[1]" })).json?.data.value.shapes as Array<{
      shapeId: string
      name?: string
    }>
    const target = shapes[1]!
    const byId = await office({ action: "get", file: deck, target: `/slide[1]/shape[@id=${target.shapeId}]` })
    expect(byId.json?.data.value.shapeId).toBe(target.shapeId)
    if (target.name) {
      const byName = await office({ action: "get", file: deck, target: `/slide[1]/shape[@name=${target.name}]` })
      expect(byName.json?.data.value.shapeId).toBe(target.shapeId)
    }
  })

  test("add --type heading / page / text 与 --before / --index 定位", async () => {
    const root = await workspace()
    const file = path.join(root, "head.doc.docx")
    expect((await office({ action: "create", file, title: "正文" })).json?.ok).toBe(true)

    expect(
      (await office({ action: "add", file, target: "/body/p[1]", type: "heading", text: "小节", level: 2 })).json?.ok,
    ).toBe(true)
    const heading = (await office({ action: "get", file, target: "/body/p[2]" })).json?.data.value
    expect(heading.text).toBe("小节")
    expect(heading.style).toBe("Heading2")

    expect(
      (await office({ action: "add", file, target: "/body", type: "paragraph", text: "最前", index: 1 })).json?.ok,
    ).toBe(true)
    expect((await office({ action: "get", file, target: "/body/p[1]" })).json?.data.value.text).toBe("最前")

    const pdf = path.join(root, "pages.pdf")
    expect((await office({ action: "create", file: pdf, title: "页" })).json?.ok).toBe(true)
    expect((await office({ action: "add", file: pdf, target: "/page[1]", type: "page" })).json?.ok).toBe(true)
    expect((await office({ action: "get", file: pdf, target: "/page[2]" })).json?.ok).toBe(true)
    expect(
      (await office({ action: "add", file: pdf, target: "/page[1]", type: "text", text: "叠加", x: 40, y: 60 })).json
        ?.ok,
    ).toBe(true)
  })

  test("help：agent / paths / props / 单条命令", async () => {
    expect((await office({ action: "help" })).json?.data.guide).toContain("novaway office")
    expect((await office({ action: "help", target: "paths" })).json?.data.guide).toContain("/slide[2]")
    expect((await office({ action: "help", target: "props" })).json?.data.guide).toContain("values")
    expect((await office({ action: "help", target: "batch" })).json?.data.guide).toContain("--keep-going")
    const miss = await office({ action: "help", target: "teleport" })
    expect(miss.json?.error.code).toBe("usage")
    expect(miss.json?.error.candidates).toContain("agent")
  })
})

// 加密样本和 core 的测试同源（独立实现生成并回读验证过）。
const ENCRYPTED_RC4_128 =
  "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0Ko01T3fiIyMQt9ZonG8uydmnsFLx63SILgJuV4phXULZfL7LcPWLBWuXF/Bm11UaUz3IKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvViAyIC9SIDMgL0xlbmd0aCAxMjggL08gPDBkYjU4NTVmYzUzMjY1NjllNzY1OTA2Y2FmNjRlNDQyOWE0YzIwZDZlOTk2ZmRlZjk2M2U5YjUwODBmOWUwODM+IC9VIDxjZDc2NTAxOTJkODQ3NWQ5NDc4ZDRjN2JjZDc0MjZiNzI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4PiAvUCAtMzkwNCA+PgplbmRvYmoKNyAwIG9iago8PCAvVGl0bGUgPGVmMWQ3ZjI1YWIyYmU2NzhkNzZkPiA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzNjggMDAwMDAgbiAKMDAwMDAwMDQ2NSAwMDAwMCBuIAowMDAwMDAwNjc1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzxhZGZlMjRmNDkzNDNkOTA3ZGE4ZTdjZjNiYTI1NDFlNT4gPDk1YTJkZmJjZWIyZWY3MTZiMWNhNWYxMGE2N2RkZTkwPl0gPj4Kc3RhcnR4cmVmCjcyNgolJUVPRgo="
const ENCRYPTED_AES_256_OBJSTM =
  "JVBERi0xLjcKJeLjz9MKNCAwIG9iago8PCAvTGVuZ3RoIDUwIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+CnN0cmVhbQozHCgin5um836N1IEvQ07qiNoZk0d02zhDlYQrorNPDjIL+X8/YGsstiPwEPP6jZq53K8Eeqc3oZ52iLYkocFf8RISu5gNjxLM+QvIfkC0OQplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvU3RhbmRhcmQgL1YgNSAvUiA2IC9MZW5ndGggMjU2IC9DRiA8PCAvU3RkQ0YgPDwgL0NGTSAvQUVTVjMgL0xlbmd0aCAzMiAvQXV0aEV2ZW50IC9Eb2NPcGVuID4+ID4+IC9TdG1GIC9TdGRDRiAvU3RyRiAvU3RkQ0YgL08gPDIxMDMxYzg2NDczN2MxYmQ4OGQ4MGEzZGE5YWM0NDIzY2FiMjRlMjY5NjkwMmM2MGUxOTI4YjZlNmNmN2U0MjQ0OTUxOWY4YzE2MmU3NTQ2MDY0ZDFkMzBlNGYyNGJkMz4gL1UgPDc0ZWNmODc0MTlhMmIxZjBmOWE1NjUwMmZiZWE1ZTNiNDU1N2M1NjNlMDkwNDA5OTE0Y2RkZTcyOTIwOGY3OWRkYjIzYWExNDk3MWU4MzQ0ODc0MTIzMzE0NDQzM2MwMT4gL09FIDxiMGMzNDI5YmEzZDgzMDEwODJmNzRiZjI4YmIxNzM2ZmE5YmFjMWNlOTkyZWU0NGY2OTkxZTE4ZWY4MDYyMmFhPiAvVUUgPDY5NjVhODY1MGZmOGEwMGI1YTBjMmIwM2JmMDVhNzM4YmY0M2E2ZmY4ZWQxNDlmMWNmZmU5ZGNlOTAyZjRkYzc+IC9QZXJtcyA8NzkwNjM1NTIwNDJkMTdkMjk0MDkzOWYzNDRhZWJlYjM+IC9QIC0zOTA0ID4+CmVuZG9iago3IDAgb2JqCjw8IC9UaXRsZSA8ODJmNGFjNWU0ZDJjNzdiOTI0MWExZjNjYWZhYmM0YzYxYTYxZTkyNjIzZjRmOTJkMzhhYTRhZTA4OGE0NzFjMT4gPj4KZW5kb2JqCjggMCBvYmoKPDwgL1R5cGUgL09ialN0bSAvTiA0IC9GaXJzdCAyMCAvTGVuZ3RoIDIwOCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KQq83H9tK90Ljrvi1gWJ+1y1D5AAj63XFwSBcoL+V53AYJi1Vla+ZQnXTTj0TovCmYdIJcGwGeCayvVwwZFGg81OvIoAdjEHExvFjckIGNCfN4uN2GzOCiX57TlGwCBcyHpv0Um6cQUrh3OX4mpI3cls4wW6Lz3jrbLjT4NiOxt4vVoBMyAoWCuhP5Ijlsa2EOZTjZTh3phhh8Mc7+modbFSTTIF7MVrnzP1QvJdAyB7gRKGUOo8vOg3ka6pMAxxrZ6koz++7ooSKpnl+Ox+n6gplbmRzdHJlYW0KZW5kb2JqCjkgMCBvYmoKPDwgL1R5cGUgL1hSZWYgL1NpemUgMTAgL1cgWzEgNCAyXSAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzw2YjEzNjBlMWYxNTA2ZTBjMWQ5MjFlNTRhMjc1Y2U4OD4gPDAwOWU5ZWFiYzM1NjUzOTUwYmNiY2M5NmM2MmYxM2I5Pl0gL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCA0OSA+PgpzdHJlYW0KeJxjYACC//+ZgCQHAwOEYoRQTIxAih8myAziLWNgAFJMZ8AUszaYYklgYAAAq/sERwplbmRzdHJlYW0KZW5kb2JqCnN0YXJ0eHJlZgoxMTIwCiUlRU9GCg=="

describe("加密 PDF 的 CLI", () => {
  test("没给密码时返回 password_required", async () => {
    const root = await workspace()
    const file = path.join(root, "secret.pdf")
    await writeFile(file, Buffer.from(ENCRYPTED_RC4_128, "base64"))
    const result = await office({ action: "info", file })
    expect(result.json?.ok).toBe(false)
    expect(result.json?.error.code).toBe("password_required")
    expect(String(result.json?.error.suggestion)).toContain("--password")
  })

  test("--password 能读、能改；写回后不再加密", async () => {
    const root = await workspace()
    const file = path.join(root, "secret.pdf")
    await writeFile(file, Buffer.from(ENCRYPTED_RC4_128, "base64"))

    const info = await office({ action: "info", file, password: "secret" })
    expect(info.json?.ok).toBe(true)
    expect(info.json?.data.encrypted).toBe(true)
    expect(info.json?.data.protection).toBe("rc4")

    const view = await office({ action: "view", file, target: "text", password: "secret" })
    expect(view.json?.ok).toBe(true)
    expect(String(view.json?.data.text)).toContain("Secret page")

    const set = await office({ action: "set", file, target: "/page[1]", value: "rotation=90", password: "secret" })
    expect(set.json?.ok).toBe(true)
    expect(set.json?.data.saved).toBe(true)

    // 写回的是未加密 PDF：后续不带密码也能打开。
    const after = await readFile(file)
    expect(Buffer.from(after).includes("/Encrypt")).toBe(false)
    const plain = await office({ action: "info", file })
    expect(plain.json?.ok).toBe(true)
    expect(plain.json?.data.encrypted).toBeUndefined()
  })

  test("所有者密码可用；密码错误明确失败", async () => {
    const root = await workspace()
    const file = path.join(root, "owner.pdf")
    await writeFile(file, Buffer.from(ENCRYPTED_RC4_128, "base64"))
    expect((await office({ action: "info", file, password: "owner" })).json?.ok).toBe(true)
    const wrong = await office({ action: "info", file, password: "nope" })
    expect(wrong.json?.ok).toBe(false)
    expect(wrong.json?.error.code).toBe("password_required")
  })

  test("对象流 + 交叉引用流的 AES-256 文件也能读", async () => {
    const root = await workspace()
    const file = path.join(root, "objstm.pdf")
    await writeFile(file, Buffer.from(ENCRYPTED_AES_256_OBJSTM, "base64"))
    const view = await office({ action: "view", file, target: "text", password: "secret" })
    expect(view.json?.ok).toBe(true)
    expect(String(view.json?.data.text)).toContain("Secret page")
  })

  test("export --pages 也能带密码", async () => {
    const root = await workspace()
    const file = path.join(root, "extract.pdf")
    const out = path.join(root, "page1.pdf")
    await writeFile(file, Buffer.from(ENCRYPTED_RC4_128, "base64"))
    const result = await office({ action: "export", file, target: out, page: 1, password: "secret" })
    expect(result.json?.ok).toBe(true)
    const extracted = await PDFDocument.load(new Uint8Array(await readFile(out)))
    expect(extracted.getPageCount()).toBe(1)
  })
})

describe("PNG 导出（export <文件> out.png --page N）", () => {
  test("PDF → PNG：第一页就是一张真图片", async () => {
    const root = await workspace()
    const file = path.join(root, "slide.pdf")
    const doc = await PDFDocument.create()
    doc.addPage([300, 200])
    await writeFile(file, await doc.save())
    const out = path.join(root, "slide.png")
    const result = await office({ action: "export", file, target: out })
    expect(result.json?.ok).toBe(true)
    expect(result.json?.data.format).toBe("png")
    expect(result.json?.data.page).toBe(1)
    expect(result.json?.data.width).toBe(600)
    const png = new Uint8Array(await readFile(out))
    // PNG 签名 + IHDR 里的宽高，确认是真画出来的位图而不是随便写的字节。
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(new DataView(png.buffer).getUint32(16)).toBe(600)
  })

  test("DOCX → PNG：先按打印排版再出图", async () => {
    const root = await workspace()
    const file = path.join(root, "report.docx")
    expect((await office({ action: "create", file, title: "季度报告", body: "第一段" })).json?.ok).toBe(true)
    const out = path.join(root, "report.png")
    const result = await office({ action: "export", file, target: out, scale: 1 })
    expect(result.json?.ok).toBe(true)
    // A4 宽 595.28pt，向上取整成像素。
    expect(result.json?.data.width).toBe(596)
    expect(result.json?.data.bytes).toBeGreaterThan(1000)
  })

  test("加密 PDF 出图：先给密码，没给就报 password_required", async () => {
    const root = await workspace()
    const file = path.join(root, "secret-page.pdf")
    await writeFile(file, Buffer.from(ENCRYPTED_RC4_128, "base64"))
    const out = path.join(root, "secret-page.png")

    const missing = await office({ action: "export", file, target: out })
    expect(missing.json?.ok).toBe(false)
    expect(missing.json?.error.code).toBe("password_required")

    const ok = await office({ action: "export", file, target: out, password: "secret" })
    expect(ok.json?.ok).toBe(true)
    const png = new Uint8Array(await readFile(out))
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  test("页码越界时说清楚，而不是写出空白图", async () => {
    const root = await workspace()
    const file = path.join(root, "one.pdf")
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    await writeFile(file, await doc.save())
    const result = await office({ action: "export", file, target: path.join(root, "p9.png"), page: 9 })
    expect(result.json?.ok).toBe(false)
    expect(String(result.json?.error.message)).toContain("页码")
  })
})
