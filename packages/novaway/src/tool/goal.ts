import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Goal } from "@/session/goal"

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

export const GoalTool = Tool.define<typeof Parameters, Metadata, Goal.Service>(
  "goal",
  Effect.gen(function* () {
    const goalService = yield* Goal.Service

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
              return {
                title: `分解目标: ${targetGoal.title}`,
                output: `目标 "${targetGoal.title}" 需要手动分解为子目标`,
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