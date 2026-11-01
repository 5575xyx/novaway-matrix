import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { editPptx, readPptxLayout } from "../../src/office/pptx-edit"

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

const SLIDE_ONE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit fontScale="88000" lnSpcReduction="20000"/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="4400" b="1"><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill></a:rPr><a:t>典型</a:t></a:r><a:r><a:rPr lang="zh-CN" sz="4400" b="1"><a:solidFill><a:srgbClr val="1F2937"/></a:solidFill></a:rPr><a:t>应用场景</a:t></a:r><a:endParaRPr lang="zh-CN" sz="4400"/></a:p>
</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="文本框 5"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>
<a:p><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>营销场景：自动生成投放策略</a:t></a:r></a:p>
<a:p><a:r><a:rPr lang="zh-CN" sz="1800"/><a:t>运营场景：数据看板辅助决策</a:t></a:r></a:p>
</p:txBody></p:sp>
<p:pic><p:nvPicPr><p:cNvPr id="4" name="图片 3"/><p:cNvPicPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/></p:blipFill>
<p:spPr><a:xfrm><a:off x="100000" y="200000"/><a:ext cx="300000" cy="400000"/></a:xfrm></p:spPr></p:pic>
<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="表格 4"/><p:cNvGraphicFramePr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>
<a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>表头A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:rPr lang="zh-CN"/><a:t>表头B</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
<a:tr><a:tc><a:txBody><a:p><a:r><a:rPr lang="zh-CN"/><a:t>数值1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:rPr lang="zh-CN"/><a:t>数值2</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
</p:spTree></p:cSld></p:sld>`

const PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="x"/>`
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/></Types>`
const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7])
const NEW_IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9])

function fixture() {
  const encoder = new TextEncoder()
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "ppt/presentation.xml", data: encoder.encode(PRESENTATION) },
    { name: "ppt/slides/slide1.xml", data: encoder.encode(SLIDE_ONE) },
    { name: "ppt/slides/_rels/slide1.xml.rels", data: encoder.encode(SLIDE_RELS) },
    { name: "ppt/media/image1.png", data: IMAGE },
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

async function slideXml(bytes: Uint8Array) {
  return new TextDecoder().decode(await rawEntry(bytes, "ppt/slides/slide1.xml"))
}

describe("editPptx 文本", () => {
  test("改一段文字：保留字体与段落属性，其它 run 合并成一段", async () => {
    const original = fixture()
    const result = await editPptx({ bytes: original, textEdits: [{ slide: 1, shapeId: "2", text: "行业应用场景" }] })

    expect(result.changed).toEqual(["ppt/slides/slide1.xml"])
    expect(result.textApplied).toEqual([
      { slide: 1, shapeId: "2", shapeName: "标题 1", paragraph: 0, previous: "典型应用场景", text: "行业应用场景" },
    ])

    const layout = await readPptxLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "2")?.paragraphs).toEqual(["行业应用场景"])

    const xml = await slideXml(result.bytes)
    expect(xml).toContain('<a:t xml:space="preserve">行业应用场景</a:t>')
    // 字体/字号/加粗原样保留
    expect(xml).toContain('sz="4400" b="1"')
    // 段落属性保留
    expect(xml).toContain('<a:pPr algn="l"/>')
    // autofit 的旧缩放比例被清掉，编辑器打开时会自己重算
    expect(xml).toContain("<a:normAutofit/>")
    expect(xml).not.toContain("fontScale=")
  })

  test("只动目标段落，同页另一段和另一形状不受影响", async () => {
    const result = await editPptx({
      bytes: fixture(),
      textEdits: [{ slide: 1, shapeName: "文本框 5", paragraph: 1, text: "运营场景：缩短响应时间" }],
    })
    const layout = await readPptxLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "3")?.paragraphs).toEqual([
      "营销场景：自动生成投放策略",
      "运营场景：缩短响应时间",
    ])
    expect(layout.find((shape) => shape.shapeId === "2")?.paragraphs).toEqual(["典型应用场景"])
  })

  test("表格单元格改字：按行列定位，别的单元格不动", async () => {
    const result = await editPptx({
      bytes: fixture(),
      textEdits: [{ slide: 1, shapeId: "5", cell: { row: 1, col: 0 }, text: "数值 42" }],
    })
    const layout = await readPptxLayout(result.bytes, [1])
    const cells = layout.find((shape) => shape.shapeId === "5")?.cells ?? []
    expect(cells.find((cell) => cell.row === 1 && cell.col === 0)?.paragraphs).toEqual(["数值 42"])
    expect(cells.find((cell) => cell.row === 0 && cell.col === 0)?.paragraphs).toEqual(["表头A"])
    expect(cells.find((cell) => cell.row === 1 && cell.col === 1)?.paragraphs).toEqual(["数值2"])
  })

  test("其它条目逐字节原样：图片、presentation.xml 的本地记录在结果里原封不动", async () => {
    const original = fixture()
    const result = await editPptx({ bytes: original, textEdits: [{ slide: 1, shapeId: "3", text: "新的正文" }] })
    expect(containsBytes(result.bytes, localRecord(original, "ppt/media/image1.png"))).toBeGreaterThanOrEqual(0)
    expect(containsBytes(result.bytes, localRecord(original, "ppt/presentation.xml"))).toBeGreaterThanOrEqual(0)
    expect(result.changed).toHaveLength(1)
    expect(Array.from(await rawEntry(result.bytes, "ppt/media/image1.png"))).toEqual(Array.from(IMAGE))
  })

  test("形状找不到时报错而不是静默写坏文件", async () => {
    await expect(
      editPptx({ bytes: fixture(), textEdits: [{ slide: 1, shapeName: "不存在的形状", text: "x" }] }),
    ).rejects.toThrow("没有找到要修改的内容")
  })

  test("页不存在时报错", async () => {
    await expect(editPptx({ bytes: fixture(), textEdits: [{ slide: 9, text: "x" }] })).rejects.toThrow("没有第 9 页")
  })

  test("XML 特殊字符被转义，不会撑坏结构", async () => {
    const result = await editPptx({ bytes: fixture(), textEdits: [{ slide: 1, shapeId: "3", text: 'A&B <c> "d"' }] })
    const xml = await slideXml(result.bytes)
    expect(xml).toContain("A&amp;B &lt;c&gt;")
    const layout = await readPptxLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "3")?.paragraphs[0]).toBe('A&B <c> "d"')
  })
})

describe("editPptx 格式", () => {
  test("只改样式：逐 run 打补丁，段内原有的不同格式不被抹平", async () => {
    const result = await editPptx({
      bytes: fixture(),
      textEdits: [{ slide: 1, shapeId: "2", style: { bold: true, size: 54, color: "FF0000", align: "ctr" } }],
    })
    const xml = await slideXml(result.bytes)
    // 两个 run 都改了，而不是收敛成一个
    expect(xml.match(/<a:t>/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(xml).toContain('sz="5400"')
    expect(xml).toContain('<a:srgbClr val="FF0000"/>')
    expect(xml).toContain('<a:pPr algn="ctr"/>')
    const layout = await readPptxLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "2")?.styles[0]).toMatchObject({
      bold: true,
      size: 54,
      color: "FF0000",
      align: "ctr",
    })
  })

  test("取消加粗会把 b 属性删掉，而不是写成 b=\"0\"", async () => {
    const result = await editPptx({
      bytes: fixture(),
      textEdits: [{ slide: 1, shapeId: "2", style: { bold: false } }],
    })
    const xml = await slideXml(result.bytes)
    expect(xml).not.toContain('b="1"')
    expect(xml).not.toContain('b="0"')
  })

  test("文字 + 样式一起改：新 run 带上样式，段落属性仍在", async () => {
    const result = await editPptx({
      bytes: fixture(),
      textEdits: [{ slide: 1, shapeId: "3", paragraph: 0, text: "新文案", style: { italic: true, color: "2563EB" } }],
    })
    const xml = await slideXml(result.bytes)
    expect(xml).toContain('i="1"')
    expect(xml).toContain('<a:srgbClr val="2563EB"/>')
    expect(xml).toContain("新文案")
  })
})

describe("editPptx 几何", () => {
  test("移动/改尺寸：只重写目标块的 xfrm", async () => {
    const result = await editPptx({
      bytes: fixture(),
      shapeEdits: [{ slide: 1, shapeId: "3", box: { x: 100, y: 200, w: 3000, h: 4000 } }],
    })
    expect(result.changed).toEqual(["ppt/slides/slide1.xml"])
    expect(result.shapeApplied[0]).toMatchObject({
      shapeId: "3",
      previous: { x: 838200, y: 1825625, w: 10515600, h: 4351338 },
      box: { x: 100, y: 200, w: 3000, h: 4000 },
    })
    const xml = await slideXml(result.bytes)
    expect(xml).toContain('<a:off x="100" y="200"/>')
    expect(xml).toContain('<a:ext cx="3000" cy="4000"/>')
    // 标题与图片的位置没被动
    expect(xml).toContain('<a:off x="838200" y="365125"/>')
    expect(xml).toContain('<a:off x="100000" y="200000"/>')
    // 读回来的几何是一致的
    const layout = await readPptxLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "3")?.box).toEqual({ x: 100, y: 200, w: 3000, h: 4000 })
  })

  test("表格框用 p:xfrm，同样能改位置", async () => {
    const result = await editPptx({
      bytes: fixture(),
      shapeEdits: [{ slide: 1, shapeId: "5", box: { x: 7, y: 8, w: 9, h: 10 } }],
    })
    const xml = await slideXml(result.bytes)
    expect(xml).toContain('<p:xfrm><a:off x="7" y="8"/><a:ext cx="9" cy="10"/></p:xfrm>')
  })

  test("旋转写进 a:xfrm 的 rot（60000 = 1 度）", async () => {
    const result = await editPptx({ bytes: fixture(), shapeEdits: [{ slide: 1, shapeId: "4", rotation: 15 }] })
    const xml = await slideXml(result.bytes)
    expect(xml).toContain('rot="900000"')
    expect((await readPptxLayout(result.bytes, [1])).find((shape) => shape.shapeId === "4")?.rotation).toBe(15)
  })
})

describe("editPptx 图片", () => {
  test("替换图片：新增媒体条目、写 rels、blip 指向新关系，旧图不删", async () => {
    const original = fixture()
    const result = await editPptx({
      bytes: original,
      imageEdits: [{ slide: 1, shapeId: "4", data: NEW_IMAGE, mime: "image/png" }],
    })

    const applied = result.imageApplied[0]!
    expect(applied.shapeId).toBe("4")
    expect(applied.previousRId).toBe("rId2")
    expect(applied.rId).toBe("rId3")
    expect(applied.mediaPath.startsWith("ppt/media/novaway-")).toBe(true)
    expect(result.changed).toContain("ppt/slides/_rels/slide1.xml.rels")

    const xml = await slideXml(result.bytes)
    expect(xml).toContain('r:embed="rId3"')
    const rels = new TextDecoder().decode(await rawEntry(result.bytes, "ppt/slides/_rels/slide1.xml.rels"))
    expect(rels).toContain('Id="rId3"')
    expect(rels).toContain(applied.mediaPath.slice("ppt/media/".length))
    // 新图片真的进了包；旧图仍然在
    expect(Array.from(await rawEntry(result.bytes, applied.mediaPath))).toEqual(Array.from(NEW_IMAGE))
    expect(Array.from(await rawEntry(result.bytes, "ppt/media/image1.png"))).toEqual(Array.from(IMAGE))
    // 读回来能拿到新关系
    const layout = await readPptxLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "4")?.image?.rId).toBe("rId3")
  })

  test("新扩展名会补进 [Content_Types].xml", async () => {
    const result = await editPptx({
      bytes: fixture(),
      imageEdits: [{ slide: 1, shapeId: "4", data: NEW_IMAGE, mime: "image/gif" }],
    })
    const types = new TextDecoder().decode(await rawEntry(result.bytes, "[Content_Types].xml"))
    expect(types).toContain('<Default Extension="gif" ContentType="image/gif"/>')
    expect(result.changed).toContain("[Content_Types].xml")
  })

  test("对没有 blip 的形状替换图片会被忽略", async () => {
    await expect(
      editPptx({ bytes: fixture(), imageEdits: [{ slide: 1, shapeId: "2", data: NEW_IMAGE, mime: "image/png" }] }),
    ).rejects.toThrow("没有找到要修改的内容")
  })
})

describe("readPptxLayout", () => {
  test("给出形状 id/名称/段落/格式/几何", async () => {
    const layout = await readPptxLayout(fixture())
    expect(layout.map((shape) => shape.shapeId)).toEqual(["2", "3", "4", "5"])
    expect(layout[0]).toMatchObject({
      slide: 1,
      shapeName: "标题 1",
      kind: "shape",
      box: { x: 838200, y: 365125, w: 10515600, h: 1325563 },
      styles: [{ align: "l", bold: true, size: 44, color: "1F2937" }],
    })
    expect(layout.find((shape) => shape.shapeId === "4")?.kind).toBe("picture")
    expect(layout.find((shape) => shape.shapeId === "4")?.image?.target).toBe("../media/image1.png")
    const table = layout.find((shape) => shape.shapeId === "5")
    expect(table?.kind).toBe("table")
    expect(table?.cells?.map((cell) => cell.paragraphs[0])).toEqual(["表头A", "表头B", "数值1", "数值2"])
  })
})

// 真实文件兜底：ppt-master 生成的 deck 用 deflate + data descriptor，
// 能验证我们的 zip 读取在真实产物上也成立。
const REAL = path.resolve(
  import.meta.dir,
  "../../../../.worktrees/feat-forge-orchestrator/ppt-master-main/examples/ppt169_building_effective_agents/exports/building_effective_agents.pptx",
)

test.skipIf(!existsSync(REAL))("真实 PPTX：读取 + 改一段后仍能被自己解析", async () => {
  const bytes = new Uint8Array(readFileSync(REAL))
  const layout = await readPptxLayout(bytes)
  expect(layout.length).toBeGreaterThan(0)
  const target = layout.find((shape) => shape.paragraphs[0]?.trim())
  expect(target).toBeDefined()
  const result = await editPptx({
    bytes,
    textEdits: [{ slide: target!.slide, shapeId: target!.shapeId, text: "原地编辑验证" }],
  })
  expect(result.changed).toEqual([`ppt/slides/slide${target!.slide}.xml`])
  const after = await readPptxLayout(result.bytes, [target!.slide])
  expect(after.find((shape) => shape.shapeId === target!.shapeId)?.paragraphs[0]).toBe("原地编辑验证")
})

/** 用我们自己的读取逻辑取条目原始字节（测试内复用，验证写出的 zip 自洽）。 */
async function rawEntry(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let cursor = view.byteLength - 22; cursor >= 0; cursor--) {
    if (view.getUint32(cursor, true) === 0x06054b50) {
      eocd = cursor
      break
    }
  }
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  for (let index = 0; index < count; index++) {
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const method = view.getUint16(cursor + 10, true)
    const size = view.getUint32(cursor + 20, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const entryName = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))
    if (entryName === name) {
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      const start = localOffset + 30 + localNameLength + localExtraLength
      const data = bytes.slice(start, start + size)
      if (method === 0) return data
      const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error("条目不存在：" + name)
}

function localRecord(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let cursor = view.byteLength - 22; cursor >= 0; cursor--) {
    if (view.getUint32(cursor, true) === 0x06054b50) {
      eocd = cursor
      break
    }
  }
  const count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  for (let index = 0; index < count; index++) {
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const size = view.getUint32(cursor + 20, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const entryName = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength))
    if (entryName === name) {
      const localNameLength = view.getUint16(localOffset + 26, true)
      const localExtraLength = view.getUint16(localOffset + 28, true)
      return bytes.slice(localOffset, localOffset + 30 + localNameLength + localExtraLength + size)
    }
    cursor += 46 + nameLength + extraLength + commentLength
  }
  throw new Error("条目不存在：" + name)
}
