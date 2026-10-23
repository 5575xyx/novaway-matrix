import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { OrchestratorService, type OrchestratorTask } from "@/orchestrator/orchestrator"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "@/session/message-v2"
import { Service as BackgroundJobService } from "@/background/job"

export const NL = String.fromCharCode(10)

const Parameters = Schema.Struct({
  action: Schema.Literals([
    "create_plan",
    "add_task",
    "execute",
    "status",
    "list",
    "pause",
    "resume",
    "cancel",
    "retry",
  ]),
  planId: Schema.optional(Schema.String).annotate({ description: "编排计划ID" }),
  name: Schema.optional(Schema.String).annotate({ description: "计划名称" }),
  tasks: Schema.optional(Schema.String).annotate({
    description:
      '任务列表 JSON 数组。每个任务: {name, type: "agent"|"tool"|"skill", config: {agent?, tool?, skill?, prompt}, dependencies: string[]}。dependencies 引用其它任务的 id (task_0, task_1, ...)',
  }),
  task: Schema.optional(Schema.String).annotate({ description: "单个任务 JSON,同上元素结构" }),
  concurrency: Schema.optional(Schema.Number).annotate({ description: "并发上限,默认按就绪任务数" }),
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run the plan in the background and return immediately (default: true)",
  }),
})

type Metadata = {
  planId?: string
  action?: string
  background?: boolean
}

type TaskInput = Omit<OrchestratorTask, "id" | "status">

export const OrchestratorTool = Tool.define<
  typeof Parameters,
  Metadata,
  OrchestratorService | Session.Service | Agent.Service | BackgroundJobService
