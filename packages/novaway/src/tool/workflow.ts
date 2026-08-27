import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Service as WorkflowService } from "@/workflow/workflow"
import { executeRun } from "@/workflow/executor"
import { getTemplate, listTemplates } from "@/workflow/templates"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"
import { SessionID } from "@/session/schema"

export const Parameters = Schema.Struct({
  action: Schema.Literal(
    "create",
    "create_from_template",
    "list",
    "get",
    "start",
    "status",
    "pause",
    "resume",
    "templates",
  ),
  workflowId: Schema.optional(Schema.String).annotate({ description: "工作流ID" }),
  name: Schema.optional(Schema.String).annotate({ description: "工作流名称" }),
  description: Schema.optional(Schema.String).annotate({ description: "工作流描述" }),
  steps: Schema.optional(Schema.String).annotate({ description: "工作流步骤 JSON" }),
  template: Schema.optional(Schema.String).annotate({
    description: "模板ID: compose | deep-research | fact-check | research-experiment",
  }),
})

type Metadata = {
  workflowId?: string
  action: string
}

export const WorkflowTool = Tool.define<typeof Parameters, Metadata, WorkflowService | Session.Service | Agent.Service>(
  "workflow",
  Effect.gen(function* () {
    const workflowService = yield* WorkflowService
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service

    return {
      description: "管理组合工作流（Workflow）- 创建/从模板创建、执行(真实多步子代理编排)、监控多步骤工作流",
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

            case "templates": {
              const output = listTemplates()
                .map((t) => `${t.id}: ${t.name} — ${t.description} (${t.steps.length} 步)`)
                .join("\n")
              return {
                title: "工作流模板",
                output: output || "暂无模板",
                metadata: { action: "templates" },
              }
            }

            case "create_from_template": {
              const template = getTemplate(params.template ?? "")
              if (!template) {
                return {
                  title: "从模板创建工作流",
                  output: `未知模板: ${params.template}。可用模板: ${listTemplates()
                    .map((t) => t.id)
                    .join(", ")}`,
                  metadata: { action: "create_from_template" },
                }
              }
              const created = yield* workflowService.create({
                sessionId,
                name: params.name ?? template.name,
                description: params.description ?? template.description,
                steps: template.steps,
              })
              return {
                title: "从模板创建工作流",
                output: `已从模板 ${template.id} 创建工作流: ${created.id} - ${created.name}`,
                metadata: { workflowId: created.id, action: "create_from_template" },
              }
            }

            case "list": {
              const workflows = yield* workflowService.list(sessionId)
              if (workflows.length === 0) {
                return { title: "列出工作流", output: "暂无工作流", metadata: { action: "list" } }
              }
              const output = workflows.map((w) => `${w.id}: ${w.name} [${w.status}]`).join("\n")
              return { title: "列出工作流", output, metadata: { action: "list" } }
            }

            case "get": {
              const workflow = yield* workflowService.get(params.workflowId!)
              if (!workflow) {
                return { title: "获取工作流", output: "工作流不存在", metadata: { action: "get" } }
              }
              const output = `ID: ${workflow.id}\n名称: ${workflow.name}\n状态: ${workflow.status}\n步骤数: ${workflow.steps.length}`
              return { title: "获取工作流", output, metadata: { workflowId: workflow.id, action: "get" } }
            }

            case "start": {
              const workflow = yield* workflowService.get(params.workflowId!)
              if (!workflow) {
                return { title: "启动工作流", output: "工作流不存在", metadata: { action: "start" } }
              }
              const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
                Effect.orDie,
              )
              if (msg.info.role !== "assistant") {
                return yield* Effect.fail(new Error("工作流必须在 assistant 轮次内启动"))
              }
              const ops = ctx.extra?.promptOps as RunAgentPromptOps | undefined
              if (!ops) {
                return yield* Effect.fail(new Error("WorkflowTool requires promptOps in ctx.extra"))
              }
              const run = yield* workflowService.startRun(params.workflowId!)
              const runAgent = makeRunAgent({
                ops,
                sessions,
                agents,
                parentSessionID: ctx.sessionID,
                defaultModel: { providerID: msg.info.providerID, modelID: msg.info.modelID },
                defaultAgent: ctx.agent,
              })
              const finalRun = yield* executeRun({
                workflow,
                run,
                runAgent,
                defaultAgent: ctx.agent,
                service: workflowService,
              })
              const output =
                finalRun.status === "completed"
                  ? `工作流执行完成: ${finalRun.id}\n已完成步骤: ${finalRun.state?.completedSteps.join(" → ") ?? ""}`
                  : `工作流执行${finalRun.status}: ${finalRun.error ?? ""}`
              return {
                title: "启动工作流",
                output,
                metadata: { workflowId: params.workflowId, action: "start" },
              }
            }

            case "status": {
              const runs = yield* workflowService.listRuns(params.workflowId!)
              if (runs.length === 0) {
                return { title: "获取工作流状态", output: "暂无运行记录", metadata: { action: "status" } }
              }
              const latest = runs[runs.length - 1]
              const steps = latest.state?.completedSteps.join(" → ") ?? ""
              const output = `最新运行: ${latest.id} [${latest.status}]${steps ? `\n已完成: ${steps}` : ""}${
                latest.error ? `\n错误: ${latest.error}` : ""
              }`
              return { title: "获取工作流状态", output, metadata: { workflowId: params.workflowId, action: "status" } }
            }

            case "pause": {
              yield* workflowService.update({ workflowId: params.workflowId!, status: "paused" })
              return { title: "暂停工作流", output: "工作流已暂停", metadata: { workflowId: params.workflowId, action: "pause" } }
            }

            case "resume": {
              yield* workflowService.update({ workflowId: params.workflowId!, status: "running" })
              return { title: "恢复工作流", output: "工作流已恢复", metadata: { workflowId: params.workflowId, action: "resume" } }
            }

            default:
              return { title: "未知操作", output: "未知操作", metadata: { action: "unknown" } }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
