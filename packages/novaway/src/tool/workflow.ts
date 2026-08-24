import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Service as WorkflowService } from "@/workflow/workflow"
import { SessionID } from "@/session/schema"

export const Parameters = Schema.Struct({
  action: Schema.Literal("create", "list", "get", "start", "status", "pause", "resume"),
  workflowId: Schema.optional(Schema.String).annotate({ description: "工作流ID" }),
  name: Schema.optional(Schema.String).annotate({ description: "工作流名称" }),
  description: Schema.optional(Schema.String).annotate({ description: "工作流描述" }),
  steps: Schema.optional(Schema.String).annotate({ description: "工作流步骤 JSON" }),
})

type Metadata = {
  workflowId?: string
  action: string
}

export const WorkflowTool = Tool.define<typeof Parameters, Metadata, WorkflowService>(
  "workflow",
  Effect.gen(function* () {
    const workflowService = yield* WorkflowService

    return {
      description: "管理工作流（Workflow）- 创建、执行、监控多步骤工作流",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.sessionID)

          switch (params.action) {
            case "create": {
              const steps = params.steps ? JSON.parse(params.steps) : []
              const created = yield* workflowService.create({
                sessionId,
                name: params.name!,
                description: params.description,
                steps,
              })
              return {
                title: "创建工作流",
                output: `工作流已创建: ${created.id} - ${created.name}`,
                metadata: { workflowId: created.id, action: "create" },
              }
            }

            case "list": {
              const workflows = yield* workflowService.list(sessionId)
              if (workflows.length === 0) {
                return {
                  title: "列出工作流",
                  output: "暂无工作流",
                  metadata: { action: "list" },
                }
              }
              const output = workflows.map((w) => `${w.id}: ${w.name} [${w.status}]`).join("\n")
              return {
                title: "列出工作流",
                output,
                metadata: { action: "list" },
              }
            }

            case "get": {
              const workflow = yield* workflowService.get(params.workflowId!)
              if (!workflow) {
                return {
                  title: "获取工作流",
                  output: "工作流不存在",
                  metadata: { action: "get" },
                }
              }
              const output = `ID: ${workflow.id}\n名称: ${workflow.name}\n状态: ${workflow.status}\n步骤数: ${workflow.steps.length}`
              return {
                title: "获取工作流",
                output,
                metadata: { workflowId: workflow.id, action: "get" },
              }
            }

            case "start": {
              const run = yield* workflowService.startRun(params.workflowId!)
              return {
                title: "启动工作流",
                output: `工作流已启动: ${run.id}`,
                metadata: { workflowId: params.workflowId, action: "start" },
              }
            }

            case "status": {
              const runs = yield* workflowService.listRuns(params.workflowId!)
              if (runs.length === 0) {
                return {
                  title: "获取工作流状态",
                  output: "暂无运行记录",
                  metadata: { action: "status" },
                }
              }
              const latest = runs[runs.length - 1]
              const output = `最新运行: ${latest.id} [${latest.status}]`
              return {
                title: "获取工作流状态",
                output,
                metadata: { workflowId: params.workflowId, action: "status" },
              }
            }

            case "pause": {
              yield* workflowService.update({ workflowId: params.workflowId!, status: "paused" })
              return {
                title: "暂停工作流",
                output: "工作流已暂停",
                metadata: { workflowId: params.workflowId, action: "pause" },
              }
            }

            case "resume": {
              yield* workflowService.update({ workflowId: params.workflowId!, status: "running" })
              return {
                title: "恢复工作流",
                output: "工作流已恢复",
                metadata: { workflowId: params.workflowId, action: "resume" },
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