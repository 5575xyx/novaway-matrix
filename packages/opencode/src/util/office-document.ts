import path from "path"
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"

const OFFICE_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

const OFFICE_EXTS = new Set([".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"])
const XML_TEXT_LIMIT = 160_000

export type OfficeDocumentText = {
  kind: "docx" | "pptx" | "xlsx" | "legacy-office"
  text: string
}

export type PptxTextFillPlan = {
  slides: ReadonlyArray<{
    slide: number
    texts: ReadonlyArray<string>
    images?: ReadonlyArray<{
      mime: string
      dataBase64: string
    }>
    tables?: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>
    charts?: ReadonlyArray<{
      categories: ReadonlyArray<string>
      series: ReadonlyArray<{
        name: string
        values: ReadonlyArray<number>
      }>
    }>
  }>
}

export function isOfficeDocument(filename: string | undefined, mime: string | undefined) {
  const type = mime?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (OFFICE_MIMES.has(type)) return true
  if (!filename) return false
  return OFFICE_EXTS.has(path.extname(filename).toLowerCase())
}

export async function extractOfficeDocumentText(input: {
  filename: string
  mime?: string
  bytes: Uint8Array
}): Promise<OfficeDocumentText | undefined> {
  const ext = path.extname(input.filename).toLowerCase()
  if (ext === ".docx") return { kind: "docx", text: await extractDocx(input.bytes) }
  if (ext === ".pptx") return { kind: "pptx", text: await extractPptx(input.bytes) }
  if (ext === ".xlsx") return { kind: "xlsx", text: await extractXlsx(input.bytes) }
  if (ext === ".doc" || ext === ".ppt" || ext === ".xls") {
    return { kind: "legacy-office", text: extractLegacyOfficeText(input.bytes) }
  }

  const type = input.mime?.split(";", 1)[0]?.trim().toLowerCase()
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return { kind: "docx", text: await extractDocx(input.bytes) }
  }
  if (type === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return { kind: "pptx", text: await extractPptx(input.bytes) }
  }
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return { kind: "xlsx", text: await extractXlsx(input.bytes) }
  }
}

export async function fillPptxTemplateText(input: { bytes: Uint8Array; plan: PptxTextFillPlan }) {
  const replacements = new Map(input.plan.slides.map((slide) => [`ppt/slides/slide${slide.slide}.xml`, slide]))
  const imageReplacements = await pptxImageReplacementMap(input.bytes, input.plan)
  const chartReplacements = await pptxChartReplacementMap(input.bytes, input.plan)
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(input.bytes)])))
  const writer = new ZipWriter(new BlobWriter("application/vnd.openxmlformats-officedocument.presentationml.presentation"))
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue
      const image = imageReplacements.get(entry.filename)
      if (image) {
        await writer.add(entry.filename, new BlobReader(new Blob([Buffer.from(image.dataBase64, "base64")], { type: image.mime })))
        continue
      }
      const chart = chartReplacements.get(entry.filename)
      if (chart) {
        await writer.add(entry.filename, new TextReader(replacePptxChartXml((await entry.getData?.(new TextWriter())) ?? "", chart)))
        continue
      }
      const slide = replacements.get(entry.filename)
      if (slide) {
        await writer.add(
          entry.filename,
          new TextReader(replacePptxTextRuns(replacePptxTables((await entry.getData?.(new TextWriter())) ?? "", slide.tables ?? []), slide.texts)),
        )
        continue
      }
      const blob = await entry.getData?.(new BlobWriter())
      if (blob) await writer.add(entry.filename, new BlobReader(blob))
    }
    return new Uint8Array(await (await writer.close()).arrayBuffer())
  } finally {
    await reader.close()
  }
}

async function pptxImageReplacementMap(bytes: Uint8Array, plan: PptxTextFillPlan) {
  const bySlide = new Map(plan.slides.flatMap((slide) => (slide.images?.length ? [[slide.slide, slide.images] as const] : [])))
  if (bySlide.size === 0) return new Map<string, { mime: string; dataBase64: string }>()

  const result = new Map<string, { mime: string; dataBase64: string }>()
  const rels = await zipTextEntries(bytes, (name) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name))
  for (const rel of rels) {
    const images = bySlide.get(slideNumberFromRels(rel.name))
    if (!images?.length) continue
    const targets = [...rel.text.matchAll(/<Relationship\b[^>]*\bType="[^"]*\/image"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g)]
      .map((match) => decodeXml(match[1] ?? ""))
      .filter(Boolean)
      .map((target) => pptxRelationshipTarget("ppt/slides", target))
    targets.slice(0, images.length).forEach((target, index) => {
      const image = images[index]
      if (image) result.set(target, image)
    })
  }
  return result
}

