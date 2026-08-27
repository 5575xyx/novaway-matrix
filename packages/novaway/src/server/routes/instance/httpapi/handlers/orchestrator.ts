import { OrchestratorService } from "@/orchestrator/orchestrator"
import { makeRunAgent, type RunAgentPromptOps } from "@/session/agent-step"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { SessionID } from "@/session/schema"
import { Effect, Scope } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

const toPlan = (p: {
  id: string
  sessionId: string
  name: string
  tasks: unknown
  status: string
  error: string | null
  createdAt: Date
  updatedAt: Date
}) => ({
  id: p.id,
  sessionId: p.sessionId,
  name: p.name,
  tasks: p.tasks,
  status: p.status,
  error: p.error ?? undefined,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
})

export const orchestratorHandlers = HttpApiBuilder.group(InstanceHttpApi, "orchestrator", (handlers) =>
  Effect.gen(function* () {
    const orchestrator = yield* OrchestratorService
    const promptSvc = yield* SessionPrompt.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const scope = yield* Scope.Scope

    return handlers
      .handle("listOrchestratorPlans", (ctx) =>
        Effect.gen(function* () {
          const plans = yield* orchestrator.listPlans(SessionID.make(ctx.params.sessionId))
          return plans.map(toPlan)
        }),
      )
      .handle("createOrchestratorPlan", (ctx) =>
        Effect.gen(function* () {
          const plan = yield* orchestrator.createPlan({
            sessionId: SessionID.make(ctx.params.sessionId),
            name: ctx.payload.name,
            tasks: ctx.payload.tasks as any,
          })
          return toPlan(plan)
        }),
      )
      .handle("getOrchestratorPlan", (ctx) =>
        Effect.gen(function* () {
          const plan = yield* orchestrator.getPlan(ctx.params.planId)
          if (!plan) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return toPlan(plan)
        }),
      )
      .handle("executeOrchestratorPlan", (ctx) =>
        Effect.gen(function* () {
          const plan = yield* orchestrator.getPlan(ctx.params.planId)
          if (!plan) return yield* Effect.fail(new HttpApiError.NotFound({}))

          // 解析默认模型:优先取会话内最近一条 assistant 消息的模型,否则用 provider 默认。
          const msgs = yield* sessions
            .messages({ sessionID: SessionID.make(plan.sessionId) })
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
            parentSessionID: SessionID.make(plan.sessionId),
            defaultModel,
            defaultAgent,
          })

          // 后台执行:UI 通过 getOrchestratorPlan 轮询状态。
          yield* orchestrator
            .executePlan({ planId: plan.id, runAgent, defaultAgent })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("orchestrator execution failed").pipe(
                  Effect.annotateLogs({ planId: plan.id, cause }),
                ),
              ),
              Effect.forkIn(scope, { startImmediately: true }),
            )

          // 返回置为 running 的当前状态(执行在后台推进)。
          const current = yield* orchestrator.getPlan(plan.id)
          return toPlan(current ?? plan)
        }),
      )
      .handle("deleteOrchestratorPlan", (ctx) =>
        Effect.gen(function* () {
          yield* orchestrator.delete(ctx.params.planId)
          return { success: true }
        }),
      )
  }),
)
