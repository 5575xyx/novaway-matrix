/**
 * 通用文档工具：DOCX 段落、富文本块、纯文本/代码行命令。
 *
 * 和 `office_pptx_*` 并列：PPTX 的几何/图片参数更细，保留专用工具；
 * 其余格式共用 `OfficeOp` 这一套词汇，和右侧面板的编辑走同一条引擎路径。
 */
import { Effect, Schema } from "effect"
import * as path from "path"
import { mkdir, readFile, rename, writeFile } from "fs/promises"
import { assertExternalDirectoryEffect } from "./external-directory"
import type { OfficeEngine, OfficeFormat, OfficeOp } from "@novaway/core/office/engine/contract"
import { indexToColumn } from "@novaway/core/office/engine/contract"
import { engineFor, officeFormatOf } from "@novaway/core/office/engine/registry"
import { formatOutline, outlineOf } from "@novaway/core/office/outline"
import { readPdfText } from "@novaway/core/office/pdf/engine"
import { DocumentOp } from "@/office/ops-schema"
import { editDocumentFile } from "@/office/document-sessions"
import { exportDocumentAs, normalizeExportTarget } from "@/office/document-export"
import { toOfficeOp } from "@/office/ops-schema"
import { InstanceState } from "@/effect/instance-state"
import { Bus } from "@/bus"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import * as Tool from "./tool"

const permissionRoot = (instance: { directory: string; worktree: string }) =>
  instance.worktree === "/" ? instance.directory : instance.worktree

const resolve = (root: string, target: string) => (path.isAbsolute(target) ? target : path.join(root, target))

const ReadParameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description:
      "Path to a .docx / .xlsx / .csv / .pptx / .html / .md / .txt file, or a legacy .doc / .xls / .ppt / .odt / .ods / .odp / .rtf (read + export). Relative paths resolve against the workspace root.",
  }),
  view: Schema.optional(Schema.Literal("outline")).annotate({
    description:
      'Set to "outline" to get just the document skeleton (headings / slides / sheets / pages with paths) instead of the full structure. Same as `office view <file> outline`.',
  }),
  password: Schema.optional(Schema.String).annotate({
    description: "Password for an encrypted PDF (user or owner password). Ignored for other formats.",
  }),
})

type ReadInput = Schema.Schema.Type<typeof ReadParameters>

