import { expect, test } from "bun:test"
import { editPptxSlides, readPptxDocument, readPptxLayout } from "../../src/office/pptx-edit"
import { entryData, readZip } from "../../src/office/engine/zip"
import { pptxEngine } from "../../src/office/engine/pptx"

// 测试用的极简 ZIP 写出器：stored（不压缩），只为造 fixture。
type Entry = { name: string; data: Uint8Array }

function u16(value: number) {
  const data = new Uint8Array(2)
  new DataView(data.buffer).setUint16(0, value, true)
  return data
}

function u32(value: number) {
  const data = new Uint8Array(4)
  new DataView(data.buffer).setUint32(0, value >>> 0, true)
  return data
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

let table: Uint32Array | undefined
function crc32(bytes: Uint8Array) {
  if (!table) {
    table = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let value = index
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      table[index] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip(entries: Entry[]) {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data,
    ])
    locals.push(local)
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    )
    offset += local.length
  }
  const central = concat(centrals)
  return concat([
    ...locals,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array) {
  outer: for (let index = 0; index + needle.length <= haystack.length; index++) {
    for (let jndex = 0; jndex < needle.length; jndex++) {
      if (haystack[index + jndex] !== needle[jndex]) continue outer
    }
    return index
  }
  return -1
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const PRESENTATION =
  HEAD +
  '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>' +
  '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/>' +
  "</p:sldIdLst></p:presentation>"

const PRESENTATION_RELS =
  HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>' +
  "</Relationships>"

const CONTENT_TYPES =
  HEAD +
  '<Types xmlns="t"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>'

function slideXml(text: string) {
  return (
    HEAD +
    '<p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree><p:sp>' +
    '<p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
    '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>' +
    text +
    "</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"
  )
}

function layoutXml(name: string, shapes: string) {
  return (
    HEAD +
    '<p:sldLayout xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld name="' +
    name +
    '"><p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    shapes +
    "</p:spTree></p:cSld></p:sldLayout>"
  )
}

function placeholder(id: number, name: string, type: string, index?: number) {
  return (
    '<p:sp><p:nvSpPr><p:cNvPr id="' +
    id +
    '" name="' +
    name +
    '"/><p:cNvSpPr/>' +
    '<p:nvPr><p:ph type="' +
    type +
    '"' +
    (index === undefined ? "" : ' idx="' + index + '"') +
    "/></p:nvPr></p:nvSpPr>" +
    "<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>"
  )
}

const TITLE_LAYOUT = layoutXml("标题版式", placeholder(2, "标题 1", "title"))
const TWO_COLUMN_LAYOUT = layoutXml(
  "两栏内容",
  placeholder(2, "标题 1", "title") + placeholder(3, "内容 2", "body", 1) + placeholder(4, "内容 3", "body", 2),
)

function deck() {
  const encoder = new TextEncoder()
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "ppt/presentation.xml", data: encoder.encode(PRESENTATION) },
    { name: "ppt/_rels/presentation.xml.rels", data: encoder.encode(PRESENTATION_RELS) },
    { name: "ppt/slides/slide1.xml", data: encoder.encode(slideXml("第一页")) },
    { name: "ppt/slides/slide2.xml", data: encoder.encode(slideXml("第二页")) },
    { name: "ppt/slides/slide3.xml", data: encoder.encode(slideXml("第三页")) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: encoder.encode(TITLE_LAYOUT) },
    { name: "ppt/slideLayouts/slideLayout2.xml", data: encoder.encode(TWO_COLUMN_LAYOUT) },
  ])
}

function order(nodes: ReadonlyArray<{ slide: number; paragraphs: string[] }>) {
  const pages = new Map<number, string>()
  for (const node of nodes) pages.set(node.slide, node.paragraphs[0] ?? "")
  return [...pages.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1])
}

test("按 presentation.xml 的清单读页面，空页也算一页", async () => {
  const doc = await readPptxDocument(deck())
  expect(doc.slideCount).toBe(3)
  expect(order(doc.nodes)).toEqual(["第一页", "第二页", "第三页"])
})

test("删页：只改 presentation.xml 和 rels，页面部件留在包里", async () => {
  const original = deck()
  const result = await editPptxSlides(original, [{ op: "deleteSlide", slide: 2 }])
  expect(result.changed).toEqual(["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"])

  const doc = await readPptxDocument(result.bytes)
  expect(doc.slideCount).toBe(2)
  expect(order(doc.nodes)).toEqual(["第一页", "第三页"])
  // 被删的那一页的字节还在：撤销只是把关系加回来，不需要重建部件。
  expect(containsBytes(result.bytes, new TextEncoder().encode("第二页"))).toBeGreaterThan(-1)
})

