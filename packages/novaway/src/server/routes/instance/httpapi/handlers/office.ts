import { AppFileSystem } from "@novaway/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { mkdir, readFile, readdir, rename, stat, writeFile } from "fs/promises"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { OfficePlatform } from "@/office/platform"
import { editPptx as applyPptxEdit } from "@novaway/core/office/pptx-edit"
import { fillPptxTemplateText } from "@/util/office-document"
import { InstanceHttpApi } from "../api"
import { OfficeArtifactPayload, OfficePptxEditPayload, OfficePptxTemplateFillPayload } from "../groups/office"

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

      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, bytes)
      })

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

      yield* Effect.promise(async () => {
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, bytes)
      })

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
            shapeEdits: shapes,
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
