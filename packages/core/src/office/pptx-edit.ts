/**
 * PPTX 文本级原地编辑。
 *
 * 目标不是"重新生成一份 PPT"，而是「改一个字就只改那个 shape」：
 * 只重写 `ppt/slides/slideN.xml` 里目标段落的 `<a:t>`，其余条目（图片、字体、
 * 母版、其它页）在 zip 里是**原样字节拷贝**，连压缩流都不重新压 —— 打开后
 * 版式、动画、编号、关系全是原来的，渲染器不认识的形状也不会被抹掉。
 *
 * 为什么不用渲染器的 serializePresentation：它输出的是 JSON 模型快照，
 * 回不到 OOXML，也不包含它没解析的扩展（SmartArt 的 diagram 数据、3D、墨迹…）。
 * 所以这里直接在原始 XML 文本上做外科手术。
 *
 * 关于「重算换行」：PowerPoint / WPS / Keynote 都是**打开时排版**，换行不落盘。
 * 改完文本由它们自己重排；我们只需要清掉 `<a:normAutofit fontScale>` 上残留的
 * 缩放比例，否则旧比例会压在新文本上。
 */

export type PptxTextEdit = {
  /** 1-based */
  slide: number
  /** `<p:cNvPr @id>`，最精确的定位方式 */
  shapeId?: string
  /** `<p:cNvPr @name>`，例如「标题 1」；和 shapeId 二选一 */
  shapeName?: string
  /** 段落序号，从 0 开始；省略时改第 0 段 */
  paragraph?: number
  /** 新文本；空串等于清空这一段 */
  text: string
}

export type PptxTextEditApplied = {
  slide: number
  shapeId: string
  shapeName?: string
  paragraph: number
  previous: string
  text: string
}

export type PptxTextEditResult = {
  bytes: Uint8Array
  applied: PptxTextEditApplied[]
  /** 真正被重写的 zip 条目（正常情况下只有 ppt/slides/slideN.xml） */
  changed: string[]
}

export type PptxSlideText = {
  slide: number
  shapeId: string
  shapeName?: string
  paragraphs: string[]
  /** 幻灯片坐标系里的位置（EMU），供 UI 叠层定位 */
  box?: { x: number; y: number; w: number; h: number }
}

export async function editPptxText(input: {
  bytes: Uint8Array
  edits: readonly PptxTextEdit[]
}): Promise<PptxTextEditResult> {
  if (input.edits.length === 0) return { bytes: input.bytes, applied: [], changed: [] }

  const zip = await readZip(input.bytes)
  const byEntry = new Map<string, PptxTextEdit[]>()
  for (const edit of input.edits) {
    const name = slideEntryName(zip, edit.slide)
    const list = byEntry.get(name) ?? []
    list.push(edit)
    byEntry.set(name, list)
  }

  const replacements = new Map<string, Uint8Array>()
  const applied: PptxTextEditApplied[] = []
  for (const [name, edits] of byEntry) {
    const entry = zip.entries.find((item) => item.name === name)
    if (!entry) throw new Error("PPTX 里没有第 " + (edits[0]?.slide ?? 0) + " 页（" + name + "）")
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    const outcome = applyTextEdits(xml, edits)
    if (outcome.applied.length === 0) continue
    replacements.set(name, new TextEncoder().encode(outcome.xml))
    applied.push(...outcome.applied)
  }

  if (replacements.size === 0) {
    throw new Error("没有找到要修改的形状：请先读取页面文字，确认形状 id 或名称")
  }
  return { bytes: rebuildZip(zip, replacements), applied, changed: [...replacements.keys()] }
}

/** 列出每一页上「有文字的形状」及其段落，供 UI 叠层和 AI 定位使用。 */
export async function readPptxTextLayout(bytes: Uint8Array, slides?: readonly number[]): Promise<PptxSlideText[]> {
  const zip = await readZip(bytes)
  const wanted = slides ? new Set(slides) : undefined
  const result: PptxSlideText[] = []
  for (const entry of zip.entries) {
    const match = entry.name.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (!match) continue
    const slide = Number(match[1])
    if (wanted && !wanted.has(slide)) continue
    const xml = new TextDecoder().decode(await entryData(zip.bytes, entry))
    for (const shape of shapeBlocks(xml)) {
      const paragraphs = shape.paragraphs.map((paragraph) => paragraph.text)
      if (paragraphs.every((text) => !text.trim())) continue
      result.push({ slide, shapeId: shape.id, shapeName: shape.name, paragraphs, box: shape.box })
    }
  }
  return result.sort((a, b) => a.slide - b.slide)
}