function readHint(format: OfficeFormat, state: unknown): string {
  if (format === "docx") {
    const paragraphs = (
      state as {
        paragraphs: Array<{
          index: number
          text: string
          style?: string
          bold?: boolean
          italic?: boolean
          size?: number
          color?: string
          align?: string
          inTable?: boolean
          list?: { kind: string; level: number }
        }>
      }
    ).paragraphs
    if (paragraphs.length === 0) return "文档里没有可编辑的段落。"
    return paragraphs
      .map((paragraph) => {
        const hints = [
          paragraph.style ? `style=${paragraph.style}` : undefined,
          paragraph.bold ? "bold" : undefined,
          paragraph.italic ? "italic" : undefined,
          paragraph.size ? `${paragraph.size}pt` : undefined,
          paragraph.color ? `#${paragraph.color}` : undefined,
          paragraph.align ? `align=${paragraph.align}` : undefined,
          paragraph.list ? `list=${paragraph.list.kind}#${paragraph.list.level}` : undefined,
          paragraph.inTable ? "inTable" : undefined,
        ].filter(Boolean)
        return `[${paragraph.index}] ${paragraph.text}${hints.length ? `  (${hints.join(" ")})` : ""}`
      })
      .join("\n")
  }

  // CSV 就是「一张只有值的表」：给出 A1 坐标，改单元格用 setCellValue。
  if (format === "csv") {
    const rows = (state as { rows: Array<Array<{ value: string }>> }).rows
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
    const limit = 600
    const lines: string[] = []
    scan: for (const [rowIndex, row] of rows.entries()) {
      for (const [colIndex, cell] of row.entries()) {
        if (cell.value.length === 0) continue
        lines.push(indexToColumn(colIndex) + (rowIndex + 1) + "\t" + cell.value)
        if (lines.length >= limit) break scan
      }
    }
    const more = lines.length >= limit ? `\n… 只显示前 ${limit} 个非空单元格（共 ${rows.length} 行）` : ""
    const head = `CSV 只有一张表（sheet 名会被忽略），${width} 列 × ${rows.length} 行`
    return head + "\n" + (lines.join("\n") || "(空表)") + more
  }

  if (format === "xlsx") {
    const sheets = (
      state as {
        sheets: Array<{
          name: string
          cells: Array<{ ref: string; text: string; formula?: string }>
          merges?: string[]
        }>
      }
    ).sheets
    const limit = 600
    return sheets
      .map((sheet) => {
        // 有公式就展示公式本身：模型看到 =SUM(B2:B9) 才知道这一格算出来的是什么。
        const cells = sheet.cells
          .slice(0, limit)
          .map((cell) => cell.ref + "\t" + (cell.formula !== undefined ? "=" + cell.formula : cell.text))
        const more = sheet.cells.length > limit ? "\n… 还有 " + (sheet.cells.length - limit) + " 个非空单元格" : ""
        // 合并区域也让模型看到：改值前要知道哪些格子其实是同一块。
        const merged = sheet.merges && sheet.merges.length > 0 ? "\n合并区域: " + sheet.merges.join(", ") : ""
        return "## " + sheet.name + "\n" + (cells.join("\n") || "(空表)") + more + merged
      })
      .join("\n\n")
  }

  // 旧格式：ODF 可以原地改；doc / xls / ppt / rtf 只读，但都能导出成新格式。
  if (format === "legacy") {
    const legacy = state as {
      kind: string
      text: string
      paragraphs?: string[]
      sheets?: Array<{ name: string; rows: string[][] }>
      pageCount: number
    }
    if (legacy.kind === "spreadsheet" && legacy.sheets) {
      return (
        "（旧表格：ODS 可以 set /Sheet/B2 value=…；xls 只读，export 另存为 xlsx）\n" +
        legacy.sheets
          .map((sheet) => "## " + sheet.name + "\n" + sheet.rows.map((row) => row.join("\t")).join("\n"))
          .join("\n\n")
      )
    }
    const paragraphs = legacy.paragraphs ?? []
    const listing =
      paragraphs.length > 0 ? paragraphs.map((text, index) => "[" + (index + 1) + "] " + text).join("\n") : legacy.text
    return (
      "（旧格式：odt / odp 可以 set /body/p[N] value=…；doc / ppt / rtf 只读，export 可另存为 docx / pptx）\n" +
      (legacy.pageCount > 0 ? "共 " + legacy.pageCount + " 页\n" : "") +
      listing
    )
  }

  // PDF 没有段落：给页码、尺寸、旋转和表单字段，够模型决定点哪一页、填哪个字段。
  if (format === "pdf") {
    const pages = (state as { pages: Array<{ page: number; width: number; height: number; rotation: number }> }).pages
    const fields = (state as { fields: Array<{ name: string; kind: string; value?: string | boolean }> }).fields
    const head = pages
      .map(
        (page) =>
          `[${page.page}] ${Math.round(page.width)}×${Math.round(page.height)}pt${page.rotation ? ` 旋转 ${page.rotation}°` : ""}`,
      )
      .join("\n")
    const form =
      fields.length === 0
        ? "\n（没有表单字段）"
        : "\n表单字段：\n" +
          fields
            .map(
              (field) =>
                `- ${field.name}（${field.kind}）${field.value !== undefined ? " = " + String(field.value) : ""}`,
            )
            .join("\n")
    return head + form
  }

  if (format === "html") {
    const blocks = (
      state as { blocks: Array<{ index: number; tag: string; text: string; editable: boolean; reason?: string }> }
    ).blocks
    return blocks
      .map((block) => {
        const lock = block.editable ? "" : `  [只读：${block.reason ?? "包含暂不支持的结构"}]`
        return `[${block.index}] <${block.tag}> ${block.text}${lock}`
      })
      .join("\n")
  }

  const text = (state as { text: string }).text
  const lines = text.split("\n")
  const limit = 400
  const body = lines
    .slice(0, limit)
    .map((line, index) => `${index + 1}\t${line}`)
    .join("\n")
  return body + (lines.length > limit ? `\n… 还有 ${lines.length - limit} 行（用 file.read 查看全文）` : "")
}

