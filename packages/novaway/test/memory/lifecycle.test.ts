import { describe, expect, test, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "../../src/config/config"
import * as Embedder from "../../src/memory/embedder"
import { testEffect } from "../lib/effect"
import { MemoryID } from "../../src/memory/schema"
import { SessionID } from "../../src/session/schema"
import { Memory } from "../../src/memory/service"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Database } from "../../src/storage/db"
import { deriveFactKey } from "../../src/memory/fact"
import { classifyMemoryDomain } from "../../src/memory/domain"
import { sanitizeFtsQuery } from "../../src/memory/search"

const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

function seedProjectID(id: ProjectID) {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id,
        worktree: "",
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run(),
  )
}

const it = testEffect(
  Layer.mergeAll(
    Memory.defaultLayer,
    Layer.mock(Config.Service, { get: () => Effect.succeed({ memory: { embedding_mode: "off" } }) }),
  ),
)

it.live("effective off config reaches both write paths and search embedding", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const projectID = ProjectID.make("memory-config-off")
    seedProjectID(projectID)
    const embed = spyOn(Embedder, "embedText")
    try {
      const first = yield* memory.add({
        projectID,
        content: "off config first",
        factKey: "off-config",
        scope: "project",
      })
      const second = yield* memory.add({
        projectID,
        content: "off config second",
        factKey: "off-config",
        scope: "project",
      })
      yield* memory.list({ projectID, search: "off" })
      yield* memory.list({ projectID, search: "zzzznomatchingtoken" })
      expect(first.embedding).toBeUndefined()
      expect(second.embedding).toBeUndefined()
      expect(embed.mock.calls.length).toBeGreaterThanOrEqual(4)
      expect(embed.mock.calls.every(([cfg]) => cfg.embedding_mode === "off")).toBe(true)
    } finally {
      embed.mockRestore()
    }
  }),
)

it.live("ID reads enforce project, global, session and active-memory boundaries", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const projectID = ProjectID.make("memory-read-current")
    const otherProject = ProjectID.make("memory-read-other")
    seedProjectID(projectID)
    seedProjectID(otherProject)
    const own = yield* memory.add({ projectID, scope: "project", content: "own readable fact" })
    const other = yield* memory.add({
      projectID: otherProject,
      scope: "project",
      content: "private other project fact",
    })
    const global = yield* memory.add({ scope: "global", target: "user", content: "global readable profile" })
    const sessionID = SessionID.make("ses_read_scope")
    // Session references are optional here; other-session access is tested by scope denial.
    expect(yield* memory.read({ id: own.id, projectID })).toEqual(own)
    expect(yield* memory.read({ id: other.id, projectID, includeGlobal: true })).toBeUndefined()
    expect(yield* memory.read({ id: global.id, projectID })).toBeUndefined()
    expect(yield* memory.read({ id: global.id, projectID, sessionID, includeGlobal: true })).toEqual(global)
    expect(yield* memory.read({ id: own.id, projectID, scope: "global" })).toBeUndefined()
    expect(yield* memory.read({ id: own.id, projectID, target: "user" })).toBeUndefined()
    expect(yield* memory.read({ id: MemoryID.make("mem_missing"), projectID })).toBeUndefined()
    yield* memory.update({ id: own.id, archived: true })
    expect(yield* memory.read({ id: own.id, projectID })).toBeUndefined()
    yield* memory.remove(global.id)
  }),
)

it.live("prefetch supplements unrelated global profiles with an independent query", () =>
  Effect.gen(function* () {
    const memory = yield* Memory.Service
    const profile = yield* memory.add({
      scope: "global",
      target: "user",
      content: "prefer concise replies",
      importance: 1,
    })
    const text = yield* memory.prefetch({
      query: "zzzzunrelatedquery",
      projectID: ProjectID.make("memory-config-off"),
      sessionID: SessionID.make("ses_memory_prefetch"),
    })
    expect(text).toContain(profile.id)
    yield* memory.remove(profile.id)
  }),
)

describe("memory lifecycle & hybrid helpers", () => {
  test("deriveFactKey normalizes package manager switches", () => {
    expect(deriveFactKey("project switched to bun package manager")).toContain("bun")
    expect(deriveFactKey("prefer pnpm")).toContain("pnpm")
  })

  test("classifyMemoryDomain covers non-coding domains", () => {
    expect(classifyMemoryDomain("prepare meeting minutes and weekly report slides")).toBe("office")
    expect(classifyMemoryDomain("I prefer concise Chinese replies")).toBe("personal")
    expect(classifyMemoryDomain("research competitor memory systems")).toBe("research")
    expect(classifyMemoryDomain("this repo uses Bun monorepo")).toBe("coding")
  })

  test("sanitizeFtsQuery keeps searchable terms", () => {
    const q = sanitizeFtsQuery("user preference Chinese reply remember")
    expect(q.includes("user") || q.includes("preference") || q.includes("Chinese")).toBe(true)
  })

  test("add with same factKey supersedes previous memory", async () => {
    const projectID = ProjectID.make("memory-lifecycle-project")
    seedProjectID(projectID)
    const first = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          projectID,
          content: "package manager uses pnpm",
          factKey: "package-manager",
          domain: "coding",
          scope: "project",
          importance: 0.8,
        }),
      ),
    )
    const second = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          projectID,
          content: "package manager switched to bun",
          factKey: "package-manager",
          domain: "coding",
          scope: "project",
          operation: "update",
          importance: 0.9,
        }),
      ),
    )

    expect(second.version).toBe((first.version ?? 1) + 1)
    expect(second.supersedesID).toBe(first.id)
    expect(second.content).toContain("bun")

    const active = await runMemory(
      Memory.Service.use((memory) =>
        memory.list({
          projectID,
          limit: 50,
        }),
      ),
    )
    expect(active.some((item) => item.id === second.id)).toBe(true)
    expect(active.some((item) => item.id === first.id)).toBe(false)

    const archived = await runMemory(
      Memory.Service.use((memory) =>
        memory.list({
          projectID,
          includeArchived: true,
          limit: 50,
        }),
      ),
    )
    const old = archived.find((item) => item.id === first.id)
    expect(old?.time.archived).toBeDefined()
  })

  test("confirm operation refreshes confidence without creating a new row", async () => {
    const projectID = ProjectID.make("memory-confirm-project")
    seedProjectID(projectID)
    const created = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          projectID,
          content: "office docs should start with conclusions",
          factKey: "office-conclusion-first",
          domain: "office",
          scope: "global",
          confidence: 0.6,
        }),
      ),
    )
    const confirmed = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          projectID,
          content: "office docs should start with conclusions",
          factKey: "office-conclusion-first",
          domain: "office",
          scope: "global",
          operation: "confirm",
          confidence: 0.9,
        }),
      ),
    )
    expect(confirmed.id).toBe(created.id)
    expect(confirmed.confidence).toBeGreaterThanOrEqual(0.9)
    expect(confirmed.time.lastConfirmed).toBeDefined()
  })
})
