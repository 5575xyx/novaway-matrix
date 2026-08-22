import { describe, expect, test } from "bun:test"
import { ConfigMemory } from "../../src/config/memory"
import { clearEmbedderCache, denseCosine, parseEmbeddingJson, resolveEmbedder } from "../../src/memory/embedder"
import { hybridScore, mergeHybridCandidates } from "../../src/memory/search"
import type { Info } from "../../src/memory/schema"
import { MemoryID } from "../../src/memory/schema"

function mem(partial: Omit<Partial<Info>, "id"> & { id: string; content: string }): Info {
  return {
    id: MemoryID.make(partial.id.startsWith("mem") ? partial.id : `mem_${partial.id}`),
    target: "memory",
    scope: "project",
    domain: "general",
    content: partial.content,
    tags: [],
    importance: partial.importance ?? 0.5,
    confidence: 0.7,
    version: 1,
    source: "manual",
    time: { created: 1, updated: 1 },
    embedding: partial.embedding,
    embeddingModel: partial.embeddingModel,
  }
}

describe("memory embedder out-of-box strategy", () => {
  test("denseCosine is bounded and higher for similar vectors", () => {
    const a = [1, 0, 0]
    const b = [0.9, 0.1, 0]
    const c = [0, 1, 0]
    expect(denseCosine(a, b)).toBeGreaterThan(denseCosine(a, c))
    expect(denseCosine(a, a)).toBeCloseTo(1, 5)
    expect(denseCosine(a, c)).toBeGreaterThanOrEqual(0)
  })

  test("parseEmbeddingJson validates arrays", () => {
    expect(parseEmbeddingJson("[1,2,3]")).toEqual([1, 2, 3])
    expect(parseEmbeddingJson("nope")).toBeUndefined()
    expect(parseEmbeddingJson('["x"]')).toBeUndefined()
  })

  test("resolveEmbedder defaults to local without any model setup", async () => {
    clearEmbedderCache()
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const backend = await resolveEmbedder(
      ConfigMemory.resolve({
        embedding_mode: "auto",
        embedding_ollama_url: "http://127.0.0.1:9", // closed port, force miss
      }),
      { force: true },
    )
    expect(backend.kind).toBe("local")
    expect(backend.modelId).toBe("local:ngram")
    expect(backend.embed).toBeUndefined()
    expect(backend.label).toContain("本地语义")
    if (prev === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prev
  })

  test("resolveEmbedder local mode never requires external models", async () => {
    clearEmbedderCache()
    const backend = await resolveEmbedder(ConfigMemory.resolve({ embedding_mode: "local" }), { force: true })
    expect(backend.kind).toBe("local")
  })

  test("hybrid prefers dense match when embeddings exist", () => {
    const query = " unrelated query text "
    const items = [
      mem({
        id: "mem_dense",
        content: "zzzz totally different surface form",
        importance: 0.2,
        embedding: [1, 0, 0],
        embeddingModel: "openai:text-embedding-3-small",
      }),
      mem({
        id: "mem_noise",
        content: "weekly office report template",
        importance: 0.99,
      }),
    ]
    const ranked = mergeHybridCandidates({
      query,
      keywordItems: [],
      ftsIds: [],
      byId: new Map(items.map((item) => [item.id, item])),
      limit: 2,
      queryEmbedding: [1, 0, 0],
      queryEmbeddingModel: "openai:text-embedding-3-small",
    })
    expect(ranked[0]?.id).toBe(items[0].id)
    expect(
      hybridScore(query, items[0], {
        queryEmbedding: [1, 0, 0],
        queryEmbeddingModel: "openai:text-embedding-3-small",
      }),
    ).toBeGreaterThan(
      hybridScore(query, items[1], {
        queryEmbedding: [1, 0, 0],
        queryEmbeddingModel: "openai:text-embedding-3-small",
      }),
    )
  })
})