export const OfficeDocumentReadTool = Tool.define<typeof ReadParameters, Record<string, never>, never>(
  "office_document_read",
  Effect.gen(function* () {
    return {
      description: [
        "Read the editable structure of a DOCX, XLSX, CSV, HTML, Markdown, PDF or plain-text file:",
        "DOCX paragraphs (1-based), XLSX sheets and CSV tables with non-empty cells as A1 refs, HTML blocks, PDF pages and form fields, and numbered lines for text files.",
        "Call this before office_document_edit. Read-only.",
      ].join(" "),
      parameters: ReadParameters,
      capabilities: { readOnly: true, concurrencySafe: true, idempotent: true },
      execute: (params: ReadInput) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = permissionRoot(instance)
          const filepath = resolve(root, params.filePath)
          const format = officeFormatOf(filepath)
          if (!format) {
            throw new Error("office_document_read 不支持这种文件：" + params.filePath)
          }
          const engine = engineFor(format)
          if (!engine) throw new Error("暂不支持这种文件：" + format)

          const bytes = yield* Effect.promise(async () => new Uint8Array(await readFile(filepath)))
          const opened = yield* Effect.promise(() =>
            (engine as OfficeEngine<unknown>).open(
              bytes,
              params.password === undefined ? undefined : { password: params.password },
            ),
          )
          if (!opened.ok)
            throw new Error(opened.error.message + (opened.error.suggestion ? "；" + opened.error.suggestion : ""))

          const base =
            params.view === "outline" ? formatOutline(outlineOf(format, opened.data)) : readHint(format, opened.data)
          // PDF 补上每页正文：模型要先把发票 / 合同读出来，才能决定改哪里。
          let output = base
          if (format === "pdf" && params.view !== "outline") {
            try {
              const pages = yield* Effect.promise(() => readPdfText(bytes, undefined, params.password))
              const body = pages
                .map((page) => `第 ${page.page} 页：\n${page.text.trim() || "（没有可读文字，可能是扫描件）"}`)
                .join("\n\n")
              output = base + "\n\n" + body
            } catch {
              // 加密 / 内容流损坏时不挡住页面结构信息。
            }
          }

          return {
            title: format + " / " + path.relative(root, filepath),
            metadata: {},
            output,
          }
        }),
    }
  }),
)

const EditParameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Path to the .docx / .xlsx / .html / .md / .txt file to modify in place.",
  }),
  password: Schema.optional(Schema.String).annotate({
    description: "Password for an encrypted PDF (user or owner password). Ignored for other formats.",
  }),
  ops: Schema.Array(DocumentOp).annotate({
    description: [
      "Ordered operations; all-or-nothing. Common shapes:",
      '{op:"setParagraphText",paragraph:2,text:"new text"} for DOCX/HTML blocks;',
      '{op:"setParagraphStyle",paragraph:2,style:{bold:true,size:18,color:"FF0000"}} for DOCX;',
      '{op:"setParagraphStyle",paragraph:3,style:{list:"bullet"}} (or "number"; "none" removes it, optional listLevel:0-8) turns a paragraph into a list item;',
      'paragraph style also accepts strike, highlight:"FFFF00", lineSpacing:1.5, firstLineIndent:24 (pt), indent:36 (pt), clear:true;',
      '{op:"insertTableRow",table:1,at:2} / {op:"deleteTableRow",table:1,at:1} / {op:"insertTableColumn",table:1,at:2} / {op:"deleteTableColumn",table:1,at:1} / {op:"setTableCellText",table:1,row:2,col:2,text:"256"} edit DOCX tables (table/row/col all 1-based);',
      'add start/end to style only part of a paragraph: {op:"setParagraphStyle",paragraph:2,start:0,end:4,style:{bold:true}};',
      '{op:"setHeaderFooter",kind:"header",text:"内部资料"} sets the DOCX header (kind:"footer" for the footer);',
      '{op:"setBlockType",block:1,tag:"h2"}, {op:"setBlockAlign",block:1,align:"center"},',
      '{op:"setBlockLineHeight",block:1,value:1.6}, {op:"setBlockIndent",block:1,value:24}, {op:"setBlockFirstLineIndent",block:1,value:32} (px) for HTML layout;',
      '{op:"formatRange",block:1,start:0,end:4,patch:{bold:true,color:"FF0000"}},',
      '{op:"formatRange",block:1,start:0,end:4,patch:{link:"https://example.com"}} (link:"" removes it) for HTML;',
      '{op:"setBlockList",block:2,kind:"ul"} (or "ol"; "none" removes the list),',
      '{op:"setBlockHtml",block:1,html:"<strong>整段</strong>替换"}, {op:"insertBlock",after:2,html:"<em>新段</em>"},',
      '{op:"deleteBlock",block:3} for rich text;',
      '{op:"insertParagraph",after:2,text:"新一段"}, {op:"deleteParagraph",paragraph:3} for DOCX;',
      '{op:"addTable",after:2,rows:[["项目","金额"],["合计","120"]]} (+header:false to skip bold), {op:"addPageBreak",after:2},',
      '{op:"addImage",after:1,dataBase64:"iVBOR…",mime:"image/png",width:320,height:200},',
      '{op:"setPageSetup",size:"A4",orientation:"landscape",margins:{top:20,left:25}} for DOCX structure;',
      'PDF pages are 1-based: {op:"deletePage",page:3}, {op:"movePage",from:3,to:1}, {op:"rotatePage",page:1,degrees:90},',
      '{op:"insertBlankPage",after:2}, {op:"insertPdfPages",after:2,dataBase64:"JVBER…",pages:[1,3]} copies pages from another PDF after page 2 (pages omitted = whole file),',
      '{op:"addPageText",page:1,text:"Approved",x:40,y:40,fontSize:18},',
      '{op:"replacePageText",page:1,find:"Draft",replace:"Final",all:true} edits existing text in place (keeps font/size/position; fails when the text is split across runs),',
      '{op:"addPageImage",page:1,dataBase64:"iVBOR…",mime:"image/png",x:40,y:80,width:200,height:120},',
      '{op:"replacePageImage",page:1,index:1,dataBase64:"iVBOR…",mime:"image/png"} to swap an existing picture in place,',
      '{op:"setPageImageBox",page:1,index:1,x:200,y:100,width:120,height:60,rotation:90} moves/scales/rotates an existing image (top-left origin, pt; rotation clockwise),',
      '{op:"annotatePage",page:1,annotation:"highlight",x:60,y:90,width:120,height:18,contents:"核对"} (highlight/underline/squiggly/strikeOut/note),',
      '{op:"cropPage",page:1,top:20,right:20,bottom:20,left:20} (margins in pt),',
      '{op:"fillForm",fields:[{name:"name",value:"Alice"}]}; PDF overlays use top-left coordinates in pt; use replacePageText/replacePageImage to change existing content without moving it;',
      '{op:"setCellValue",sheet:"Sheet1",cell:"B2",value:42} or value:{formula:"SUM(B2:B9)"};',
      '{op:"setCellStyle",sheet:"Sheet1",range:"A1:C3",cellStyle:{bold:true,fill:"FFF2CC",align:"ctr"}}, {op:"clearCells",sheet:"Sheet1",range:"A2:C2"} empties a range,',
      '{op:"insertRows",sheet:"Sheet1",at:3,count:2}, {op:"deleteColumns",sheet:"Sheet1",at:1} for XLSX structure;',
      '{op:"addSheet",name:"汇总"}, {op:"renameSheet",sheet:"Sheet1",name:"数据"}, {op:"deleteSheet",sheet:"Sheet3"}, {op:"setSheetTabColor",sheet:"Sheet1",color:"4472C4"} (omit color to clear the tab colour) for worksheets;',
      '{op:"deleteSlide",slide:3}, {op:"moveSlide",from:3,to:1}, {op:"duplicateSlide",slide:1}, {op:"addSlide",after:2,layout:"两栏内容"} for slides (separate call from per-shape edits);',
      '{op:"addTextBox",slide:1,text:"标题",box:{x:60,y:40,w:600,h:80},style:{size:28,bold:true}}, {op:"deleteShape",slide:1,shapeId:"7"}, {op:"renameShape",slide:1,shapeId:"7",name:"标题"} for shapes;',
      '{op:"setSlideNotes",slide:1,text:"讲者提示"} writes speaker notes (creates the notes slide when missing), {op:"setSlideHidden",slide:1,hidden:true} skips it in slideshow;',
      "PPTX slide text/geometry ops need slide + shapeId from office_pptx_read.",
      "add cellStyle:{merge:true} to merge a range (merge:false unmerges);",
      'add cellStyle:{format:"percent"} or {format:"0.00"} for number formats, {border:"thin"} for borders;',
      '{op:"setText",text:"..."}, {op:"sortLines"}, {op:"formatJson",indent:"  "},',
      '{op:"changeCase",mode:"upper"}, {op:"convertIndent",toTabs:true,width:2} for text files;',
      '{op:"setHeading",level:2,start:0,end:120}, {op:"toggleList",kind:"ordered",start:0,end:120},',
      '{op:"setProperty",key:"tags",property:["工作","2026"]}, {op:"setProperty",key:"draft",property:false},',
      '{op:"deleteProperty",key:"draft"} edit Markdown front-matter properties (only that line is rewritten);',
      '{op:"toggleQuote",start:0,end:120}, {op:"toggleTask",start:0,end:120} rewrite whole lines',
      "(Markdown heading only; lists/quotes work in plain text too; toggleTask flips - [ ] / - [x])",
      "and require start/end offsets of the lines to change;",
      "other text ops without start/end apply to the whole file, with offsets they apply to that range.",
    ].join(" "),
  }),
})

