/**
 * 旧格式的解析：ODF（odt / ods / odp）和 RTF，以及 Office 97-2003 二进制文件。
 *
 * Core 解析器本身保持只读并负责转换输入；浏览器 Host 按统一流程把结果导出为现代 OOXML，
 * 再挂载对应编辑器，编辑保存到现代副本而不是旧源文件。
 *
 * .doc / .xls / .ppt 是二进制的 OLE 复合文档：这里自带一个最小 OLE 读取器
 * （./ole）和 Word 片段表 / Excel BIFF8 / PowerPoint 记录树的文本提取（./binary），
 * 所以也能打开、预览、导出成 docx / xlsx / pptx —— 但仍然**不原地写回**。
 */
import { inflateEntry, readZip } from "../engine/zip"
import { detectOleKind, readLegacyBinary } from "./binary"

export type LegacyExtension = "odt" | "ods" | "odp" | "rtf" | "doc" | "xls" | "ppt"

export type LegacyKind = "document" | "spreadsheet" | "presentation" | "text"

export type LegacySheet = {
  name: string
  rows: string[][]
}

export type LegacyDocument = {
  kind: LegacyKind
  /** 纯文本摘要（段落 / 表格 / 每页文字），给预览和导出用。 */
  text: string
  /**
   * 逐段文字，顺序和 `content.xml` 里的 text:h / text:p 一致。
   * 面板按这个下标改字（和 `setParagraphText` 的 1 起下标对应）。
   */
  paragraphs: string[]
  /** ODS 的表格；其它格式为空。 */
  sheets: LegacySheet[]
  /** ODP 的页数；O 其它格式为 0。 */
  pageCount: number
}

export function legacyKindOf(extension: string): LegacyKind | undefined {
  if (extension === "odt") return "document"
  if (extension === "ods") return "spreadsheet"
  if (extension === "odp") return "presentation"
  if (extension === "rtf") return "text"
  return undefined
}

/** ODF 的 content.xml：三种文档共用一份，只有顶层元素不同。 */
function stripTag(xml: string, tag: string): string[] {
  const values: string[] = []
  const pattern = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">", "g")
  for (const match of xml.matchAll(pattern)) values.push(match[1] ?? "")
  return values
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** 去掉内部标签，只留文字；`text:s` 是空格、`text:tab` 是制表符、`text:line-break` 是换行。 */
function odfText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<text:s\b[^>]*\/>/g, " ")
      .replace(/<text:tab\b[^>]*\/>/g, "\t")
      .replace(/<text:line-break\b[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
}

async function readOdf(bytes: Uint8Array, kind: LegacyKind): Promise<LegacyDocument> {
  const zip = await readZip(bytes)
  const entry = zip.entries.find((item) => item.name === "content.xml")
  if (!entry) throw new Error("这不是有效的 OpenDocument 文件（缺少 content.xml）")
  const xml = new TextDecoder().decode(await inflateEntry(zip, entry))

  if (kind === "spreadsheet") {
    const sheets: LegacySheet[] = []
    const tables = stripTag(xml, "table:table")
    const names = [...xml.matchAll(/<table:table\b[^>]*table:name="([^"]*)"/g)].map((match) =>
      decodeEntities(match[1]!),
    )
    for (const [index, table] of tables.entries()) {
      const rows: string[][] = []
      for (const row of stripTag(table, "table:table-row")) {
        const cells: string[] = []
        // 重复列（table:number-columns-repeated）要展开，否则数据会错位。
        const cellPattern = /<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>|<table:table-cell\b([^>]*)\/>/g
        for (const match of row.matchAll(cellPattern)) {
          const attrs = match[1] ?? match[3] ?? ""
          const repeated = Number(/table:number-columns-repeated="(\d+)"/.exec(attrs)?.[1] ?? 1)
          const value = odfText(match[2] ?? "").trim()
          for (let count = 0; count < Math.min(repeated, 256); count += 1) cells.push(count === 0 ? value : "")
        }
        // 去掉行尾的一串空格子（ODF 用重复空单元格占满整行）。
        while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop()
        if (cells.length > 0) rows.push(cells)
      }
      sheets.push({ name: names[index] ?? "Sheet" + (index + 1), rows })
    }
    const text = sheets
      .map((sheet) => "## " + sheet.name + "\n" + sheet.rows.map((row) => row.join("\t")).join("\n"))
      .join("\n\n")
    return { kind, text, paragraphs: [], sheets, pageCount: 0 }
  }

  if (kind === "presentation") {
    const pages = stripTag(xml, "draw:page")
    const names = [...xml.matchAll(/<draw:page\b[^>]*draw:name="([^"]*)"/g)].map((match) => decodeEntities(match[1]!))
    const paragraphs = pages.flatMap((page) =>
      stripTag(page, "text:p")
        .map((paragraph) => odfText(paragraph).trim())
        .filter(Boolean),
    )
    const text = pages
      .map((page, index) => {
        const body = stripTag(page, "text:p")
          .map((paragraph) => odfText(paragraph).trim())
          .filter(Boolean)
        return "## 第 " + (index + 1) + " 页" + (names[index] ? " · " + names[index] : "") + "\n" + body.join("\n")
      })
      .join("\n\n")
    return { kind, text, paragraphs, sheets: [], pageCount: pages.length }
  }

  // 文本文档：标题（text:h）和段落（text:p）按文档顺序输出，表格里的段落也在内。
  const paragraphs = [...xml.matchAll(/<text:(?:h|p)\b[^>]*>([\s\S]*?)<\/text:(?:h|p)>/g)]
    .map((match) => odfText(match[1] ?? "").trim())
    .filter((paragraph) => paragraph.length > 0)
  return { kind, text: paragraphs.join("\n"), paragraphs, sheets: [], pageCount: 0 }
}

