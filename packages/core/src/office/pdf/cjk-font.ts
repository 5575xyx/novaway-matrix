/**
 * PDF 里的中文文字。
 *
 * pdf-lib 的标准字体（Helvetica 等）是 WinAnsi，只有 U+00FF 以内的字形，
 * 所以中文标题、批注正文以前只能留白。这里改用 PDF 的**预定义 CJK 字体**：
 *
 *   Type0 / CIDFontType0，BaseFont = STSong-Light，Encoding = UniGB-UCS2-H
 *
 * 也就是 PDF 规范里的 Adobe-GB1 中文字体。文件里不嵌字体（体积不变），
 * Acrobat、WPS、macOS 预览以及大多数 Chromium 阅读器会映射到系统宋体。
 * 找不到字体的阅读器至少不会把文件判成损坏 —— 文字数据仍在内容流里。
 *
 * 注意：UniGB-UCS2-H 只覆盖 UCS-2（BMP），emoji 之类会被替换成空格，
 * 这和「标准字体画不出来」相比仍是净改进。
 */
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  PDFRef,
  PDFString,
  rgb,
} from "pdf-lib"

/**
 * ASCII 的字符宽度（Helvetica 的 AFM 值，单位 1/1000 em）。
 *
 * Adobe-GB1 里 CID 1..95 就是 ASCII 0x20..0x7E；不写 /W 的话这些字会按 DW=1000
 * 排成方块，`123.45` 会被拉成「1 2 3 . 4 5」。这些号码对应 STSong 的比例西文，
 * 正好让数字和英文回到正常字距。
 */
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584,
]

const FONT_REF = new WeakMap<PDFDocument, PDFRef>()
const PAGE_KEY = new WeakMap<PDFPage, PDFName>()
const FONT_TAG = "STSong-Light"

/** 只要有一个字符超出 WinAnsi，就走 CJK 字体。 */
export function needsCjk(text: string): boolean {
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0xff) return true
  }
  return false
}

function cjkFont(doc: PDFDocument): PDFRef {
  const cached = FONT_REF.get(doc)
  if (cached) return cached

  const descriptor = doc.context.obj({
    Type: "FontDescriptor",
    FontName: FONT_TAG,
    Flags: 4,
    FontBBox: [-25, -254, 1000, 880],
    ItalicAngle: 0,
    Ascent: 880,
    Descent: -120,
    CapHeight: 880,
    StemV: 0,
  })
  const descendant = doc.context.obj({
    Type: "Font",
    Subtype: "CIDFontType0",
    BaseFont: FONT_TAG,
    // Registry / Ordering 按规范是**字符串**而不是名字：pdf.js 一类阅读器会按
    // 字符串去拼 `Adobe-GB1-UCS2` 做反查，写成 /Adobe /GB1 会拼出空名字而丢字。
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("GB1"), Supplement: 4 },
    FontDescriptor: descriptor,
    DW: 1000,
    W: [1, ASCII_WIDTHS],
  })
  const font = doc.context.obj({
    Type: "Font",
    Subtype: "Type0",
    BaseFont: FONT_TAG,
    Encoding: "UniGB-UCS2-H",
    DescendantFonts: [descendant],
  })
  const ref = doc.context.register(font)
  FONT_REF.set(doc, ref)
  return ref
}

/** UTF-16BE 十六进制：UniGB-UCS2-H 要求的就是这种写法。 */
function hexText(text: string): string {
  let out = ""
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    // 代理对（emoji 等）无法映射到 UCS-2，用全角空格占位，避免输出非法串。
    const safe = code >= 0xd800 && code <= 0xdfff ? 0x3000 : code
    out += safe.toString(16).padStart(4, "0").toUpperCase()
  }
  return out
}

function colorOf(value: string | undefined) {
  const hex = (value ?? "").replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return rgb(0, 0, 0)
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  )
}

/**
 * 在一页上登记 CID 字体，返回资源名。
 *
 * 同一页重复登记会产出 `F1`、`F1-1`… 一串重复资源，所以这里按页缓存；
 * 打印整份文档时每页只登记一次。
 */
export function ensureCjkFont(page: PDFPage, doc: PDFDocument): PDFName {
  const cached = PAGE_KEY.get(page)
  if (cached) return cached
  const key = page.node.newFontDictionary(FONT_TAG, cjkFont(doc))
  PAGE_KEY.set(page, key)
  return key
}

/**
 * 在页面上按左上角坐标画多行中文。
 * 行距和 `page.drawText` 的叠加文字保持一致（1.25 倍字号）。
 */
export function drawCjkLines(
  page: PDFPage,
  doc: PDFDocument,
  options: { text: string; x: number; top: number; size: number; color?: string },
): void {
  const key = ensureCjkFont(page, doc)
  const color = colorOf(options.color)
  const lines = options.text.split(String.fromCharCode(10))
  lines.forEach((line, index) => {
    if (line === "") return
    const y = page.getHeight() - options.top - options.size - index * options.size * 1.25
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.NonStrokingColorRgb, [
        PDFNumber.of(color.red),
        PDFNumber.of(color.green),
        PDFNumber.of(color.blue),
      ]),
      PDFOperator.of(PDFOperatorNames.BeginText),
      PDFOperator.of(PDFOperatorNames.SetFontAndSize, [key, PDFNumber.of(options.size)]),
      PDFOperator.of(PDFOperatorNames.SetTextMatrix, [
        PDFNumber.of(1),
        PDFNumber.of(0),
        PDFNumber.of(0),
        PDFNumber.of(1),
        PDFNumber.of(options.x),
        PDFNumber.of(y),
      ]),
      PDFOperator.of(PDFOperatorNames.ShowText, [PDFHexString.of(hexText(line))]),
      PDFOperator.of(PDFOperatorNames.EndText),
    )
  })
}

/** 粗体标题也走同一套 CID 字体（BaseFont 换成 STSongStd-Light 没有保证，保持常规体）。 */
export function drawCjkTitle(
  page: PDFPage,
  doc: PDFDocument,
  options: { text: string; size: number; color?: string },
): void {
  const width = [...options.text].reduce(
    (sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0xff ? options.size : options.size * 0.52),
    0,
  )
  drawCjkLines(page, doc, {
    text: options.text,
    x: Math.max(48, (page.getWidth() - width) / 2),
    top: 96,
    size: options.size,
    ...(options.color ? { color: options.color } : {}),
  })
}