async function pptxChartReplacementMap(bytes: Uint8Array, plan: PptxTextFillPlan) {
  const bySlide = new Map(plan.slides.flatMap((slide) => (slide.charts?.length ? [[slide.slide, slide.charts] as const] : [])))
  if (bySlide.size === 0) {
    return new Map<
      string,
      {
        categories: ReadonlyArray<string>
        series: ReadonlyArray<{ name: string; values: ReadonlyArray<number> }>
      }
    >()
  }

  const result = new Map<string, { categories: ReadonlyArray<string>; series: ReadonlyArray<{ name: string; values: ReadonlyArray<number> }> }>()
  const rels = await zipTextEntries(bytes, (name) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name))
  for (const rel of rels) {
    const charts = bySlide.get(slideNumberFromRels(rel.name))
    if (!charts?.length) continue
    const targets = [...rel.text.matchAll(/<Relationship\b[^>]*\bType="[^"]*\/chart"[^>]*\bTarget="([^"]+)"[^>]*\/?>/g)]
      .map((match) => decodeXml(match[1] ?? ""))
      .filter(Boolean)
      .map((target) => pptxRelationshipTarget("ppt/slides", target))
    targets.slice(0, charts.length).forEach((target, index) => {
      const chart = charts[index]
      if (chart) result.set(target, chart)
    })
  }
  return result
}

async function zipTextEntries(bytes: Uint8Array, predicate: (name: string) => boolean) {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(bytes)])))
  try {
    const entries = await reader.getEntries()
    const matched = entries
      .filter((entry) => !entry.directory && predicate(entry.filename))
      .sort((a, b) => naturalCompare(a.filename, b.filename))

    const result: Array<{ name: string; text: string }> = []
    for (const entry of matched) {
      const text = await entry.getData?.(new TextWriter())
      if (text) result.push({ name: entry.filename, text })
    }
    return result
  } finally {
    await reader.close()
  }
}

async function extractDocx(bytes: Uint8Array) {
  const entries = await zipTextEntries(
    bytes,
    (name) =>
      name === "word/document.xml" ||
      /^word\/(header|footer)\d+\.xml$/.test(name) ||
      name === "docProps/core.xml",
  )
  return clamp(
    entries
      .flatMap((entry) => xmlParagraphs(entry.text))
      .filter(Boolean)
      .join("\n\n"),
  )
}