// ---------------------------------------------------------------------------
// XML 手术
// ---------------------------------------------------------------------------

type ShapeBlock = {
  id: string
  name?: string
  start: number
  end: number
  box?: { x: number; y: number; w: number; h: number }
  paragraphs: ParagraphBlock[]
}

type ParagraphBlock = { start: number; end: number; text: string; runs: RunBlock[] }
type RunBlock = { start: number; end: number; text: string; rPr?: string }

const SP_OPEN = /<p:sp(?:\s[^>]*)?>/g

function shapeBlocks(xml: string): ShapeBlock[] {
  const result: ShapeBlock[] = []
  SP_OPEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SP_OPEN.exec(xml))) {
    const start = match.index
    const close = xml.indexOf("</p:sp>", start)
    if (close === -1) break
    const end = close + "</p:sp>".length
    const body = xml.slice(start, end)
    const cNvPr = body.match(/<p:cNvPr\b[^>]*>/)?.[0]
    const id = cNvPr?.match(/\sid="([^"]*)"/)?.[1] ?? ""
    if (!id) continue
    const name = cNvPr?.match(/\sname="([^"]*)"/)?.[1]
    result.push({
      id,
      name: name === undefined ? undefined : decodeXml(name),
      start,
      end,
      box: shapeBox(body),
      paragraphs: paragraphBlocks(body).map((paragraph) => ({
        start: start + paragraph.start,
        end: start + paragraph.end,
        text: paragraph.text,
        runs: paragraph.runs.map((run) => ({ ...run, start: start + run.start, end: start + run.end })),
      })),
    })
    SP_OPEN.lastIndex = end
  }
  return result
}

function shapeBox(body: string) {
  const off = body.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/)
  const ext = body.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)
  if (!off || !ext) return undefined
  return { x: Number(off[1]), y: Number(off[2]), w: Number(ext[1]), h: Number(ext[2]) }
}

function paragraphBlocks(body: string): ParagraphBlock[] {
  // 形状的正文容器是 <p:txBody>（`a:txBody` 只出现在图表/表格里），两种都认。
  const txBody = body.match(/<(?:p|a):txBody(?:\s[^>]*)?>([\s\S]*?)<\/(?:p|a):txBody>/)
  if (!txBody) return []
  const inner = txBody[1] ?? ""
  const base = (txBody.index ?? 0) + txBody[0].indexOf(">") + 1
  const result: ParagraphBlock[] = []
  // `<a:p>` / `<a:r>` 偶尔带属性（lang、smtClean 之类），标签长度不能写死。
  const paragraphRe = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g
  let match: RegExpExecArray | null
  while ((match = paragraphRe.exec(inner))) {
    const start = base + match.index
    const end = start + match[0].length
    const innerStart = start + match[0].indexOf(">") + 1
    const runs: RunBlock[] = []
    const runRe = /<a:r(?:\s[^>]*)?>([\s\S]*?)<\/a:r>/g
    let run: RegExpExecArray | null
    while ((run = runRe.exec(match[1] ?? ""))) {
      const runStart = innerStart + run.index
      const runEnd = runStart + run[0].length
      const text = run[1]?.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/)?.[1] ?? ""
      runs.push({
        start: runStart,
        end: runEnd,
        text: decodeXml(text),
        rPr: run[1]?.match(/<a:rPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:rPr>)/)?.[0],
      })
    }
    result.push({ start, end, text: runs.map((item) => item.text).join(""), runs })
  }
  return result
}

