import path from "node:path"
import { Skill } from "@/skill"
import * as SkillPython from "@/skill/python-env"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 技能扩展的 Python 环境。
 *
 * 市场里的技能可能自带 Python 脚本（ppt-master 的 SVG -> PPTX 就是），装好后
 * 还差一步依赖。这个工具把「准备环境」暴露给 Agent：不拼 pip 命令、不碰系统
 * Python，和安装流程用的是同一套隔离 venv，失败原因能如实报给用户。
 */
type Metadata = { name: string; state: SkillPython.State; python?: string }

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "prepare"])).annotate({
    description:
      "status (default) lists skills that need Python dependencies and whether their environment is ready; prepare creates the isolated venv and installs the skill requirements.txt.",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Skill name. Required for prepare.",
  }),
  reinstall: Schema.optional(Schema.Boolean).annotate({
    description:
      "With action=prepare, rebuild the environment from scratch (use when a previous install was interrupted).",
  }),
})

/** 找出「带 requirements.txt 的技能」，逐个看它有没有环境。 */
function describeRow(name: string, found: string, status: SkillPython.Status): SetupStepView {
  return {
    step: name,
    status: status.state === "ready" ? "ready" : status.state,
    detail: status.state === "ready" ? status.python : (status.error ?? found),
  }
}

function stepsFrom(events: readonly string[]): SetupStepView[] {
  return events.map((event) => {
    const at = event.indexOf(": ")
    return at === -1
      ? { step: event, status: "info" }
      : { step: event.slice(0, at), status: "info", detail: event.slice(at + 2) }
  })
}

export const SkillPythonTool = Tool.define(
  "skill_python",
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return {
      description: [
        "Inspect or prepare the Python environment of an installed skill that ships .py scripts (for example ppt-master).",
        "Use action=status to see which skills need Python and whether their environment is ready.",
        "Use action=prepare with name to create an isolated venv under the NovaWay data directory and install that skill requirements.txt (mirror fallback, no system Python changes).",
        "After it is ready, always run the skill scripts with the interpreter path this tool reports; never use python3/python from PATH.",
        "Prefer this tool over manual pip commands. If it fails, report the error to the user instead of pretending the scripts ran.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        Effect.gen(function* () {
          const all = yield* skill.all()

          if ((params.action ?? "status") === "prepare") {
            const name = params.name?.trim()
            if (!name) throw new Error("action=prepare 需要 name")
            const info = all.find((item) => item.name === name)
            if (!info) {
              throw new Error(
                setupFailure({
                  domain: "skill-python",
                  ready: false,
                  phase: "missing-skill",
                  summary: "没有找到技能：" + name,
                  next: "先用 skill 工具的可用技能列表确认名字；扩展要先从市场安装。",
                }),
              )
            }
            const found = yield* Effect.promise(() => SkillPython.findRequirements(path.dirname(info.location)))
            if (!found) {
              throw new Error(
                setupFailure({
                  domain: "skill-python",
                  ready: false,
                  phase: "no-requirements",
                  summary: "技能 " + name + " 没有 requirements.txt，不需要 Python 环境。",
                }),
              )
            }

            yield* ctx.ask({
              permission: "skill_python",
              patterns: [name],
              always: ["*"],
              metadata: { action: "prepare", name, requirements: found.file },
            })

            const events: string[] = []
            const result = yield* Effect.promise(() =>
              SkillPython.prepare({
                name: info.name,
                requirements: found.file,
                reinstall: params.reinstall === true,
                signal: ctx.abort,
                onProgress: (event) => {
                  events.push(event.phase + ": " + event.message)
                  void Effect.runPromise(ctx.metadata({ title: event.message })).catch(() => undefined)
                },
              }),
            )

            if (result.state !== "ready") {
              throw new Error(
                setupFailure({
                  domain: "skill-python",
                  ready: false,
                  phase: "error",
                  summary: "Python 环境准备失败：" + (result.error ?? "未知原因"),
                  hint: result.hint,
                  steps: stepsFrom(events),
                  next: "检查网络/代理后重试；也可以让用户确认 Python 版本（需要 3.9+）。",
                }),
              )
            }

            return {
              title: "Python environment ready",
              metadata: { name: info.name, state: "ready", python: result.python },
              output: formatSetupReport({
                domain: "skill-python",
                ready: true,
                phase: "ready",
                summary: "技能 " + info.name + " 的 Python 环境已就绪。",
                facts: { python: result.python, requirements: found.file },
                steps: stepsFrom(events),
                next: "运行该技能的脚本时用这个解释器的绝对路径，例如：" + (result.python ?? ""),
              }),
            }
          }

          const rows: Array<{ name: string; file: string; status: SkillPython.Status }> = []
          for (const item of all) {
            const dir = path.dirname(item.location)
            const found = yield* Effect.promise(() => SkillPython.findRequirements(dir))
            if (!found) continue
            // 环境按技能名记录；历史记录可能落在扩展目录名上，两种都认。
            const direct = yield* Effect.promise(() => SkillPython.status(item.name))
            const status =
              direct.state === "idle" && found.name !== item.name
                ? yield* Effect.promise(() => SkillPython.status(found.name))
                : direct
            rows.push({ name: item.name, file: found.file, status })
          }

          if (rows.length === 0) {
            return {
              title: "No Python skills",
              metadata: { name: "", state: "idle" },
              output: formatSetupReport({
                domain: "skill-python",
                ready: true,
                phase: "empty",
                summary: "当前没有需要 Python 依赖的技能。",
                next: "从市场安装带 requirements.txt 的技能后，这里会出现对应的条目。",
              }),
            }
          }
          const ready = rows.filter((row) => row.status.state === "ready").length
          const report: SetupReport = {
            domain: "skill-python",
            ready: ready === rows.length,
            phase: "status",
            summary: ready + "/" + rows.length + " 个技能的 Python 环境已就绪",
            steps: rows.map((row) => describeRow(row.name, row.file, row.status)),
            next: ready === rows.length ? undefined : "对需要使用的技能调用 action=prepare（name=技能名）。",
          }
          return {
            title: "Skill Python environments",
            metadata: { name: "", state: report.ready ? "ready" : "idle" },
            output: formatSetupReport(report),
          }
        }),
    }
  }),
)