>(
  "orchestrator",
  Effect.gen(function* () {
    const orchestrator = yield* OrchestratorService
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const background = yield* BackgroundJobService

    return {
      description: "多代理编排(Orchestrator)- 创建含依赖关系的任务计划,按拓扑顺序并发派生子代理执行,结果在任务间传递",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          switch (params.action) {
            case "create_plan": {
              const tasks = params.tasks ? (JSON.parse(params.tasks) as TaskInput[]) : []
              const plan = yield* orchestrator.createPlan({
                sessionId: ctx.sessionID,
                name: params.name ?? "编排计划",
                tasks,
              })
              const summary = plan.tasks
                .map(
                  (t) =>
                    `${t.id} [${t.type}]${t.dependencies.length ? ` ←(${t.dependencies.join(",")})` : ""}: ${t.name}`,
                )
                .join("\n")
              return {
                title: "创建编排计划",
                output: `计划已创建: ${plan.id} - ${plan.name}\n${summary}`,
                metadata: { planId: plan.id, action: "create_plan" },
              }
            }

            case "add_task": {
              if (!params.planId || !params.task) {
                return yield* Effect.fail(new Error("add_task 需要 planId 和 task"))
              }
              const taskInput = JSON.parse(params.task) as TaskInput
              const task = yield* orchestrator.addTask({ planId: params.planId, task: taskInput })
              return {
                title: "添加任务",
                output: `任务已添加: ${task.id} - ${task.name}`,
                metadata: { planId: params.planId, action: "add_task" },
              }
            }

            case "list": {
              const plans = yield* orchestrator.listPlans(ctx.sessionID)
              if (plans.length === 0) {
                return { title: "列出编排计划", output: "暂无编排计划", metadata: { action: "list" } }
              }
              const output = plans.map((p) => `${p.id}: ${p.name} [${p.status}] (${p.tasks.length} 任务)`).join("\n")
              return { title: "列出编排计划", output, metadata: { action: "list" } }
            }

            case "status": {
              if (!params.planId) return yield* Effect.fail(new Error("status 需要 planId"))
              const plan = yield* orchestrator.getPlan(params.planId)
              if (!plan) {
                return { title: "编排状态", output: "计划不存在", metadata: { action: "status" } }
              }
              const output = [
                `计划: ${plan.id} - ${plan.name} [${plan.status}]`,
                ...plan.tasks.map((t) => `  ${t.id} [${t.status}] ${t.name}${t.error ? ` — 错误: ${t.error}` : ""}`),
                plan.error ? `错误: ${plan.error}` : "",
              ]
                .filter(Boolean)
                .join("\n")
              return { title: "编排状态", output, metadata: { planId: plan.id, action: "status" } }
            }

            case "execute": {
              if (!params.planId) return yield* Effect.fail(new Error("execute 需要 planId"))
              const plan = yield* orchestrator.getPlan(params.planId)
              if (!plan) {
                return { title: "执行编排计划", output: "计划不存在", metadata: { action: "execute" } }
              }
              const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
                Effect.orDie,
              )
              if (msg.info.role !== "assistant") {
                return yield* Effect.fail(new Error("编排计划必须在 assistant 轮次内执行"))
              }
              const ops = ctx.extra?.promptOps as RunAgentPromptOps | undefined
              if (!ops) {
                return yield* Effect.fail(new Error("OrchestratorTool requires promptOps in ctx.extra"))
              }
              const runAgent = makeRunAgent({
                ops,
                sessions,
                agents,
                parentSessionID: ctx.sessionID,
                defaultModel: { providerID: msg.info.providerID, modelID: msg.info.modelID },
                defaultAgent: ctx.agent,
              })
              const runPlan = (retry = false) =>
                orchestrator.executePlan({
                  planId: params.planId!,
                  runAgent,
                  defaultAgent: ctx.agent,
                  concurrency: params.concurrency,
                  retry,
                })

              if (params.background !== false) {
                yield* background.start({
                  id: "orchestrator:" + params.planId,
                  type: "orchestrator",
                  title: plan.name,
                  metadata: { planId: params.planId },
                  run: runPlan().pipe(Effect.as("编排完成")),
                })
                return {
                  title: "编排计划已后台执行",
                  output:
                    "plan_id: " +
                    params.planId +
                    NL +
                    "state: running" +
                    NL +
                    "Use action=status to poll, action=pause/resume/cancel to control.",
                  metadata: { planId: params.planId, action: "execute", background: true },
                }
              }

              const final = yield* runPlan()
              const output = [
                `编排执行${final.status === "completed" ? "完成" : final.status}: ${final.id}`,
                ...final.tasks.map((t) => `  ${t.id} [${t.status}] ${t.name}${t.error ? ` — ${t.error}` : ""}`),
                final.error ? `错误: ${final.error}` : "",
              ]
                .filter(Boolean)
                .join(NL)
              return {
                title: "执行编排计划",
                output,
                metadata: { planId: params.planId, action: "execute" },
              }
            }

            case "pause":
            case "resume":
            case "cancel": {
              if (!params.planId) return yield* Effect.fail(new Error(params.action + " 需要 planId"))
              const status = params.action === "pause" ? "paused" : params.action === "resume" ? "running" : "cancelled"
              const plan = yield* orchestrator.setStatus({ planId: params.planId, status })
              if (!plan) return { title: "编排状态", output: "计划不存在", metadata: {} }
              if (params.action === "cancel") yield* background.cancel("orchestrator:" + params.planId)
              return {
                title:
                  "编排计划已" + (params.action === "pause" ? "暂停" : params.action === "resume" ? "恢复" : "取消"),
                output: "plan_id: " + plan.id + NL + "state: " + plan.status,
                metadata: { planId: plan.id, action: params.action },
              }
            }

            case "retry": {
              if (!params.planId) return yield* Effect.fail(new Error("retry 需要 planId"))
              const retryPlan = yield* orchestrator.getPlan(params.planId)
              if (!retryPlan) return { title: "编排状态", output: "计划不存在", metadata: {} }
              const retryMsg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
                Effect.orDie,
              )
              const retryOps = ctx.extra?.promptOps as RunAgentPromptOps | undefined
              if (!retryOps || retryMsg.info.role !== "assistant") {
                return yield* Effect.fail(new Error("retry 需要在 assistant 轮次内执行"))
              }
              const retryAgent = makeRunAgent({
                ops: retryOps,
                sessions,
                agents,
                parentSessionID: ctx.sessionID,
                defaultModel: { providerID: retryMsg.info.providerID, modelID: retryMsg.info.modelID },
                defaultAgent: ctx.agent,
              })
              const final = yield* orchestrator.executePlan({
                planId: params.planId,
                runAgent: retryAgent,
                defaultAgent: ctx.agent,
                concurrency: params.concurrency,
                retry: true,
              })
              return {
                title: "重试编排计划",
                output: "plan_id: " + final.id + NL + "state: " + final.status,
                metadata: { planId: final.id, action: "retry" },
              }
            }

            default:
              return { title: "未知操作", output: "未知操作", metadata: { action: "unknown" } }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
