import { describe, expect, test } from "bun:test"
import { PDFArray, PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib"
import {
  createPdf,
  extractPdfImages,
  extractPdfPages,
  mergePdfPages,
  pdfEngine,
  readPdfPageText,
  readPdfText,
  splitPdfPages,
} from "../../src/office/pdf/engine"
import { engineFor } from "../../src/office/engine/registry"

async function fixture(pages = 2) {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pages; index += 1) {
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("page " + (index + 1), { x: 50, y: 700, size: 20, font, color: rgb(0, 0, 0) })
  }
  return new Uint8Array(await doc.save())
}

/** 一张 1×1 的最小 JPEG（pdf-lib 的 embedJpg 能直接吃）。 */
async function makeJpeg(): Promise<Uint8Array> {
  const base64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
  return new Uint8Array(Buffer.from(base64, "base64"))
}

async function run(bytes: Uint8Array, ops: Parameters<typeof pdfEngine.apply>[1]) {
  const opened = await pdfEngine.open(bytes)
  if (!opened.ok) throw new Error(opened.error.message)
  const applied = await pdfEngine.apply(opened.data, ops, bytes)
  if (!applied.ok) throw new Error(applied.error.message)
  return { state: applied.data.state, bytes: applied.data.bytes }
}

describe("PDF 引擎", () => {
  test("注册表把 .pdf 交给 PDF 引擎", () => {
    expect(engineFor("pdf")).toBe(pdfEngine)
  })

  test("读出页数与页面尺寸", async () => {
    const opened = await pdfEngine.open(await fixture(3))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.data.pages.map((page) => page.page)).toEqual([1, 2, 3])
    expect(Math.round(opened.data.pages[0]!.width)).toBe(595)
  })

  test("删除页面；只剩一页时拒绝", async () => {
    const result = await run(await fixture(2), [{ op: "deletePage", page: 1 }])
    expect(result.state.pages.length).toBe(1)

    const single = await run(await fixture(1), [{ op: "deletePage", page: 1 }]).catch((error) => error)
    expect(single instanceof Error).toBe(true)
  })

  test("调序：第 1 页挪到第 2 页", async () => {
    const result = await run(await fixture(3), [{ op: "movePage", from: 1, to: 2 }])
    expect(result.state.pages.length).toBe(3)
  })

  test("旋转页面", async () => {
    const result = await run(await fixture(2), [{ op: "rotatePage", page: 1, degrees: 90 }])
    expect(result.state.pages[0]!.rotation).toBe(90)
    const bad = await run(await fixture(2), [{ op: "rotatePage", page: 1, degrees: 45 }]).catch((error) => error)
    expect(bad instanceof Error).toBe(true)
  })

  test("插入空白页，尺寸默认沿用相邻页", async () => {
    const result = await run(await fixture(2), [{ op: "insertBlankPage", after: 1 }])
    expect(result.state.pages.length).toBe(3)
    expect(Math.round(result.state.pages[1]!.width)).toBe(595)
  })

  test("从另一份 PDF 插入页面（按给定顺序，原文件不变）", async () => {
    const source = await PDFDocument.create()
    source.addPage([300, 300])
    source.addPage([400, 400])
    source.addPage([500, 500])
    const sourceBytes = new Uint8Array(await source.save())

    const target = await fixture(2)
    const result = await run(target, [
      {
        op: "insertPdfPages",
        after: 1,
        dataBase64: Buffer.from(sourceBytes).toString("base64"),
        pages: [3, 1],
      },
    ])
    expect(result.state.pages.length).toBe(4)
    // 插在第 1 页之后：原第 1 页、源第 3 页、源第 1 页、原第 2 页。
    expect(Math.round(result.state.pages[0]!.width)).toBe(595)
    expect(Math.round(result.state.pages[1]!.width)).toBe(500)
    expect(Math.round(result.state.pages[2]!.width)).toBe(300)
    expect(Math.round(result.state.pages[3]!.width)).toBe(595)

    const bad = await run(target, [
      { op: "insertPdfPages", after: 0, dataBase64: Buffer.from(sourceBytes).toString("base64"), pages: [9] },
    ]).catch((error) => error)
    expect(bad instanceof Error).toBe(true)
    expect((bad as Error).message).toContain("第 9 页")
  })

  test("叠加文字（Latin）", async () => {
    const before = await fixture(1)
    const result = await run(before, [
      { op: "addPageText", page: 1, text: "Approved", x: 40, y: 40, size: 18, color: "2563EB" },
    ])
    expect(result.bytes.length).toBeGreaterThan(before.length)
  })

  test("中文叠加文字走预定义 CID 字体，不再拒绝", async () => {
    const before = await fixture(1)
    const result = await run(before, [{ op: "addPageText", page: 1, text: "已审核", x: 40, y: 40, size: 14 }])
    expect(result.bytes.length).toBeGreaterThan(before.length)

    const doc = await PDFDocument.load(result.bytes)
    const resources = doc.getPage(0).node.Resources()
    const fonts = doc.context.lookup(resources!.get(PDFName.of("Font")))
    expect(fonts).toBeInstanceOf(PDFDict)
    const dict = fonts as PDFDict
    const key = dict.keys().find((item) => item.toString().includes("STSong-Light"))
    expect(key).toBeDefined()
    const font = dict.lookup(key!) as PDFDict
    expect(String(font.get(PDFName.of("Subtype")))).toBe("/Type0")
    expect(String(font.get(PDFName.of("Encoding")))).toBe("/UniGB-UCS2-H")

    // Registry / Ordering 必须是字符串：pdf.js 一类阅读器会拿它们拼
    // `Adobe-GB1-UCS2` 去查 CMap，写成名字会拼出空串、整段中文丢字。
    const descendant = (font.lookup(PDFName.of("DescendantFonts")) as PDFArray).lookup(0) as PDFDict
    const system = descendant.lookup(PDFName.of("CIDSystemInfo")) as PDFDict
    expect(String(system.lookup(PDFName.of("Registry")))).toBe("(Adobe)")
    expect(String(system.lookup(PDFName.of("Ordering")))).toBe("(GB1)")
    // ASCII 的宽度表：`123.45` 不该被排成方块。
    const widths = descendant.lookup(PDFName.of("W")) as PDFArray
    expect(Number(widths.size())).toBe(2)
  })

  test("批注写进页面的 Annots", async () => {
    const result = await run(await fixture(1), [
      { op: "annotatePage", page: 1, kind: "highlight", x: 60, y: 90, width: 120, height: 18, color: "FFE066" },
    ])
    const doc = await PDFDocument.load(result.bytes)
    const annots = doc.getPage(0).node.Annots()
    expect(annots?.size()).toBe(1)
    // Annots 里存的是对象引用，顺着引用看注解本身。
    const ref = annots!.get(0)
    const annot = doc.context.lookup(ref) as unknown as { get(name: unknown): unknown }
    expect(String(annot.get(PDFName.of("Subtype")))).toBe("/Highlight")
  })

  test("文本框 / 形状 / 回复批注都能写进去", async () => {
    const first = await run(await fixture(1), [
      {
        op: "annotatePage",
        page: 1,
        kind: "text",
        x: 40,
        y: 40,
        width: 160,
        height: 30,
        contents: "已核对",
        id: "n1",
        fontSize: 12,
      },
    ])
    const second = await run(first.bytes, [
      { op: "annotatePage", page: 1, kind: "square", x: 60, y: 90, width: 120, height: 60, color: "DC2626" },
      { op: "annotatePage", page: 1, kind: "circle", x: 80, y: 120, width: 60, height: 60 },
      { op: "annotatePage", page: 1, kind: "line", x: 20, y: 20, width: 100, height: 40 },
      {
        op: "annotatePage",
        page: 1,
        kind: "note",
        x: 30,
        y: 30,
        width: 16,
        height: 16,
        contents: "回复",
        replyTo: "n1",
      },
    ])
    const doc = await PDFDocument.load(second.bytes)
    const annots = doc.getPage(0).node.Annots()!
    expect(annots.size()).toBe(5)
    const subtypes = annots.asArray().map((ref) => {
      const annot = doc.context.lookup(ref) as unknown as { get(name: unknown): unknown }
      return String(annot.get(PDFName.of("Subtype")))
    })
    expect(subtypes).toContain("/FreeText")
    expect(subtypes).toContain("/Square")
    expect(subtypes).toContain("/Circle")
    expect(subtypes).toContain("/Line")
  })

  test("回复不存在的批注时报错", async () => {
    const error = await run(await fixture(1), [
      { op: "annotatePage", page: 1, kind: "note", x: 30, y: 30, width: 16, height: 16, replyTo: "missing" },
    ]).catch((value) => value)
    expect(error instanceof Error).toBe(true)
  })

  test("提取内嵌图片（JPEG 原样带走）", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const jpeg = await makeJpeg()
    const image = await doc.embedJpg(jpeg)
    page.drawImage(image, { x: 40, y: 600, width: 80, height: 80 })
    const bytes = new Uint8Array(await doc.save())
    const images = await extractPdfImages(bytes)
    expect(images.length).toBe(1)
    expect(images[0]!.mime).toBe("image/jpeg")
    expect(images[0]!.page).toBe(1)
    expect(images[0]!.data.length).toBeGreaterThan(100)
  })

  test("换掉页面上的图片：内容流不动，资源里的图像对象被替换", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    page.drawImage(await doc.embedJpg(await makeJpeg()), { x: 40, y: 600, width: 80, height: 80 })
    const bytes = new Uint8Array(await doc.save())

    const { default: UPNG } = await import("@pdf-lib/upng")
    const rgba = new Uint8Array(4 * 3 * 4).fill(200)
    const png = new Uint8Array(UPNG.encode([rgba.buffer as ArrayBuffer], 4, 3, 0))
    const result = await run(bytes, [
      { op: "replacePageImage", page: 1, dataBase64: Buffer.from(png).toString("base64"), mime: "image/png" },
    ])

    const images = await extractPdfImages(result.bytes)
    expect(images.length).toBe(1)
    expect(images[0]!.width).toBe(4)
    expect(images[0]!.height).toBe(3)
  })

  test("换图片时页面上没有这么多图会报错", async () => {
    const error = await run(await fixture(1), [
      {
        op: "replacePageImage",
        page: 1,
        index: 2,
        dataBase64: Buffer.from(await makeJpeg()).toString("base64"),
        mime: "image/jpeg",
      },
    ]).catch((value) => value)
    expect(error instanceof Error).toBe(true)
  })

  test("填写 AcroForm 文本字段", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const form = doc.getForm()
    const field = form.createTextField("name")
    field.setText("old")
    field.addToPage(page, { x: 50, y: 700, width: 200, height: 24 })
    const bytes = new Uint8Array(await doc.save())

    const result = await run(bytes, [{ op: "fillForm", fields: [{ name: "name", value: "Alice" }] }])
    expect(result.state.fields.find((item) => item.name === "name")?.value).toBe("Alice")
  })

  test("不认识的字段名报错", async () => {
    const error = await run(await fixture(1), [{ op: "fillForm", fields: [{ name: "nope", value: "x" }] }]).catch(
      (value) => value,
    )
    expect(error instanceof Error).toBe(true)
  })

  test("裁切页面：四边各裁掉指定 pt", async () => {
    const bytes = await fixture(1)
    const result = await run(bytes, [{ op: "cropPage", page: 1, left: 20, right: 20, top: 10, bottom: 10 }])
    const doc = await PDFDocument.load(result.bytes)
    const box = doc.getPage(0).getCropBox()
    expect(Math.round(box.width)).toBe(555)
    expect(Math.round(box.height)).toBe(822)
  })

  test("裁切过度时报错", async () => {
    const error = await run(await fixture(1), [{ op: "cropPage", page: 1, left: 400, right: 400 }]).catch(
      (value) => value,
    )
    expect(error instanceof Error).toBe(true)
  })

  test("提取页面：只留指定页，且页序按传入顺序", async () => {
    const bytes = await fixture(4)
    const extracted = await extractPdfPages(bytes, [3, 1])
    const doc = await PDFDocument.load(extracted)
    expect(doc.getPageCount()).toBe(2)
  })

  test("切分页面：每份页数固定，最后一份可以不足", async () => {
    const parts = await splitPdfPages(await fixture(5), 2)
    expect(parts.length).toBe(3)
    const counts: number[] = []
    for (const part of parts) counts.push((await PDFDocument.load(part)).getPageCount())
    expect(counts).toEqual([2, 2, 1])
  })

  test("读出每页文字（Latin + 中文）", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("Source invoice 123.45", { x: 50, y: 700, size: 18, font })
    page.drawText("Second line", { x: 50, y: 660, size: 12, font })
    const latin = await readPdfText(new Uint8Array(await doc.save()))
    expect(latin.length).toBe(1)
    expect(latin[0]!.text).toContain("Source invoice 123.45")
    expect(latin[0]!.text.split("\n")[1]).toBe("Second line")

    const chinese = await createPdf({ title: "发票", body: "金额已核对，共计123.45元" })
    const cjk = await readPdfText(chinese)
    expect(cjk[0]!.text).toContain("金额已核对，共计123.45元")

    const single = await readPdfPageText(chinese, 1)
    expect(single).toContain("发票")
    expect(await readPdfPageText(chinese, 9)).toBeUndefined()
  })

  test("合并多份 PDF：页数和顺序都对", async () => {
    const docA = await PDFDocument.create()
    docA.addPage([300, 300])
    const docB = await PDFDocument.create()
    docB.addPage([400, 400])
    docB.addPage([500, 500])
    const merged = await mergePdfPages([new Uint8Array(await docA.save()), new Uint8Array(await docB.save())])
    const result = await PDFDocument.load(merged)
    expect(result.getPageCount()).toBe(3)
    expect(Math.round(result.getPage(0).getWidth())).toBe(300)
    expect(Math.round(result.getPage(1).getWidth())).toBe(400)
    expect(Math.round(result.getPage(2).getWidth())).toBe(500)
  })

  test("提取越界页码时报错", async () => {
    const error = await extractPdfPages(await fixture(2), [9]).catch((value) => value)
    expect(error instanceof Error).toBe(true)
  })

  test("PDF 没有文本导出", async () => {
    const bytes = await fixture(1)
    const opened = await pdfEngine.open(bytes)
    if (!opened.ok) return
    const exported = await pdfEngine.export!(opened.data, "txt", bytes)
    expect(exported.ok).toBe(false)
  })
})

