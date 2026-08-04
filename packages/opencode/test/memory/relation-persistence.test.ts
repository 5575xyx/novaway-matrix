import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Memory } from "../../src/memory/service"
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

describe("memory relation persistence", () => {
  test("writes relationship edges and refreshes them on update", async () => {
    seedProject()
    const item = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          content: "张伟是 NovaWay 的客户",
          scope: "global",
          kind: "relationship",
          entities: [
            { name: "张伟", type: "person" },
            { name: "NovaWay", type: "product" },
          ],
        }),
      ),
    )

    const relations = await runMemory(Memory.Service.use((memory) => memory.relationsForMemory(item.id)))
    expect(relations).toHaveLength(1)
    expect(relations[0]).toMatchObject({ source: "张伟", relation: "是", target: "NovaWay" })

    const byEntity = await runMemory(Memory.Service.use((memory) => memory.listRelations({ entity: "NovaWay" })))
    expect(byEntity.some((relation) => relation.memoryID === item.id)).toBe(true)

    const updated = await runMemory(
      Memory.Service.use((memory) =>
        memory.update({
          id: item.id,
          content: "张伟是 NovaWay 的合作伙伴",
          kind: "relationship",
          entities: [
            { name: "张伟", type: "person" },
            { name: "NovaWay", type: "product" },
          ],
        }),
      ),
    )
    const refreshed = await runMemory(Memory.Service.use((memory) => memory.relationsForMemory(updated!.id)))
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]).toMatchObject({ source: "张伟", relation: "是", target: "NovaWay" })
  })

  test("removes relation edges when the source memory is deleted", async () => {
    seedProject()
    const item = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          content: "李雷负责 NovaWay 项目",
          scope: "global",
          kind: "relationship",
          entities: [
            { name: "李雷", type: "person" },
            { name: "NovaWay", type: "product" },
          ],
        }),
      ),
    )
    await runMemory(Memory.Service.use((memory) => memory.remove(item.id)))
    const remaining = await runMemory(Memory.Service.use((memory) => memory.relationsForMemory(item.id)))
    expect(remaining).toHaveLength(0)
  })

  test("adds and removes manual relations", async () => {
    seedProject()
    const item = await runMemory(
      Memory.Service.use((memory) =>
        memory.add({
          content: "NovaWay 主产品线",
          scope: "global",
          kind: "semantic",
          entities: [{ name: "NovaWay", type: "product" }],
        }),
      ),
    )
    const created = await runMemory(
      Memory.Service.use((memory) =>
        memory.addRelation({
          memoryID: item.id,
          source: "NovaWay",
          relation: "由",
          target: "NovaWay 团队",
          targetType: "team",
        }),
      ),
    )
    expect(created?.source).toBe("NovaWay")
    expect(created?.target).toBe("NovaWay 团队")

    const removed = await runMemory(Memory.Service.use((memory) => memory.removeRelation(created!.id)))
    expect(removed).toBe(true)
    const remaining = await runMemory(Memory.Service.use((memory) => memory.relationsForMemory(item.id)))
    expect(remaining).toHaveLength(0)
  })
})
