import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
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
