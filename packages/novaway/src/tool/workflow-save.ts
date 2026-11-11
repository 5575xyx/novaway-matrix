import path from "node:path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { AppFileSystem } from "@novaway/core/filesystem"
import { Global } from "@novaway/core/global"
import { prepareWorkflow, formatDiagnostics } from "@/dynamic-workflow"
import {
  GLOBAL_SUBDIR,
  PROJECT_DIR,
  fileName,
  parseHeader,
  renderSavedScript,
  stripHeader,
  validateName,
  type SavedWorkflow,
  type Scope,
} from "@/dynamic-workflow/saved"

/**
 * 保存 / 列出可重用的工作流脚本。
 *
 * 保存之前**先编译**：一个存下来却跑不起来的脚本，比没有更糟——模型会在几天后按名字调用它，
 * 然后拿到一堆它当时没写的错误。所以这里的检查与 `create_workflow` 用的是同一个函数。
 *
 * 覆盖需要显式同意（`overwrite`）。静默覆盖一份别人（或用户自己）写过的资产，是最不
 * 容易被发现的那种破坏。
 */

type Services = AppFileSystem.Service

function directoryOf(scope: Scope, cwd: string): string {
  return scope === "global" ? path.join(Global.Path.config, GLOBAL_SUBDIR) : path.join(cwd, PROJECT_DIR)
}

const parameters = Schema.Struct({
  name: Schema.String.annotate({
    description: "工作流名字，会变成文件名：小写字母、数字、点、下划线、连字符。例如 review-diff。",
  }),
  script: Schema.String.annotate({ description: "脚本正文（一段 TypeScript 的函数体）。不需要写头部注释。" }),
  description: Schema.optional(Schema.String).annotate({ description: "一句话说明它做什么。" }),
  when_to_use: Schema.optional(Schema.String).annotate({
    description: "什么情况下该用它。写用户会说的一句话，例如「帮我 review 一下这次改动」。",
  }),
  scope: Schema.optional(Schema.Literals(["project", "global"])).annotate({
    description: "project（缺省）跟着仓库走，能提交；global 跨仓库通用。",
  }),
  overwrite: Schema.optional(Schema.Boolean).annotate({ description: "同名文件已存在时是否覆盖。缺省不覆盖。" }),
})

type Metadata = { status?: string; path?: string; scope?: Scope; name?: string }

