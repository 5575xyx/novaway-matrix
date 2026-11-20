import { Effect } from "effect"
import { planGoalWithModel, materializeGoalPlan } from "./planner"
import type { StoredSuperAgentRun, Interface as SuperAgentStoreInterface } from "./store"
import type { SuperAgentRunStatus } from "./types"
import type { Interface as ProviderInterface } from "@/provider/provider"
import type { Interface as SessionInterface } from "@/session/session"
import type { Interface as ToolRegistryInterface } from "@/tool/registry"
import type { SessionID } from "@/session/schema"

export type SuperAgentStartDependencies = {
  readonly store: SuperAgentStoreInterface
  readonly sessions: SessionInterface
  readonly provider: ProviderInterface
  readonly toolRegistry: ToolRegistryInterface
}

/**
 * Start a persisted run, including model-backed planning.
 *
 * Keeping this transition in one service is important for Goal launch: the
 * HTTP endpoint and the legacy run endpoint must use exactly the same planner,
 * failure event, and lifecycle transitions. A run is never reported as
 * started until its persisted graph is executable.
 */
export function startSuperAgentRun(
  dependencies: SuperAgentStartDependencies,
  runID: string,
): Effect.Effect<StoredSuperAgentRun | undefined> {
  const { store, sessions, provider, toolRegistry } = dependencies
  const move = (run: StoredSuperAgentRun, status: SuperAgentRunStatus) =>
    Effect.gen(function* () {
      const persisted = yield* store.transitionWithEvent(run.id, status, {
        type: "run_status_changed",
        at: Date.now(),
        payload: { from: run.status, to: status },
      })
      if (!persisted) return undefined
      return persisted.run
    })

  return Effect.gen(function* () {
    let next = yield* store.get(runID)
    if (!next) return undefined
    if (next.status === "draft") {
      next = yield* move(next, "planning")
      if (!next) return undefined
    }
    if (
      next.status === "planning" &&
      next.goal.planningMode === "model" &&
      !next.goal.plan &&
      next.graph.planHash === "initial"
    ) {
      if (!next.goal.sessionId) throw new Error("model planning requires a sessionId")
      const session = yield* sessions.get(next.goal.sessionId as SessionID).pipe(Effect.orDie)
      const selected = session.model
        ? { providerID: session.model.providerID, modelID: session.model.id }
        : yield* provider.defaultModel()
      const model = yield* provider.getModel(selected.providerID, selected.modelID).pipe(Effect.orDie)
      const language = yield* provider.getLanguage(model).pipe(Effect.orDie)
      const definitions = yield* toolRegistry.all()
      const failPlanning = (error: unknown): Effect.Effect<never, never, never> =>
        Effect.gen(function* () {
          const failure = error instanceof Error ? error : new Error(String(error))
          yield* store
            .transitionWithEvent(next!.id, "failed", {
              type: "run_failed",
              at: Date.now(),
              payload: { code: "planner_failed", message: failure.message },
            })
            .pipe(Effect.orDie)
          return yield* Effect.die(failure)
        })
      const plan = yield* Effect.tryPromise({
        try: () =>
          planGoalWithModel({
            model: language,
            run: next!,
            availableTools: definitions.map((definition) => definition.id),
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(Effect.catch(failPlanning))
      const graph = yield* Effect.try({
        try: () => materializeGoalPlan(next!, plan),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(Effect.catch(failPlanning))
      const planned = yield* store.updateGraph(next!.id, graph, next!.graph.version)
      if (!planned) return undefined
      yield* store.appendEvent({
        runID: planned.id,
        type: "model_plan_created",
        at: planned.updatedAt,
        payload: { graphID: planned.graph.id, version: planned.graph.version, taskCount: plan.length },
      })
      next = planned
    }
    if (next.status === "planning") {
      next = yield* move(next, "ready")
      if (!next) return undefined
    }
    if (next.status === "ready") {
      next = yield* move(next, "running")
      if (!next) return undefined
    }
    return next
  })
}