describe("PDF 原地改字", () => {
  async function contentText(bytes: Uint8Array): Promise<string> {
    const doc = await PDFDocument.load(bytes)
    const contents = doc.getPage(0).node.Contents()
    const { PDFArray, PDFRef, PDFRawStream, decodePDFRawStream } = await import("pdf-lib")
    const streams: Uint8Array[] = []
    const collect = (value: unknown) => {
      if (value instanceof PDFRef) {
        const looked = doc.context.lookup(value)
        if (looked instanceof PDFRawStream) streams.push(decodePDFRawStream(looked).decode())
      } else if (value instanceof PDFRawStream) streams.push(decodePDFRawStream(value).decode())
    }
    if (contents instanceof PDFArray) {
      for (let index = 0; index < contents.size(); index += 1) collect(contents.get(index))
    } else collect(contents)
    const raw = streams.map((bytes) => new TextDecoder("windows-1252").decode(bytes)).join("\n")
    // 内容流里的字符串可能是字面量，也可能是十六进制（单字节 / UTF-16BE）。
    const hexes = [...raw.matchAll(/<([0-9A-Fa-f]+)>/g)].flatMap((match) => {
      const clean = match[1]!.length % 2 === 0 ? match[1]! : match[1]! + "0"
      let latin = ""
      let wide = ""
      for (let index = 0; index < clean.length; index += 2) {
        const byte = Number.parseInt(clean.slice(index, index + 2), 16)
        latin += String.fromCharCode(byte)
        if (index + 3 < clean.length) {
          wide += String.fromCharCode((byte << 8) | Number.parseInt(clean.slice(index + 2, index + 4), 16))
        }
      }
      return [latin, wide]
    })
    return [raw, ...hexes].join("\n")
  }

  test("拉丁文字：字体和位置不变，只换字符串", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("Hello World", { x: 50, y: 700, size: 20, font })
    const bytes = new Uint8Array(await doc.save())

    const result = await run(bytes, [{ op: "replacePageText", page: 1, find: "World", replace: "NovaWay" }])
    const text = await contentText(result.bytes)
    expect(text).toContain("NovaWay")
    expect(text).not.toContain("World")
    expect(text).toContain("20") // 字号操作数还在
  })

  test("中文：十六进制 UTF-16BE 字符串也能替换", async () => {
    const { drawCjkLines } = await import("../../src/office/pdf/cjk-font")
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    drawCjkLines(page, doc, { text: "季度汇报", x: 50, top: 100, size: 20 })
    const bytes = new Uint8Array(await doc.save())

    const result = await run(bytes, [{ op: "replacePageText", page: 1, find: "汇报", replace: "总结" }])
    const text = await contentText(result.bytes)
    expect(text).toContain("603B7ED3")
    expect(text).not.toContain("6C4762A5")
  })

  test("找不到时明确报错，不改文件", async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595, 842])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    page.drawText("Hello", { x: 50, y: 700, size: 20, font })
    const bytes = new Uint8Array(await doc.save())
    const error = await run(bytes, [{ op: "replacePageText", page: 1, find: "Missing", replace: "x" }]).catch(
      (value) => value,
    )
    expect(error instanceof Error).toBe(true)
    expect(String(error)).toContain("没有找到")
  })
})

