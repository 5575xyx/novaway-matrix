/**
 * PPTX 原地编辑工具：改文字/格式/位置/图片，不动别的。
 *
 * 之前的 office 链路是「整份重新生成」——用户想改封面上一句话，模型也得重画整本，
 * 字号、图片位置、动画全变成新的。这里改成外科手术：直接改 `ppt/slides/slideN.xml`
 * 里某个块的 XML，其余 zip 条目逐字节保留。
 *
 * 定位靠 `p:cNvPr@id` / `@name`，要先用 `office_pptx_read` 拿到页面上有哪些块
 * （id、名称、段落原文、几何），再按 id 改 —— 猜名字改错页比改不动更糟。
 */
import { Effect, Schema } from "effect"
import * as path from "path"
import { readFile, rename, writeFile } from "fs/promises"
import { assertExternalDirectoryEffect } from "./external-directory"
import {
  editPptx,
  editPptxSlides,
  listPptxLayouts,
  readPptxLayout,
  type PptxShapeOp,
} from "@novaway/core/office/pptx-edit"
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
        "List the editable objects of a PPTX that already exists on disk: slide, shape id, name, kind, geometry,",
        "text paragraphs with their formatting, table cells, and pictures.",
        "Call this before office_pptx_edit - editing needs a shapeId (or an exact shape name) from here.",
        "Read-only; nothing is modified.",
      ].join(" "),
      parameters: ReadParameters,
      capabilities: { readOnly: true, concurrencySafe: true, idempotent: true },
      execute: (params: ReadInput) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = permissionRoot(instance)
          const filepath = resolve(root, params.filePath)
          const bytes = new Uint8Array(yield* Effect.promise(() => readFile(filepath)))
          const layout = yield* Effect.promise(() => readPptxLayout(bytes, params.slides))
          const layouts = yield* Effect.promise(() => listPptxLayouts(bytes))
          if (layout.length === 0) {
            return {
              title: "No editable objects",
              metadata: {},
              output: `${path.relative(root, filepath)} has no text, tables or pictures on the requested slides.`,
            }
          }
          const slides = new Map<number, string[]>()
          for (const node of layout) {
            const lines = slides.get(node.slide) ?? []
            const heading = [
              `- shapeId=${node.shapeId}`,
              node.shapeName ? `"${node.shapeName}"` : undefined,
              node.kind,
              node.box
                ? `x=${Math.round(node.box.x)} y=${Math.round(node.box.y)} w=${Math.round(node.box.w)} h=${Math.round(node.box.h)}`
                : undefined,
              node.rotation ? `rot=${node.rotation}°` : undefined,
            ]
              .filter(Boolean)
              .join(" ")
            lines.push(heading)
            node.paragraphs.forEach((text, index) => {
              const style = node.styles[index] ?? {}
              const hints = [
                style.size ? `${style.size}pt` : undefined,
                style.bold ? "bold" : undefined,
                style.italic ? "italic" : undefined,
                style.color ? `#${style.color}` : undefined,
                style.align ? `align=${style.align}` : undefined,
              ]
                .filter(Boolean)
                .join(" ")
              lines.push(`  [${index}] ${text}${hints ? `  (${hints})` : ""}`)
            })
            for (const cell of node.cells ?? []) {
              const at = cell.box ? ` @${cell.box.x},${cell.box.y} ${cell.box.w}x${cell.box.h}` : ""
              lines.push(`  cell[${cell.row}][${cell.col}]${at} ${cell.paragraphs.join(" / ")}`)
            }
            if (node.image) lines.push(`  picture: ${node.image.target || node.image.rId}`)
            slides.set(node.slide, lines)
          }
          return {
            title: `${layout.length} object(s)`,
            metadata: {},
            output:
              (layouts.length > 0
                ? "## 版式\n" + layouts.map((item) => `- ${item.name} (${item.part})`).join("\n") + "\n\n"
                : "") +
              [...slides.entries()].map(([slide, lines]) => `## 第 ${slide} 页\n${lines.join("\n")}`).join("\n\n"),
          }
        }),
    }
  }),
)

const Style = Schema.Struct({
  bold: Schema.optional(Schema.Boolean),
  italic: Schema.optional(Schema.Boolean),
  underline: Schema.optional(Schema.Boolean),
  size: Schema.optional(Schema.Number).annotate({ description: "Font size in points." }),
  color: Schema.optional(Schema.String).annotate({ description: "Hex colour, e.g. 1F2937." }),
  align: Schema.optional(Schema.Literals(["l", "ctr", "r", "just"])),
  font: Schema.optional(Schema.String),
})

