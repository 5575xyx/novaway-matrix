import { describe, expect, test } from "bun:test"
import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js"
import { deflateSync } from "node:zlib"
import { createDocumentAsync } from "@novaway/core/office/create"
import { engineFor } from "@novaway/core/office/engine/registry"
import { exportDocumentAs, normalizeExportTarget } from "../../src/office/document-export"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** 造一个最小的 PPTX：一页标题 + 一段正文，够走通引擎的 open → export。 */
async function pptxBytes() {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  const slide = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>',
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>',
    "<p:txBody><a:p><a:r><a:t>封面标题</a:t></a:r></a:p></p:txBody></p:sp>",
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="文本框 2"/><p:nvPr/></p:nvSpPr>',
    "<p:txBody><a:p><a:r><a:t>一句话结论</a:t></a:r></a:p></p:txBody></p:sp>",
    "</p:spTree></p:cSld></p:sld>",
  ].join("")
  await writer.add("ppt/presentation.xml", new TextReader("<p:presentation/>"))
  await writer.add("ppt/slides/slide1.xml", new TextReader(slide))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

/** 带一张图的 PPTX：图片节点引用 ppt/media/image1.png，导出时要真的画出来。 */
async function pptxWithPicture(png: Uint8Array) {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  const slide = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"',
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    "<p:cSld><p:spTree>",
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr/></p:nvSpPr>',
    "<p:txBody><a:p><a:r><a:t>带图的一页</a:t></a:r></a:p></p:txBody></p:sp>",
    '<p:pic><p:nvPicPr><p:cNvPr id="3" name="图片 2"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>',
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>',
    '<p:spPr><a:xfrm><a:off x="1200000" y="1800000"/><a:ext cx="3600000" cy="1800000"/></a:xfrm>',
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>',
    "</p:spTree></p:cSld></p:sld>",
  ].join("")
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"' +
    ' Target="../media/image1.png"/></Relationships>'
  await writer.add("ppt/presentation.xml", new TextReader("<p:presentation/>"))
  await writer.add("ppt/slides/slide1.xml", new TextReader(slide))
  await writer.add("ppt/slides/_rels/slide1.xml.rels", new TextReader(rels))
  await writer.add("ppt/media/image1.png", new Uint8ArrayReader(png))
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

/** 加密 PDF（RC4 128，密码 secret）：用来验证导出入口也接受密码。 */
const ENCRYPTED_PDF =
  "JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA1MCAvRmlsdGVyIC9GbGF0ZURlY29kZSA+PgpzdHJlYW0Ko01T3fiIyMQt9ZonG8uydmnsFLx63SILgJuV4phXULZfL7LcPWLBWuXF/Bm11UaUz3IKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyA+PgplbmRvYmoKNiAwIG9iago8PCAvRmlsdGVyIC9TdGFuZGFyZCAvViAyIC9SIDMgL0xlbmd0aCAxMjggL08gPDBkYjU4NTVmYzUzMjY1NjllNzY1OTA2Y2FmNjRlNDQyOWE0YzIwZDZlOTk2ZmRlZjk2M2U5YjUwODBmOWUwODM+IC9VIDxjZDc2NTAxOTJkODQ3NWQ5NDc4ZDRjN2JjZDc0MjZiNzI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4PiAvUCAtMzkwNCA+PgplbmRvYmoKNyAwIG9iago8PCAvVGl0bGUgPGVmMWQ3ZjI1YWIyYmU2NzhkNzZkPiA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyMSAwMDAwMCBuIAowMDAwMDAwMjQ3IDAwMDAwIG4gCjAwMDAwMDAzNjggMDAwMDAgbiAKMDAwMDAwMDQ2NSAwMDAwMCBuIAowMDAwMDAwNjc1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiAvSW5mbyA3IDAgUiAvRW5jcnlwdCA2IDAgUiAvSUQgWzxhZGZlMjRmNDkzNDNkOTA3ZGE4ZTdjZjNiYTI1NDFlNT4gPDk1YTJkZmJjZWIyZWY3MTZiMWNhNWYxMGE2N2RkZTkwPl0gPj4Kc3RhcnR4cmVmCjcyNgolJUVPRgo="

