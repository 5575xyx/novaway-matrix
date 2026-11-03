import { AppFileSystem } from "@novaway/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises"
import path from "path"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { OfficePlatform } from "@/office/platform"
import { editPptx as applyPptxEdit } from "@novaway/core/office/pptx-edit"
import type { OfficeOp } from "@novaway/core/office/engine/contract"
import { applyDocumentOpsAs, formatOfPath } from "@/office/document-file"
import { toOfficeOp } from "@/office/ops-schema"
import { boxPtToEmu } from "@novaway/core/office/engine/units"
import { fillPptxTemplateText } from "@/util/office-document"
import { InstanceHttpApi } from "../api"
import {
  OfficeArtifactPayload,
  OfficeDocumentEditPayload,
  OfficePptxEditPayload,
  OfficePptxTemplateFillPayload,
} from "../groups/office"

const kindDir = {
  document: "documents",
  ppt: "ppt",
  data: "data",
  design: "design",
  web: "web",
  meeting: "meetings",
  knowledge: "knowledge",
  task: "tasks",
  communication: "communication",
} as const

const kindByDir = Object.fromEntries(Object.entries(kindDir).map(([kind, dir]) => [dir, kind])) as Record<
  string,
  keyof typeof kindDir
>

export const officeHandlers = HttpApiBuilder.group(InstanceHttpApi, "office", (handlers) =>
  Effect.gen(function* () {
    const platform = yield* OfficePlatform.Service
    const bus = yield* Bus.Service

    /**
     * Office 产物落盘后广播「文件已更新」。
     *
     * 和 write/edit 工具口径一致：右侧面板的实时跟随、预览刷新都靠这个事件驱动。
     * 原地改字走「临时文件 + rename」——文件监听器只看到 temp 的增删，拿不到
     * 「这份产物改好了」的稳定信号；另外两条直接覆盖写也统一走这里，口径一致。
     * 广播失败不该让保存失败，所以用 ignore 兜住。
     */
    const announceWrite = (absolute: string, existed: boolean) =>
      Effect.gen(function* () {
        yield* bus.publish(File.Event.Edited, { file: absolute })
        yield* bus.publish(FileWatcher.Event.Updated, { file: absolute, event: existed ? "change" : "add" })
      }).pipe(Effect.ignore)

    const listArtifacts = Effect.fn("OfficeHttpApi.listArtifacts")(function* () {
      const state = yield* InstanceState.context
      const workspace = state.worktree === "/" ? state.directory : state.worktree
      const root = path.join(workspace, ".novaway", "office")
      return yield* Effect.promise(async () => {
        const directories = await readdir(root, { withFileTypes: true }).catch(() => [])
        const artifacts = await Promise.all(
          directories
            .filter((entry) => entry.isDirectory() && kindByDir[entry.name])
            .flatMap(async (entry) => {
              const files = await readdir(path.join(root, entry.name), { withFileTypes: true }).catch(() => [])
              return Promise.all(
                files
                  .filter((file) => file.isFile())
                  .map(async (file) => {
                    const target = path.join(root, entry.name, file.name)
                    const info = await stat(target)
                    return {
                      kind: kindByDir[entry.name]!,
                      path: path.relative(workspace, target),
                      filename: file.name,
                      bytes: info.size,
                      modified: info.mtimeMs,
                    }
                  }),
              )
            }),
        )
        return artifacts.flat().sort((a, b) => b.modified - a.modified)
      })
    })

    const saveArtifact = Effect.fn("OfficeHttpApi.saveArtifact")(function* (ctx: {
      payload: typeof OfficeArtifactPayload.Type
    }) {
      const filename = safeFilename(ctx.payload.filename)
      if (!filename || !ctx.payload.contentBase64.trim()) return yield* new HttpApiError.BadRequest({})

      const state = yield* InstanceState.context
      const root = path.join(state.worktree === "/" ? state.directory : state.worktree, ".novaway", "office")
      const target = path.join(root, kindDir[ctx.payload.kind], filename)
      if (!AppFileSystem.contains(root, target)) return yield* new HttpApiError.BadRequest({})

      const bytes = Buffer.from(ctx.payload.contentBase64, "base64")
      if (!bytes.length) return yield* new HttpApiError.BadRequest({})

      const existed = yield* Effect.promise(() =>
        stat(target).then(
          () => true,
          () => false,
        ),
      )
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, bytes)
      })
      yield* announceWrite(target, existed)

      const relativePath = path.relative(state.worktree === "/" ? state.directory : state.worktree, target)
      const artifact = yield* platform.registerArtifact({
        kind: ctx.payload.kind,
        name: filename,
        filename,
        path: relativePath,
      })

      return {
        path: relativePath,
        bytes: bytes.length,
        version: artifact?.version ?? 1,
      }
    })

    const fillPptxTemplate = Effect.fn("OfficeHttpApi.fillPptxTemplate")(function* (ctx: {
      payload: typeof OfficePptxTemplateFillPayload.Type
    }) {
      const filename = safeFilename(
        ctx.payload.filename.endsWith(".pptx") ? ctx.payload.filename : `${ctx.payload.filename}.pptx`,
      )
      if (!filename || !ctx.payload.templateBase64.trim() || ctx.payload.slides.length === 0)
        return yield* new HttpApiError.BadRequest({})

      const state = yield* InstanceState.context
      const workspace = state.worktree === "/" ? state.directory : state.worktree
      const root = path.join(workspace, ".novaway", "office")
      const target = path.join(root, kindDir.ppt, filename)
      if (!AppFileSystem.contains(root, target)) return yield* new HttpApiError.BadRequest({})

      const bytes = yield* Effect.promise(() =>
        fillPptxTemplateText({
          bytes: Buffer.from(ctx.payload.templateBase64, "base64"),
          plan: { slides: ctx.payload.slides },
        }),
      )
      if (!bytes.length) return yield* new HttpApiError.BadRequest({})

      const templateExisted = yield* Effect.promise(() =>
        stat(target).then(
          () => true,
          () => false,
        ),
      )
      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, bytes)
      })
      yield* announceWrite(target, templateExisted)

      return {
        path: path.relative(workspace, target),
        bytes: bytes.length,
        version: 1,
      }
    })

    /**
     * 原地改 PPTX：文字、格式、几何、图片替换，只重写被点中的那几个块，
     * 其它 zip 条目逐字节拷贝。
     * 写回用「临时文件 + rename」——用户正拿 PowerPoint 打开这份文件时，
     * 直接覆盖会让他拿到半个文件。
     */
    const editDocument = Effect.fn("OfficeHttpApi.editDocument")(function* (ctx: {
      payload: typeof OfficeDocumentEditPayload.Type
    }) {
      const bad = (message: string) => new HttpApiError.BadRequest({ message } as never)
      const relative = ctx.payload.path
        .split(String.fromCharCode(92))
        .join("/")
        .replace(/^(?:\.\/)+/, "")
        .replace(/^\/+/, "")
      if (ctx.payload.ops.length === 0) return yield* bad("没有要执行的操作")

      const format = formatOfPath(relative)
      if (!format) return yield* bad("这个文件类型暂不支持编辑：" + relative)

      const ops: OfficeOp[] = []
      for (const item of ctx.payload.ops) {
        const converted = toOfficeOp(item)
        if (!converted.ok) return yield* bad(converted.message)
        ops.push(converted.op)
      }

      const state = yield* InstanceState.context
      const workspace = state.worktree === "/" ? state.directory : state.worktree
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* bad("路径越界")

      const result = yield* Effect.tryPromise({
        try: async () => {
          const bytes = new Uint8Array(await readFile(target))
          const applied = await applyDocumentOpsAs(bytes, format, ops)
          if (!applied.ok) {
            throw new Error(
              applied.error.message + (applied.error.suggestion ? "；" + applied.error.suggestion : ""),
            )
          }
          // 没有实际改动就不写盘：文本文件的编码/BOM/换行符不该被无谓重写。
          if (applied.data.changed.length === 0) return { ...applied.data, bytes }
          const temp = `${target}.novaway-edit-${Date.now()}`
          await writeFile(temp, applied.data.bytes)
          await rename(temp, target)
          return applied.data
        },
        catch: (error) =>
          bad(error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)),
      })

      if (result.changed.length > 0) yield* announceWrite(target, true)
      return {
        path: relative,
        bytes: result.bytes.length,
        changed: result.changed,
        applied: result.applied.length,
      }
    })

    const editPptx = Effect.fn("OfficeHttpApi.editPptxText")(function* (ctx: {
      payload: typeof OfficePptxEditPayload.Type
    }) {
      const relative = ctx.payload.path
        .split(String.fromCharCode(92))
        .join("/")
        .replace(/^(?:\.\/)+/, "")
        .replace(/^\/+/, "")
      const edits = ctx.payload.edits ?? []
      const shapes = ctx.payload.shapes ?? []
      const images = ctx.payload.images ?? []
      if (!relative.toLowerCase().endsWith(".pptx") || edits.length + shapes.length + images.length === 0)
        return yield* new HttpApiError.BadRequest({})

      const state = yield* InstanceState.context
      const workspace = state.worktree === "/" ? state.directory : state.worktree
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* new HttpApiError.BadRequest({})

      // 解析失败（页码不存在、形状没找到）是用户的输入问题，回 400 而不是 500。
      const result = yield* Effect.tryPromise({
        try: async () => {
          const bytes = new Uint8Array(await readFile(target))
          const edited = await applyPptxEdit({
            bytes,
            textEdits: edits,
            // HTTP 层用 pt（和 UI/画布一致），引擎写 XML 时要 EMU。
            shapeEdits: shapes.map((shape) => ({
              ...shape,
              ...(shape.box ? { box: boxPtToEmu(shape.box) } : {}),
            })),
            imageEdits: images.map((image) => ({
              slide: image.slide,
              shapeId: image.shapeId,
              shapeName: image.shapeName,
              mime: image.mime,
              data: new Uint8Array(Buffer.from(image.dataBase64, "base64")),
            })),
          })
          const temp = `${target}.novaway-edit-${Date.now()}`
          await writeFile(temp, edited.bytes)
          await rename(temp, target)
          return edited
        },
        catch: () => new HttpApiError.BadRequest({}),
      })

      // 原地改字/换图同样算一次写盘（原有文件，事件为 change）。
      yield* announceWrite(target, true)

      return {
        path: relative,
        bytes: result.bytes.length,
        changed: result.changed,
        applied: result.textApplied,
        shapes: result.shapeApplied,
        images: result.imageApplied.map((item) => ({
          slide: item.slide,
          shapeId: item.shapeId,
          shapeName: item.shapeName,
          mediaPath: item.mediaPath,
          rId: item.rId,
        })),
      }
    })

    return handlers
      .handle("listArtifacts", listArtifacts)
      .handle("saveArtifact", saveArtifact)
      .handle("fillPptxTemplate", fillPptxTemplate)
      .handle("editDocument", editDocument)
      .handle("editPptxText", editPptx)
  }),
)

function safeFilename(input: string) {
  return input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120)
}