const Box = Schema.Struct({
  x: Schema.Number.annotate({ description: "Left, in EMU." }),
  y: Schema.Number.annotate({ description: "Top, in EMU." }),
  w: Schema.Number.annotate({ description: "Width, in EMU." }),
  h: Schema.Number.annotate({ description: "Height, in EMU." }),
})

const EditParameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "Path to the .pptx file to modify in place." }),
  texts: Schema.optional(
    Schema.Array(
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
        text: Schema.optional(Schema.String).annotate({
          description: "New text for that paragraph. Omit to only change formatting.",
        }),
        style: Schema.optional(Style),
        cell: Schema.optional(
          Schema.Struct({ row: Schema.Number, col: Schema.Number }).annotate({
            description: "Table cell (0-based). The paragraph index is inside that cell.",
          }),
        ),
      }),
    ),
  ),
  shapes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slide: Schema.Number,
        shapeId: Schema.optional(Schema.String),
        shapeName: Schema.optional(Schema.String),
        box: Schema.optional(Box),
        rotation: Schema.optional(Schema.Number).annotate({ description: "Clockwise rotation in degrees." }),
      }),
    ),
  ),
  images: Schema.optional(
    Schema.Array(
      Schema.Struct({
        slide: Schema.Number,
        shapeId: Schema.optional(Schema.String),
        shapeName: Schema.optional(Schema.String),
        imagePath: Schema.String.annotate({
          description: "Path to the new image file (png/jpeg/gif/webp/svg).",
        }),
      }),
    ),
  ),
  /** 页面结构：新建 / 删除 / 调序 / 复制。 */
  slides: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          op: Schema.Literal("addSlide"),
          after: Schema.optional(Schema.Number),
          layout: Schema.optional(Schema.String).annotate({
            description: "Layout name (from office_pptx_read layouts), slideLayoutN.xml, or 1-based index.",
          }),
        }),
        Schema.Struct({ op: Schema.Literal("deleteSlide"), slide: Schema.Number }),
        Schema.Struct({ op: Schema.Literal("moveSlide"), from: Schema.Number, to: Schema.Number }),
        Schema.Struct({ op: Schema.Literal("duplicateSlide"), slide: Schema.Number }),
      ]),
    ),
  ),
  /** 形状结构：新建文本框 / 删除形状。 */
  structure: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          op: Schema.Literal("addTextBox"),
          slide: Schema.Number,
          text: Schema.String,
          box: Schema.optional(Box),
          style: Schema.optional(Style),
        }),
        Schema.Struct({
          op: Schema.Literal("addShape"),
          slide: Schema.Number,
          kind: Schema.Literals(["rect", "roundRect", "ellipse", "triangle", "diamond", "rightArrow", "line", "star5"]),
          box: Schema.optional(Box),
          fill: Schema.optional(Schema.String).annotate({
            description: "Fill colour RRGGBB. Omit for the theme accent.",
          }),
          line: Schema.optional(Schema.String).annotate({ description: "Outline colour RRGGBB. Omit for no outline." }),
          text: Schema.optional(Schema.String),
          style: Schema.optional(Style),
        }),
        Schema.Struct({
          op: Schema.Literal("addPicture"),
          slide: Schema.Number,
          imagePath: Schema.String.annotate({
            description: "Image on disk (png/jpeg/gif/webp/svg). Relative paths resolve against the workspace root.",
          }),
          box: Schema.optional(Box),
        }),
        Schema.Struct({
          op: Schema.Literal("deleteShape"),
          slide: Schema.Number,
          shapeId: Schema.optional(Schema.String),
          shapeName: Schema.optional(Schema.String),
        }),
      ]),
    ),
  ),
})

type EditInput = Schema.Schema.Type<typeof EditParameters>

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
}

