import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  applyRelevanceKeep,
  formatIndexLine,
  isToolGuide,
  selectPrefetchItems,
  stalenessNote,
} from "../../src/memory/prefetch"
import { Memory } from "../../src/memory/service"
import type { Info } from "../../src/memory/schema"
import { MemoryID } from "../../src/memory/schema"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function mem(partial: Partial<Info> & Pick<Info, "id" | "content" | "scope" | "target">): Info {
  return {
    tags: [],
    importance: 0.5,
    confidence: 0.7,
    domain: "general",
    version: 1,
    source: "manual",
    time: { created: NOW, updated: NOW },
    ...partial,
  }
}

describe("memory prefetch staleness", () => {
  test("notes memories stale after two weeks", () => {
    const fresh = mem({ id: MemoryID.make("mem_1"), content: "fresh", scope: "project", target: "memory" })
    expect(stalenessNote(fresh, NOW)).toBeUndefined()

    const stale = mem({
      id: MemoryID.make("mem_2"),
      content: "stale",
      scope: "project",
      target: "memory",
      time: { created: NOW - 30 * DAY, updated: NOW - 20 * DAY },
    })
    expect(stalenessNote(stale, NOW)).toBe("20 天前，使用前先核实")
  })

  test("prefers the last confirmation over the update time", () => {
    const item = mem({
      id: MemoryID.make("mem_3"),
      content: "confirmed yesterday",
      scope: "project",
      target: "memory",
      time: { created: NOW - 60 * DAY, updated: NOW - 30 * DAY, lastConfirmed: NOW - DAY },
    })
    expect(stalenessNote(item, NOW)).toBeUndefined()
  })

  test("formatIndexLine renders the note unless disabled", () => {
    const item = mem({
      id: MemoryID.make("mem_4"),
      content: "old convention",
      scope: "project",
      target: "memory",
      time: { created: NOW - 30 * DAY, updated: NOW - 21 * DAY },
    })
    expect(formatIndexLine(item, { now: NOW })).toContain("21 天前，使用前先核实")
    expect(formatIndexLine(item, { now: NOW, staleness: false })).not.toContain("使用前先核实")
  })
})

describe("memory prefetch tool-guide suppression", () => {
  const guide = mem({
    id: MemoryID.make("mem_guide"),
    content: "工具调用参数：shell 需要 command 与 workdir",
    scope: "project",
    target: "memory",
    kind: "procedure",
  })
  const fact = mem({
    id: MemoryID.make("mem_fact"),
    content: "本项目使用 bun 跑测试",
    scope: "project",
    target: "memory",
  })

  test("only flags procedure entries that explain tool usage", () => {
    expect(isToolGuide(guide)).toBe(true)
    expect(isToolGuide(fact)).toBe(false)
  })

  test("drops tool guides only when a live tool schema is present", () => {
    const query = "调用 shell 工具传入参数"
    const withSchema = selectPrefetchItems(query, [guide, fact], { hasLiveToolSchema: true, limit: 10 })
    expect(withSchema.map((item) => item.id)).not.toContain(guide.id)
    const withoutSchema = selectPrefetchItems(query, [guide], { limit: 10 })
    expect(withoutSchema.map((item) => item.id)).toContain(guide.id)
  })
})

describe("memory relevance keep mapping", () => {
  const items = ["a", "b", "c"].map((name) =>
    mem({ id: MemoryID.make(`mem_${name}`), content: name, scope: "project", target: "memory" }),
  )

  test("maps indexes back to entries and ignores out-of-range values", () => {
    expect(applyRelevanceKeep(items, [2, 0, 9, -1, 1.5]).map((item) => item.content)).toEqual(["a", "c"])
  })

  test("deduplicates repeated indexes", () => {
    expect(applyRelevanceKeep(items, [1, 1, 1]).map((item) => item.content)).toEqual(["b"])
  })
})

describe("memory prefetch relevance filter", () => {
  const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
    Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

  function seed() {
    const projectID = ProjectID.make(`prefetch-filter-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    Database.use((db) =>
      db.insert(ProjectTable).values({ id: projectID, worktree: "", sandboxes: [] }).onConflictDoNothing().run(),
    )
    return projectID
  }

  async function add(projectID: ProjectID, content: string) {
    await runMemory(
      Memory.Service.use((memory) => memory.add({ projectID, scope: "project", content, summary: content })),
    )
  }

  test("keeps only the entries the selector approves", async () => {
    const projectID = seed()
    for (const name of ["kept", "dropped-one", "dropped-two", "dropped-three"]) {
      await add(projectID, `${name} uses zquality tokens`)
    }

    const context = await runMemory(
      Memory.Service.use((memory) =>
        memory.prefetch({
          query: "zquality tokens",
          projectID,
          sessionID: SessionID.make("ses_prefetch_filter_keep"),
          limit: 10,
          relevanceFilter: (items) => Effect.succeed(items.filter((item) => item.content.startsWith("kept"))),
        }),
      ),
    )
    expect(context).toContain("kept uses zquality tokens")
    expect(context).not.toContain("dropped-one")
  })

  test("falls back to the unfiltered pool when the selector fails", async () => {
    const projectID = seed()
    for (const name of ["alpha", "beta", "gamma", "delta"]) {
      await add(projectID, `${name} mentions zfallback hosts`)
    }

    const context = await runMemory(
      Memory.Service.use((memory) =>
        memory.prefetch({
          query: "zfallback hosts",
          projectID,
          sessionID: SessionID.make("ses_prefetch_filter_fallback"),
          limit: 10,
          relevanceFilter: () => Effect.fail(new Error("selector unavailable")),
        }),
      ),
    )
    expect(context).toContain("alpha mentions zfallback hosts")
    expect(context).toContain("delta mentions zfallback hosts")
  })
})