/**
 * RTF：只取字面文字。
 *
 * 要跳过「目标组」（字体表、颜色表、图片数据…），否则 `Helvetica` 这种
 * 字体名会被当成正文混进来。用一个小栈记录每层花括号的跳过状态。
 */
function readRtf(bytes: Uint8Array): LegacyDocument {
  // 先按 ASCII 探测 `\ansicpg936` 这类代码页声明，中文 RTF 的直接字面量才不会是乱码。
  const head = new TextDecoder("windows-1252").decode(bytes.slice(0, 512))
  const codepage = /\\ansicpg(\d+)/.exec(head)?.[1]
  const encoding =
    codepage === "936" ? "gbk" : codepage === "950" ? "big5" : codepage === "65001" ? "utf-8" : "windows-1252"
  let source: string
  try {
    source = new TextDecoder(encoding as never).decode(bytes)
  } catch {
    // 运行环境没带对应代码页：退回单字节解码，至少 ASCII 部分可用。
    source = new TextDecoder("windows-1252").decode(bytes)
  }
  const parts: string[] = []
  const skipStack: boolean[] = []
  let skip = false
  let index = 0

  // 这些目标组的内容不是正文。
  const SKIP_DESTINATIONS = new Set([
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "header",
    "footer",
    "footnote",
    "annotation",
    "listtable",
    "listoverridetable",
    "rsidtbl",
    "generator",
    "xmlnstbl",
    "themedata",
    "colorschememapping",
    "datastore",
    "latentstyles",
  ])

  while (index < source.length) {
    const char = source[index]!
    if (char === "{") {
      skipStack.push(skip)
      index += 1
      continue
    }
    if (char === "}") {
      skip = skipStack.pop() ?? false
      index += 1
      continue
    }
    if (char !== "\\") {
      if (!skip && char !== "\r" && char !== "\n") parts.push(char)
      index += 1
      continue
    }

    const next = source[index + 1]
    if (next === "*") {
      // \* 表示「不认识的组，整组跳过」。
      skip = true
      index += 2
      continue
    }
    if (next === "'") {
      const value = Number.parseInt(source.slice(index + 2, index + 4), 16)
      if (!skip && Number.isFinite(value)) parts.push(String.fromCharCode(value))
      index += 4
      continue
    }
    if (next === "u") {
      const match = /^u(-?\d+)\??/.exec(source.slice(index + 1))
      if (match && !skip) {
        const code = Number(match[1])
        parts.push(String.fromCharCode(code < 0 ? code + 65536 : code))
      }
      index += 1 + (match?.[0].length ?? 1)
      continue
    }
    if (next === "\\" || next === "{" || next === "}") {
      if (!skip) parts.push(next)
      index += 2
      continue
    }
    if (next === "~") {
      if (!skip) parts.push(" ")
      index += 2
      continue
    }

    const match = /^[a-zA-Z]+-?\d* ?/.exec(source.slice(index + 1))
    const word = match?.[0].trim().replace(/\d+$/, "") ?? ""
    if (SKIP_DESTINATIONS.has(word)) skip = true
    if (!skip) {
      if (word === "par" || word === "line") parts.push("\n")
      else if (word === "tab" || word === "cell" || word === "row") parts.push("\t")
    }
    index += 1 + (match?.[0].length ?? 1)
  }

  const text = parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/\t+$/, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return {
    kind: "text",
    text,
    paragraphs: text.split(String.fromCharCode(10)).filter((line) => line !== ""),
    sheets: [],
    pageCount: 0,
  }
}

