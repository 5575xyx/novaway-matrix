import { Effect, Schema } from "effect"
import { generateObject, type ModelMessage } from "ai"
import * as Tool from "./tool"
import { Goal } from "@/session/goal"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "@/session/message-v2"

const DecomposeResult = Schema.Struct({
  subGoals: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      description: Schema.optional(Schema.String),
      successCriteria: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
})

const CreateParams = Schema.Struct({
  action: Schema.Literal("create"),
  title: Schema.String.annotate({ description: "目标标题" }),
  description: Schema.optional(Schema.String.annotate({ description: "目标描述" })),
  parentId: Schema.optional(Schema.String.annotate({ description: "父目标ID" })),
  priority: Schema.optional(
    Schema.Literals(["high", "medium", "low"]).annotate({ description: "优先级" }),
  ),
  successCriteria: Schema.optional(
    Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "成功标准" }),
  ),
  deadline: Schema.optional(Schema.String.annotate({ description: "截止日期 ISO 格式" })),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "标签" })),
})

const UpdateParams = Schema.Struct({
  action: Schema.Literal("update"),
  goalId: Schema.String.annotate({ description: "目标ID" }),
  title: Schema.optional(Schema.String.annotate({ description: "目标标题" })),
  description: Schema.optional(Schema.String.annotate({ description: "目标描述" })),
  status: Schema.optional(
    Schema.Literals(["pending", "in_progress", "completed", "cancelled"]).annotate({
      description: "目标状态",
    }),
  ),
  priority: Schema.optional(
    Schema.Literals(["high", "medium", "low"]).annotate({ description: "优先级" }),
  ),
  successCriteria: Schema.optional(
    Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "成功标准" }),
  ),
  deadline: Schema.optional(Schema.String.annotate({ description: "截止日期 ISO 格式" })),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String)).annotate({ description: "标签" })),
})

const ListParams = Schema.Struct({
  action: Schema.Literal("list"),
})

const GetParams = Schema.Struct({
  action: Schema.Literal("get"),
  goalId: Schema.String.annotate({ description: "目标ID" }),
})

const ProgressParams = Schema.Struct({
  action: Schema.Literal("progress"),
  goalId: Schema.String.annotate({ description: "目标ID" }),
})

const DecomposeParams = Schema.Struct({
  action: Schema.Literal("decompose"),
  goalId: Schema.String.annotate({ description: "目标ID" }),
})

const Parameters = Schema.Union([
  CreateParams,
  UpdateParams,
  ListParams,
  GetParams,
  ProgressParams,
  DecomposeParams,
])

type Metadata = {
  goalId?: string
  action?: string
}