type EditInput = Schema.Schema.Type<typeof EditParameters>

export const OfficeDocumentEditTool = Tool.define<typeof EditParameters, Record<string, never>, Bus.Service>(
  "office_document_edit",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return {
      description: [
        "Edit a DOCX, XLSX, CSV, HTML, Markdown, PDF or plain-text file in place using node-level operations.",
        "DOCX only rewrites word/document.xml; XLSX only rewrites the touched sheet (plus styles.xml for formatting);",
        "HTML rewrites only the touched block; text files keep their",
        "original encoding, BOM and line endings. Every other byte is preserved, so formatting, styles and media stay intact.",
        "Use office_document_read first to get paragraph/block indexes. All operations in one call succeed or none apply.",
        "Every edit is recorded in the host undo stack, so the user can undo it from the file panel.",
      ].join(" "),
      parameters: EditParameters,
      execute: (params: EditInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = permissionRoot(instance)
          const filepath = resolve(root, params.filePath)
          const format = officeFormatOf(filepath)
          if (!format) {
            throw new Error("office_document_edit 不支持这种文件：" + params.filePath)
          }
          if (params.ops.length === 0) throw new Error("没有要执行的操作")

          const ops: OfficeOp[] = []
          for (const item of params.ops) {
            const converted = toOfficeOp(item)
            if (!converted.ok) throw new Error(converted.message)
            ops.push(converted.op)
          }

          yield* assertExternalDirectoryEffect(ctx, filepath)
          const relative = path.relative(root, filepath)
          yield* ctx.ask({ permission: "edit", patterns: [relative], always: ["*"], metadata: { filepath } })

          // 走和右侧面板同一条写回路径（含临时文件 + rename）：
          // AI 的修改因此也进宿主的撤销栈，用户按「撤销」能把 AI 刚做的那一步退掉。
          const result = yield* Effect.promise(async () => {
            const applied = await editDocumentFile(
              filepath,
              format,
              ops,
              params.password === undefined ? {} : { password: params.password },
            )
            if (!applied.ok) {
              throw new Error(applied.error.message + (applied.error.suggestion ? "；" + applied.error.suggestion : ""))
            }
            return applied.data
          })

          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filepath, event: "change" })

          return {
            title: `${params.ops.length} operation(s)`,
            metadata: {},
            output: [
              `改为 ${relative}，重写 ${result.changed.join(", ")}（其余字节不变）`,
              ...params.ops.map((item) => {
                const where =
                  item.paragraph !== undefined
                    ? `段落 ${item.paragraph}`
                    : item.block !== undefined
                      ? `块 ${item.block}`
                      : "整篇"
                return `- ${where}: ${item.op}`
              }),
            ].join("\n"),
          }
        }),
    }
  }),
)

const ExportParameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description:
      "Path to any supported document, including legacy .doc / .xls / .ppt / .odt / .ods / .odp / .rtf. Relative paths resolve against the workspace root.",
  }),
  target: Schema.String.annotate({
    description:
      "Target format: csv / tsv / html for XLSX, csv / tsv / md / html / json for CSV, md / txt / html for DOCX and PPTX, txt / md / html for rich text, txt for plain text. Legacy formats (odt/ods/odp/rtf) can also be saved as docx / xlsx / pptx. Use png to render one page as a picture (see page).",
  }),
  page: Schema.optional(
    Schema.Number.annotate({ description: "Page to render when target is png (1-based, default 1)." }),
  ),
  outputPath: Schema.optional(
    Schema.String.annotate({
      description:
        "Where to write the exported file. Defaults to the source path with the target extension (report.docx → report.md).",
    }),
  ),
  password: Schema.optional(Schema.String).annotate({
    description: "Password for an encrypted PDF (user or owner password). Ignored for other formats.",
  }),
})

type ExportInput = Schema.Schema.Type<typeof ExportParameters>

/**
 * 导出：只读原文件，写出一份新格式的副本。
 *
 * 和右侧面板的「导出」按钮走同一个 `exportDocumentAs`，
 * 所以能力完全一致 —— 模型能把一份 docx 变成 markdown 拿去改，
 * 也能把 xlsx 变成 csv 交给别的工具处理。
 */
export const OfficeDocumentExportTool = Tool.define<typeof ExportParameters, Record<string, never>, Bus.Service>(
  "office_document_export",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return {
      description: [
        "Export a DOCX / XLSX / HTML / Markdown / plain-text file into another text format.",
        "XLSX → csv / tsv / html, CSV → csv / tsv / md / html / json, DOCX / PPTX → md / txt / html, rich text → txt / md / html, plain text → txt, ODT / RTF → docx, ODS → xlsx, ODP → pptx.",
        "The source file is never modified; the result is written to outputPath.",
        "target=png renders one page as an image (docx / xlsx / pptx are laid out to PDF first); page selects it.",
      ].join(" "),
      parameters: ExportParameters,
      execute: (params: ExportInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = permissionRoot(instance)
          const filepath = resolve(root, params.filePath)
          const format = officeFormatOf(filepath)
          if (!format) throw new Error("office_document_export 不支持这种文件：" + params.filePath)

          const kind = normalizeExportTarget(params.target)
          // 默认落在源文件旁边、同名的另一种后缀（report.docx → report.md）。
          const dot = filepath.lastIndexOf(".")
          const stem =
            dot > filepath.lastIndexOf("/") && dot > filepath.lastIndexOf("\\") ? filepath.slice(0, dot) : filepath
          const output = params.outputPath ? resolve(root, params.outputPath) : stem + "." + kind

          yield* assertExternalDirectoryEffect(ctx, output)
          const relativeOutput = path.relative(root, output)
          yield* ctx.ask({
            permission: "edit",
            patterns: [relativeOutput],
            always: ["*"],
            metadata: { filepath: output },
          })

          const exported = yield* Effect.promise(async () => {
            const bytes = new Uint8Array(await readFile(filepath))
            const result = await exportDocumentAs(bytes, format, kind, {
              ...(params.password === undefined ? {} : { password: params.password }),
              ...(params.page === undefined ? {} : { page: params.page }),
            })
            if (!result.ok) {
              throw new Error(result.error.message + (result.error.suggestion ? "；" + result.error.suggestion : ""))
            }
            await mkdir(path.dirname(output), { recursive: true })
            const temp = `${output}.novaway-export-${Date.now()}`
            await writeFile(temp, result.data.bytes)
            await rename(temp, output)
            return result.data
          })

          yield* bus.publish(File.Event.Edited, { file: output })
          yield* bus.publish(FileWatcher.Event.Updated, { file: output, event: "add" })

          return {
            title: `导出为 .${exported.target}`,
            metadata: {},
            output: [
              `已导出 ${path.relative(root, filepath)} → ${relativeOutput}`,
              `${exported.bytes.length} 字节，${exported.mime}（原文件未改动）`,
            ].join("\n"),
          }
        }),
    }
  }),
)
