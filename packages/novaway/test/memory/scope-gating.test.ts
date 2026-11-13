import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config/config"
import { Memory } from "../../src/memory/service"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { testEffect } from "../lib/effect"

function seedProjectID(id: ProjectID) {
  Database.use((db) => db.insert(ProjectTable).values({ id, worktree: "", sandboxes: [] }).onConflictDoNothing().run())
}

function seedSession(id: string) {
  const sessionID = SessionID.make(id)
  Database.use((db) => {
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run()
    db.insert(SessionTable)
      .values({
        id: sessionID,
        project_id: ProjectID.global,
        slug: id,
        directory: "",
        title: id,
        version: "test",
      })
      .onConflictDoNothing()
      .run()
  })
  return sessionID
}

const it = testEffect(
  Layer.mergeAll(
    Memory.defaultLayer,
    Layer.mock(Config.Service, {
      get: () => Effect.succeed({ memory: { embedding_mode: "off", global_enabled: false, project_enabled: true } }),
    }),
  ),
)

it.live("syncTurn skips a disabled global scope but keeps an enabled project scope", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const projectID = ProjectID.make("memory-gating-sync")
    seedProjectID(projectID)
    const sessionID = seedSession("ses_memory_gating_sync")

    yield* memory.syncTurn({
      userContent: "记住：我喜欢简洁回复 zzgatingglobal",
      assistantContent: "好的",
      projectID,
      sessionID,
    })
    yield* memory.syncTurn({
      userContent: "记住：本项目用 bun 跑测试 zzgatingproject",
      assistantContent: "好的",
      projectID,
      sessionID,
    })

    const global = yield* memory.list({ projectID, includeGlobal: true, scope: "global", limit: 1000 })
    const project = yield* memory.list({ projectID, scope: "project", limit: 1000 })
    expect(global.some((item) => item.content.includes("zzgatingglobal"))).toBe(false)
    expect(project.some((item) => item.content.includes("zzgatingproject"))).toBe(true)
  }),
)

it.live("auto-apply respects a disabled global scope while manual apply still writes", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const projectID = ProjectID.make("memory-gating-apply")
    seedProjectID(projectID)

    const candidates = yield* memory.review({
      userContent: "remember this globally across projects: reply in Simplified Chinese zzgatingapply",
      projectID,
      candidates: [{ content: "Reply in Simplified Chinese zzgatingapply.", scope: "global" }],
    })
    const candidate = candidates[0]
    expect(candidate.scope).toBe("global")

    const auto = yield* memory.applyReviewCandidate(candidate.id, undefined, { auto: true })
    expect(auto).toBeUndefined()

    const manual = yield* memory.applyReviewCandidate(candidate.id)
    expect(manual?.scope).toBe("global")
    expect(manual?.content).toContain("zzgatingapply")
  }),
)
