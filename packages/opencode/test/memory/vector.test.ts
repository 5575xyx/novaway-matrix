import { describe, expect, test } from "bun:test"
import { cosineSimilarity, semanticScore, semanticSimilarity, textVector } from "../../src/memory/vector"
import { hybridScore, mergeHybridCandidates } from "../../src/memory/search"
import type { Info } from "../../src/memory/schema"
import { MemoryID } from "../../src/memory/schema"

function mem(input: {
  id: string
  content: string
  summary?: string
  tags?: string[]
  importance?: number
  confidence?: number
  updated?: number
}): Info {
  return {
    id: MemoryID.make(input.id.startsWith("mem") ? input.id : `mem_${input.id}`),
    target: "memory",
    scope: "project",
    domain: "general",
    content: input.content,
    summary: input.summary,
    tags: input.tags ?? [],
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.7,
    version: 1,
    source: "manual",
    time: { created: 1, updated: input.updated ?? 1 },
  }
}

describe("memory local semantic vectors", () => {
  test("similar chinese phrases score higher than unrelated text", () => {
    const q = "项目统一使用 Bun 管理依赖"
    const related = semanticSimilarity(q, "这个仓库的包管理器统一采用 Bun")
    const unrelated = semanticSimilarity(q, "数据库迁移使用 Drizzle 和 SQL")
    expect(related).toBeGreaterThan(unrelated)
    expect(related).toBeGreaterThan(0.12)
  })

  test("textVector is L2-normalized", () => {
    const vec = textVector("package manager bun monorepo")
    let norm = 0
    for (const value of vec.values()) norm += value * value
    expect(Math.abs(Math.sqrt(norm) - 1)).toBeLessThan(1e-6)
  })

  test("cosineSimilarity is symmetric and bounded", () => {
    const a = textVector("office meeting minutes")
    const b = textVector("meeting minutes and action items")
    const ab = cosineSimilarity(a, b)
    const ba = cosineSimilarity(b, a)
    expect(ab).toBeCloseTo(ba, 8)
    expect(ab).toBeGreaterThanOrEqual(0)
    expect(ab).toBeLessThanOrEqual(1)
  })

  test("hybrid merge promotes same-language paraphrase without exact keyword match", () => {
    const query = "this repository package manager is bun"
    const items = [
      mem({
        id: "mem_semantic",
        content: "repo installs dependencies with bun rather than npm",
        importance: 0.35,
      }),
      mem({
        id: "mem_noise",
        content: "weekly office report template should lead with conclusions",
        importance: 0.95,
      }),
    ]
    const byId = new Map(items.map((item) => [item.id, item]))
    const ranked = mergeHybridCandidates({
      query,
      keywordItems: [],
      ftsIds: [],
      byId,
      limit: 2,
    })
    expect(ranked[0]?.id).toBe(items[0].id)
    expect(semanticScore(query, items[0])).toBeGreaterThan(semanticScore(query, items[1]))
    expect(hybridScore(query, items[0])).toBeGreaterThan(hybridScore(query, items[1]))
  })
})
