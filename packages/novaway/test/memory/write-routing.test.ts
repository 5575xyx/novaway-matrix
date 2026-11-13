import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Memory } from "../../src/memory/service"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"

const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

function seedProject() {
  const projectID = ProjectID.make(`write-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  Database.use((db) =>
    db.insert(ProjectTable).values({ id: projectID, worktree: "", sandboxes: [] }).onConflictDoNothing().run(),
  )
  return projectID
}

function seedSession(projectID: ProjectID) {
  const sessionID = SessionID.make(`ses-cursor-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: sessionID,
        directory: "",
        title: sessionID,
        version: "test",
      })
      .onConflictDoNothing()
      .run(),
  )
  return sessionID
}

describe("memory write-layer scope routing", () => {
  test("preferences land in global scope without an explicit override", async () => {
    const projectID = seedProject()
    const item = await runMemory(
      Memory.Service.use((memory) => memory.add({ projectID, content: "User prefers terse commit messages" })),
    )
    expect(item.scope).toBe("global")
    expect(item.projectID).toBeUndefined()
  })

  test("procedures and decisions stay project-scoped", async () => {
    const projectID = seedProject()
    const procedure = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({ projectID, content: "Release workflow: run bun typecheck before tagging" }),
      ),
    )
    expect(procedure.scope).toBe("project")
    expect(procedure.projectID).toBe(projectID)

    const decision = await runMemory(
      Memory.Service.use((memory) => memory.add({ projectID, content: "Decided to use SQLite for the local store" })),
    )
    expect(decision.scope).toBe("project")
  })

  test("an explicit scope always wins over the kind default", async () => {
    const projectID = seedProject()
    const item = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({ projectID, scope: "project", content: "User prefers tabs in this repo" }),
      ),
    )
    expect(item.scope).toBe("project")
  })

  test("session-only wording keeps session scope", async () => {
    const projectID = seedProject()
    const item = await runMemory(
      Memory.Service.use((memory) => memory.add({ projectID, content: "仅本会话记住：我偏好先跑 lint" })),
    )
    expect(item.scope).toBe("session")
  })
})

describe("memory review cursor asymmetry", () => {
  test("keeps counting after a due review that never lands, and resets after success", async () => {
    const projectID = seedProject()
    const sessionID = seedSession(projectID)
    const due = () =>
      runMemory(
        Memory.Service.use((memory) =>
          memory.reviewDue({
            userContent: "记住：游标推进用例",
            projectID,
            sessionID,
            reviewInterval: 2,
          }),
        ),
      )

    expect(await due()).toBe(false)
    expect(await due()).toBe(true)
    // 审查失败/未落库时计数不清零，下一轮仍然判定为到期，保证重试。
    expect(await due()).toBe(true)

    await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "记住：游标推进用例",
          projectID,
          sessionID,
          skipReviewState: true,
        }),
      ),
    )
    expect(await due()).toBe(false)
  })
})
