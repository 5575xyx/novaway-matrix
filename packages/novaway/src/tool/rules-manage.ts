import { Global } from "@novaway/core/global"
import { AppFileSystem } from "@novaway/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { formatSetupReport, type SetupReport, type SetupStepView } from "@/setup/report"
import matter from "gray-matter"
import path from "node:path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 规则（rules/*.md）管理。
 *
 * 规则是每次会话都会注入系统提示的 markdown，和设置页「规则」是同一批文件：
 * - 全局：`<配置目录>/rules/<name>.md`
 * - 项目：`<项目>/.novaway/rules/<name>.md`
 *
 * 写入后不需要重启：Instruction 每次组装系统提示都会重新 glob 这些目录。
 */
type RulesMetadata = {
  scope: string
  count: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "save", "remove"])).annotate({
    description:
      "status (default) lists global and project rules; save writes or overwrites one rule file; remove deletes it.",
  }),
  scope: Schema.optional(Schema.Literals(["global", "project"])).annotate({
    description: "Which rule set to touch. Defaults to project for save (safer), global for status-only listing.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Rule file name without .md. Letters, digits, dot, dash, underscore.",
  }),
  content: Schema.optional(Schema.String).annotate({ description: "Rule body in markdown." }),
  description: Schema.optional(Schema.String).annotate({ description: "Optional one-line description." }),
})

const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

/** 规则名 → 安全文件名；不合法返回 undefined。 */
export function ruleFileName(value: string | undefined) {
  const name = value?.trim()
  if (!name || !NAME_PATTERN.test(name)) return undefined
  return name + ".md"
}

export function renderRule(content: string, description?: string) {
  const body = content.trimEnd() + String.fromCharCode(10)
  return matter.stringify(body, description?.trim() ? { description: description.trim() } : {})
}

function step(name: string, status: string, detail?: string): SetupStepView {
  return { step: name, status, ...(detail ? { detail } : {}) }
}

export const RulesManageTool = Tool.define(
  "rules_manage",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    return {
      description: [
        "Manage NovaWay rules: markdown files under rules/ that are injected into every session's system prompt.",
        "Use action=status to list global and project rules with their paths.",
        "Use action=save with scope, name, content to create or overwrite a rule; action=remove deletes one.",
        "Rules are for durable instructions ('always answer in Chinese', 'never touch migrations/'). For one-off tasks use the todo tool or just do the work.",
        "Prefer scope=project for repository-specific conventions and scope=global only for personal preferences.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<RulesMetadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const dirs = {
            global: () => path.join(Global.Path.config, "rules"),
            project: () => path.join(instance.directory, ".novaway", "rules"),
          } as const

          const list = (dir: string) =>
            fs
              .glob("*.md", { cwd: dir, absolute: true, dot: true, symlink: true })
              .pipe(Effect.catch(() => Effect.succeed([] as string[])))

          if ((params.action ?? "status") === "status") {
            const global = yield* list(dirs.global())
            const project = yield* list(dirs.project())
            const report: SetupReport = {
              domain: "rules",
              ready: global.length + project.length > 0,
              phase: global.length + project.length > 0 ? "ready" : "empty",
              summary:
                global.length + project.length === 0
                  ? "还没有任何规则。"
                  : "全局 " + global.length + " 条，项目 " + project.length + " 条",
              steps: [
                ...global.map((file) => step(path.basename(file, ".md"), "global", file)),
                ...project.map((file) => step(path.basename(file, ".md"), "project", file)),
              ],
              next:
                global.length + project.length === 0
                  ? "用 action=save 写第一条规则；项目约定建议 scope=project。"
                  : undefined,
            }
            return {
              title: "Rules",
              metadata: { scope: "all", count: global.length + project.length },
              output: formatSetupReport(report),
            }
          }

          const scope = params.scope ?? "project"
          const filename = ruleFileName(params.name)
          if (!filename) throw new Error("name 只能包含字母、数字、点、横线和下划线")
          const file = path.join(dirs[scope](), filename)

          if (params.action === "remove") {
            const exists = yield* fs.exists(file).pipe(Effect.catch(() => Effect.succeed(false)))
            if (!exists) throw new Error("规则不存在：" + file)
            yield* ctx.ask({
              permission: "rules_manage",
              patterns: [scope + ":" + filename],
              always: ["*"],
              metadata: { action: "remove", scope, file },
            })
            yield* fs.remove(file).pipe(Effect.orDie)
            return {
              title: "Rule removed",
              metadata: { scope, count: 0 },
              output: "已删除规则 " + file,
            }
          }

          const content = params.content?.trim()
          if (!content) throw new Error("action=save 需要 content")

          yield* ctx.ask({
            permission: "rules_manage",
            patterns: [scope + ":" + filename],
            always: ["*"],
            metadata: { action: "save", scope, file },
          })

          yield* fs.writeWithDirs(file, renderRule(content, params.description)).pipe(Effect.orDie)
          return {
            title: "Rule saved",
            metadata: { scope, count: 1 },
            output: formatSetupReport({
              domain: "rules",
              ready: true,
              phase: "saved",
              summary: "规则已保存，下一次对话即生效。",
              facts: { scope, file, characters: String(content.length) },
            }),
          }
        }),
    }
  }),
)
