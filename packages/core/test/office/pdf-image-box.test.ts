import { describe, expect, test } from "bun:test"
import { PDFDocument } from "pdf-lib"
import { findImagePlacement, pageImages, setPageImageBox } from "../../src/office/pdf/image-box"
import { pdfEngine } from "../../src/office/pdf/engine"

/** 一张 1×1 的最小 JPEG。 */
function tinyJpeg(): Uint8Array {
  const base64 =
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="
  return new Uint8Array(Buffer.from(base64, "base64"))
}

async function pageWithImage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const image = await doc.embedJpg(tinyJpeg())
  page.drawImage(image, { x: 50, y: 300, width: 100, height: 50 })
  return new Uint8Array(await doc.save())
}

describe("PDF 图片框：移动 / 缩放 / 旋转", () => {
  test("读出图片当前的位置（左上角原点）", async () => {
    const doc = await PDFDocument.load(await pageWithImage())
    const images = pageImages(doc, 0)
    expect(images.length).toBe(1)
    const placement = findImagePlacement(doc, 0, 1)
    expect(placement?.box.x).toBeCloseTo(50, 1)
    expect(placement?.box.y).toBeCloseTo(842 - 300 - 50, 1)
    expect(placement?.box.w).toBeCloseTo(100, 1)
    expect(placement?.box.h).toBeCloseTo(50, 1)
    expect(placement?.rotation).toBe(0)
  })

  test("移动并缩放：重开后位置和尺寸都在，只有一次绘制", async () => {
    const bytes = await pageWithImage()
    const opened = await pdfEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await pdfEngine.apply(
      opened.data,
      [{ op: "setPageImageBox", page: 1, x: 200, y: 100, width: 120, height: 60 }],
      bytes,
    )
    if (!applied.ok) throw new Error(applied.error.message)

    const reopened = await PDFDocument.load(applied.data.bytes)
    const placement = findImagePlacement(reopened, 0, 1)
    expect(placement?.box.x).toBeCloseTo(200, 1)
    expect(placement?.box.y).toBeCloseTo(100, 1)
    expect(placement?.box.w).toBeCloseTo(120, 1)
    expect(placement?.box.h).toBeCloseTo(60, 1)

    const streamText = await contentOf(reopened)
    expect((streamText.match(/Do/g) ?? []).length).toBe(1)
  })

  test("只旋转 90°：绕中心转、宽高互换", async () => {
    const bytes = await pageWithImage()
    const opened = await pdfEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await pdfEngine.apply(opened.data, [{ op: "setPageImageBox", page: 1, rotation: 90 }], bytes)
    if (!applied.ok) throw new Error(applied.error.message)

    const reopened = await PDFDocument.load(applied.data.bytes)
    const placement = findImagePlacement(reopened, 0, 1)
    expect(placement?.rotation).toBe(90)
    expect(placement?.box.w).toBeCloseTo(50, 1)
    expect(placement?.box.h).toBeCloseTo(100, 1)
    expect(placement!.box.x + placement!.box.w / 2).toBeCloseTo(100, 1)
    expect(placement!.box.y + placement!.box.h / 2).toBeCloseTo(842 - 300 - 25, 1)
  })

  test("没有图片时明确报 not_found", async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 300])
    const bytes = new Uint8Array(await doc.save())
    const opened = await pdfEngine.open(bytes)
    if (!opened.ok) throw new Error(opened.error.message)
    const applied = await pdfEngine.apply(opened.data, [{ op: "setPageImageBox", page: 1, x: 10 }], bytes)
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.error.code).toBe("not_found")
  })
})

async function contentOf(doc: PDFDocument): Promise<string> {
  const { PDFArray, PDFRawStream, PDFRef, decodePDFRawStream } = await import("pdf-lib")
  const contents = doc.getPage(0).node.Contents()
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
  return streams.map((item) => new TextDecoder("windows-1252").decode(item)).join("\n")
}
