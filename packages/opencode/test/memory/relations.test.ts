import { describe, expect, test } from "bun:test"
import { detectRelationConflicts, findRelatedMemories, listRelationsFromMemory } from "../../src/memory/relations"
import { MemoryID } from "../../src/memory/schema"
import type { Info } from "../../src/memory/schema"

function memory(input: {
  id: string
  content: string
  entities?: Array<{ name: string; type?: string }>
  kind?: Info["kind"]
}): Info {
  return {
    id: MemoryID.make(input.id),
    target: "memory",
    scope: "global",
    domain: "general",
    kind: input.kind ?? "relationship",
    entities: input.entities ?? [],
    content: input.content,
    summary: undefined,
    tags: [],
    importance: 0.7,
    confidence: 0.8,
    version: 1,
    source: "manual",
    time: { created: 1, updated: 1 },
  }
}

describe("memory relations", () => {
  test("extracts entity-relation-entity edges from relationship memories", () => {
    const edges = listRelationsFromMemory([
      memory({
        id: "mem_rel_customer",
        content: "张伟是 NovaWay 的客户",
        entities: [
          { name: "张伟", type: "person" },
          { name: "NovaWay", type: "product" },
        ],
      }),
      memory({
        id: "mem_rel_owner",
        content: "李雷负责 NovaWay 项目",
        entities: [
          { name: "李雷", type: "person" },
          { name: "NovaWay", type: "product" },
        ],
      }),
    ])
    expect(edges).toHaveLength(2)
    expect(edges[0]).toMatchObject({ source: "张伟", relation: "是", target: "NovaWay" })
    expect(edges[1]).toMatchObject({ source: "李雷", relation: "负责", target: "NovaWay" })
  })

  test("finds related memories by entity and relation", () => {
    const items = [
      memory({
        id: "mem_rel_customer",
        content: "张伟是 NovaWay 的客户",
        entities: [
          { name: "张伟", type: "person" },
          { name: "NovaWay", type: "product" },
        ],
      }),
      memory({
        id: "mem_rel_owner",
        content: "李雷负责 NovaWay 项目",
        entities: [
          { name: "李雷", type: "person" },
          { name: "NovaWay", type: "product" },
        ],
      }),
    ]
    expect(findRelatedMemories(items, "NovaWay")).toHaveLength(2)
    expect(findRelatedMemories(items, "NovaWay", "负责")).toHaveLength(1)
    expect(findRelatedMemories(items, "张伟")[0]?.target).toBe("NovaWay")
  })

  test("detects duplicate and conflicting relations", () => {
    const edges = [
      {
        source: "张伟",
        relation: "是",
        target: "NovaWay",
        memoryID: "mem_rel_customer",
        context: "张伟是 NovaWay 的客户",
      },
    ]
    expect(detectRelationConflicts(edges, { source: "张伟", relation: "是", target: "NovaWay" })[0]?.kind).toBe(
      "duplicate",
    )
    expect(detectRelationConflicts(edges, { source: "张伟", relation: "负责", target: "NovaWay" })[0]?.kind).toBe(
      "conflict",
    )
  })
})
