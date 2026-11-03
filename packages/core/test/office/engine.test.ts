import { describe, expect, test } from "bun:test"
import {
  columnToIndex,
  formatCellRef,
  indexToColumn,
  parseCellRef,
  parseOfficePath,
} from "../../src/office/engine/contract"
import { pptxEngine } from "../../src/office/engine/pptx"
import { DocumentSession, PathLocks } from "../../src/office/engine/session"
import { boxEmuToPt, boxPtToEmu, EMU_PER_POINT, emuToPt, ptToEmu } from "../../src/office/engine/units"

const encoder = new TextEncoder()

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

function buildZip(entries: Array<{ name: string; data: Uint8Array }>) {
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

const SLIDE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题 1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="zh-CN" sz="4400" b="1"/><a:t>标题文字</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`

const PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/></p:presentation>`

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`

function fixture() {
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "ppt/presentation.xml", data: encoder.encode(PRESENTATION) },
    { name: "ppt/slides/slide1.xml", data: encoder.encode(SLIDE) },
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

describe("单位换算", () => {
  test("pt 与 EMU 往返不丢精度", () => {
    expect(EMU_PER_POINT).toBe(12700)
    expect(ptToEmu(1)).toBe(12700)
    expect(emuToPt(12192000)).toBe(960)
    expect(emuToPt(6858000)).toBe(540)
    const box = { x: 12.5, y: 24, w: 100, h: 50 }
    expect(boxEmuToPt(boxPtToEmu(box))).toEqual(box)
  })
})

describe("路径寻址", () => {
  test("文档 / 段落 / 表格", () => {
    expect(parseOfficePath("/body")).toEqual({ ok: true, data: { kind: "document", path: "/body" } })
    expect(parseOfficePath("/body/p[3]")).toEqual({ ok: true, data: { kind: "paragraph", index: 3 } })
    expect(parseOfficePath("/body/table[2]")).toEqual({ ok: true, data: { kind: "table", index: 2 } })
  })

  test("表格单元格与区域", () => {
    expect(parseOfficePath("/Sheet1/B2")).toEqual({
      ok: true,
      data: { kind: "cell", sheet: "Sheet1", row: 1, col: 1 },
    })
    const range = parseOfficePath("/Sheet1/A1:C10")
    expect(range.ok && range.data.kind === "range" && range.data.end).toEqual({ row: 9, col: 2 })
  })

  test("幻灯片与页面", () => {
    expect(parseOfficePath("/slide[2]/shape[1]")).toEqual({
      ok: true,
      data: { kind: "shape", slide: 2, index: 1 },
    })
    expect(parseOfficePath("/page[4]")).toEqual({ ok: true, data: { kind: "page", index: 4 } })
  })

  test("非法路径给出可执行建议", () => {
    const result = parseOfficePath("/body/x[1]")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.suggestion).toContain("/body/p[N]")
  })

  test("列号互转", () => {
    expect(columnToIndex("A")).toBe(0)
    expect(columnToIndex("AA")).toBe(26)
    expect(indexToColumn(26)).toBe("AA")
    expect(parseCellRef("AB12")).toEqual({ row: 11, col: 27 })
    expect(formatCellRef({ row: 11, col: 27 })).toBe("AB12")
  })
})

describe("pptxEngine：几何单位", () => {
  test("打开后页面尺寸是 pt，所有盒子都落在页面范围内", async () => {
    const state = await pptxEngine.open(fixture())
    expect(state.ok).toBe(true)
    if (!state.ok) return
    expect(state.data.size).toEqual({ w: 960, h: 540 })
    for (const node of state.data.nodes) {
      if (!node.box) continue
      expect(node.box.x).toBeGreaterThanOrEqual(0)
      expect(node.box.y).toBeGreaterThanOrEqual(0)
      expect(node.box.x + node.box.w).toBeLessThanOrEqual(960.001)
      expect(node.box.y + node.box.h).toBeLessThanOrEqual(540.001)
    }
  })

  test("用 pt 移动形状：写回的是 EMU，重新读取后位置一致", async () => {
    const bytes = fixture()
    const opened = await pptxEngine.open(bytes)
    if (!opened.ok) throw new Error("open failed")

    const applied = await pptxEngine.apply(
      opened.data,
      [{ op: "setShapeBox", slide: 1, shapeId: "2", box: { x: 72, y: 72, w: 480, h: 100 } }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["ppt/slides/slide1.xml"])

    const reopened = await pptxEngine.open(applied.data.bytes)
    if (!reopened.ok) throw new Error("reopen failed")
    const node = reopened.data.nodes.find((item) => item.shapeId === "2")
    expect(node?.box).toEqual({ x: 72, y: 72, w: 480, h: 100 })
  })

  test("改文字只重写目标 slide，其它条目字节原样", async () => {
    const bytes = fixture()
    const opened = await pptxEngine.open(bytes)
    if (!opened.ok) throw new Error("open failed")

    const applied = await pptxEngine.apply(
      opened.data,
      [{ op: "setParagraphText", slide: 1, shapeId: "2", paragraph: 0, text: "新的标题" }],
      bytes,
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.data.changed).toEqual(["ppt/slides/slide1.xml"])
    expect(containsBytes(applied.data.bytes, encoder.encode("screen16x9"))).toBeGreaterThanOrEqual(0)
  })
})

describe("DocumentSession：脏标记与撤销", () => {
  test("保存期间产生的新修改不会被标成已保存", async () => {
    const session = await DocumentSession.open(pptxEngine, fixture())
    if (!session.ok) throw new Error("open failed")
    const doc = session.data

    const revision = doc.saveRevision()
    expect(doc.dirty).toBe(false)

    const result = await doc.apply([{ op: "setParagraphText", slide: 1, shapeId: "2", paragraph: 0, text: "A" }])
    expect(result.ok).toBe(true)
    expect(doc.dirty).toBe(true)

    expect(doc.markSaved(revision)).toBe(false)
    expect(doc.dirty).toBe(true)

    expect(doc.markSaved(doc.saveRevision())).toBe(true)
    expect(doc.dirty).toBe(false)
  })

  test("撤销恢复到上一次的字节与布局", async () => {
    const session = await DocumentSession.open(pptxEngine, fixture())
    if (!session.ok) throw new Error("open failed")
    const doc = session.data
    const before = doc.state.nodes.find((item) => item.shapeId === "2")?.box

    await doc.apply([{ op: "setShapeBox", slide: 1, shapeId: "2", box: { x: 10, y: 10, w: 100, h: 50 } }])
    expect(doc.state.nodes.find((item) => item.shapeId === "2")?.box).toEqual({ x: 10, y: 10, w: 100, h: 50 })

    expect(doc.undo().ok).toBe(true)
    expect(doc.state.nodes.find((item) => item.shapeId === "2")?.box).toEqual(before)
    expect(doc.redo().ok).toBe(true)
    expect(doc.state.nodes.find((item) => item.shapeId === "2")?.box).toEqual({ x: 10, y: 10, w: 100, h: 50 })
  })

  test("一批操作里有一个失败，文件保持不变", async () => {
    const session = await DocumentSession.open(pptxEngine, fixture())
    if (!session.ok) throw new Error("open failed")
    const doc = session.data
    const bytes = doc.bytes

    const result = await doc.apply([
      { op: "setParagraphText", slide: 1, shapeId: "2", paragraph: 0, text: "改了" },
      { op: "setShapeBox", slide: 99, shapeId: "2", box: { x: 0, y: 0, w: 1, h: 1 } },
    ])
    expect(result.ok).toBe(false)
    expect(doc.bytes).toBe(bytes)
    expect(doc.dirty).toBe(false)
  })
})

describe("PathLocks", () => {
  test("同一路径串行执行", async () => {
    const locks = new PathLocks()
    const order: number[] = []
    await Promise.all([
      locks.run("a.pptx", async () => {
        await Bun.sleep(20)
        order.push(1)
      }),
      locks.run("a.pptx", async () => {
        order.push(2)
      }),
    ])
    expect(order).toEqual([1, 2])
  })
})
