import { Evolution } from "@/evolution/service"
import { InstanceState } from "@/effect/instance-state"
import { formatSetupReport, setupFailure, type SetupReport, type SetupStepView } from "@/setup/report"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"

/**
 * 进化候选（自我改进建议）管理。
 *
 * Agent 会从对话里提炼候选（技能 / 规则 / 记忆写入等），默认进候选队列等人确认。
 * 这个工具让用户在对话里就能：看有哪些、看内容、应用、忽略 —— 不用切到设置页。
 *
 * 写盘动作（applyFile）默认不暴露：它会改项目文件，风险高于「应用候选」。
 */
type EvolutionMetadata = {
  candidates: number
  applied: number
}

const Parameters = Schema.Struct({
  action: Schema.optional(Schema.Literals(["status", "preview", "apply", "dismiss"])).annotate({
    description:
      "status (default) lists candidates; preview shows one candidate's target and diff; apply accepts it; dismiss rejects it.",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "Candidate id. Required for preview/apply/dismiss.",
  }),
  status: Schema.optional(Schema.Literals(["pending", "applied", "dismissed"])).annotate({
    description: "Filter for action=status. Defaults to pending.",
  }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max candidates to list (default 20)." }),
})

function step(id: string, status: string, detail?: string): SetupStepView {
  return { step: id, status, ...(detail ? { detail } : {}) }
}

export const EvolutionManageTool = Tool.define(
  "evolution_manage",
  Effect.gen(function* () {
    const evolution = yield* Evolution.Service

    return {
      description: [
        "Inspect and act on NovaWay's evolution candidates (self-improvement suggestions derived from conversations).",
        "Use action=status to list pending candidates; action=preview to see what one would change; action=apply to accept it; action=dismiss to reject it.",
        "Apply only after showing the user the target and content, because applying changes what future sessions know or do.",
        "This tool only touches the candidate queue; writing candidates to disk is intentionally not exposed here.",
      ].join(" "),
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<EvolutionMetadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const projectID = instance.project.id

          if ((params.action ?? "status") === "status") {
            const status = params.status ?? "pending"
            const items = yield* evolution.list({
              projectID,
              includeGlobal: true,
              status,
              limit: params.limit ?? 20,
            })
            const report: SetupReport = {
              domain: "evolution",
              ready: true,
              phase: status,
              summary: status + " 状态共 " + items.length + " 条候选",
              steps: items.map((item) =>
                step(
                  item.id,
                  item.kind,
                  [item.title, item.domain, item.reason.slice(0, 120)].filter(Boolean).join(" | "),
                ),
              ),
              next:
                items.length > 0
                  ? "先 action=preview 看内容，再决定 apply 还是 dismiss。"
                  : "没有待处理候选；Agent 会在对话中逐步积累。",
            }
            return {
              title: "Evolution candidates",
              metadata: { candidates: items.length, applied: 0 },
              output: formatSetupReport(report),
            }
          }

          const id = params.id?.trim()
          if (!id) throw new Error("action=" + params.action + " 需要 id（先用 status 查看）")

          if (params.action === "preview") {
            const preview = yield* evolution.preview(id as never)
            if (!preview) throw new Error("找不到候选：" + id)
            return {
              title: "Candidate preview",
              metadata: { candidates: 1, applied: 0 },
              output: formatSetupReport({
                domain: "evolution",
                ready: true,
                phase: "preview",
                summary: preview.title,
                facts: {
                  kind: preview.kind,
                  target: preview.target,
                },
                steps: [
                  { step: "diff", status: "preview", detail: preview.diff.slice(0, 6000) },
                  ...(preview.note ? [{ step: "note", status: "info", detail: preview.note }] : []),
                ],
              }),
            }
          }

          yield* ctx.ask({
            permission: "evolution_manage",
            patterns: [params.action + ":" + id],
            always: ["*"],
            metadata: { action: params.action, candidateID: id },
          })

          if (params.action === "dismiss") {
            const item = yield* evolution.dismiss(id as never)
            if (!item) throw new Error("找不到候选：" + id)
            return {
              title: "Candidate dismissed",
              metadata: { candidates: 1, applied: 0 },
              output: "已忽略候选 " + item.title,
            }
          }

          const item = yield* evolution.apply(id as never)
          if (!item) {
            throw new Error(
              setupFailure({
                domain: "evolution",
                ready: false,
                phase: "apply-failed",
                summary: "应用候选失败。",
                facts: { candidateID: id },
                next: "先 action=preview 检查目标是否存在冲突，再试一次。",
              }),
            )
          }
          return {
            title: "Candidate applied",
            metadata: { candidates: 1, applied: 1 },
            output: formatSetupReport({
              domain: "evolution",
              ready: true,
              phase: "applied",
              summary: "已应用候选：" + item.title,
              facts: { kind: item.kind, target: item.target },
              next: "需要重启会话让新的记忆/技能立即生效时，提醒用户开启新会话。",
            }),
          }
        }),
    }
  }),
)