/**
 * 读一份旧格式文件。
 *
 * `extension` 为 odt / ods / odp / rtf 时走 ODF / RTF 解析；
 * doc / xls / ppt（Office 97-2003 二进制）走 `readLegacyBinary` 的只读文字提取
 * （能读、能预览、能导出成 OOXML，但没有写回引擎）；其余抛「不支持」。
 */
export async function readLegacyDocument(bytes: Uint8Array, extension: string): Promise<LegacyDocument> {
  const kind = legacyKindOf(extension)
  if (kind) return kind === "text" ? readRtf(bytes) : readOdf(bytes, kind)
  if (extension === "doc" || extension === "xls" || extension === "ppt") return readLegacyBinary(bytes, extension)
  throw new Error("不支持的旧格式：" + extension)
}

/**
 * 从字节猜旧格式的具体类型。
 *
 * 引擎的 `open(bytes)` 拿不到路径，所以必须能自己认：
 *   - ODF 包里有 `mimetype` 条目（`application/vnd.oasis.opendocument.text` 等）；
 *   - RTF 以 `{\rtf` 开头；
 *   - Office 97-2003 是 OLE 复合文档（`D0 CF 11 E0`）。
 */
export async function detectLegacyExtension(bytes: Uint8Array): Promise<LegacyExtension> {
  const head = new TextDecoder("windows-1252").decode(bytes.slice(0, 8))
  // 注意这里要匹配的是文件里的反斜杠，所以源码里必须写成两个。
  if (head.startsWith("{\\rtf")) return "rtf"
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    // 二进制 Office：按容器里的流名判断 doc / xls / ppt。
    return detectOleKind(bytes) ?? "doc"
  }
  try {
    const zip = await readZip(bytes)
    const entry = zip.entries.find((item) => item.name === "mimetype")
    const mime = entry ? new TextDecoder().decode(await inflateEntry(zip, entry)) : ""
    if (mime.includes("opendocument.text")) return "odt"
    if (mime.includes("opendocument.spreadsheet")) return "ods"
    if (mime.includes("opendocument.presentation")) return "odp"
    // 没有 mimetype（有些工具会漏）时看 content.xml 里的顶层元素。
    const content = zip.entries.find((item) => item.name === "content.xml")
    if (content) {
      const xml = new TextDecoder().decode(await inflateEntry(zip, content))
      if (xml.includes("<table:table")) return "ods"
      if (xml.includes("<draw:page")) return "odp"
      return "odt"
    }
  } catch {
    // 不是 zip：落到下面统一报错。
  }
  throw new Error("无法识别这种旧格式文档")
}