function applyTextEdits(xml: string, edits: readonly PptxTextEdit[]) {
  const shapes = shapeBlocks(xml)
  const applied: PptxTextEditApplied[] = []
  const splices: Array<{ start: number; end: number; replacement: string }> = []

  for (const edit of edits) {
    const shape = shapes.find((item) =>
      edit.shapeId ? item.id === edit.shapeId : edit.shapeName ? item.name === edit.shapeName : false,
    )
    if (!shape) continue
    const index = edit.paragraph ?? 0
    const paragraph = shape.paragraphs[index]
    if (!paragraph) continue

    // 沿用这一段第一个 run 的字体/字号/颜色；空段落就没有 rPr，用默认格式。
    const runPr = paragraph.runs[0]?.rPr
    const replacement =
      "<a:p>" +
      paragraphXmlPrefix(xml, paragraph) +
      (runPr ? "<a:r>" + runPr : "<a:r>") +
      '<a:t xml:space="preserve">' +
      encodeXml(edit.text) +
      "</a:t></a:r>" +
      paragraphXmlSuffix(xml, paragraph) +
      "</a:p>"
    splices.push({ start: paragraph.start, end: paragraph.end, replacement })
    applied.push({
      slide: edit.slide,
      shapeId: shape.id,
      shapeName: shape.name,
      paragraph: index,
      previous: paragraph.text,
      text: edit.text,
    })
  }

  if (splices.length === 0) return { xml, applied: [] }

  // 从后往前替换，避免前面的改动把后面的偏移量挪走。
  let next = xml
  for (const item of [...splices].sort((a, b) => b.start - a.start)) {
    next = next.slice(0, item.start) + item.replacement + next.slice(item.end)
  }
  next = resetAutoFit(next, new Set(applied.map((item) => item.shapeId)))
  return { xml: next, applied }
}

/** 段落属性（缩进/项目符号/对齐）直接决定排版，丢了等于重排整页。 */
function paragraphXmlPrefix(xml: string, paragraph: ParagraphBlock) {
  const body = xml.slice(paragraph.start, paragraph.end)
  return body.match(/<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>)/)?.[0] ?? ""
}

/** 段落结束符属性决定空行高度，一起留着。 */
function paragraphXmlSuffix(xml: string, paragraph: ParagraphBlock) {
  const body = xml.slice(paragraph.start, paragraph.end)
  return body.match(/<a:endParaRPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:endParaRPr>)/)?.[0] ?? ""
}

/** 改过文本的形状：清掉 autofit 上残留的缩放比例，让编辑器打开时自己重算字号。 */
function resetAutoFit(xml: string, shapeIds: Set<string>) {
  if (shapeIds.size === 0) return xml
  const targets = shapeBlocks(xml).filter((shape) => shapeIds.has(shape.id))
  let next = xml
  for (const shape of [...targets].sort((a, b) => b.start - a.start)) {
    const body = next.slice(shape.start, shape.end)
    const patched = body.replace(/<a:normAutofit\b([^>]*?)\/>/g, (_whole, attrs: string) => {
      const cleaned = attrs
        .replace(/\s(?:fontScale|lnSpcReduction)="[^"]*"/g, "")
        .trimEnd()
      return cleaned ? "<a:normAutofit" + cleaned + "/>" : "<a:normAutofit/>"
    })
    if (patched === body) continue
    next = next.slice(0, shape.start) + patched + next.slice(shape.end)
  }
  return next
}

function encodeXml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function decodeXml(input: string) {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
}

function slideEntryName(zip: ZipArchive, slide: number) {
  const name = "ppt/slides/slide" + slide + ".xml"
  if (zip.entries.some((entry) => entry.name === name)) return name
  throw new Error("PPTX 里没有第 " + slide + " 页（缺 " + name + "）")
}

// ---------------------------------------------------------------------------
// ZIP 读写：只重写被改的条目，其余条目原样拷贝字节
// ---------------------------------------------------------------------------

type ZipEntry = {
  name: string
  nameBytes: Uint8Array
  method: number
  flags: number
  crc: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
  extra: Uint8Array
  comment: Uint8Array
  /** 本地头的名字/扩展区长度可能与中央目录不同，必须各读各的 */
  localNameLength: number
  localExtraLength: number
}

type ZipArchive = { bytes: Uint8Array; entries: ZipEntry[]; comment: Uint8Array }

