/**
 * 知识库文档正文抽取。
 *
 * 目标：把用户随手丢进来的常见办公文件变成可检索的纯文本，
 * 不引入重型解析服务（RAGFlow 那套版面模型对本地个人知识库过重）。
 *
 * 支持：
 * - 文本类：md / txt / json / csv / log / yaml / xml / html（去标签）
 * - DOCX：解压 word/document.xml，段落与制表符还原成换行/缩进
 * - PPTX：按幻灯片顺序拼接 a:t 文本
 * - XLSX：见 ./xlsx.ts —— 数字格式（日期/百分比/千分位）、合并单元格、真实表名
 * - PDF：解压 FlateDecode 内容流，取 Tj/TJ 文本（覆盖大多数文本型 PDF；
 *   扫描件/自定义字体编码抽不出文字时返回空串，由调用方给出提示）
 */
import { inflateSync } from "node:zlib"
import { ocrImage, type OcrResult } from "./ocr"
import { xlsxToText } from "./xlsx"
import { pdfLines, orderByColumns, type PdfLine } from "./pdf/layout"
import { readPdfString, unescapePdf } from "./pdf/lexer"

export type ExtractResult = {
  text: string
  /** 抽取时发现的问题（例如 PDF 无可提取文本）。 */
  warning?: string
  /** 这一次是否走了 OCR、用的哪个后端。 */
  ocr?: { used: boolean; backend?: string }
}

const decoder = new TextDecoder("utf-8")

export const SUPPORTED_EXTENSIONS = [
  "md",
  "markdown",
  "txt",
  "text",
  "json",
  "csv",
  "tsv",
  "log",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "docx",
  "pptx",
  "xlsx",
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "tif",
  "tiff",
] as const

export function extensionOf(name: string) {
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index + 1).toLowerCase()
}