async function extractPptx(bytes: Uint8Array) {
  const entries = await zipTextEntries(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
  const notes = new Map(
    (await zipTextEntries(bytes, (name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))).map((entry) => [
      slideNumber(entry.name),
      xmlTextRuns(entry.text),
    ]),
  )
  return clamp(
    [
      await pptxTemplateSignals(bytes, entries),
      entries
      .map((entry, index) => {
        const lines = xmlTextRuns(entry.text)
        const noteLines = notes.get(slideNumber(entry.name)) ?? []
        if (lines.length === 0 && noteLines.length === 0) return ""
        return [
          `## 第 ${index + 1} 页`,
          ...lines,
          ...(noteLines.length > 0 ? ["### 演讲备注", ...noteLines] : []),
        ].join("\n")
      })
      .filter(Boolean)
      .join("\n\n"),
    ]
      .filter(Boolean)
      .join("\n\n"),
  )
}

async function pptxTemplateSignals(bytes: Uint8Array, slides: Array<{ name: string; text: string }>) {
  const theme = (await zipTextEntries(bytes, (name) => /^ppt\/theme\/theme\d+\.xml$/.test(name))).map((entry) => entry.text).join("\n")
  const colors = unique([...theme.matchAll(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/g)].map((match) => `#${match[1]?.toUpperCase()}`)).slice(0, 8)
  const fonts = unique([...theme.matchAll(/typeface="([^"]+)"/g)].map((match) => decodeXml(match[1] ?? "").trim()).filter(Boolean)).slice(0, 6)
  const library = slides
    .map((slide, index) => {
      const lines = xmlTextRuns(slide.text)
      const slots = pptxSlideSlots(slide.text)
      const features = [
        `${xmlElementCount(slide.text, "p:sp")} 个文本/形状框`,
        slots.length > 0 ? `可替换槽位：${pptxSlotSummary(slots)}` : undefined,
        xmlElementCount(slide.text, "p:pic") > 0 ? `${xmlElementCount(slide.text, "p:pic")} 个图片位` : undefined,
        xmlElementCount(slide.text, "a:tbl") > 0 ? `${xmlElementCount(slide.text, "a:tbl")} 个表格` : undefined,
        /c:chart|\/chart/.test(slide.text) ? "包含图表" : undefined,
      ].filter(Boolean)
      return `- 第 ${index + 1} 页：${pptxPageRole(lines, index, slides.length)}；${features.join("，") || "结构较简洁"}`
    })
    .join("\n")

  return [
    "## PPTX模板设计信号",
    colors.length > 0 ? `- 主题色：${colors.join("、")}` : undefined,
    fonts.length > 0 ? `- 字体：${fonts.join("、")}` : undefined,
    `- 幻灯片数量：${slides.length}`,
    "- 模板页库：",
    library,
    "- 使用建议：生成新 PPT 时优先沿用这些主题色、字体气质和页面结构；不要把源 PPTX 当普通文本资料处理。",
  ]
    .filter(Boolean)
    .join("\n")
}

function pptxPageRole(lines: string[], index: number, total: number) {
  const text = lines.join("")
  if (index === 0) return "封面候选"
  if (index === total - 1 && /谢谢|致谢|总结|结论|下一步|thanks|summary|conclusion|next/i.test(text)) return "收尾候选"
  if (/目录|议程|agenda|outline/i.test(text)) return "目录候选"
  if (/数据|指标|图表|增长|收入|成本|利润|%|％|\d/.test(text)) return "数据页候选"
  if (lines.length <= 2) return "章节/观点页候选"
  return "内容页候选"
}

function pptxSlideSlots(xml: string) {
  return xmlBlocks(xml, "p:sp")
    .map((shape, index) => {
      const text = xmlTextRuns(shape).join(" ").trim()
      if (!text) return
      const name = decodeXml(shape.match(/<p:cNvPr[^>]*\sname="([^"]*)"/)?.[1] ?? "")
      const placeholder = shape.match(/<p:ph[^>]*\stype="([^"]*)"/)?.[1] ?? ""
      const geometry = pptxShapeGeometry(shape)
      return {
        id: `slot-${index + 1}`,
        role: pptxSlotRole(name, placeholder, text, geometry),
        chars: text.length,
        geometry,
      }
    })
    .filter((slot): slot is NonNullable<typeof slot> => !!slot)
}

function pptxSlotSummary(slots: ReturnType<typeof pptxSlideSlots>) {
  return Object.entries(
    slots.reduce<Record<string, number>>((result, slot) => ({ ...result, [slot.role]: (result[slot.role] ?? 0) + 1 }), {}),
  )
    .map(([role, count]) => `${pptxSlotRoleLabel(role)} ${count}`)
    .join("、")
}

function pptxShapeGeometry(xml: string) {
  const off = xml.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/)
  const ext = xml.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/)
  if (!off || !ext) return
  return {
    x: Number(off[1]),
    y: Number(off[2]),
    cx: Number(ext[1]),
    cy: Number(ext[2]),
  }
}

function pptxSlotRole(name: string, placeholder: string, text: string, geometry: ReturnType<typeof pptxShapeGeometry>) {
  const signal = `${name} ${placeholder}`.toLowerCase()
  if (/subtitle/.test(signal)) return "subtitle"
  if (/title|ctrtitle/.test(signal) || (geometry && geometry.cy < 900_000 && text.length <= 60)) return "title"
  if (/body|content|obj/.test(signal) || text.length > 80 || (geometry && geometry.cy > 1_100_000)) return "body"
  if (/dt|ftr|sldnum|date|footer|label/.test(signal) || text.length <= 24) return "label"
  return "shape"
}

function pptxSlotRoleLabel(role: string) {
  if (role === "title") return "标题槽"
  if (role === "body") return "正文槽"
  if (role === "label") return "标签槽"
  return "文本槽"
}

