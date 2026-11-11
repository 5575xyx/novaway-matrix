/**
 * 旧格式引擎。
 *
 * 复用的是同一个 `OfficeEngine` 接口：预览、AI 的读写工具和导出按钮**不分叉**。
 * Core legacy engine owns parsing and conversion. Its direct `apply` operation remains
 * conservative for formats without a native writer; the browser Host follows the
 * same path, exporting to modern OOXML before mounting the native editor.
 */
import type { OfficeEngine, OfficeResult } from "../engine/contract"
import { fail, ok } from "../engine/contract"
import type { DocxBlock } from "../create"
import { detectLegacyExtension, readLegacyDocument, type LegacyDocument } from "./read"
import { editOdf } from "./write"

export type LegacyState = LegacyDocument

/** 把纯文本按空行/标题切成 docx 段落。 */
function blocksOf(text: string): DocxBlock[] {
  const blocks: DocxBlock[] = []
  for (const line of text.split(String.fromCharCode(10))) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) blocks.push({ text: heading[2]!, heading: heading[1]!.length })
    else if (line.trim() !== "") blocks.push({ text: line })
  }
  return blocks
}

/** 标题取第一张表的 A1；表格为空时退回第一段文字。 */
function titleOf(state: LegacyState): string {
  if (state.sheets[0]?.rows[0]?.[0]) return state.sheets[0].rows[0][0]
  const first = state.text.split(String.fromCharCode(10)).find((line) => line.trim() !== "")
  return first?.trim().slice(0, 60) || "文档"
}

export const legacyEngine: OfficeEngine<LegacyState> = {
  format: "legacy",

  async open(bytes) {
    // 引擎不知道路径，所以从内容认：ODF 的 mimetype / RTF 的魔数 / OLE 的魔数。
    try {
      const extension = await detectLegacyExtension(bytes)
      return ok(await readLegacyDocument(bytes, extension))
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法解析旧格式文档"
      return fail(
        "open_failed",
        message,
        "如果这是 Office 97-2003 的 .doc / .xls / .ppt，可以先在 Word / Excel / PowerPoint 或 LibreOffice 里另存为 docx / xlsx / pptx",
      )
    }
  },

  async apply(state, ops, bytes) {
    try {
      const extension = await detectLegacyExtension(bytes)
      if (extension === "doc" || extension === "xls" || extension === "ppt") {
        return fail(
          "unsupported_format",
          "这是 Office 97-2003 二进制格式，不能原地编辑",
          "请用 Word / Excel / PowerPoint 或 LibreOffice 另存为 docx / xlsx / pptx 后再改",
        )
      }
      if (extension === "rtf") {
        return fail(
          "unsupported_format",
          "RTF 目前只能预览和导出，不能原地编辑",
          "请另存为 docx 后再改（Word / LibreOffice 都能另存），或用 export 导出 docx",
        )
      }
      return await editOdf(bytes, ops)
    } catch (error) {
      return fail("engine", error instanceof Error ? error.message : "旧格式写入失败")
    }
  },

  async export(state, target): Promise<OfficeResult<Uint8Array>> {
    const kind = target.toLowerCase().replace(/^\./, "")
    const encoder = new TextEncoder()
    if (kind === "txt" || kind === "text") return ok(encoder.encode(state.text))
    if (kind === "html" || kind === "htm") {
      const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      const body =
        state.kind === "spreadsheet"
          ? state.sheets
              .map(
                (sheet) =>
                  "<h2>" +
                  escape(sheet.name) +
                  "</h2><table>" +
                  sheet.rows
                    .map((row) => "<tr>" + row.map((cell) => "<td>" + escape(cell) + "</td>").join("") + "</tr>")
                    .join("") +
                  "</table>",
              )
              .join(String.fromCharCode(10))
          : state.text
              .split(String.fromCharCode(10))
              .map((line) => (line.trim() === "" ? "" : "<p>" + escape(line) + "</p>"))
              .join(String.fromCharCode(10))
      return ok(encoder.encode("<html><body>" + body + "</body></html>"))
    }
    if (kind === "md" || kind === "markdown") {
      if (state.kind === "spreadsheet") {
        const rows = state.sheets.flatMap((sheet) => {
          const [header, ...body] = sheet.rows
          if (!header) return []
          const line = (row: string[]) => "| " + header.map((_, index) => row[index] ?? "").join(" | ") + " |"
          return [
            "",
            "## " + sheet.name,
            "",
            "| " + header.join(" | ") + " |",
            "| " + header.map(() => "---").join(" | ") + " |",
            ...body.map(line),
          ]
        })
        return ok(encoder.encode("" + rows.join("\n").trimStart()))
      }
      return ok(encoder.encode(state.text))
    }
    if (kind === "docx") {
      const { docxFromBlocks } = await import("../create")
      const title = titleOf(state)
      const blocks = blocksOf(state.text)
      // 标题已经是文档标题，正文里再出现一次就成了重复的标题行。
      if (blocks[0]?.text === title) blocks.shift()
      return ok(docxFromBlocks(title, blocks))
    }
    if (kind === "xlsx") {
      const { xlsxFromSheets } = await import("../create")
      const sheets = state.sheets.length > 0 ? state.sheets : [{ name: "Sheet1", rows: [] }]
      return ok(
        xlsxFromSheets(
          titleOf(state),
          sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows })),
        ),
      )
    }
    if (kind === "pptx") {
      const { pptxFromSlides } = await import("../create")
      const pages = state.text.split("## 第 ")
      const slides = pages
        .filter((page) => page.trim() !== "")
        .map((page, index) => {
          const lines = page.split(String.fromCharCode(10))
          const heading = index === 0 && !/^\d+ 页/.test(page) ? titleOf(state) : lines[0]!.trim()
          return {
            title: heading.replace(/^\d+ 页 · /, ""),
            lines: lines.slice(1).filter((line) => line.trim() !== ""),
          }
        })
      return ok(pptxFromSlides(titleOf(state), slides.length > 0 ? slides : [{ title: titleOf(state), lines: [] }]))
    }
    if (kind === "pdf") {
      const { printToPdf } = await import("../pdf/print")
      return ok(await printToPdf("legacy", state))
    }
    return fail("unsupported_format", "旧格式不能导出成 " + target, "支持 pdf / txt / md / html / docx / xlsx / pptx")
  },
}