test("拖页：重排 sldIdLst，页面部件一个字节都不动", async () => {
  const original = deck()
  const result = await editPptxSlides(original, [{ op: "moveSlide", from: 3, to: 1 }])
  expect(result.changed).toEqual(["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"])

  const doc = await readPptxDocument(result.bytes)
  expect(order(doc.nodes)).toEqual(["第三页", "第一页", "第二页"])
  // 顺序变了之后，页码 1 对应的就是原第三页的部件。
  expect((await readPptxLayout(result.bytes, [1])).map((node) => node.paragraphs[0])).toEqual(["第三页"])
  // 内容部件一个字节都没重写。
  const zip = await readZip(result.bytes)
  const part = zip.entries.find((item) => item.name === "ppt/slides/slide1.xml")!
  const xml = new TextDecoder().decode(await entryData(zip.bytes, part))
  expect(xml).toContain("第一页")
})

test("删到只剩一页后不再允许删除", async () => {
  const one = await editPptxSlides(deck(), [
    { op: "deleteSlide", slide: 3 },
    { op: "deleteSlide", slide: 2 },
  ])
  expect((await readPptxDocument(one.bytes)).slideCount).toBe(1)
  await expect(editPptxSlides(one.bytes, [{ op: "deleteSlide", slide: 1 }])).rejects.toThrow("至少")
})

test("复制页：克隆部件和 rels，新页紧跟原页，接着还能再复制", async () => {
  const result = await editPptxSlides(deck(), [{ op: "duplicateSlide", slide: 2 }])
  const doc = await readPptxDocument(result.bytes)
  expect(doc.slideCount).toBe(4)
  expect(order(doc.nodes)).toEqual(["第一页", "第二页", "第二页", "第三页"])

  const zip = await readZip(result.bytes)
  // 克隆出来的是独立部件，不是把原页挂两遍。
  expect(zip.entries.some((item) => item.name === "ppt/slides/slide4.xml")).toBe(true)
  const typesEntry = zip.entries.find((item) => item.name === "[Content_Types].xml")!
  const types = new TextDecoder().decode(await entryData(zip.bytes, typesEntry))
  expect(types).toContain('PartName="/ppt/slides/slide4.xml"')

  // 同一批里再复制一次：来源可能还是刚克隆出来的部件。
  const twice = await editPptxSlides(result.bytes, [{ op: "duplicateSlide", slide: 2 }])
  expect((await readPptxDocument(twice.bytes)).slideCount).toBe(5)
})

test("复制页后按新页码改字，只影响克隆页", async () => {
  const result = await editPptxSlides(deck(), [{ op: "duplicateSlide", slide: 1 }])
  const edited = await pptxEngine.open(result.bytes)
  expect(edited.ok).toBe(true)
  if (!edited.ok) return
  const page2 = edited.data.nodes.filter((node) => node.slide === 2)
  expect(page2.map((node) => node.paragraphs[0])).toEqual(["第一页"])
  const applied = await pptxEngine.apply(
    edited.data,
    [{ op: "setParagraphText", slide: 2, shapeId: page2[0]!.shapeId, paragraph: 0, text: "新一页" }],
    result.bytes,
  )
  expect(applied.ok).toBe(true)
  if (!applied.ok) return
  expect(order(applied.data.state.nodes)).toEqual(["第一页", "新一页", "第二页", "第三页"])
})

test("页码越界给出可读错误", async () => {
  await expect(editPptxSlides(deck(), [{ op: "deleteSlide", slide: 9 }])).rejects.toThrow("超出范围")
  await expect(editPptxSlides(deck(), [{ op: "moveSlide", from: 0, to: 2 }])).rejects.toThrow("超出范围")
})

test("引擎：页面操作走 apply，和内容操作混在一起会明确拒绝", async () => {
  const bytes = deck()
  const opened = await pptxEngine.open(bytes)
  expect(opened.ok).toBe(true)
  if (!opened.ok) return

  const removed = await pptxEngine.apply(opened.data, [{ op: "deleteSlide", slide: 1 }], bytes)
  expect(removed.ok).toBe(true)
  if (!removed.ok) return
  expect(removed.data.state.slideCount).toBe(2)
  expect(order(removed.data.state.nodes)).toEqual(["第二页", "第三页"])

  const copied = await pptxEngine.apply(opened.data, [{ op: "duplicateSlide", slide: 3 }], bytes)
  expect(copied.ok).toBe(true)
  if (!copied.ok) return
  expect(copied.data.state.slideCount).toBe(4)
  expect(order(copied.data.state.nodes)).toEqual(["第一页", "第二页", "第三页", "第三页"])

  const mixed = await pptxEngine.apply(
    opened.data,
    [
      { op: "deleteSlide", slide: 1 },
      { op: "setParagraphText", slide: 1, shapeId: "2", paragraph: 0, text: "新标题" },
    ],
    bytes,
  )
  expect(mixed.ok).toBe(false)
  if (!mixed.ok) {
    expect(mixed.error.code).toBe("invalid_params")
    expect(mixed.error.suggestion).toContain("再按新的页码")
  }
})

