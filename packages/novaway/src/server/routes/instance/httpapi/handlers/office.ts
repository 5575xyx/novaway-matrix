import { AppFileSystem } from "@novaway/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises"
import path from "path"
import { Bus } from "@/bus"
import { InstanceState } from "@/effect/instance-state"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { OfficePlatform } from "@/office/platform"
import { editPptx as applyPptxEdit } from "@novaway/core/office/pptx-edit"
import { createDocumentAsync } from "@novaway/core/office/create"
import type { OfficeOp } from "@novaway/core/office/engine/contract"
import { formatOfPath } from "@/office/document-file"
import { exportDocumentAs, isBinaryExportTarget } from "@/office/document-export"
import {
  documentHistory,
  editDocumentFile,
  recordDocumentWrite,
  redoDocumentFile,
  undoDocumentFile,
} from "@/office/document-sessions"
import { toOfficeOp } from "@/office/ops-schema"
import { boxEmuToPt, boxPtToEmu } from "@novaway/core/office/engine/units"
import { fillPptxTemplateText } from "@/util/office-document"
import { PluginRuntimeService } from "@/plugin/runtime/service"
import type { RuntimeOfficeRegistry } from "@/office/runtime"
import { InstanceHttpApi } from "../api"
import {
  OfficeArtifactPayload,
  OfficeDocumentCreatePayload,
  OfficeDocumentEditPayload,
  OfficeDocumentExportPayload,
  OfficeDocumentHistoryPayload,
  OfficeDocumentSavePayload,
  OfficePptxEditPayload,
  OfficePptxTemplateFillPayload,
  officeError,
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
    const runtime = yield* PluginRuntimeService.Service
    const officeRegistry = Effect.fn("OfficeHttpApi.officeRegistry")(function* () {
      return (yield* runtime.get).registries.office
    })

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
     * 新建 Office 文件：和 CLI 的 `office create`、AI 的参数走同一个 `createDocument`。
     * 只创建不覆盖 —— 写文件不可逆，撞名让调用方换个名字。
     */
    const createDocumentFile = Effect.fn("OfficeHttpApi.createDocument")(function* (ctx: {
      payload: typeof OfficeDocumentCreatePayload.Type
    }) {
      const bad = (message: string) => new HttpApiError.BadRequest({ message } as never)
      const relative = normalizeRelativePath(ctx.payload.path)
      if (!relative) return yield* bad("没有指定文件路径")

      const state = yield* InstanceState.context
      // File 面板返回的是相对当前实例 directory 的路径；worktree 可能是仓库根，不能用它直接拼面板路径。
      const workspace = state.directory
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* bad("路径越界")

      const existed = yield* Effect.promise(() =>
        stat(target).then(
          () => true,
          () => false,
        ),
      )
      if (existed) return yield* bad("同名文件已经存在：" + relative)

      const created = yield* Effect.tryPromise({
        try: () => createDocumentAsync(relative, { title: ctx.payload.title, body: ctx.payload.body }),
        catch: (error) => bad(error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)),
      })

      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, created.bytes)
      })
      yield* announceWrite(target, false)

      return { path: relative, kind: created.kind, bytes: created.bytes.length }
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
      const relative = normalizeRelativePath(ctx.payload.path)
      if (ctx.payload.ops.length === 0) return yield* bad("没有要执行的操作")

      const registry = yield* officeRegistry()
      const format = formatOfPath(relative, registry)
      if (!format) return yield* bad("这个文件类型暂不支持编辑：" + relative)

      const ops: OfficeOp[] = []
      for (const item of ctx.payload.ops) {
        const converted = toOfficeOp(item)
        if (!converted.ok) return yield* bad(converted.message)
        ops.push(converted.op)
      }

      const state = yield* InstanceState.context
      const workspace = state.directory
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* bad("路径越界")

      const result = yield* Effect.tryPromise({
        try: async () => {
          const applied = await editDocumentFile(target, format, ops, {
            registry,
            ...(ctx.payload.password === undefined ? {} : { password: ctx.payload.password }),
          })
          if (!applied.ok) {
            throw new Error(applied.error.message + (applied.error.suggestion ? "；" + applied.error.suggestion : ""))
          }
          return applied.data
        },
        catch: (error) => bad(error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)),
      })

      yield* announceWrite(target, true)
      return {
        path: relative,
        bytes: result.bytes.length,
        changed: result.changed,
        applied: result.applied.length,
        ...result.history,
      }
    })

    /**
     * 整字节写回（浏览器内 Office 编辑器保存）：把编辑器算好的完整字节
     * 一次写回原路径。复用 `recordDocumentWrite` —— 字节进宿主撤销栈、
     * 原子写回（temp + rename）、watcher 广播，与 PPTX 画布编辑同一条路。
     */
    const saveDocument = Effect.fn("OfficeHttpApi.saveDocument")(function* (ctx: {
      payload: typeof OfficeDocumentSavePayload.Type
    }) {
      const bad = (message: string) => new HttpApiError.BadRequest({ message } as never)
      const relative = normalizeRelativePath(ctx.payload.path)
      if (!ctx.payload.contentBase64.trim()) return yield* bad("没有要保存的内容")

      const registry = yield* officeRegistry()
      const format = formatOfPath(relative, registry)
      if (!format) return yield* bad("这个文件类型暂不支持保存：" + relative)

      const state = yield* InstanceState.context
      const workspace = state.directory
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* bad("路径越界")

      const expectedBaselineSha256 = ctx.payload.expectedBaselineSha256
      if (expectedBaselineSha256 && !/^[0-9a-f]{64}$/i.test(expectedBaselineSha256)) {
        return yield* bad("保存版本摘要格式不正确")
      }

      const next = new Uint8Array(Buffer.from(ctx.payload.contentBase64, "base64"))
      if (!next.length) return yield* bad("保存内容为空")

      const result = yield* Effect.tryPromise({
        try: async () => {
          const previous = new Uint8Array(await readFile(target))
          const recorded = await recordDocumentWrite(
            target,
            format,
            previous,
            next,
            "保存编辑",
            expectedBaselineSha256,
            { registry },
          )
          if (!recorded.ok) {
            throw new Error(
              recorded.error.message + (recorded.error.suggestion ? "；" + recorded.error.suggestion : ""),
            )
          }
          return recorded.data
        },
        catch: (error) => bad(error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)),
      })

      yield* announceWrite(target, true)
      return {
        path: relative,
        bytes: result.bytes.length,
        ...result.history,
      }
    })

    /**
     * 撤销 / 重做共用一个壳：规范化路径 → 推断格式 → 改字节 → 广播。
     * 历史属于宿主会话（见 @/office/document-sessions），人和 AI 共用一条栈。
     */
    function* historyEdit(
      ctx: { payload: typeof OfficeDocumentHistoryPayload.Type },
      action: (
        target: string,
        format: NonNullable<ReturnType<typeof formatOfPath>>,
        registry: RuntimeOfficeRegistry | undefined,
      ) => Promise<Awaited<ReturnType<typeof undoDocumentFile>>>,
    ) {
      const bad = (message: string) => new HttpApiError.BadRequest({ message } as never)
      const relative = normalizeRelativePath(ctx.payload.path)
      const registry = yield* officeRegistry()
      const format = formatOfPath(relative, registry)
      if (!format) return yield* bad("这个文件类型暂不支持编辑：" + relative)

      const state = yield* InstanceState.context
      const workspace = state.directory
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* bad("路径越界")

      const result = yield* Effect.tryPromise({
        try: async () => {
          const applied = await action(target, format, registry)
          if (!applied.ok) {
            throw new Error(applied.error.message + (applied.error.suggestion ? "；" + applied.error.suggestion : ""))
          }
          return applied.data
        },
        catch: (error) => bad(error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)),
      })

      yield* announceWrite(target, true)
      return { path: relative, bytes: result.bytes.length, ...result.history }
    }

    /** 导出：只读，不写盘、不动撤销栈；返回文本让前端下载或让 Agent 自行落盘。 */
    const exportDocument = Effect.fn("OfficeHttpApi.exportDocument")(function* (ctx: {
      payload: typeof OfficeDocumentExportPayload.Type
    }) {
      const bad = (message: string) => officeError(message)
      const relative = normalizeRelativePath(ctx.payload.path)
      const registry = yield* officeRegistry()
      const format = formatOfPath(relative, registry)
      if (!format) return yield* bad("这个文件类型暂不支持导出：" + relative)

      const state = yield* InstanceState.context
      const workspace = state.directory
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return yield* bad("路径越界")

      const result = yield* Effect.tryPromise({
        try: async () => {
          const bytes = new Uint8Array(await readFile(target))
          const exported = await exportDocumentAs(bytes, format, ctx.payload.target, {
            registry,
            ...(ctx.payload.password === undefined ? {} : { password: ctx.payload.password }),
            ...(ctx.payload.page === undefined ? {} : { page: ctx.payload.page }),
            ...(ctx.payload.scale === undefined ? {} : { scale: ctx.payload.scale }),
          })
          if (!exported.ok) {
            throw new Error(
              exported.error.message + (exported.error.suggestion ? "；" + exported.error.suggestion : ""),
            )
          }
          return exported.data
        },
        catch: (error) => bad(error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)),
      })

      // docx/xlsx/pptx 是二进制：按 base64 传，前端再还原成字节。
      // 文本目标继续直接给字符串，调用方不用关心编码。
      const binary = isBinaryExportTarget(result.target)
      return {
        path: relative,
        target: result.target,
        mime: result.mime,
        content: binary ? Buffer.from(result.bytes).toString("base64") : new TextDecoder().decode(result.bytes),
        bytes: result.bytes.length,
        encoding: binary ? ("base64" as const) : ("utf8" as const),
      }
    })

    const undoDocument = Effect.fn("OfficeHttpApi.undoDocument")(function* (ctx: {
      payload: typeof OfficeDocumentHistoryPayload.Type
    }) {
      return yield* historyEdit(ctx, (target, format, registry) => undoDocumentFile(target, format, { registry }))
    })

    const redoDocument = Effect.fn("OfficeHttpApi.redoDocument")(function* (ctx: {
      payload: typeof OfficeDocumentHistoryPayload.Type
    }) {
      return yield* historyEdit(ctx, (target, format, registry) => redoDocumentFile(target, format, { registry }))
    })

    /** 只读历史状态：面板切到文件时问一次，按钮是否需要置灰。 */
    const documentState = Effect.fn("OfficeHttpApi.documentState")(function* (ctx: { query: { path: string } }) {
      const relative = normalizeRelativePath(ctx.query.path)
      const registry = yield* officeRegistry()
      const format = formatOfPath(relative, registry)
      if (!format) return { path: relative, canUndo: false, canRedo: false }

      const state = yield* InstanceState.context
      const workspace = state.directory
      const target = path.join(workspace, relative)
      if (!AppFileSystem.contains(workspace, target)) return { path: relative, canUndo: false, canRedo: false }

      const history = yield* Effect.promise(() => documentHistory(target, format, { registry }))
      if (!history.ok) return { path: relative, canUndo: false, canRedo: false }
      return { path: relative, ...history.data }
    })

    const editPptx = Effect.fn("OfficeHttpApi.editPptxText")(function* (ctx: {
      payload: typeof OfficePptxEditPayload.Type
    }) {
      const relative = normalizeRelativePath(ctx.payload.path)
      const edits = ctx.payload.edits ?? []
      const shapes = ctx.payload.shapes ?? []
      const images = ctx.payload.images ?? []
      const structure = ctx.payload.structure ?? []
      if (
        !relative.toLowerCase().endsWith(".pptx") ||
        edits.length + shapes.length + images.length + structure.length === 0
      )
        return yield* new HttpApiError.BadRequest({})

      const state = yield* InstanceState.context
      const workspace = state.directory
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
            // 结构操作同样用 pt，引擎里再换成 EMU。
            shapeOps: structure.map((item) => {
              if (item.op === "addTextBox") {
                return {
                  op: "addTextBox" as const,
                  slide: item.slide,
                  text: item.text,
                  ...(item.box ? { box: boxPtToEmu(item.box) } : {}),
                  ...(item.style ? { style: item.style } : {}),
                }
              }
              if (item.op === "addShape") {
                return {
                  op: "addShape" as const,
                  slide: item.slide,
                  kind: item.kind,
                  ...(item.box ? { box: boxPtToEmu(item.box) } : {}),
                  ...(item.fill ? { fill: item.fill } : {}),
                  ...(item.line ? { line: item.line } : {}),
                  ...(item.text ? { text: item.text } : {}),
                  ...(item.style ? { style: item.style } : {}),
                }
              }
              if (item.op === "addPicture") {
                return {
                  op: "addPicture" as const,
                  slide: item.slide,
                  data: new Uint8Array(Buffer.from(item.dataBase64, "base64")),
                  mime: item.mime,
                  ...(item.box ? { box: boxPtToEmu(item.box) } : {}),
                }
              }
              return {
                op: "deleteShape" as const,
                slide: item.slide,
                ...(item.shapeId ? { shapeId: item.shapeId } : {}),
                ...(item.shapeName ? { shapeName: item.shapeName } : {}),
              }
            }),
          })
          // 走宿主会话写回：画布上的改动因此也进撤销栈，
          // 和文本/DOCX/XLSX 的编辑共享同一条历史（切标签也不会丢）。
          const recorded = await recordDocumentWrite(target, "pptx", bytes, edited.bytes, "编辑幻灯片")
          if (!recorded.ok) {
            throw new Error(
              recorded.error.message + (recorded.error.suggestion ? "；" + recorded.error.suggestion : ""),
            )
          }
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
        shapes: result.shapeApplied.map(({ previous, box, ...shape }) => ({
          ...shape,
          ...(previous ? { previous: boxEmuToPt(previous) } : {}),
          ...(box ? { box: boxEmuToPt(box) } : {}),
        })),
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
      .handle("createDocument", createDocumentFile)
      .handle("editDocument", editDocument)
      .handle("saveDocument", saveDocument)
      .handle("exportDocument", exportDocument)
      .handle("undoDocument", undoDocument)
      .handle("redoDocument", redoDocument)
      .handle("documentState", documentState)
      .handle("editPptxText", editPptx)
  }),
)

/** Windows 反斜杠 / 前导 ./ 和 / 统一成工作区相对路径。 */
function normalizeRelativePath(input: string): string {
  return input
    .split(String.fromCharCode(92))
    .join("/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "")
}

function safeFilename(input: string) {
  return input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120)
}
