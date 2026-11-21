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
import { Service as TeamService } from "@/team/team"
import { Effect, Scope } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import * as WorkflowPolicy from "@/workflow/policy"
import { summarize } from "@/workflow/metrics"
import { Memory } from "@/memory/service"
import { memoryInput } from "@/workflow/evidence"
import { githubEvent, hasGithubDelivery, deliveryID, verifyGithubSignature } from "@/workflow/integration"

export const workflowHandlers = HttpApiBuilder.group(InstanceHttpApi, "workflow", (handlers) =>
  Effect.gen(function* () {
    const workflow = yield* WorkflowService
    const promptSvc = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const teams = yield* TeamService
    const scope = yield* Scope.Scope
    const workflowPolicy = yield* WorkflowPolicy.Service
    const memory = yield* Memory.Service

    return handlers
      .handle("githubWorkflowWebhook", (ctx) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(ctx.params.sessionId)
          const request = yield* HttpServerRequest.HttpServerRequest
          const webhookSecret = process.env.NOVAWAY_GITHUB_WEBHOOK_SECRET?.trim()
          // Development may opt into unsigned fixtures; production must always
          // configure the secret because GitHub signs the raw JSON bytes.
          if (webhookSecret || process.env.NODE_ENV === "production") {
            const rawBody = yield* request.text.pipe(Effect.catch(() => Effect.succeed("")))
            if (
              !webhookSecret ||
              !verifyGithubSignature({
                rawBody,
                signature: request.headers["x-hub-signature-256"],
                secret: webhookSecret,
              })
            )
              return yield* Effect.fail(new HttpApiError.BadRequest({}))
          }
          const headerEvent = request.headers["x-github-event"]?.trim()
          const eventName = ctx.payload.event.trim()
          if (headerEvent && headerEvent !== eventName) return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const requestDeliveryID = deliveryID(request.headers["x-github-delivery"])
          const payloadDeliveryID = deliveryID(ctx.payload.deliveryID)
          if (requestDeliveryID && payloadDeliveryID && requestDeliveryID !== payloadDeliveryID)
            return yield* Effect.fail(new HttpApiError.BadRequest({}))
          const id = requestDeliveryID ?? payloadDeliveryID
          // A webhook can arrive before the first model turn (for example when
          // GitHub is configured immediately after a session is created). Create
          // the durable policy anchor so evidence and delivery idempotency are
          // not silently discarded for that valid integration path.
          if (!(yield* workflowPolicy.get(sessionID))) {
            yield* workflowPolicy.beginTurn({
              sessionID,
              turnID: `github:${id ?? eventName}`,
              text: `GitHub integration event: ${eventName}`,
            })
          }
          if (id) {
            const events = yield* workflowPolicy
              .events(sessionID, 10_000)
              .pipe(Effect.catchCause(() => Effect.succeed([])))
            if (hasGithubDelivery(events, id)) return { accepted: true, duplicate: true }
          }
          const event = githubEvent({ event: eventName, deliveryID: id, payload: ctx.payload.payload })
          const source = "github:" + eventName
          const memoryItem = yield* memory.add(memoryInput({ sessionID, source, evidence: event.payload }))
          yield* workflowPolicy.recordEvidence({
            sessionID,
            payload: { memoryID: memoryItem.id, source, evidence: event.payload },
          })
          yield* workflowPolicy.recordIntegration({
            sessionID,
            kind: event.kind,
            payload: { ...event.payload, memoryID: memoryItem.id },
          })
          return { accepted: true, duplicate: false, memoryID: memoryItem.id }
        }),
      )
      .handle("recordWorkflowEvidence", (ctx) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(ctx.params.sessionId)
          const item = yield* memory.add(
            memoryInput({ sessionID, source: ctx.payload.source, evidence: ctx.payload.evidence }),
          )
          return yield* workflowPolicy.recordEvidence({
            sessionID,
            payload: { memoryID: item.id, source: ctx.payload.source, evidence: ctx.payload.evidence },
          })
        }),
      )
      .handle("recordWorkflowIntegration", (ctx) =>
        workflowPolicy.recordIntegration({
          sessionID: SessionID.make(ctx.params.sessionId),
          kind: ctx.payload.kind,
          payload: ctx.payload.payload,
        }),
      )
      .handle("updateWorkflowState", (ctx) =>
        workflowPolicy
          .updateState({
            sessionID: SessionID.make(ctx.params.sessionId),
            expectedRevision: ctx.payload.expectedRevision,
            patch: ctx.payload.patch as any,
          })
          .pipe(
            Effect.catch((error) =>
              error instanceof Error && error.message.startsWith("workflow state conflict")
                ? Effect.fail(new HttpApiError.Conflict({}))
                : Effect.die(error),
            ),
          ),
      )
      .handle("getWorkflowState", (ctx) => workflowPolicy.get(SessionID.make(ctx.params.sessionId)).pipe(Effect.map((state) => state ?? null)))
      .handle("listWorkflowEvents", (ctx) =>
        workflowPolicy
          .events(SessionID.make(ctx.params.sessionId), 1000)
          .pipe(Effect.catchCause(() => Effect.succeed([]))),
      )
      .handle("getWorkflowMetrics", (ctx) =>
        Effect.gen(function* () {
          const sessionID = SessionID.make(ctx.params.sessionId)
          const state = yield* workflowPolicy.get(sessionID)
          const events = yield* workflowPolicy.events(sessionID, 1000).pipe(Effect.catchCause(() => Effect.succeed([])))
          return summarize(sessionID, state, events as any)
        }),
      )
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
          const existing = yield* workflow.get(ctx.params.workflowId)
          if (!existing) return yield* Effect.fail(new HttpApiError.NotFound({}))
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
            teams,
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