test("新建空白页：插在指定页之后，成为可编辑的空页", async () => {
  const original = deck()
  const result = await editPptxSlides(original, [{ op: "addSlide", after: 1 }])
  expect(result.changed).toContain("ppt/presentation.xml")
  expect(result.changed).toContain("ppt/_rels/presentation.xml.rels")
  expect(result.changed).toContain("[Content_Types].xml")
  expect(result.changed).toContain("ppt/slides/slide4.xml")

  const doc = await readPptxDocument(result.bytes)
  expect(doc.slideCount).toBe(4)
  // 新页在第二页的位置、没有形状，所以只有三页有可编辑节点。
  expect(doc.nodes.map((node) => node.slide)).toEqual([1, 3, 4])
  expect(doc.nodes.find((node) => node.slide === 3)!.paragraphs[0]).toBe("第二页")

  const zip = await readZip(result.bytes)
  const part = zip.entries.find((item) => item.name === "ppt/slides/slide4.xml")!
  expect(new TextDecoder().decode(await entryData(result.bytes, part))).toContain("<p:spTree>")
})

test("新建页可以插在最前面（after = 0）", async () => {
  const result = await editPptxSlides(deck(), [{ op: "addSlide", after: 0 }])
  const doc = await readPptxDocument(result.bytes)
  expect(doc.slideCount).toBe(4)
  expect(doc.nodes.map((node) => node.slide)).toEqual([2, 3, 4])
})

test("默认插在最后一页后面", async () => {
  const result = await editPptxSlides(deck(), [{ op: "addSlide" }])
  const doc = await readPptxDocument(result.bytes)
  expect(doc.slideCount).toBe(4)
  expect(doc.nodes.map((node) => node.slide)).toEqual([1, 2, 3])
})

test("新建文本框：形状树里多一个可编辑的 sp", async () => {
  const opened = await pptxEngine.open(deck())
  expect(opened.ok).toBe(true)
  if (!opened.ok) return
  const applied = await pptxEngine.apply(
    opened.data,
    [{ op: "addTextBox", slide: 1, text: "新增的一行", box: { x: 100, y: 120, w: 400, h: 60 } }],
    deck(),
  )
  expect(applied.ok).toBe(true)
  if (!applied.ok) return
  const nodes = await readPptxLayout(applied.data.bytes, [1])
  const added = nodes.find((node) => node.paragraphs[0] === "新增的一行")
  expect(added).toBeDefined()
  expect(added!.kind).toBe("shape")
  // 位置按 pt → EMU 换算写回。
  expect(added!.box).toEqual({ x: 1270000, y: 1524000, w: 5080000, h: 762000 })
})

test("删除形状：只掉这一个，页上别的对象还在", async () => {
  const opened = await pptxEngine.open(deck())
  expect(opened.ok).toBe(true)
  if (!opened.ok) return
  const before = await readPptxLayout(deck(), [1])
  const applied = await pptxEngine.apply(
    opened.data,
    [{ op: "deleteShape", slide: 1, shapeId: before[0]!.shapeId }],
    deck(),
  )
  expect(applied.ok).toBe(true)
  if (!applied.ok) return
  expect((await readPptxLayout(applied.data.bytes, [1])).length).toBe(before.length - 1)
  // 其它两页一个字节都没动。
  expect(applied.data.changed).not.toContain("ppt/slides/slide2.xml")
})

test("列出版式：名字来自 cSld，序号按部件名排", async () => {
  const { listPptxLayouts } = await import("../../src/office/pptx-edit")
  expect(await listPptxLayouts(deck())).toEqual([
    { index: 1, name: "标题版式", part: "slideLayout1.xml" },
    { index: 2, name: "两栏内容", part: "slideLayout2.xml" },
  ])

  const opened = await pptxEngine.open(deck())
  if (!opened.ok) throw new Error(opened.error.message)
  expect(opened.data.layouts.map((layout) => layout.name)).toEqual(["标题版式", "两栏内容"])
})

test("按名字选版式：新页带占位符，关系指向对应版式", async () => {
  const result = await editPptxSlides(deck(), [{ op: "addSlide", after: 1, layout: "两栏内容" }])
  const zip = await readZip(result.bytes)
  const part = zip.entries.find((item) => item.name === "ppt/slides/slide4.xml")!
  const xml = new TextDecoder().decode(await entryData(result.bytes, part))
  expect((xml.match(/<p:ph\b/g) ?? []).length).toBe(3)
  // 占位符 id 重排，保证同一页内唯一。
  expect((xml.match(/<p:cNvPr id="(2|3|4)"/g) ?? []).length).toBeGreaterThanOrEqual(3)

  const rels = zip.entries.find((item) => item.name === "ppt/slides/_rels/slide4.xml.rels")!
  expect(new TextDecoder().decode(await entryData(result.bytes, rels))).toContain("slideLayout2.xml")
})

test("按 1-based 序号选版式也可以", async () => {
  const result = await editPptxSlides(deck(), [{ op: "addSlide", after: 0, layout: "1" }])
  const zip = await readZip(result.bytes)
  const part = zip.entries.find((item) => item.name === "ppt/slides/slide4.xml")!
  const xml = new TextDecoder().decode(await entryData(result.bytes, part))
  expect((xml.match(/<p:ph\b/g) ?? []).length).toBe(1)
})

test("版式名不存在时报错并列出可用版式", async () => {
  await expect(editPptxSlides(deck(), [{ op: "addSlide", layout: "不存在的版式" }])).rejects.toThrow("可用")
})