export const GoalTool = Tool.define<typeof Parameters, Metadata, Goal.Service | Provider.Service>(
  "goal",
  Effect.gen(function* () {
    const goalService = yield* Goal.Service
    const provider = yield* Provider.Service

    return {
      description: "管理目标（Goal）- 创建、更新、查看、分解目标",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const sessionId = ctx.sessionID

          switch (params.action) {
            case "create": {
              const created = yield* goalService.create({
                sessionId,
                parentId: params.parentId,
                title: params.title,
                description: params.description,
                priority: params.priority,
                successCriteria: params.successCriteria,
                deadline: params.deadline ? new Date(params.deadline) : undefined,
                tags: params.tags,
              })
              return {
                title: `创建目标: ${created.title}`,
                output: `目标已创建: ${created.id} - ${created.title}`,
                metadata: { goalId: created.id, action: "create" },
              }
            }

            case "update": {
              const updated = yield* goalService.update({
                goalId: params.goalId,
                title: params.title,
                description: params.description,
                status: params.status,
                priority: params.priority,
                successCriteria: params.successCriteria,
                deadline: params.deadline ? new Date(params.deadline) : undefined,
                tags: params.tags,
              })
              return {
                title: `更新目标: ${updated.title}`,
                output: `目标已更新: ${updated.id} - ${updated.title} (状态: ${updated.status})`,
                metadata: { goalId: updated.id, action: "update" },
              }
            }

            case "list": {
              const goals = yield* goalService.list(sessionId)
              if (goals.length === 0) {
                return {
                  title: "目标列表",
                  output: "暂无目标",
                  metadata: { action: "list" },
                }
              }
              const output = goals
                .map((g) => `${g.id}: ${g.title} [${g.status}] ${g.progress}%`)
                .join("\n")
              return {
                title: `目标列表 (${goals.length} 个)`,
                output,
                metadata: { action: "list" },
              }
            }

            case "get": {
              const goal = yield* goalService.get(params.goalId)
              if (!goal) {
                return {
                  title: "获取目标",
                  output: "目标不存在",
                  metadata: { goalId: params.goalId, action: "get" },
                }
              }
              const output = [
                `ID: ${goal.id}`,
                `标题: ${goal.title}`,
                `描述: ${goal.description ?? "无"}`,
                `状态: ${goal.status}`,
                `进度: ${goal.progress}%`,
                `优先级: ${goal.priority}`,
                `创建时间: ${goal.createdAt.toISOString()}`,
                `更新时间: ${goal.updatedAt.toISOString()}`,
                goal.deadline ? `截止日期: ${goal.deadline.toISOString()}` : null,
                goal.successCriteria ? `成功标准: ${goal.successCriteria.join(", ")}` : null,
                goal.tags.length > 0 ? `标签: ${goal.tags.join(", ")}` : null,
              ]
                .filter(Boolean)
                .join("\n")
              return {
                title: `目标: ${goal.title}`,
                output,
                metadata: { goalId: goal.id, action: "get" },
              }
            }

            case "progress": {
              const progress = yield* goalService.getProgress(params.goalId)
              const output = `任务: ${progress.total} 总计, ${progress.completed} 完成, ${progress.percentage.toFixed(1)}%`
              return {
                title: "目标进度",
                output,
                metadata: { goalId: params.goalId, action: "progress" },
              }
            }

            case "decompose": {
              const targetGoal = yield* goalService.get(params.goalId)
              if (!targetGoal) {
                return {
                  title: "分解目标",
                  output: "目标不存在",
                  metadata: { goalId: params.goalId, action: "decompose" },
                }
              }
              // 用当轮 assistant 模型做真实 LLM 分解,产出子目标并落库为子目标。
              const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
                Effect.orDie,
              )
              if (msg.info.role !== "assistant") {
                return yield* Effect.fail(new Error("目标分解必须在 assistant 轮次内执行"))
              }
              const model = yield* provider.getModel(msg.info.providerID, msg.info.modelID)
              const language = yield* provider.getLanguage(model)
              const system = [
                "你是目标分解助手。把给定的高层目标拆解为 2-6 个具体、可独立推进的子目标。",
                "每个子目标要有清晰的 title;尽量给出 description 和可验证的 successCriteria。",
                "子目标应覆盖父目标、彼此尽量不重叠,顺序体现推进路径。不要输出与目标无关的内容。",
              ].join("\n")
              const messages: ModelMessage[] = [
                { role: "system", content: system },
                {
                  role: "user",
                  content: [
                    `父目标: ${targetGoal.title}`,
                    targetGoal.description ? `描述: ${targetGoal.description}` : "",
                    targetGoal.successCriteria?.length ? `成功标准: ${targetGoal.successCriteria.join("; ")}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ]
              const result = yield* Effect.promise(() =>
                generateObject({
                  model: language,
                  temperature: 0.2,
                  maxOutputTokens: 900,
                  messages,
                  schema: Object.assign(
                    Schema.toStandardSchemaV1(DecomposeResult),
                    Schema.toStandardJSONSchemaV1(DecomposeResult),
                  ),
                }).then((r) => r.object as Schema.Schema.Type<typeof DecomposeResult>),
              )
              const created: string[] = []
              for (const sg of result.subGoals) {
                if (!sg.title?.trim()) continue
                const child = yield* goalService.create({
                  sessionId,
                  parentId: targetGoal.id,
                  title: sg.title.trim(),
                  description: sg.description,
                  successCriteria: sg.successCriteria ? [...sg.successCriteria] : undefined,
                })
                created.push(`${child.id}: ${child.title}`)
              }
              return {
                title: `分解目标: ${targetGoal.title}`,
                output:
                  created.length > 0
                    ? `已分解为 ${created.length} 个子目标:\n${created.join("\n")}`
                    : "未能生成子目标,请补充目标描述后重试",
                metadata: { goalId: targetGoal.id, action: "decompose" },
              }
            }

            default:
              return {
                title: "未知操作",
                output: "未知操作",
                metadata: { action: "unknown" },
              }
          }
        }).pipe(Effect.orDie),
    }
  }),
)