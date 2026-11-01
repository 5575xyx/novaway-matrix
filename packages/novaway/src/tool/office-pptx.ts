/**
 * PPTX 原地编辑工具：改文字，不动别的。
 *
 * 之前的 office 链路是「整份重新生成」——用户想改封面上一句话，模型也得重画整本，
 * 字号、图片位置、动画全变成新的。这里改成外科手术：直接改 `ppt/slides/slideN.xml`
 * 里某个 shape 的某一段 `<a:t>`，其余 zip 条目逐字节保留。
 *
 * 形状定位靠 `p:cNvPr@id` / `@name`，要先用 `office_pptx_read` 拿到页面上有哪些
 * 形状（id、名称、段落原文），再按 id 改 —— 猜名字改错页比改不动更糟。
 */
import { Effect, Schema } from "effect"
import * as path from "path"
import { readFile, rename, writeFile } from "fs/promises"
import { assertExternalDirectoryEffect } from "./external-directory"
import { editPptxText, readPptxTextLayout } from "@novaway/core/office/pptx-text-edit"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"

const permissionRoot = (instance: { directory: string; worktree: string }) =>
  instance.worktree === "/" ? instance.directory : instance.worktree

const ReadParameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Path to the .pptx file. Relative paths resolve against the workspace root.",
  }),
  slides: Schema.optional(Schema.Array(Schema.Number)).annotate({
    description: "Only inspect these 1-based slide numbers. Omit to read every slide.",
  }),
})

type ReadInput = Schema.Schema.Type<typeof ReadParameters>

export const OfficePptxReadTool = Tool.define<typeof ReadParameters, Record<string, never>, never>(
  "office_pptx_read",
  Effect.gen(function* () {
    return {
      description: [
        "List the text shapes of a PPTX that already exists on disk: slide number, shape id, shape name and each paragraph's text.",
        "Call this before office_pptx_edit - editing needs a shapeId (or an exact shape name) from here.",
        "Read-only; nothing is modified.",
      ].join(" "),
      parameters: ReadParameters,
      capabilities: { readOnly: true, concurrencySafe: true, idempotent: true },
      execute: (params: ReadInput) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(permissionRoot(instance), params.filePath)
          const layout = yield* Effect.promise(async () =>
            readPptxTextLayout(new Uint8Array(await readFile(filepath)), params.slides),
          )
          if (layout.length === 0) {
            return {
              title: "No text shapes",
              metadata: {},
              output: `${path.relative(permissionRoot(instance), filepath)} has no text shapes on the requested slides.`,
            }
          }
          const slides = new Map<number, string[]>()
          for (const shape of layout) {
            const lines = slides.get(shape.slide) ?? []
            const name = shape.shapeName ? ` "${shape.shapeName}"` : ""
            lines.push(`- shapeId=${shape.shapeId}${name}`)
            shape.paragraphs.forEach((text, index) => {
              lines.push(`  [${index}] ${text}`)
            })
            slides.set(shape.slide, lines)
          }
          return {
            title: `${layout.length} text shape(s)`,
            metadata: {},
            output: [...slides.entries()]
              .map(([slide, lines]) => `## 第 ${slide} 页\n${lines.join("\n")}`)
              .join("\n\n"),
          }
        }),
    }
  }),
)

const EditParameters = Schema.Struct({
  filePath: Schema.String.annotate({
    description: "Path to the .pptx file to modify in place.",
  }),
  edits: Schema.Array(
    Schema.Struct({
      slide: Schema.Number.annotate({ description: "1-based slide number." }),
      shapeId: Schema.optional(Schema.String).annotate({
        description: "p:cNvPr id from office_pptx_read. Preferred over shapeName.",
      }),
      shapeName: Schema.optional(Schema.String).annotate({
        description: "Exact shape name, e.g. '标题 1'. Only use when the id is unknown.",
      }),
      paragraph: Schema.optional(Schema.Number).annotate({
        description: "0-based paragraph index inside the shape (default 0).",
      }),
      text: Schema.String.annotate({ description: "New text for that paragraph." }),
    }),
  ),
})

type EditInput = Schema.Schema.Type<typeof EditParameters>

export const OfficePptxEditTool = Tool.define<typeof EditParameters, Record<string, never>, never>(
  "office_pptx_edit",
  Effect.gen(function* () {
    return {
      description: [
        "Edit the text of existing shapes inside a PPTX in place.",
        "Only the touched slide XML is rewritten; images, theme, master, other slides and animations are copied byte-for-byte,",
        "so the deck keeps its layout instead of being regenerated.",
        "Pass shapeId from office_pptx_read. Font, size, colour and paragraph properties are inherited from the first run of the paragraph.",
      ].join(" "),
      parameters: EditParameters,
      execute: (params: EditInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(permissionRoot(instance), params.filePath)
          if (!filepath.toLowerCase().endsWith(".pptx")) throw new Error("office_pptx_edit only edits .pptx files")

          yield* assertExternalDirectoryEffect(ctx, filepath)
          const relative = path.relative(permissionRoot(instance), filepath)
          yield* ctx.ask({
            permission: "edit",
            patterns: [relative],
            always: ["*"],
            metadata: { filepath },
          })

          const result = yield* Effect.promise(async () => {
            const bytes = new Uint8Array(await readFile(filepath))
            const edited = await editPptxText({ bytes, edits: params.edits })
            // 先写临时文件再 rename：用户可能正用 PowerPoint 打开着这份文件。
            const temp = `${filepath}.novaway-edit-${Date.now()}`
            await writeFile(temp, edited.bytes)
            await rename(temp, filepath)
            return edited
          })

          const applied = result.applied
            .map(
              (item) =>
                `- 第 ${item.slide} 页 ${item.shapeName ? `「${item.shapeName}」` : `shape ${item.shapeId}`}: ` +
                `"${item.previous}" -> "${item.text}"`,
            )
            .join("\n")
          return {
            title: `${result.applied.length} text edit(s)`,
            metadata: {},
            output: [`改为 ${relative}，重写 ${result.changed.join(", ")}（其余条目字节不变）`, applied].join("\n"),
          }
        }),
    }
  }),
)