// 四种标准加密的真实样本（RC4-40 / RC4-128 / AES-128 / AES-256，最后一份用对象流 + 交叉引用流），
// 由独立实现（PyPDF2 + pycryptodome）生成并回读验证。用它们保证我们的解密器和别的实现互操作，
// 而不是「自己加密、自己解密」式的自洽测试。
const ENCRYPTED_FIXTURES: Record<string, string> = {
  "rc4-40":
    "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0Kdp9hIVYDoTYaDwsdLh0+jKe6IVyMN8NluAqqwln+E+vXJFnUhpeEdzxn2OS3z0ZnKYsKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvViAxIC9SIDIgL08gPDkyZmUwZjQ0NTRhZDRjOTY0NDY5M2YzM2MwN2NiNTRmNTg3ZGNlMWUyNjgyZmU5ZWNlYTYxMDdhMWVmNjMwZGQ+IC9VIDw5OTZlMDI2YTAyM2JiOGQxOWQzMGI5MzIxNmQzN2Y3ZWJhY2I2ZTczNzJjMTIzMzk3MmU3MWRmMjAxZDhkOTJmPiAvUCAtMzkwNCA+PgplbmRvYmoKNyAwIG9iago8PCAvVGl0bGUgPGE5ZGUzY2Y3NGJhZmU5NmViOWExPiA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzNjggMDAwMDAgbiAKMDAwMDAwMDQ2NSAwMDAwMCBuIAowMDAwMDAwNjYzIDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzwxN2Q3ODlkYzgxMjFmOTAyNjVhZTQ3N2MxMzg4YmUwMj4gPDk3NTFhY2QwZDA5NDM3OGNlMmRkNGViYmI3YmE2MTVkPl0gPj4Kc3RhcnR4cmVmCjcxNAolJUVPRgo=",
  "rc4-128":
    "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0Ko01T3fiIyMQt9ZonG8uydmnsFLx63SILgJuV4phXULZfL7LcPWLBWuXF/Bm11UaUz3IKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvViAyIC9SIDMgL0xlbmd0aCAxMjggL08gPDBkYjU4NTVmYzUzMjY1NjllNzY1OTA2Y2FmNjRlNDQyOWE0YzIwZDZlOTk2ZmRlZjk2M2U5YjUwODBmOWUwODM+IC9VIDxjZDc2NTAxOTJkODQ3NWQ5NDc4ZDRjN2JjZDc0MjZiNzI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4PiAvUCAtMzkwNCA+PgplbmRvYmoKNyAwIG9iago8PCAvVGl0bGUgPGVmMWQ3ZjI1YWIyYmU2NzhkNzZkPiA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzNjggMDAwMDAgbiAKMDAwMDAwMDQ2NSAwMDAwMCBuIAowMDAwMDAwNjc1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzxhZGZlMjRmNDkzNDNkOTA3ZGE4ZTdjZjNiYTI1NDFlNT4gPDk1YTJkZmJjZWIyZWY3MTZiMWNhNWYxMGE2N2RkZTkwPl0gPj4Kc3RhcnR4cmVmCjcyNgolJUVPRgo=",
  "aes-128":
    "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA4MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0Kytiuao5b4Ml8QHO14vP6fQvzdO0a/vCzb+LpJAAElYmzEaTHLL1UHENyyzo9Bq8QsD1WLaDYbhhSmcw9W6qsZTi5htFrYcqQJ2UwC25QErMKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvViA0IC9SIDQgL0xlbmd0aCAxMjggL0NGIDw8IC9TdGRDRiA8PCAvQ0ZNIC9BRVNWMiAvTGVuZ3RoIDE2IC9BdXRoRXZlbnQgL0RvY09wZW4gPj4gPj4gL1N0bUYgL1N0ZENGIC9TdHJGIC9TdGRDRiAvTyA8MGRiNTg1NWZjNTMyNjU2OWU3NjU5MDZjYWY2NGU0NDI5YTRjMjBkNmU5OTZmZGVmOTYzZTliNTA4MGY5ZTA4Mz4gL1UgPDQ1NTVkMDRjYjMxZjIxZGRhY2I3M2M4ZmNlN2Y0M2RkMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+IC9QIC0zOTA0ID4+CmVuZG9iago3IDAgb2JqCjw8IC9UaXRsZSA8ODc1N2ZhMmNjNzI1ZTcwNjRhMDMxNDQxYzVlYmJlZWI0NDQ5MWIwM2M3ZDhiNDg4NTU0NmYyOWMzMDA4NzliNz4gPj4KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzk4IDAwMDAwIG4gCjAwMDAwMDA0OTUgMDAwMDAgbiAKMDAwMDAwMDc5NyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDggL1Jvb3QgMSAwIFIgL0luZm8gNyAwIFIgL0VuY3J5cHQgNiAwIFIgL0lEIFs8MDIxMGFmYTlhNGVlNDIyNzM1MTRlYjI3MzZhOGRmYTI+IDwyNDMwNDBjZDJhMTZjMTczYTJlOGIxMjAyNDJmMTcxZj5dID4+CnN0YXJ0eHJlZgo4OTIKJSVFT0YK",
  "aes-256":
    "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA4MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KDnNPcIv9s2lWZK5pl1KCho43g/nPZ4woGMmjJySsYtMOgxAW8kSuVQ9SVS3ZCslxNRFMnstZCDhlvXZ7yrNrsmAw4d0x/SSK7zedpHfnTv4KZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvViA1IC9SIDYgL0xlbmd0aCAyNTYgL0NGIDw8IC9TdGRDRiA8PCAvQ0ZNIC9BRVNWMyAvTGVuZ3RoIDMyIC9BdXRoRXZlbnQgL0RvY09wZW4gPj4gPj4gL1N0bUYgL1N0ZENGIC9TdHJGIC9TdGRDRiAvTyA8OGIyY2E5NDQ3ZDUzMjBiZjY0NjQwZThmNTY4YjdiMmM4ZWZjYTViNWYzMWEyMjM0YmUyYjUxMGE0MGIxYWE4MmQzZDZiZWViYjM3ZmNjOGMxOGFiZmQyYmQyYzI2N2Q0PiAvVSA8YjQyODAwZDQ2MjAyYjViOTljYTA5NGM0NDMwZTJiYTMwNTc0NGE1Mzc3ZDY0MDQyZTY2YmI0MDJmNDNjZTczOWQ3ZjA2ZGVhYmZjNDAyNWYyYjZjZjYxNDI0YjdjNDBlPiAvT0UgPGMyNzU1ZTRiY2JhYTlhY2VmYTlhMTMwYzUzMDUwNzJkMzcwZTBjMzNmNWZmMzJlNWViMWRkMmZlZTIzZjljNDI+IC9VRSA8YmZkZDYxNzcyZmMzYmMwZGE5OGEzZWRiNmMyODE2NTA5ZTEzMzdmMmJkN2QzOTQ1ZThjZmExZmM1NWFiYWVhYj4gL1Blcm1zIDw0YjFmYTBhZWEzMzRmYjNlNDJmYjEyYzU2ZDFlZWVmYz4gL1AgLTM5MDQgPj4KZW5kb2JqCjcgMCBvYmoKPDwgL1RpdGxlIDwwMzM3NzYwNmE5NGVkNGRhMDZmNjZmZDFlMDAxNzZiMDY1ZTZkNGMxOWYzNjcwMmRkMWY5YzY1YmY0ZmJkMDQyPiA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzOTggMDAwMDAgbiAKMDAwMDAwMDQ5NSAwMDAwMCBuIAowMDAwMDAxMDQ1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzxkMjYyZDNjYmIwZTBmN2FiNzE1ZDQ1NmYyZjQ3NDY1Yz4gPGFkYzZiYTk0ZWI4MmY4MDYzMDY0NjZmYzM5MzhmYzViPl0gPj4Kc3RhcnR4cmVmCjExNDAKJSVFT0YK",
  "aes-256-objstm":
    "JVBERi0xLjcKJeLjz9MKNCAwIG9iago8PCAvTGVuZ3RoIDUwIC9GaWx0ZXIgL0ZsYXRlRGVjb2RlID4+CnN0cmVhbQozHCgin5um836N1IEvQ07qiNoZk0d02zhDlYQrorNPDjIL+X8/YGsstiPwEPP6jZq53K8Eeqc3oZ52iLYkocFf8RISu5gNjxLM+QvIfkC0OQplbmRzdHJlYW0KZW5kb2JqCjYgMCBvYmoKPDwgL0ZpbHRlciAvU3RhbmRhcmQgL1YgNSAvUiA2IC9MZW5ndGggMjU2IC9DRiA8PCAvU3RkQ0YgPDwgL0NGTSAvQUVTVjMgL0xlbmd0aCAzMiAvQXV0aEV2ZW50IC9Eb2NPcGVuID4+ID4+IC9TdG1GIC9TdGRDRiAvU3RyRiAvU3RkQ0YgL08gPDIxMDMxYzg2NDczN2MxYmQ4OGQ4MGEzZGE5YWM0NDIzY2FiMjRlMjY5NjkwMmM2MGUxOTI4YjZlNmNmN2U0MjQ0OTUxOWY4YzE2MmU3NTQ2MDY0ZDFkMzBlNGYyNGJkMz4gL1UgPDc0ZWNmODc0MTlhMmIxZjBmOWE1NjUwMmZiZWE1ZTNiNDU1N2M1NjNlMDkwNDA5OTE0Y2RkZTcyOTIwOGY3OWRkYjIzYWExNDk3MWU4MzQ0ODc0MTIzMzE0NDQzM2MwMT4gL09FIDxiMGMzNDI5YmEzZDgzMDEwODJmNzRiZjI4YmIxNzM2ZmE5YmFjMWNlOTkyZWU0NGY2OTkxZTE4ZWY4MDYyMmFhPiAvVUUgPDY5NjVhODY1MGZmOGEwMGI1YTBjMmIwM2JmMDVhNzM4YmY0M2E2ZmY4ZWQxNDlmMWNmZmU5ZGNlOTAyZjRkYzc+IC9QZXJtcyA8NzkwNjM1NTIwNDJkMTdkMjk0MDkzOWYzNDRhZWJlYjM+IC9QIC0zOTA0ID4+CmVuZG9iago3IDAgb2JqCjw8IC9UaXRsZSA8ODJmNGFjNWU0ZDJjNzdiOTI0MWExZjNjYWZhYmM0YzYxYTYxZTkyNjIzZjRmOTJkMzhhYTRhZTA4OGE0NzFjMT4gPj4KZW5kb2JqCjggMCBvYmoKPDwgL1R5cGUgL09ialN0bSAvTiA0IC9GaXJzdCAyMCAvTGVuZ3RoIDIwOCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0KQq83H9tK90Ljrvi1gWJ+1y1D5AAj63XFwSBcoL+V53AYJi1Vla+ZQnXTTj0TovCmYdIJcGwGeCayvVwwZFGg81OvIoAdjEHExvFjckIGNCfN4uN2GzOCiX57TlGwCBcyHpv0Um6cQUrh3OX4mpI3cls4wW6Lz3jrbLjT4NiOxt4vVoBMyAoWCuhP5Ijlsa2EOZTjZTh3phhh8Mc7+modbFSTTIF7MVrnzP1QvJdAyB7gRKGUOo8vOg3ka6pMAxxrZ6koz++7ooSKpnl+Ox+n6gplbmRzdHJlYW0KZW5kb2JqCjkgMCBvYmoKPDwgL1R5cGUgL1hSZWYgL1NpemUgMTAgL1cgWzEgNCAyXSAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzw2YjEzNjBlMWYxNTA2ZTBjMWQ5MjFlNTRhMjc1Y2U4OD4gPDAwOWU5ZWFiYzM1NjUzOTUwYmNiY2M5NmM2MmYxM2I5Pl0gL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCA0OSA+PgpzdHJlYW0KeJxjYACC//+ZgCQHAwOEYoRQTIxAih8myAziLWNgAFJMZ8AUszaYYklgYAAAq/sERwplbmRzdHJlYW0KZW5kb2JqCnN0YXJ0eHJlZgoxMTIwCiUlRU9GCg==",
}