async function extractXlsx(bytes: Uint8Array) {
  const shared = new Map<number, string>()
  const sharedEntries = await zipTextEntries(bytes, (name) => name === "xl/sharedStrings.xml")
  for (const entry of sharedEntries) {
    xmlBlocks(entry.text, "si").forEach((block, index) => {
      shared.set(index, xmlTextRuns(block).join(""))
    })
  }

  const sheets = await zipTextEntries(bytes, (name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  return clamp(
    sheets
      .map((entry, index) => {
        const rows = xmlBlocks(entry.text, "row")
          .map((row) =>
            xmlBlocks(row, "c")
              .map((cell) => cellValue(cell, shared))
              .filter(Boolean)
              .join(" | "),
          )
          .filter(Boolean)
        if (rows.length === 0) return ""
        return [`## 工作表 ${index + 1}`, ...rows].join("\n")
      })
      .filter(Boolean)
      .join("\n\n"),
  )
}

function cellValue(cell: string, shared: Map<number, string>) {
  const value = tagText(cell, "v")
  if (cell.includes('t="s"')) return shared.get(Number(value)) ?? ""
  if (cell.includes('t="inlineStr"')) return xmlTextRuns(cell).join("")
  return decodeXml(value)
}

function xmlParagraphs(xml: string) {
  return xmlBlocks(xml, "w:p")
    .map((block) => xmlTextRuns(block).join("").replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function xmlTextRuns(xml: string) {
  const normalized = xml
    .replace(/<(?:w|a):tab\s*\/>/g, "\t")
    .replace(/<(?:w|a):br\s*\/>/g, "\n")
  return [...normalized.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t|t)>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter((text) => text.trim())
}

function xmlBlocks(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "g"))].map((match) => match[0])
}

function xmlElementCount(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`, "g"))].length
}

function tagText(xml: string, tag: string) {
  return decodeXml(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? "")
}

function replacePptxTextRuns(xml: string, replacements: ReadonlyArray<string>) {
  const slots = pptxSlideSlots(xml)
  const bodySlots = slots.filter((slot) => slot.role === "body").length
  const titleSlots = slots.filter((slot) => slot.role === "title").length
  const subtitleSlots = slots.filter((slot) => slot.role === "subtitle").length
  if (bodySlots > 0) return replacePptxShapeSlots(xml, replacements, bodySlots, titleSlots > 0, subtitleSlots > 0)

  let index = 0
  return xml.replace(/(<a:t(?:\s[^>]*)?>)([\s\S]*?)(<\/a:t>)/g, (match, open: string, _text: string, close: string) =>
    index < replacements.length ? `${open}${encodeXml(replacements[index++] ?? "")}${close}` : match,
  )
}

function replacePptxTables(xml: string, tables: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>) {
  let tableIndex = 0
  return xml.replace(/<a:tbl(?:\s[^>]*)?>[\s\S]*?<\/a:tbl>/g, (tableXml) => {
    const table = tables[tableIndex++]
    if (!table) return tableXml
    return replaceTableRows(tableXml, table)
  })
}

function replaceTableRows(xml: string, table: ReadonlyArray<ReadonlyArray<string>>) {
  const rows = [...xml.matchAll(/<a:tr(?:\s[^>]*)?>[\s\S]*?<\/a:tr>/g)].map((match) => match[0])
  if (rows.length === 0 || table.length === 0) return xml

  let replaced = false
  return xml.replace(/<a:tr(?:\s[^>]*)?>[\s\S]*?<\/a:tr>/g, () => {
    if (replaced) return ""
    replaced = true
    return table.map((row, index) => replaceTableRowCells(rows[Math.min(index, rows.length - 1)] ?? rows[0]!, row)).join("")
  })
}

function replaceTableRowCells(xml: string, row: ReadonlyArray<string>) {
  const cells = [...xml.matchAll(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g)].map((match) => match[0])
  if (cells.length === 0 || row.length === 0) return xml

  let replaced = false
  return xml.replace(/<a:tc(?:\s[^>]*)?>[\s\S]*?<\/a:tc>/g, () => {
    if (replaced) return ""
    replaced = true
    return row.map((cell, index) => replaceTableCellText(cells[Math.min(index, cells.length - 1)] ?? cells[0]!, cell)).join("")
  })
}

function replaceTableCellText(xml: string, value: string) {
  let touched = false
  return xml.replace(/(<a:t(?:\s[^>]*)?>)([\s\S]*?)(<\/a:t>)/g, (match, open: string, _text: string, close: string) => {
    if (touched) return `${open}${close}`
    touched = true
    return `${open}${encodeXml(value)}${close}`
  })
}

function replacePptxChartXml(
  xml: string,
  chart: { categories: ReadonlyArray<string>; series: ReadonlyArray<{ name: string; values: ReadonlyArray<number> }> },
) {
  const templateSeries = [...xml.matchAll(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g)].map((match) => match[0])
  if (templateSeries.length === 0 || chart.series.length === 0) return xml

  let replaced = false
  return xml.replace(/<c:ser(?:\s[^>]*)?>[\s\S]*?<\/c:ser>/g, () => {
    if (replaced) return ""
    replaced = true
    return chart.series
      .map((series, index) => replaceChartSeries(templateSeries[Math.min(index, templateSeries.length - 1)] ?? templateSeries[0]!, chart.categories, series, index))
      .join("")
  })
}

function replaceChartSeries(
  xml: string,
  categories: ReadonlyArray<string>,
  series: { name: string; values: ReadonlyArray<number> },
  index: number,
) {
  return replaceChartBlock(
    replaceChartBlock(
      replaceChartBlock(
        xml.replace(/<c:idx\s+val="\d+"\s*\/>/, `<c:idx val="${index}"/>`).replace(/<c:order\s+val="\d+"\s*\/>/, `<c:order val="${index}"/>`),
        "c:tx",
        chartTextCache(series.name),
      ),
      "c:cat",
      chartCategoryCache(categories),
    ),
    "c:val",
    chartValueCache(series.values),
  )
}

function replaceChartBlock(xml: string, tag: string, value: string) {
  return xml.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`), value)
}

