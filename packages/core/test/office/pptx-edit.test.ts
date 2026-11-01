import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { editPptxText, readPptxTextLayout } from "../../src/office/pptx-text-edit"

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
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
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
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
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
</p:spTree></p:cSld></p:sld>`

const PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="x"/>`
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7])

function fixture() {
  const encoder = new TextEncoder()
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode("<Types/>") },
    { name: "ppt/presentation.xml", data: encoder.encode(PRESENTATION) },
    { name: "ppt/slides/slide1.xml", data: encoder.encode(SLIDE_ONE) },
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

describe("editPptxText", () => {
  test("改一段文字：保留字体与段落属性，其它 run 合并成一段", async () => {
    const original = fixture()
    const result = await editPptxText({
      bytes: original,
      edits: [{ slide: 1, shapeId: "2", text: "行业应用场景" }],
    })

    expect(result.changed).toEqual(["ppt/slides/slide1.xml"])
    expect(result.applied).toEqual([
      {
        slide: 1,
        shapeId: "2",
        shapeName: "标题 1",
        paragraph: 0,
        previous: "典型应用场景",
        text: "行业应用场景",
      },
    ])

    const layout = await readPptxTextLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "2")?.paragraphs).toEqual(["行业应用场景"])

    const xml = new TextDecoder().decode(await rawEntry(result.bytes, "ppt/slides/slide1.xml"))
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
    const result = await editPptxText({
      bytes: fixture(),
      edits: [{ slide: 1, shapeName: "文本框 5", paragraph: 1, text: "运营场景：缩短响应时间" }],
    })
    const layout = await readPptxTextLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "3")?.paragraphs).toEqual([
      "营销场景：自动生成投放策略",
      "运营场景：缩短响应时间",
    ])
    expect(layout.find((shape) => shape.shapeId === "2")?.paragraphs).toEqual(["典型应用场景"])
  })

  test("其它条目逐字节原样：图片、presentation.xml 的本地记录在结果里原封不动", async () => {
    const original = fixture()
    const result = await editPptxText({
      bytes: original,
      edits: [{ slide: 1, shapeId: "3", text: "新的正文" }],
    })
    const imageRecord = localRecord(original, "ppt/media/image1.png")
    expect(containsBytes(result.bytes, imageRecord)).toBeGreaterThanOrEqual(0)
    const presentationRecord = localRecord(original, "ppt/presentation.xml")
    expect(containsBytes(result.bytes, presentationRecord)).toBeGreaterThanOrEqual(0)
    // 只有一页被改，且改完之后仍是合法 PPTX
    expect(result.changed).toHaveLength(1)
    expect(Array.from(await rawEntry(result.bytes, "ppt/media/image1.png"))).toEqual(Array.from(IMAGE))
  })

  test("形状找不到时报错而不是静默写坏文件", async () => {
    await expect(
      editPptxText({ bytes: fixture(), edits: [{ slide: 1, shapeName: "不存在的形状", text: "x" }] }),
    ).rejects.toThrow("没有找到要修改的形状")
  })

  test("页不存在时报错", async () => {
    await expect(editPptxText({ bytes: fixture(), edits: [{ slide: 9, text: "x" }] })).rejects.toThrow("没有第 9 页")
  })

  test("XML 特殊字符被转义，不会撑坏结构", async () => {
    const result = await editPptxText({
      bytes: fixture(),
      edits: [{ slide: 1, shapeId: "3", text: 'A&B <c> "d"' }],
    })
    const xml = new TextDecoder().decode(await rawEntry(result.bytes, "ppt/slides/slide1.xml"))
    expect(xml).toContain("A&amp;B &lt;c&gt;")
    const layout = await readPptxTextLayout(result.bytes, [1])
    expect(layout.find((shape) => shape.shapeId === "3")?.paragraphs[0]).toBe('A&B <c> "d"')
  })
})

describe("readPptxTextLayout", () => {
  test("给出形状 id/名称/段落与位置", async () => {
    const layout = await readPptxTextLayout(fixture())
    expect(layout.map((shape) => shape.shapeId)).toEqual(["2", "3"])
    expect(layout[0]).toMatchObject({
      slide: 1,
      shapeName: "标题 1",
      box: { x: 838200, y: 365125, w: 10515600, h: 1325563 },
    })
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
  const layout = await readPptxTextLayout(bytes)
  expect(layout.length).toBeGreaterThan(0)
  const target = layout.find((shape) => shape.paragraphs[0]?.trim())
  expect(target).toBeDefined()
  const result = await editPptxText({
    bytes,
    edits: [{ slide: target!.slide, shapeId: target!.shapeId, text: "原地编辑验证" }],
  })
  expect(result.changed).toEqual([`ppt/slides/slide${target!.slide}.xml`])
  const after = await readPptxTextLayout(result.bytes, [target!.slide])
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
