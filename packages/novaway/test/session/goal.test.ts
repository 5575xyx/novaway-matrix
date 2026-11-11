import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Goal } from "../../src/session/goal"
import { GoalTable } from "../../src/session/goal.sql"
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

  test("cancels only an in-progress goal", async () => {
    const sessionId = seedSession("ses_01J5Y5H0AH4Q4NXJ6P4C3P5V2Q")
    seedGoal(sessionId, "goal-cancel-active", "in_progress")

    const updated = await runGoal(
      Goal.Service.use((goal) => goal.update({ goalId: "goal-cancel-active", sessionId, status: "cancelled" })),
    )

    expect(updated.status).toBe("cancelled")
  })
})
