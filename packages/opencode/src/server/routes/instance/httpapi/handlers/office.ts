import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { mkdir, readdir, stat, writeFile } from "fs/promises"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { fillPptxTemplateText } from "@/util/office-document"
import { InstanceHttpApi } from "../api"
import { OfficeArtifactPayload, OfficePptxTemplateFillPayload } from "../groups/office"

const kindDir = {
  document: "documents",
  ppt: "ppt",
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

      return {
        path: path.relative(state.worktree === "/" ? state.directory : state.worktree, target),
        bytes: bytes.length,
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
      }
    })

    return handlers
      .handle("listArtifacts", listArtifacts)
      .handle("saveArtifact", saveArtifact)
      .handle("fillPptxTemplate", fillPptxTemplate)
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