export function isSupportedFile(name: string) {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

/** 视觉模型兜底：把图片交给多模态模型转写文字。 */
export type VisionOcr = (input: { data: Buffer; mimeType: string }) => Promise<string>

export type ExtractOptions = {
  vision?: VisionOcr
  ocrLanguages?: string[]
}

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"] as const

export function isImageFile(name: string) {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

function decodeEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, String.fromCharCode(39))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

function normalize(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** HTML/XML 转纯文本：块级标签转换行，行内标签直接去掉。 */
export function htmlToText(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
  return normalize(decodeEntities(text))
}

/** 一段 XML 里的纯文本（保留制表符与换行）。 */
function docxRunsText(xml: string) {
  return decodeEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
}

/**
 * Word 表格转 markdown 表格。
 *
 * 之前表格被拍平成「制表符 + 换行」的纯文本，行列关系丢失，检索时
 * 「第 3 行第 2 列」这种结构信息完全没用。这里按行/单元格还原成
 * `| a | b |` 形式，首行作为表头并补一条分隔线。
 */
export function docxTableToMarkdown(table: string) {
  const rows: string[][] = []
  for (const rowMatch of table.matchAll(/<w:tr[^>]*>([\s\S]*?)<\/w:tr>/g)) {
    const cells: string[] = []
    for (const cellMatch of rowMatch[1].matchAll(/<w:tc[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      const text = docxRunsText(cellMatch[1]).replace(/\s+/g, " ").replace(/\|/g, "\|").trim()
      cells.push(text)
    }
    if (cells.length > 0) rows.push(cells)
  }
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const line = (row: string[]) =>
    "| " +
    Array.from({ length: width }, (_, index) => row[index] ?? "")
      .join(" | ")
      .trimEnd() +
    " |"
  const out = [line(rows[0]), "| " + Array.from({ length: width }, () => "---").join(" | ") + " |"]
  for (const row of rows.slice(1)) out.push(line(row))
  return out.join(String.fromCharCode(10))
}

function docxToText(xml: string) {
  // 先把表格整块换成占位符，避免段落拍平逻辑把行列结构打散。
  const tables: string[] = []
  const body = xml.replace(/<w:tbl[^>]*>[\s\S]*?<\/w:tbl>/g, (table) => {
    const index = tables.push(docxTableToMarkdown(table)) - 1
    return String.fromCharCode(10) + "[[DOCX_TABLE_" + index + "]]" + String.fromCharCode(10)
  })
  const flattened = normalize(docxRunsText(body))
  return normalize(
    flattened.replace(/\[\[DOCX_TABLE_(\d+)\]\]/g, (_match, index: string) => {
      return String.fromCharCode(10) + (tables[Number(index)] ?? "") + String.fromCharCode(10)
    }),
  )
}

function pptxSlideOrder(name: string) {
  const match = /slide(\d+)\.xml$/.exec(name)
  return match ? Number(match[1]) : 0
}

async function pptxToText(zip: import("jszip")) {
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => pptxSlideOrder(a) - pptxSlideOrder(b))
  const parts: string[] = []
  for (const [index, name] of slides.entries()) {
    const xml = await zip.file(name)?.async("text")
    if (!xml) continue
    const paragraphs = xml
      .replace(/<\/a:p>/g, "\n")
      .replace(/<a:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "\t")
      .split("\n")
      .map((line: string) =>
        decodeEntities(
          line
            .split("\t")
            .map((item: string) => item.trim())
            .filter(Boolean)
            .join(" "),
        ),
      )
      .filter(Boolean)
      .join("\n")
    if (paragraphs.trim()) parts.push("## Slide " + String(index + 1) + "\n\n" + paragraphs.trim())
  }
  return normalize(parts.join("\n\n"))
}

function xmlText(value: string | undefined) {
  if (!value) return ""
  return decodeEntities(value.replace(/<[^>]+>/g, "")).trim()
}

/**
 * 从一段内容流里取出所有文本行（带坐标）。
 *
 * 先用 `pdfLines` 逐行解析 `BT..ET` 块的文本与起始坐标，再按页做一次
 * 双栏判定：只有确实检测到双栏时才按「先左后右」重排，单栏保持原顺序。
 */
function pdfStrings(content: string, decode: (text: string) => string, page = 0): PdfLine[] {
  const out: PdfLine[] = []
  let cursor = 0
  let index = 0
  while (true) {
    const start = content.indexOf("BT", cursor)
    if (start === -1) break
    const end = content.indexOf("ET", start + 2)
    if (end === -1) break
    cursor = end + 2
    const block = content.slice(start + 2, end)
    for (const line of pdfLines(block, decode)) {
      out.push({ text: line.text, index: index++, page, x: line.x, y: line.y })
    }
  }
  return orderByColumns(out)
}

/**
 * PDF 的 ToUnicode CMap：把字形编码映射回 Unicode。
 * 中文 PDF 常用 CID 字体，内容流里是字形编号而不是 ASCII，
 * 没有这张表就会抽出乱码/问号。
 */
export function parseToUnicodeCMaps(streams: readonly string[]): Map<number, string> {
  const map = new Map<number, string>()
  const hex = (value: string) => parseInt(value, 16)
  const B = String.fromCharCode(92)
  const bfchar = new RegExp("beginbfchar([" + B + "s" + B + "S]*?)endbfchar", "g")
  const pairRe = new RegExp("<([0-9a-fA-F]+)>[" + B + "s]*<([0-9a-fA-F]+)>", "g")
  const bfrange = new RegExp("beginbfrange([" + B + "s" + B + "S]*?)endbfrange", "g")
  const entryRe = new RegExp(
    "<([0-9a-fA-F]+)>[" + B + "s]*<([0-9a-fA-F]+)>[" + B + "s]*(?:<([0-9a-fA-F]+)>|[" + B + "[]([^" + B + "]]*?)])",
    "g",
  )
  const itemRe = new RegExp("<([0-9a-fA-F]+)>", "g")

  for (const stream of streams) {
    if (!stream.includes("beginbfchar") && !stream.includes("beginbfrange")) continue
    for (const block of stream.matchAll(bfchar)) {
      for (const pair of block[1].matchAll(pairRe)) {
        const code = hex(pair[1])
        const text = unicodeFromHex(pair[2])
        if (text) map.set(code, text)
      }
    }
    for (const block of stream.matchAll(bfrange)) {
      for (const entry of block[1].matchAll(entryRe)) {
        const start = hex(entry[1])
        const end = hex(entry[2])
        if (end < start || end - start > 65535) continue
        if (entry[3] !== undefined) {
          const base = unicodeFromHex(entry[3])
          if (!base) continue
          const points = Array.from(base)
          const last = points[points.length - 1]
          if (last === undefined) continue
          for (let code = start; code <= end; code++) {
            const offset = code - start
            const next = points.slice()
            next[next.length - 1] = String.fromCodePoint(last.codePointAt(0)! + offset)
            map.set(code, next.join(""))
          }
        } else if (entry[4] !== undefined) {
          const values = Array.from(entry[4].matchAll(itemRe)).map((item) => unicodeFromHex(item[1]))
          values.forEach((text, offset) => {
            if (text) map.set(start + offset, text)
          })
        }
      }
    }
  }
  return map
}

function unicodeFromHex(value: string) {
  if (!value || value.length % 4 !== 0) {
    const code = Number.parseInt(value, 16)
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ""
  }
  let out = ""
  for (let index = 0; index < value.length; index += 4) {
    const code = Number.parseInt(value.slice(index, index + 4), 16)
    if (Number.isFinite(code) && code > 0) out += String.fromCodePoint(code)
  }
  return out
}

/** 用 CMap 解码字节串：优先双字节，其次单字节；无从解码时原样返回。 */
export function decodeWithCMap(bytes: string, map: Map<number, string>) {
  if (map.size === 0) return bytes
  let out = ""
  let matched = 0
  for (let index = 0; index < bytes.length; index += 2) {
    const pair = (bytes.charCodeAt(index) << 8) | (bytes.charCodeAt(index + 1) || 0)
    const mapped = map.get(pair)
    if (mapped !== undefined) {
      out += mapped
      matched++
      continue
    }
    const single = map.get(bytes.charCodeAt(index))
    if (single !== undefined) {
      out += single
      matched++
      index--
      continue
    }
    out += bytes[index]
    if (bytes[index + 1]) out += bytes[index + 1]
  }
  // 一个都没命中说明这不是 CID 文本，保持原始字节更可靠。
  return matched > 0 ? out : bytes
}

/**
 * 扫描版 PDF 没有文本层，但每一页通常就是一张 JPEG（/DCTDecode）。
 * 直接把这些 JPEG 抠出来交给 OCR，比引入 PDF 渲染器 + canvas 简单得多，
 * 也避免了原生依赖。JPXDecode（JPEG2000）等格式跳过，由调用方提示。
 */
export function pdfEmbeddedImages(buffer: Buffer) {
  const raw = buffer.toString("latin1")
  const images: Buffer[] = []
  let cursor = 0
  while (true) {
    const marker = raw.indexOf("DCTDecode", cursor)
    if (marker === -1) break
    const streamAt = raw.indexOf("stream", marker)
    if (streamAt === -1) break
    // 只接受同一对象里的 stream（中间不应再出现 endobj）。
    const between = raw.slice(marker, streamAt)
    if (between.includes("endobj")) {
      cursor = marker + 9
      continue
    }
    let start = streamAt + "stream".length
    if (raw[start] === String.fromCharCode(10)) start++
    if (raw[start] === String.fromCharCode(13)) start++
    const end = raw.indexOf("endstream", start)
    if (end === -1) break
    const slice = raw.slice(start, end)
    // JPEG 必须从 SOI 开始、以 EOI 结束；PDF 流尾部可能带换行。
    const soi = slice.indexOf(String.fromCharCode(255, 216))
    const eoi = slice.lastIndexOf(String.fromCharCode(255, 217))
    if (soi !== -1 && eoi > soi) {
      images.push(Buffer.from(slice.slice(soi, eoi + 2), "latin1"))
    }
    cursor = end + 9
  }
  return images
}

export function pdfToText(buffer: Buffer) {
  const raw = buffer.toString("latin1")
  const chunks: string[] = []
  let cursor = 0
  while (true) {
    const marker = raw.indexOf("stream", cursor)
    if (marker === -1) break
    const newline = raw.indexOf(String.fromCharCode(10), marker)
    if (newline === -1) break
    const start = newline + 1
    const end = raw.indexOf("endstream", start)
    if (end === -1) break
    cursor = end + 9
    const slice = raw.slice(start, end)
    try {
      chunks.push(inflateSync(Buffer.from(slice, "latin1")).toString("latin1"))
    } catch {
      if (slice.includes("BT")) chunks.push(slice)
    }
  }
  const cmap = parseToUnicodeCMaps(chunks)
  const decode = (text: string) => decodeWithCMap(text, cmap)
  const text = chunks
    .flatMap((chunk, page) => pdfStrings(chunk, decode, page))
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(String.fromCharCode(10))
  return normalize(text)
}

function mimeFor(extension: string) {
  if (extension === "png") return "image/png"
  if (extension === "webp") return "image/webp"
  if (extension === "bmp") return "image/bmp"
  if (extension === "tif" || extension === "tiff") return "image/tiff"
  return "image/jpeg"
}

async function tryVision(data: Buffer, mimeType: string, vision?: VisionOcr) {
  if (!vision) return ""
  try {
    return await vision({ data, mimeType })
  } catch {
    return ""
  }
}

export async function extractText(
  input: { name: string; data: Buffer },
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const extension = extensionOf(input.name)
  if (!extension) return { text: normalize(decoder.decode(input.data)) }

  if (isImageFile(input.name)) {
    const result = await ocrImage(input.data, options.ocrLanguages)
    if (result.text) return { text: normalize(result.text), ocr: { used: true, backend: result.backend } }
    const vision = await tryVision(input.data, mimeFor(extension), options.vision)
    if (vision) return { text: normalize(vision), ocr: { used: true, backend: "vision" } }
    return {
      text: "",
      warning:
        result.error && result.backend === "none"
          ? "图片需要 OCR 才能检索，但当前没有可用的 OCR 引擎。可在知识库右上角点「未配置 OCR」一键安装 RapidOCR。"
          : "OCR 没有从这张图片里识别出文字。",
      ocr: { used: false, backend: result.backend },
    }
  }

  const plain = ["md", "markdown", "txt", "text", "json", "csv", "tsv", "log", "yaml", "yml", "xml"]
  if (plain.includes(extension)) return { text: normalize(decoder.decode(input.data)) }
  if (extension === "html" || extension === "htm") return { text: htmlToText(decoder.decode(input.data)) }

  if (extension === "pdf") {
    const text = pdfToText(input.data)
    if (text) return { text }
    // 没有文本层：尝试把内嵌的页面图片交给 OCR。
    const images = pdfEmbeddedImages(input.data)
    let backend = "none"
    if (images.length > 0) {
      const pages: string[] = []
      for (const image of images) {
        const result = await ocrImage(image, options.ocrLanguages)
        backend = result.backend
        if (result.text) {
          pages.push(result.text)
          continue
        }
        const vision = await tryVision(image, "image/jpeg", options.vision)
        if (vision) {
          backend = "vision"
          pages.push(vision)
        }
      }
      if (pages.length > 0) {
        return {
          text: normalize(pages.join(String.fromCharCode(10) + String.fromCharCode(10))),
          ocr: { used: true, backend },
        }
      }
    }
    return {
      text: "",
      warning:
        backend === "none"
          ? "这份 PDF 是扫描件，需要 OCR 才能检索。可在知识库右上角点「未配置 OCR」一键安装 RapidOCR。"
          : "扫描版 PDF 的 OCR 没有识别出文字。",
      ocr: { used: false, backend },
    }
  }

  if (extension === "docx" || extension === "pptx" || extension === "xlsx") {
    const { default: JSZip } = await import("jszip")
    const zip = await JSZip.loadAsync(input.data)
    const text =
      extension === "docx"
        ? docxToText((await zip.file("word/document.xml")?.async("text")) ?? "")
        : extension === "pptx"
          ? await pptxToText(zip)
          : await xlsxToText(zip)
    return text ? { text } : { text: "", warning: "文件里没有提取到可检索的文本。" }
  }

  return { text: normalize(decoder.decode(input.data)) }
}
