import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Memory } from "../../src/memory/service"
import {
  addMemoryMetadataTags,
  memoryEntitiesFromTags,
  memoryKindFromTags,
  resolveMemoryKind,
} from "../../src/memory/kind"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Database } from "../../src/storage/db"

const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

function seedProject() {
  Database.use((db) =>
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run(),
  )
}

describe("generic memory kinds", () => {
  test("classifies non-coding durable memory by intent", () => {
    expect(resolveMemoryKind({ content: "我喜欢晚上工作" })).toBe("preference")
    expect(resolveMemoryKind({ content: "上周完成了季度会议" })).toBe("episodic")
    expect(resolveMemoryKind({ content: "决定采用 A 方案" })).toBe("decision")
    expect(resolveMemoryKind({ content: "记得先复盘再写方案" })).toBe("lesson")
  })

  test("persists kind and entities as compatible tags", () => {
    const tags = addMemoryMetadataTags(["review"], "goal", [{ name: "张伟", type: "person" }])
    expect(memoryKindFromTags(tags)).toBe("goal")
    expect(memoryEntitiesFromTags(tags)).toEqual([{ name: "张伟", type: "person" }])
    expect(tags).toContain("memory-kind:goal")
    expect(tags).toContain("entity:person:张伟")
  })

  test("applied generic memory is filterable by kind and returns entities", async () => {
    seedProject()
    const candidates = await runMemory(
      Memory.Service.use((memory) =>
        memory.review({
          userContent: "记住我们决定把 NovaWay 作为主产品线",
          projectID: ProjectID.global,
          candidates: [
            {
              content: "NovaWay 是主产品线",
              kind: "decision",
              entities: [{ name: "NovaWay", type: "product" }],
              reason: "通用决策记忆",
            },
          ],
        }),
      ),
    )
    const decision = candidates.find((candidate) => candidate.content === "NovaWay 是主产品线")
    expect(decision?.kind).toBe("decision")
    expect(decision?.entities).toEqual([{ name: "NovaWay", type: "product" }])

    await runMemory(Memory.Service.use((memory) => memory.applyReviewCandidate(decision!.id)))
    const items = await runMemory(Memory.Service.use((memory) => memory.list({ kind: "decision", limit: 10 })))
    expect(items.some((item) => item.kind === "decision" && item.entities?.some((e) => e.name === "NovaWay"))).toBe(
      true,
    )
  })
})
