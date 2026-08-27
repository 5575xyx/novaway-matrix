import { WorkflowService } from "@/workflow/workflow"
import type { WorkflowStep } from "@/workflow/workflow.sql"
import { executeRun } from "@/workflow/executor"
import { getTemplate, listTemplates } from "@/workflow/templates"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const workflowHandlers = HttpApiBuilder.group(InstanceHttpApi, "workflow", (handlers) =>
  Effect.gen(function* () {
    const workflow = yield* WorkflowService
    const promptSvc = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const scope = yield* Scope.Scope

    return handlers
      .handle("listWorkflows", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const workflows = yield* workflow.list(sessionId)
          return workflows.map((w) => ({
            id: w.id,
            sessionId: w.sessionId,
            name: w.name,
            description: w.description ?? undefined,
            steps: w.steps,
            status: w.status,
            state: w.state,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
          }))
        }),
      )
      .handle("createWorkflow", (ctx) =>
        Effect.gen(function* () {
          const sessionId = SessionID.make(ctx.params.sessionId)
          const created = yield* workflow.create({
            sessionId,
            name: ctx.payload.name,
            description: ctx.payload.description,
            steps: ctx.payload.steps as any,
          })
          return {
            id: created.id,
            sessionId: created.sessionId,
            name: created.name,
            description: created.description ?? undefined,
            steps: created.steps,
            status: created.status,
            state: created.state,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          }
        }),
      )
      .handle("getWorkflow", (ctx) =>
        Effect.gen(function* () {
          const w = yield* workflow.get(ctx.params.workflowId)
          if (!w) {
            return yield* Effect.fail(new HttpApiError.NotFound({}))
          }
          return {
            id: w.id,
            sessionId: w.sessionId,
            name: w.name,
            description: w.description ?? undefined,
            steps: w.steps,
            status: w.status,
            state: w.state,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
          }
        }),
      )
      .handle("updateWorkflow", (ctx) =>
        Effect.gen(function* () {
          const updated = yield* workflow.update({
            workflowId: ctx.params.workflowId,
            ...ctx.payload,
            steps: ctx.payload.steps as WorkflowStep[] | undefined,
          })
          return {
            id: updated.id,
            sessionId: updated.sessionId,
            name: updated.name,
            description: updated.description ?? undefined,
            steps: updated.steps,
            status: updated.status,
            state: updated.state,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          }
        }),
      )
      .handle("deleteWorkflow", (ctx) =>
        Effect.gen(function* () {
          yield* workflow.delete(ctx.params.workflowId)
          return { success: true }
        }),
      )
      .handle("startWorkflow", (ctx) =>
        Effect.gen(function* () {
          const wf = yield* workflow.get(ctx.params.workflowId)
          if (!wf) return yield* Effect.fail(new HttpApiError.NotFound({}))

          const run = yield* workflow.startRun(ctx.params.workflowId)

          // 解析默认模型:优先取会话内最近一条 assistant 消息的模型,否则用 provider 默认。
          const msgs = yield* sessions
            .messages({ sessionID: SessionID.make(wf.sessionId) })
            .pipe(Effect.catchCause(() => Effect.succeed([])))
          const lastAssistant = [...msgs].reverse().find((m) => m.info.role === "assistant")
          const defaultModel =
            lastAssistant && lastAssistant.info.role === "assistant"
              ? { providerID: lastAssistant.info.providerID, modelID: lastAssistant.info.modelID }
              : yield* provider.defaultModel()
          const defaultAgent = yield* agents.defaultAgent()

          const ops: RunAgentPromptOps = {
            resolvePromptParts: (template) => promptSvc.resolvePromptParts(template),
            prompt: (input) => promptSvc.prompt(input).pipe(Effect.orDie),
          }
          const runAgent = makeRunAgent({
            ops,
            sessions,
            agents,
            parentSessionID: SessionID.make(wf.sessionId),
            defaultModel,
            defaultAgent,
          })

          // 后台执行:UI 通过 listWorkflowRuns / getWorkflow 轮询状态。
          yield* executeRun({ workflow: wf, run, runAgent, defaultAgent, service: workflow }).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("workflow execution failed").pipe(
                Effect.annotateLogs({ workflowId: wf.id, runId: run.id, cause }),
              ),
            ),
            Effect.forkIn(scope, { startImmediately: true }),
          )

          return {
            id: run.id,
            workflowId: run.workflowId,
            sessionId: run.sessionId,
            status: run.status,
            state: run.state,
            error: run.error ?? undefined,
            startedAt: run.startedAt?.toISOString(),
            completedAt: run.completedAt?.toISOString(),
            createdAt: run.createdAt.toISOString(),
          }
        }),
      )
      .handle("listWorkflowRuns", (ctx) =>
        Effect.gen(function* () {
          const runs = yield* workflow.listRuns(ctx.params.workflowId)
          return runs.map((r) => ({
            id: r.id,
            workflowId: r.workflowId,
            sessionId: r.sessionId,
            status: r.status,
            state: r.state,
            error: r.error ?? undefined,
            startedAt: r.startedAt?.toISOString(),
            completedAt: r.completedAt?.toISOString(),
            createdAt: r.createdAt.toISOString(),
          }))
        }),
      )
      .handle("listWorkflowTemplates", () =>
        Effect.sync(() =>
          listTemplates().map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            steps: t.steps.length,
          })),
        ),
      )
      .handle("createWorkflowFromTemplate", (ctx) =>
        Effect.gen(function* () {
          const template = getTemplate(ctx.payload.template)
          if (!template) return yield* Effect.fail(new HttpApiError.NotFound({}))
          const sessionId = SessionID.make(ctx.params.sessionId)
          const created = yield* workflow.create({
            sessionId,
            name: ctx.payload.name ?? template.name,
            description: ctx.payload.description ?? template.description,
            steps: template.steps,
          })
          return {
            id: created.id,
            sessionId: created.sessionId,
            name: created.name,
            description: created.description ?? undefined,
            steps: created.steps,
            status: created.status,
            state: created.state,
            createdAt: created.createdAt.toISOString(),
            updatedAt: created.updatedAt.toISOString(),
          }
        }),
      )
  }),
)
