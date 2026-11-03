/**
 * 通用文档工具：DOCX 段落、富文本块、纯文本/代码行命令。
 *
 * 和 `office_pptx_*` 并列：PPTX 的几何/图片参数更细，保留专用工具；
 * 其余格式共用 `OfficeOp` 这一套词汇，和右侧面板的编辑走同一条引擎路径。
 */
import { Effect, Schema } from "effect"
import * as path from "path"
import { readFile, rename, writeFile } from "fs/promises"
import { assertExternalDirectoryEffect } from "./external-directory"
import type { OfficeEngine, OfficeFormat, OfficeOp } from "@novaway/core/office/engine/contract"
import { engineFor, officeFormatOf } from "@novaway/core/office/engine/registry"
import { DocumentOp } from "@/office/ops-schema"
import { applyDocumentOpsAs } from "@/office/document-file"
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
    description: "Path to a .docx / .html / .md / .txt file. Relative paths resolve against the workspace root.",
  }),
})

type ReadInput = Schema.Schema.Type<typeof ReadParameters>

function readHint(format: OfficeFormat, state: unknown): string {
  if (format === "docx") {
    const paragraphs = (state as { paragraphs: Array<{ index: number; text: string; style?: string; bold?: boolean; italic?: boolean; size?: number; color?: string; align?: string; inTable?: boolean }> }).paragraphs
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
          paragraph.inTable ? "inTable" : undefined,
        ].filter(Boolean)
        return `[${paragraph.index}] ${paragraph.text}${hints.length ? `  (${hints.join(" ")})` : ""}`
      })
      .join("\n")
  }

  if (format === "html") {
    const blocks = (state as { blocks: Array<{ index: number; tag: string; text: string; editable: boolean; reason?: string }> }).blocks
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
  const body = lines.slice(0, limit).map((line, index) => `${index + 1}\t${line}`).join("\n")
  return body + (lines.length > limit ? `\n… 还有 ${lines.length - limit} 行（用 file.read 查看全文）` : "")
}

export const OfficeDocumentReadTool = Tool.define<typeof ReadParameters, Record<string, never>, never>(
  "office_document_read",
  Effect.gen(function* () {
    return {
      description: [
        "Read the editable structure of a DOCX, HTML, Markdown or plain-text file: paragraphs/blocks with 1-based indexes,",
        "text, and formatting hints; text files come back as numbered lines.",
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
          if (!format) throw new Error("office_document_read 只支持 .docx / .html / .md / .txt：" + params.filePath)
          const engine = engineFor(format)
          if (!engine) throw new Error("暂不支持这种文件：" + format)

          const bytes = yield* Effect.promise(async () => new Uint8Array(await readFile(filepath)))
          const opened = yield* Effect.promise(() => (engine as OfficeEngine<unknown>).open(bytes))
          if (!opened.ok) throw new Error(opened.error.message)

          return {
            title: format + " / " + path.relative(root, filepath),
            metadata: {},
            output: readHint(format, opened.data),
          }
        }),
    }
  }),
)

const EditParameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Path to the .docx / .html / .md / .txt file to modify in place.",
  }),
  ops: Schema.Array(DocumentOp).annotate({
    description: [
      "Ordered operations; all-or-nothing. Common shapes:",
      '{op:"setParagraphText",paragraph:2,text:"new text"} for DOCX/HTML blocks;',
      '{op:"setParagraphStyle",paragraph:2,style:{bold:true,size:18,color:"FF0000"}} for DOCX;',
      '{op:"setBlockType",block:1,tag:"h2"}, {op:"setBlockAlign",block:1,align:"center"},',
      '{op:"formatRange",block:1,start:0,end:4,patch:{bold:true,color:"FF0000"}} for HTML;',
      '{op:"setBlockHtml",block:1,html:"<strong>整段</strong>替换"} for rich text;',
      '{op:"setText",text:"..."}, {op:"sortLines"}, {op:"formatJson",indent:"  "} for text files.',
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
        "Edit a DOCX, HTML, Markdown or plain-text file in place using node-level operations.",
        "DOCX only rewrites word/document.xml; HTML rewrites only the touched block; text files keep their",
        "original encoding, BOM and line endings. Every other byte is preserved, so formatting, styles and media stay intact.",
        "Use office_document_read first to get paragraph/block indexes. All operations in one call succeed or none apply.",
      ].join(" "),
      parameters: EditParameters,
      execute: (params: EditInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = permissionRoot(instance)
          const filepath = resolve(root, params.filePath)
          const format = officeFormatOf(filepath)
          if (!format) throw new Error("office_document_edit 只支持 .docx / .html / .md / .txt：" + params.filePath)
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

          const result = yield* Effect.promise(async () => {
            const bytes = new Uint8Array(await readFile(filepath))
            const applied = await applyDocumentOpsAs(bytes, format, ops)
            if (!applied.ok) {
              throw new Error(
                applied.error.message + (applied.error.suggestion ? "；" + applied.error.suggestion : ""),
              )
            }
            if (applied.data.changed.length === 0) {
              throw new Error("操作没有产生任何改动")
            }
            // 先写临时文件再 rename：用户可能正开着这份文件。
            const temp = `${filepath}.novaway-edit-${Date.now()}`
            await writeFile(temp, applied.data.bytes)
            await rename(temp, filepath)
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