export const SaveWorkflowTool = Tool.define<typeof parameters, Metadata, Services>(
  "save_workflow",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    return {
      description: [
        "把一个工作流脚本存成可重用的文件，之后可以用 create_workflow 的 saved 参数按名字跑。",
        "存之前会先编译检查；存下来就跑不起来的脚本不该存在。同名文件默认不覆盖。",
      ].join(""),
      parameters,
      capabilities: { concurrencySafe: false, workspace: true },

      execute: (params: Schema.Schema.Type<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const invalid = validateName(params.name)
          if (invalid) {
            return { title: "名字不能用", output: invalid, metadata: { status: "invalid" } }
          }

          const prepared = prepareWorkflow(params.script)
          if (!prepared.ok) {
            return {
              title: "脚本没有通过检查，没有保存",
              output: [
                "存下来却跑不起来的脚本比没有更糟——几天后按名字调用时才炸。请先改好：",
                formatDiagnostics(prepared.diagnostics),
              ].join("\n"),
              metadata: { status: "invalid" },
            }
          }

          const scope: Scope = params.scope ?? "project"
          const cwd = ctx.directory ?? process.cwd()
          const dir = directoryOf(scope, cwd)
          const file = path.join(dir, fileName(params.name))
          const relative = path.relative(cwd, file) || file

          const existing = yield* fs.readFileStringSafe(file)
          if (existing !== undefined && !params.overwrite) {
            return {
              title: "同名工作流已存在",
              output: `${relative} 已经存在。要覆盖它，带上 overwrite: true；想并存，就换一个名字。`,
              metadata: { status: "exists", path: file, scope, name: params.name },
            }
          }

          // 写文件仍然走 `write` 权限：用户配置里对 `.novaway/**` 的规则应当照常生效。
          yield* ctx.ask({ permission: "write", patterns: [relative], always: [relative], metadata: {} })

          const content = renderSavedScript(
            {
              name: params.name,
              ...(params.description ? { description: params.description } : {}),
              ...(params.when_to_use ? { whenToUse: params.when_to_use } : {}),
            },
            params.script,
          )
          yield* fs.writeWithDirs(file, content).pipe(Effect.orDie)

          const shape = [
            `${prepared.sites.length} 个站点`,
            prepared.phaseNames.length > 0 ? `阶段：${prepared.phaseNames.join(" → ")}` : "",
          ]
            .filter(Boolean)
            .join("，")
          return {
            title: existing === undefined ? "已保存工作流" : "已更新工作流",
            output: [
              `${relative}（${shape}）`,
              existing === undefined ? "" : "覆盖了原来的版本。",
              '之后用 create_workflow 的 saved: "' + params.name + '" 直接跑它。',
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: { status: "saved", path: file, scope, name: params.name },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** 扫一遍目录，返回全部已保存的工作流。列表工具与「按名字找不到时给出候选」共用。 */
export const listSaved = (
  fs: AppFileSystem.Interface,
  input: { cwd: string; scopes?: ReadonlyArray<Scope> },
): Effect.Effect<SavedWorkflow[], never> =>
  Effect.gen(function* () {
    const found: SavedWorkflow[] = []
    for (const scope of input.scopes ?? (["project", "global"] as const)) {
      const dir = directoryOf(scope, input.cwd)
      const listing = yield* fs.readDirectoryEntries(dir).pipe(Effect.catch(() => Effect.succeed([])))
      for (const entry of listing) {
        if (!entry.name.endsWith(".dwf.ts")) continue
        const file = path.join(dir, entry.name)
        const text = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
        if (text === undefined) continue
        const header = parseHeader(text)
        // 头部坏掉的文件不隐藏：它可能正是要修的那一份。名字退回到文件名。
        found.push({
          name: header?.name ?? entry.name.slice(0, -".dwf.ts".length),
          ...(header?.description ? { description: header.description } : {}),
          ...(header?.whenToUse ? { whenToUse: header.whenToUse } : {}),
          scope,
          path: file,
          relative: path.relative(input.cwd, file) || file,
        })
      }
    }
    return found
  })

const listParameters = Schema.Struct({
  scope: Schema.optional(Schema.Literals(["project", "global", "all"])).annotate({
    description: "列哪个范围，缺省 all。",
  }),
})

export const ListSavedWorkflowsTool = Tool.define<typeof listParameters, { count?: number }, Services>(
  "list_saved_workflows",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    return {
      description: "列出保存过的工作流脚本：名字、说明、什么时候用。只读。",
      parameters: listParameters,
      capabilities: { concurrencySafe: true, workspace: false, readOnly: true },

      execute: (params: Schema.Schema.Type<typeof listParameters>, ctx: Tool.Context<{ count?: number }>) =>
        Effect.gen(function* () {
          const cwd = ctx.directory ?? process.cwd()
          const scopes: ReadonlyArray<Scope> =
            params.scope === "all" || params.scope === undefined ? ["project", "global"] : [params.scope]
          const found = yield* listSaved(fs, { cwd, scopes })

          if (found.length === 0) {
            return {
              title: "还没有保存过工作流",
              output: "用 save_workflow 把一段验证过的脚本存下来，之后就能按名字复用。",
              metadata: { count: 0 },
            }
          }

          const lines = found.map((item) => {
            const parts = [`${item.name}  [${item.scope}]`]
            if (item.description) parts.push(item.description)
            if (item.whenToUse) parts.push(`何时用：${item.whenToUse}`)
            return parts.join("  ·  ")
          })
          return {
            title: `${found.length} 个保存的工作流`,
            output: lines.join("\n"),
            metadata: { count: found.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** `create_workflow` 的 `saved` 参数要用：按名字读出脚本正文。先项目、后全局。 */
export const loadSaved = (
  fs: AppFileSystem.Interface,
  input: { name: string; cwd: string; scope?: Scope },
): Effect.Effect<
  { scope: Scope; path: string; header: ReturnType<typeof parseHeader>; script: string } | undefined,
  never
> =>
  Effect.gen(function* () {
    const ordered: Scope[] = input.scope ? [input.scope] : ["project", "global"]
    for (const scope of ordered) {
      const file = path.join(directoryOf(scope, input.cwd), fileName(input.name))
      const text = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
      if (text === undefined) continue
      return { scope, path: file, header: parseHeader(text), script: stripHeader(text) }
    }
    return undefined
  })
