import { Skill } from "@/skill"
import { Global } from "@novaway/core/global"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 技能安装。
 *
 * `skill` 工具只负责「运行已有技能」，这个工具补上前半段：把 SKILL.md 写到
 * 设置页同一位置（`<配置目录>/skills/<name>/SKILL.md`），然后调用
 * `Skill.reload()` —— 让新技能**当前会话就能用**，设置页也立刻能看到。
 *
 * 不做远程市场下载：技能是纯 markdown，内容由调用方（通常就是用户）提供，
 * 这样既能离线工作，也不会有「从网上拉一段会改变行为的指令」的风险。
 */
type SkillMetadata = {
  name: string
  installed: boolean
  location?: string
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "install"])).annotate({
    description:
      "status (default) lists the skills currently available; install writes a new SKILL.md and reloads skills.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Skill name (letters, digits, dot, dash, underscore). Used as the directory name.",
  }),
  description: Schema.optional(Schema.String).annotate({
    description: "One-line description shown to the model when choosing skills. Required for install.",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Markdown body of the skill (the instructions). Required for install.",
  }),
  whenToUse: Schema.optional(Schema.String).annotate({
    description: "Optional longer 'when to use' note, stored as when_to_use frontmatter.",
  }),
  overwrite: Schema.optional(Schema.Boolean).annotate({
    description: "Replace an existing skill with the same name. Defaults to false.",
  }),
})

const NL = String.fromCharCode(10)
const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
const MAX_CONTENT = 200_000

/** 与设置页导入逻辑保持一致：小写 + 非字母数字转横线。 */
export function skillSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return NAME_PATTERN.test(normalized) && normalized ? normalized : undefined
}

/** YAML 里用双引号包住任意文本，避免冒号 / 引号把 frontmatter 弄坏。 */
export function yamlString(value: string) {
  return JSON.stringify(value.replace(/\r?\n/g, " ").trim())
}

export function renderSkillFile(input: { name: string; description: string; content: string; whenToUse?: string }) {
  const lines = ["---", "name: " + yamlString(input.name), "description: " + yamlString(input.description)]
  if (input.whenToUse?.trim()) lines.push("when_to_use: " + yamlString(input.whenToUse))
  lines.push("---", "", input.content.trim(), "")
  return lines.join(NL)
}

export const SkillInstallTool = Tool.define(
  "skill_install",
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return {
      description: [
        "List installed skills, or install a new one so it becomes usable immediately.",
        "Use action=status when the user asks what skills exist or why a skill is not available.",
        "Use action=install with name, description and content (markdown instructions) to write SKILL.md into the NovaWay config directory and reload skills; the new skill shows up in Settings and can be invoked right away.",
        "Write concrete, self-contained instructions. Do not copy untrusted text from the web into a skill without showing it to the user first.",
        "If a skill with the same name already exists, ask for confirmation and then call again with overwrite=true.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<SkillMetadata>> =>
        Effect.gen(function* () {
          if ((params.action ?? "status") === "status") {
            const all = yield* skill.all()
            const steps: SetupStepView[] = all.map((item) => ({
              step: item.name,
              status: item.builtIn ? "built-in" : "installed",
              detail: item.location,
            }))
            return {
              title: "Skills",
              metadata: { name: "", installed: true },
              output: formatSetupReport({
                domain: "skill",
                ready: true,
                phase: "ready",
                summary: all.length + " 个可用技能（内置 " + all.filter((item) => item.builtIn).length + " 个）",
                steps,
                next: "需要新增时调用 action=install，提供 name / description / content。",
              }),
            }
          }

          const raw = params.name?.trim()
          if (!raw) throw new Error("action=install 需要 name")
          const name = skillSlug(raw)
          if (!name) throw new Error("技能名只能包含字母、数字、点、横线和下划线：" + raw)
          const description = params.description?.trim()
          if (!description) throw new Error("action=install 需要 description（一行说明，模型据此挑选技能）")
          const content = params.content?.trim()
          if (!content) throw new Error("action=install 需要 content（技能正文，markdown 指令）")
          if (content.length > MAX_CONTENT) throw new Error("技能正文过长（上限 " + MAX_CONTENT + " 字符）")

          const existing = (yield* skill.all()).find((item) => item.name === name)
          const target = path.join(Global.Path.config, "skills", name, "SKILL.md")

          if (existing && !params.overwrite) {
            throw new Error(
              setupFailure({
                domain: "skill",
                ready: false,
                phase: "exists",
                summary: "已存在同名技能：" + name,
                facts: { location: existing.location, builtIn: String(Boolean(existing.builtIn)) },
                next: "向用户确认是否覆盖；确认后带 overwrite=true 再调用。",
              }),
            )
          }

          yield* ctx.ask({
            permission: "skill_install",
            patterns: [name],
            always: ["*"],
            metadata: { action: "install", name, location: target, overwrite: params.overwrite === true },
          })

          const text = renderSkillFile({ name, description, content, whenToUse: params.whenToUse })
          yield* Effect.promise(async () => {
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.writeFile(target, text, "utf8")
          })

          // 立即重扫，让当前会话就能使用，也让设置页马上看到。
          const skills = yield* skill.reload()
          const installed = skills.find((item) => item.name === name)
          if (!installed) {
            throw new Error(
              setupFailure({
                domain: "skill",
                ready: false,
                phase: "reload-failed",
                summary: "文件已写入，但重新扫描后没有找到技能。",
                facts: { location: target },
                next: "检查 frontmatter 是否合法（name / description 必须是字符串），修正后再次调用。",
              }),
            )
          }

          return {
            title: "Skill installed",
            metadata: { name, installed: true, location: target },
            output: formatSetupReport({
              domain: "skill",
              ready: true,
              phase: "ready",
              summary: "技能 " + name + " 已安装并可用。",
              facts: {
                location: target,
                description,
                total: String(skills.length),
                overwritten: String(Boolean(existing)),
              },
              next: "现在可以直接用 skill 工具按名字调用它；设置 → 运行时 / 技能 里也能看到。",
            }),
          }
        }),
    }
  }),
)