export const OfficePptxEditTool = Tool.define<typeof EditParameters, Record<string, never>, Bus.Service>(
  "office_pptx_edit",
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    return {
      description: [
        "Edit a PPTX in place: rewrite paragraph text, change font formatting, move/resize/rotate shapes, or swap a picture.",
        "Only the touched slide XML (plus the new media entry for pictures) is rewritten; images, theme, master, other slides",
        "and animations are copied byte-for-byte, so the deck keeps its layout instead of being regenerated.",
        "Pass shapeId from office_pptx_read. Theme fonts and sizes are inherited from the existing runs unless you override them.",
        "slides accepts addSlide (after, optional layout), deleteSlide, moveSlide (from/to) and duplicateSlide; structure accepts",
        "addTextBox (slide, text, optional box/style), addShape (slide + kind rect/roundRect/ellipse/triangle/diamond/rightArrow/line/star5, optional box/fill/line/text/style; box is in EMU like the other structure ops), addPicture (slide + imagePath, optional EMU box) and deleteShape (slide + shapeId or shapeName).",
      ].join(" "),
      parameters: EditParameters,
      execute: (params: EditInput, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const root = permissionRoot(instance)
          const filepath = resolve(root, params.filePath)
          if (!filepath.toLowerCase().endsWith(".pptx")) throw new Error("office_pptx_edit only edits .pptx files")

          yield* assertExternalDirectoryEffect(ctx, filepath)
          const relative = path.relative(root, filepath)
          yield* ctx.ask({ permission: "edit", patterns: [relative], always: ["*"], metadata: { filepath } })

          const result = yield* Effect.promise(async () => {
            const original = new Uint8Array(await readFile(filepath))
            // 页面操作先做：后面的文字/形状定位用的都是「新页序」。
            const slid = params.slides?.length ? await editPptxSlides(original, params.slides) : undefined
            const bytes = slid?.bytes ?? original
            const imageEdits = [] as Array<{
              slide: number
              shapeId?: string
              shapeName?: string
              data: Uint8Array
              mime: string
            }>
            for (const image of params.images ?? []) {
              const source = resolve(root, image.imagePath)
              const ext = source.slice(source.lastIndexOf(".") + 1).toLowerCase()
              imageEdits.push({
                slide: image.slide,
                shapeId: image.shapeId,
                shapeName: image.shapeName,
                data: new Uint8Array(await readFile(source)),
                mime: MIME_BY_EXT[ext] ?? "image/png",
              })
            }
            const structureOps: PptxShapeOp[] = []
            for (const item of params.structure ?? []) {
              if (item.op !== "addPicture") {
                structureOps.push(item)
                continue
              }
              const source = resolve(root, item.imagePath)
              const ext = source.slice(source.lastIndexOf(".") + 1).toLowerCase()
              structureOps.push({
                op: "addPicture" as const,
                slide: item.slide,
                data: new Uint8Array(await readFile(source)),
                mime: MIME_BY_EXT[ext] ?? "image/png",
                ...(item.box ? { box: item.box } : {}),
              })
            }
            const edited = await editPptx({
              bytes,
              textEdits: params.texts ?? [],
              shapeEdits: params.shapes ?? [],
              imageEdits,
              shapeOps: structureOps,
            })
            // 页面操作与形状操作可能落在不同的包条目上：合并「改了哪些」。
            const changed = [...new Set([...(slid?.changed ?? []), ...edited.changed])]
            // 先写临时文件再 rename：用户可能正用 PowerPoint 打开着这份文件。
            const temp = `${filepath}.novaway-edit-${Date.now()}`
            await writeFile(temp, edited.bytes)
            await rename(temp, filepath)
            return { ...edited, changed, slideApplied: slid?.applied ?? [] }
          })

          // 和 write/edit 工具一样显式广播一次写盘事件：这里落盘走「临时文件 + rename」，
          // 文件监听器看到的是 temp 的 add/unlink（且可能被忽略规则吞掉），
          // 前端拿不到稳定的「这份产物改好了」信号，右侧跟随/预览就刷不出来。
          yield* bus.publish(File.Event.Edited, { file: filepath })
          yield* bus.publish(FileWatcher.Event.Updated, { file: filepath, event: "change" })

          const lines: string[] = []
          for (const item of result.slideApplied) {
            lines.push("- 页面操作：" + item.op)
          }
          for (const item of result.textApplied) {
            const where = item.cell ? `单元格(${item.cell.row},${item.cell.col})` : `第 ${item.paragraph} 段`
            const changed = item.previous !== item.text ? `"${item.previous}" -> "${item.text}"` : "仅改格式"
            lines.push(`- 第 ${item.slide} 页 ${shapeLabel(item)} ${where}: ${changed}`)
          }
          for (const item of result.shapeApplied) {
            lines.push(
              `- 第 ${item.slide} 页 ${shapeLabel(item)}: 位置/尺寸 ${formatBox(item.box)}` +
                (item.rotation !== undefined ? `，旋转 ${item.rotation}°` : ""),
            )
          }
          for (const item of result.imageApplied) {
            lines.push(`- 第 ${item.slide} 页 ${shapeLabel(item)}: 换成 ${item.mediaPath}`)
          }
          return {
            title: `${result.textApplied.length + result.shapeApplied.length + result.imageApplied.length} edit(s)`,
            metadata: {},
            output: [`改为 ${relative}，重写 ${result.changed.join(", ")}（其余条目字节不变）`, ...lines].join("\n"),
          }
        }),
    }
  }),
)

function shapeLabel(item: { shapeId: string; shapeName?: string }) {
  return item.shapeName ? `「${item.shapeName}」` : `shape ${item.shapeId}`
}

function formatBox(box: { x: number; y: number; w: number; h: number } | undefined) {
  if (!box) return "未变"
  return `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.w)} h=${Math.round(box.h)}`
}
