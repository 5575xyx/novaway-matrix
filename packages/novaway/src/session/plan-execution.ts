import { createHash } from "node:crypto"
import { Effect } from "effect"
import { startSuperAgentRun } from "@/super-agent/launcher"
import type { Interface as SuperAgentStore } from "@/super-agent/store"
import type { Interface as Provider } from "@/provider/provider"
import type { Interface as Session } from "./session"
import type { Interface as ToolRegistry } from "@/tool/registry"
import type { SessionID } from "./schema"
import type { Goal } from "@/super-agent/types"

export type PlanExecutionResult = {
  goalID: string
  runID: string
}

/**
 * Start the durable, goal-driven runner for an approved plan.
 *
 * An approved plan is a complete execution contract, so this path uses the
 * persistent goal runner rather than the interactive goal toggle in PromptInput.
 * The latter is intended for a normal user prompt; plan approval needs a
 * resumable run that can continue in the background and perform verification.
 */
export const launchApprovedPlan = Effect.fn("PlanExecution.launchApprovedPlan")(function* (input: {
  sessionID: SessionID
  directory: string
  planPath: string
  planText: string
  sessions: Session
  store: SuperAgentStore
  provider: Provider
  toolRegistry: ToolRegistry
}) {
  const key = `${input.sessionID}:${input.planPath}`
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 32)
  const goalID = `goal_plan_${digest}`
  const runID = `sa_plan_${digest}`
  const title = `执行计划：${input.planPath}`
  const criteria = ["完成计划文件中的全部实施步骤", "运行计划中要求的验证并提供可复核证据"]
  const goal: Goal = {
    text: [
      `严格按照已批准的计划文件执行：${input.planPath}`,
      "先读取计划文件，再逐项实施，不要跳过依赖、风险和验证步骤。",
      "计划原文：",
      input.planText.slice(0, 120_000),
    ].join("\n\n"),
    constraints: ["不要重复规划并替代执行；以计划文件为执行基线", "所有完成结论都必须有验证证据"],
    acceptanceCriteria: criteria.map((text, index) => ({ id: `plan-criterion-${index + 1}`, text, required: true })),
    planningMode: "model",
    source: "user",
    requestedBy: input.sessionID,
    goalId: goalID,
    sessionId: input.sessionID,
  }
  const run = yield* input.store.createGoalLinked({
    id: runID,
    directory: input.directory,
    goal,
    goalId: goalID,
    sessionId: input.sessionID,
    title,
    description: goal.text,
    successCriteria: criteria,
    executionConfig: {
      maxIterations: 20,
      verifier: "agent",
      mode: "durable",
    },
  })
  if (!run) {
    const existing = yield* input.store.get(runID)
    if (!existing) return yield* Effect.die(new Error("The approved plan goal could not be created."))
    yield* startSuperAgentRun(
      { store: input.store, sessions: input.sessions, provider: input.provider, toolRegistry: input.toolRegistry },
      existing.id,
    )
    return { goalID, runID: existing.id }
  }
  const started = yield* startSuperAgentRun(
    { store: input.store, sessions: input.sessions, provider: input.provider, toolRegistry: input.toolRegistry },
    run.id,
  )
  if (!started) return yield* Effect.die(new Error("The approved plan goal could not be started."))
  return { goalID, runID: started.id }
})

export * as PlanExecution from "./plan-execution"