describe("文档导出", () => {
  test("目标格式别名归一", () => {
    expect(normalizeExportTarget(".CSV")).toBe("csv")
    expect(normalizeExportTarget("markdown")).toBe("md")
    expect(normalizeExportTarget("text")).toBe("txt")
    expect(normalizeExportTarget(" html ")).toBe("html")
  })

  test("Markdown 原样导出，编码保持不变", async () => {
    const bytes = encoder.encode("# 标题\n\n正文\n")
    const result = await exportDocumentAs(bytes, "markdown", "txt")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.target).toBe("txt")
    expect(result.data.mime).toBe("text/plain")
    expect(decoder.decode(result.data.bytes)).toBe("# 标题\n\n正文\n")
  })

  test("不支持的格式与目标都给出可读错误", async () => {
    const unsupported = await exportDocumentAs(encoder.encode("x"), undefined, "csv")
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.error.code).toBe("unsupported_format")

    // text → pdf 现在由共享排版器支持；用 xlsx 这种纯文本写不出的目标验证提示。
    const wrong = await exportDocumentAs(encoder.encode("x"), "text", "xlsx")
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error.suggestion).toContain("txt")
  })

  test("HTML 导出成纯文字时按块分段", async () => {
    const html = "<!doctype html><html><body><h1>标题</h1><p>正文</p></body></html>"
    const result = await exportDocumentAs(encoder.encode(html), "html", "txt")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(decoder.decode(result.data.bytes)).toBe("标题\n\n正文")
  })

  test("PPTX 导出成 md：一页一节，标题 + 要点", async () => {
    const result = await exportDocumentAs(await pptxBytes(), "pptx", "md")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.mime).toBe("text/markdown")
    const text = decoder.decode(result.data.bytes)
    expect(text).toContain("## 封面标题")
    expect(text).toContain("- 一句话结论")
  })

  test("PPTX 导出成 txt：带页码，只留文字", async () => {
    const result = await exportDocumentAs(await pptxBytes(), "pptx", "txt")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = decoder.decode(result.data.bytes)
    expect(text.split("\n")[0]).toBe("第 1 页：封面标题")
    expect(text).toContain("一句话结论")
    expect(text).not.toContain("<p:sld")
  })

  test("CSV 导出成 md / json：表头是列名", async () => {
    const nl = String.fromCharCode(10)
    const source = encoder.encode("name,count" + nl + "apple,3" + nl + "pear,5" + nl)
    const md = await exportDocumentAs(source, "csv", "md")
    expect(md.ok).toBe(true)
    if (!md.ok) return
    expect(md.data.mime).toBe("text/markdown")
    expect(decoder.decode(md.data.bytes).split(nl)[0]).toBe("| name | count |")

    const json = await exportDocumentAs(source, "csv", "json")
    expect(json.ok).toBe(true)
    if (!json.ok) return
    expect(json.data.mime).toBe("application/json")
    expect(JSON.parse(decoder.decode(json.data.bytes))).toEqual([
      { name: "apple", count: "3" },
      { name: "pear", count: "5" },
    ])
  })

  test("加密 PDF 导出：没密码报 password_required，给了密码原样另存", async () => {
    const bytes = new Uint8Array(Buffer.from(ENCRYPTED_PDF, "base64"))
    const missing = await exportDocumentAs(bytes, "pdf", "pdf")
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error.code).toBe("password_required")
      expect(String(missing.error.suggestion)).toContain("密码")
    }

    const unlocked = await exportDocumentAs(bytes, "pdf", "pdf", { password: "secret" })
    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) return
    expect(unlocked.data.bytes).toEqual(bytes)
  })

  test("HTML 导出成 html 时逐字节不变", async () => {
    const html = "<!doctype html><html><body><p>x</p></body></html>"
    const result = await exportDocumentAs(encoder.encode(html), "html", "html")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(decoder.decode(result.data.bytes)).toBe(html)
  })
})