function encryptedFixture(name: string): Uint8Array {
  return new Uint8Array(Buffer.from(ENCRYPTED_FIXTURES[name]!, "base64"))
}

describe("加密 PDF：--password", () => {
  for (const name of Object.keys(ENCRYPTED_FIXTURES)) {
    test(`${name}：输密码打开、读文字、另存后不再加密`, async () => {
      const bytes = encryptedFixture(name)

      // 没给密码：明确告诉调用方要补 --password。
      const locked = await pdfEngine.open(bytes)
      expect(locked.ok).toBe(false)
      if (!locked.ok) expect(locked.error.code).toBe("password_required")

      const opened = await pdfEngine.open(bytes, { password: "secret" })
      expect(opened.ok).toBe(true)
      if (!opened.ok) return
      expect(opened.data.encrypted).toBe(true)
      expect(opened.data.pages).toHaveLength(1)

      const texts = await readPdfText(bytes, undefined, "secret")
      expect(texts[0]?.text).toContain("Secret page")

      const applied = await pdfEngine.apply(opened.data, [{ op: "rotatePage", page: 1, degrees: 90 }], bytes, {
        password: "secret",
      })
      expect(applied.ok).toBe(true)
      if (!applied.ok) return
      // 写回的是解密后的普通 PDF：不用密码也能继续读。
      expect(applied.data.state.encrypted).toBeUndefined()
      const after = await readPdfText(applied.data.bytes)
      expect(after[0]?.text).toContain("Secret page")
    })
  }

  test("所有者密码也能打开", async () => {
    const opened = await pdfEngine.open(encryptedFixture("aes-256"), { password: "owner" })
    expect(opened.ok).toBe(true)
  })

  test("密码不对时明确报错，不返回半成品", async () => {
    const opened = await pdfEngine.open(encryptedFixture("rc4-128"), { password: "nope" })
    expect(opened.ok).toBe(false)
    if (!opened.ok) {
      expect(opened.error.code).toBe("password_required")
      expect(opened.error.message).toContain("密码")
    }
  })

  test("没加密的 PDF 不受 --password 影响", async () => {
    const opened = await pdfEngine.open(await fixture(1), { password: "随便" })
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.data.encrypted).toBeUndefined()
  })
})