async function readZip(bytes: Uint8Array): Promise<ZipArchive> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(view)
  if (eocd === -1) throw new Error("不是有效的 ZIP/PPTX 文件（找不到中央目录）")
  const count = view.getUint16(eocd + 10, true)
  const offset = view.getUint32(eocd + 16, true)
  if (offset === 0xffffffff || count === 0xffff) {
    throw new Error("暂不支持 ZIP64 的 PPTX（通常是单文件超过 4GB）")
  }
  const commentLength = view.getUint16(eocd + 20, true)
  const comment = bytes.slice(eocd + 22, eocd + 22 + commentLength)

  const entries: ZipEntry[] = []
  let cursor = offset
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("中央目录损坏")
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    const crc = view.getUint32(cursor + 16, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentSize = view.getUint16(cursor + 32, true)
    const localOffset = view.getUint32(cursor + 42, true)
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength)
    const extra = bytes.slice(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength)
    const entryComment = bytes.slice(
      cursor + 46 + nameLength + extraLength,
      cursor + 46 + nameLength + extraLength + commentSize,
    )
    cursor += 46 + nameLength + extraLength + commentSize

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("本地文件头损坏")
    entries.push({
      name: new TextDecoder("utf-8", { fatal: false }).decode(nameBytes),
      nameBytes,
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      extra,
      comment: entryComment,
      localNameLength: view.getUint16(localOffset + 26, true),
      localExtraLength: view.getUint16(localOffset + 28, true),
    })
  }
  return { bytes, entries, comment }
}

function findEndOfCentralDirectory(view: DataView) {
  const min = Math.max(0, view.byteLength - 0xffff - 22)
  for (let cursor = view.byteLength - 22; cursor >= min; cursor--) {
    if (view.getUint32(cursor, true) === 0x06054b50) return cursor
  }
  return -1
}

async function entryData(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const start = entry.localOffset + 30 + entry.localNameLength + entry.localExtraLength
  const raw = bytes.slice(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8) throw new Error("不支持的压缩方式 " + entry.method + "（" + entry.name + "）")
  return inflateRaw(raw)
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function rebuildZip(zip: ZipArchive, replacements: Map<string, Uint8Array>) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of zip.entries) {
    const replacement = replacements.get(entry.name)
    let record: Uint8Array
    if (replacement) {
      // 改动条目以 stored 形式写入：不重新压缩，内容可复现。
      const crc = crc32(replacement)
      const flags = entry.flags & ~0x8
      record = concat([
        u32(0x04034b50),
        u16(20),
        u16(flags),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(replacement.length),
        u32(replacement.length),
        u16(entry.nameBytes.length),
        u16(entry.extra.length),
        entry.nameBytes,
        entry.extra,
        replacement,
      ])
      centralParts.push(
        concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(flags),
          u16(0),
          u16(0),
          u16(0),
          u32(crc),
          u32(replacement.length),
          u32(replacement.length),
          u16(entry.nameBytes.length),
          u16(entry.extra.length),
          u16(entry.comment.length),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          entry.nameBytes,
          entry.extra,
          entry.comment,
        ]),
      )
    } else {
      // 未改动的条目：连本地头一起原样拷贝，压缩流一个字节都不碰。
      const end = entry.localOffset + 30 + entry.localNameLength + entry.localExtraLength + entry.compressedSize
      record = zip.bytes.slice(entry.localOffset, end)
      centralParts.push(
        concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(entry.flags),
          u16(entry.method),
          u16(0),
          u16(0),
          u32(entry.crc),
          u32(entry.compressedSize),
          u32(entry.uncompressedSize),
          u16(entry.nameBytes.length),
          u16(entry.extra.length),
          u16(entry.comment.length),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          entry.nameBytes,
          entry.extra,
          entry.comment,
        ]),
      )
    }
    localParts.push(record)
    offset += record.length
  }

  const central = concat(centralParts)
  return concat([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(zip.entries.length),
    u16(zip.entries.length),
    u32(central.length),
    u32(offset),
    u16(zip.comment.length),
    zip.comment,
  ])
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

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

let crcTable: Uint32Array | undefined

function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let value = index
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      crcTable[index] = value >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