describe("PNG 导出", () => {
  test("DOCX → PNG：默认第 1 页、2 倍分辨率", async () => {
    const docx = await createDocumentAsync("report.docx", { title: "标题", body: "正文一段" })
    const result = await exportDocumentAs(docx.bytes, "docx", "png")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.mime).toBe("image/png")
    expect([...result.data.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const width = new DataView(result.data.bytes.buffer, result.data.bytes.byteOffset).getUint32(16)
    expect(width).toBe(Math.ceil(595.28 * 2))
  })

  test("DOCX 里的图片会画进 PNG，不会被排版丢掉", async () => {
    // 纯色 PNG（96×48）：不依赖测试夹具文件，也能按像素断言。
    const png = solidPng(96, 48, [37, 99, 235])
    const docx = await createDocumentAsync("report.docx", { title: "带图的报告", body: "第一段" })
    const engine = engineFor("docx")!
    const opened = await engine.open(docx.bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await engine.apply(
      opened.data,
      [
        {
          op: "addImage",
          after: 1,
          dataBase64: Buffer.from(png).toString("base64"),
          mime: "image/png",
          width: 96,
          height: 48,
        },
      ],
      docx.bytes,
    )
    if (!applied.ok) throw new Error(applied.error.message)

    const result = await exportDocumentAs(applied.data.bytes, "docx", "png", { scale: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await bluePixels(result.data.bytes)).toBeGreaterThan(1000)
  })

  test("PPTX 里的图片会画进 PNG", async () => {
    const png = solidPng(120, 60, [37, 99, 235])
    const result = await exportDocumentAs(await pptxWithPicture(png), "pptx", "png", { scale: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(await bluePixels(result.data.bytes)).toBeGreaterThan(1000)
  })

  test("CSV → PNG：表格外形画成一页", async () => {
    const nl = String.fromCharCode(10)
    const result = await exportDocumentAs(encoder.encode("name,count" + nl + "apple,3" + nl), "csv", "png", {
      scale: 1,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.data.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  test("加密 PDF 也能出图：密码不对就报 password_required", async () => {
    const bytes = new Uint8Array(Buffer.from(ENCRYPTED_PDF, "base64"))
    const missing = await exportDocumentAs(bytes, "pdf", "png")
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe("password_required")

    const unlocked = await exportDocumentAs(bytes, "pdf", "png", { password: "secret" })
    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) return
    expect([...unlocked.data.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})

/** PNG 每个 chunk 末尾的 CRC-32（IEEE）。 */
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return (value ^ 0xffffffff) >>> 0
}

/** 最小的 PNG 编码器：8 位 RGB、无滤波，够造测试图。 */
function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length)
    body.set(
      [...type].map((char) => char.charCodeAt(0)),
      0,
    )
    body.set(data, 4)
    const head = new Uint8Array(4)
    new DataView(head.buffer).setUint32(0, data.length)
    const tail = new Uint8Array(4)
    new DataView(tail.buffer).setUint32(0, crc32(body))
    return [...head, ...body, ...tail]
  }
  const header = new Uint8Array(13)
  new DataView(header.buffer).setUint32(0, width)
  new DataView(header.buffer).setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", header),
    ...chunk("IDAT", deflateSync(raw)),
    ...chunk("IEND", new Uint8Array(0)),
  ])
}

/** 数一数导出图里有多少接近 #2563eb 的像素。 */
async function bluePixels(png: Uint8Array): Promise<number> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas")
  const image = await loadImage(Buffer.from(png))
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext("2d")
  context.drawImage(image, 0, 0)
  const { data } = context.getImageData(0, 0, image.width, image.height)
  let count = 0
  for (let index = 0; index < data.length; index += 4) {
    if (
      Math.abs(data[index]! - 37) < 12 &&
      Math.abs(data[index + 1]! - 99) < 12 &&
      Math.abs(data[index + 2]! - 235) < 12
    ) {
      count += 1
    }
  }
  return count
}