function chartTextCache(value: string) {
  return `<c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${encodeXml(value)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
}

function chartCategoryCache(categories: ReadonlyArray<string>) {
  return `<c:cat><c:strRef><c:strCache><c:ptCount val="${categories.length}"/>${categories
    .map((category, index) => `<c:pt idx="${index}"><c:v>${encodeXml(category)}</c:v></c:pt>`)
    .join("")}</c:strCache></c:strRef></c:cat>`
}

function chartValueCache(values: ReadonlyArray<number>) {
  return `<c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${Number.isFinite(value) ? value : 0}</c:v></c:pt>`)
    .join("")}</c:numCache></c:numRef></c:val>`
}

function replacePptxShapeSlots(
  xml: string,
  replacements: ReadonlyArray<string>,
  bodySlots: number,
  hasTitleSlot: boolean,
  hasSubtitleSlot: boolean,
) {
  const bodyChunks = chunkText(replacements.slice((hasTitleSlot ? 1 : 0) + (hasSubtitleSlot ? 1 : 0)), bodySlots)
  let titleUsed = false
  let subtitleUsed = false
  let bodyIndex = 0

  return xml.replace(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g, (shape) => {
    const text = xmlTextRuns(shape).join(" ").trim()
    if (!text) return shape

    const name = decodeXml(shape.match(/<p:cNvPr[^>]*\sname="([^"]*)"/)?.[1] ?? "")
    const placeholder = shape.match(/<p:ph[^>]*\stype="([^"]*)"/)?.[1] ?? ""
    const role = pptxSlotRole(name, placeholder, text, pptxShapeGeometry(shape))
    if (hasTitleSlot && role === "title" && !titleUsed && replacements[0]) {
      titleUsed = true
      return replaceShapeTextRuns(shape, [replacements[0]])
    }
    if (hasSubtitleSlot && role === "subtitle" && !subtitleUsed && replacements[1]) {
      subtitleUsed = true
      return replaceShapeTextRuns(shape, [replacements[1]])
    }
    if (role === "body") return replaceShapeTextRuns(shape, [bodyChunks[bodyIndex++] ?? ""])
    return shape
  })
}

function replaceShapeTextRuns(xml: string, replacements: ReadonlyArray<string>) {
  let index = 0
  let touched = false
  return xml.replace(/(<a:t(?:\s[^>]*)?>)([\s\S]*?)(<\/a:t>)/g, (match, open: string, _text: string, close: string) => {
    if (index < replacements.length) {
      touched = true
      return `${open}${encodeXml(replacements[index++] ?? "")}${close}`
    }
    return touched ? `${open}${close}` : match
  })
}

function chunkText(lines: ReadonlyArray<string>, count: number) {
  if (count <= 1) return [lines.join("\n")]
  return Array.from({ length: count }, (_, index) =>
    lines
      .slice(Math.ceil((lines.length * index) / count), Math.ceil((lines.length * (index + 1)) / count))
      .join("\n"),
  )
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function encodeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function extractLegacyOfficeText(bytes: Uint8Array) {
  const ascii = Buffer.from(bytes)
    .toString("latin1")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)

  const utf16 = Buffer.from(bytes)
    .toString("utf16le")
    .replace(/[^\u0009\u000a\u000d\u0020-\u9fff]+/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4)

  return clamp([...new Set([...utf16, ...ascii])].join("\n"))
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function clamp(text: string) {
  return text.trim().slice(0, XML_TEXT_LIMIT)
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

function slideNumber(name: string) {
  return Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0)
}

function slideNumberFromRels(name: string) {
  return Number(name.match(/slide(\d+)\.xml\.rels$/)?.[1] ?? 0)
}

function pptxRelationshipTarget(base: string, target: string) {
  if (target.startsWith("/")) return target.replace(/^\/+/, "")
  return path.posix.normalize(path.posix.join(base, target))
}
