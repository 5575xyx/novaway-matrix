import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Goal } from "../../src/session/goal"
import { allowGoalContinuation } from "../../src/session/goal-budget"
import { GoalBudgetTable, GoalTable } from "../../src/session/goal.sql"
import { ProjectID } from "../../src/project/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"

const runGoal = <A>(effect: Effect.Effect<A, unknown, Goal.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Goal.layer)))

function seedSession(id: string) {
  const sessionId = SessionID.make(id)
  Database.use((db) => {
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run()
    db.insert(SessionTable)
      .values({ id: sessionId, project_id: ProjectID.global, slug: id, directory: "", title: id, version: "test" })
      .onConflictDoNothing()
      .run()
  })
  return sessionId
}

function seedGoal(sessionId: SessionID, id: string, status: "in_progress" | "paused" | "cancelled") {
  const now = new Date()
  Database.use((db) =>
    db
      .insert(GoalTable)
      .values({
        id,
        session_id: sessionId,
        title: id,
        status,
        priority: "medium",
        progress: 0,
        tags: [],
        created_at: now,
        updated_at: now,
      })
      .run(),
  )
}

describe("GoalService", () => {
  test("does not replace cancellation with a late completion", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2P")
    seedGoal(sessionId, "goal-cancel-race", "cancelled")

    const updated = await runGoal(
      Goal.Service.use((goal) => goal.update({ goalId: "goal-cancel-race", sessionId, status: "completed" })),
    )

    expect(updated.status).toBe("cancelled")
  })

  test("does not complete a paused goal", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2R")
    seedGoal(sessionId, "goal-paused-race", "paused")

    const updated = await runGoal(
      Goal.Service.use((goal) => goal.update({ goalId: "goal-paused-race", sessionId, status: "completed" })),
    )

    expect(updated.status).toBe("paused")
  })

  test("claims a Goal lease atomically and allows takeover after release", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2U")
    seedGoal(sessionId, "goal-lease", "in_progress")

    const first = await runGoal(
      Goal.Service.use((goal) => goal.claimRun({ goalId: "goal-lease", sessionId, owner: "worker-a" })),
    )
    const second = await runGoal(
      Goal.Service.use((goal) => goal.claimRun({ goalId: "goal-lease", sessionId, owner: "worker-b" })),
    )
    expect(first).toBe(true)
    expect(second).toBe(false)

    await runGoal(Goal.Service.use((goal) => goal.releaseRun({ goalId: "goal-lease", sessionId, owner: "worker-a" })))
    const afterRelease = await runGoal(
      Goal.Service.use((goal) => goal.claimRun({ goalId: "goal-lease", sessionId, owner: "worker-b" })),
    )
    expect(afterRelease).toBe(true)
  })

  test("ignores malformed persisted execution configuration", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2V")
    Database.use((db) =>
      db
        .insert(GoalTable)
        .values({
          id: "goal-invalid-config",
          session_id: sessionId,
          title: "invalid",
          status: "in_progress",
          priority: "medium",
          progress: 0,
          tags: [],
          execution_config: "{not-json}",
          created_at: new Date(),
          updated_at: new Date(),
        })
        .run(),
    )

    const goals = await runGoal(Goal.Service.use((goal) => goal.list(sessionId)))
    expect(goals.find((goal) => goal.id === "goal-invalid-config")?.executionConfig).toBeNull()
  })

  test("cancels only an in-progress goal", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2Q")
    seedGoal(sessionId, "goal-cancel-active", "in_progress")

    const updated = await runGoal(
      Goal.Service.use((goal) => goal.update({ goalId: "goal-cancel-active", sessionId, status: "cancelled" })),
    )

    expect(updated.status).toBe("cancelled")
  })

  test("round-trips the durable execution profile", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5W")
    await runGoal(
      Goal.Service.use((goal) =>
        goal.create({
          sessionId,
          title: "durable goal",
          status: "in_progress",
          executionConfig: {
            maxIterations: 0,
            mode: "durable",
            superAgentRunId: "sa_test_run",
          },
        }),
      ),
    )

    const goals = await runGoal(Goal.Service.use((goal) => goal.list(sessionId)))
    expect(goals.find((goal) => goal.title === "durable goal")?.executionConfig).toEqual({
      maxIterations: 0,
      mode: "durable",
      superAgentRunId: "sa_test_run",
    })
  })
})


describe("GoalBudget", () => {
  test("allows continuation without limits", () => {
    expect(
      allowGoalContinuation({ budget: { turns: 9, tokens: 999_999, startedAt: 0 }, limits: {}, now: 10_000 }),
    ).toEqual({ allowed: true })
  })

  test("stops at the token limit", () => {
    const permit = allowGoalContinuation({
      budget: { turns: 1, tokens: 500, startedAt: 0 },
      limits: { maxTokens: 500 },
      now: 0,
    })
    expect(permit).toEqual({ allowed: false, reason: "max_tokens", detail: "token 预算已用 500/500" })
  })

  test("stops when the active window is exhausted", () => {
    const permit = allowGoalContinuation({
      budget: { turns: 1, tokens: 0, startedAt: 1_000 },
      limits: { maxActiveMs: 2_000 },
      now: 3_500,
    })
    expect(permit).toEqual({ allowed: false, reason: "max_active_ms", detail: "已执行 3s，上限 2s" })
  })

  test("persists the budget across reads and accumulates charges", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2S")
    seedGoal(sessionId, "goal-budget-persist", "in_progress")

    const created = await runGoal(
      Goal.Service.use((goal) => goal.budget({ goalId: "goal-budget-persist", sessionId, startedAt: 1_000 })),
    )
    expect(created).toEqual({ turns: 0, tokens: 0, startedAt: 1_000 })

    const reread = await runGoal(
      Goal.Service.use((goal) => goal.budget({ goalId: "goal-budget-persist", sessionId, startedAt: 9_999 })),
    )
    expect(reread.startedAt).toBe(1_000)

    await runGoal(
      Goal.Service.use((goal) => goal.chargeBudget({ goalId: "goal-budget-persist", sessionId, tokens: 30 })),
    )
    const charged = await runGoal(
      Goal.Service.use((goal) => goal.chargeBudget({ goalId: "goal-budget-persist", sessionId, tokens: 12 })),
    )
    expect(charged).toEqual({ turns: 2, tokens: 42, startedAt: 1_000 })
  })

  test("drops the budget row when the goal is deleted", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2T")
    seedGoal(sessionId, "goal-budget-cascade", "in_progress")
    await runGoal(
      Goal.Service.use((goal) => goal.budget({ goalId: "goal-budget-cascade", sessionId, startedAt: 1_000 })),
    )

    await runGoal(Goal.Service.use((goal) => goal.delete({ goalId: "goal-budget-cascade", sessionId })))

    const rows = Database.use((db) => db.select().from(GoalBudgetTable).all())
    expect(rows.some((row) => row.goal_id === "goal-budget-cascade")).toBe(false)
  })
})
