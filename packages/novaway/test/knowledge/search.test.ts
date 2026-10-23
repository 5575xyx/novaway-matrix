import { describe, expect, test } from "bun:test"
import { chunkText, searchDocuments, tokenize } from "@/knowledge/search"

describe("knowledge.search", () => {
  test("chunks long text with overlap", () => {
    const text = Array.from({ length: 20 }, (_, index) => `Paragraph ${index} ${"x".repeat(200)}`).join("\n\n")
    const chunks = chunkText(text, { maxSize: 500, overlap: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(600)
  })

  test("tokenizes english words and chinese bigrams", () => {
    const tokens = tokenize("Deploy Pipeline 部署流水线")
    expect(tokens).toContain("deploy")
    expect(tokens).toContain("pipeline")
    expect(tokens).toContain("部署")
    expect(tokens).toContain("流水")
  })

  test("ranks the document that matches the query", () => {
    const hits = searchDocuments(
      [
        {
          id: "d1",
          collectionID: "c1",
          title: "Deployment guide",
          content: "How to deploy the service to production with rollback steps.",
        },
        {
          id: "d2",
          collectionID: "c1",
          title: "Design tokens",
          content: "Colors, spacing and typography used by the product.",
        },
        {
          id: "d3",
          collectionID: "c2",
          title: "发布流程",
          content: "线上发布前需要完成回归测试，并准备好回滚方案。",
        },
      ],
      "rollback deploy",
    )
    expect(hits[0].documentID).toBe("d1")
    expect(hits[0].snippet.toLowerCase()).toContain("rollback")
  })

  test("matches chinese queries", () => {
    const hits = searchDocuments(
      [
        { id: "d3", collectionID: "c2", title: "发布流程", content: "线上发布前需要完成回归测试，并准备好回滚方案。" },
        { id: "d4", collectionID: "c2", title: "报销制度", content: "差旅报销需要提供发票。" },
      ],
      "回滚",
    )
    expect(hits[0].documentID).toBe("d3")
  })

  test("returns nothing for an empty query", () => {
    expect(searchDocuments([], "")).toEqual([])
  })
})

describe("hybrid search", () => {
  test("fuses lexical and sparse signals", async () => {
    const { hybridSearch } = await import("@/knowledge/search")
    const hits = hybridSearch(
      [
        {
          id: "d1",
          collectionID: "c1",
          title: "Deployment runbook",
          content: "Deploy workers safely, then verify the release and rollback plan.",
        },
        {
          id: "d2",
          collectionID: "c1",
          title: "Design notes",
          content: "Colour tokens and spacing for the dashboard.",
        },
      ],
      "release rollback",
    )
    expect(hits[0].documentID).toBe("d1")
    expect(hits[0].score).toBeGreaterThan(0)
    expect(hits[0].score).toBeLessThanOrEqual(1)
  })

  test("dense vector path participates in fusion", async () => {
    const { hybridSearch } = await import("@/knowledge/search")
    const documents = [
      { id: "d1", collectionID: "c1", title: "A", content: "alpha beta gamma" },
      { id: "d2", collectionID: "c1", title: "B", content: "delta epsilon" },
    ]
    // query 与两篇都没有关键词/稀疏命中，只有稠密一路有信号。
    const hits = hybridSearch(documents, "zzz", { dense: [0.9, 0.1] })
    expect(hits[0].documentID).toBe("d1")
  })
})

describe("incremental chunk cache", () => {
  test("reuses chunks for unchanged documents and rebuilds changed ones", async () => {
    const { indexChunks } = await import("@/knowledge/search")
    const cache = new Map<string, { hash: string; chunks: any[] }>()
    const stable = {
      id: "d1",
      collectionID: "c1",
      title: "Stable",
      content: "alpha beta gamma",
      hash: "h1",
    }
    const changing = {
      id: "d2",
      collectionID: "c1",
      title: "Changing",
      content: "delta epsilon",
      hash: "h2",
    }

    const first = indexChunks([stable, changing], cache)
    const firstChunks = cache.get("d1")!.chunks
    expect(first.length).toBe(2)

    // 只有 d2 变了：d1 必须复用同一份切片对象，d2 重新生成。
    const second = indexChunks([stable, { ...changing, content: "zeta eta", hash: "h3" }], cache)
    expect(cache.get("d1")!.chunks).toBe(firstChunks)
    expect(cache.get("d2")!.hash).toBe("h3")
    expect(second.find((item) => item.documentID === "d2")!.text).toContain("zeta")
  })

  test("does not cache documents without a hash", async () => {
    const { indexChunks } = await import("@/knowledge/search")
    const cache = new Map<string, { hash: string; chunks: any[] }>()
    indexChunks([{ id: "d1", collectionID: "c1", title: "T", content: "body" }], cache)
    expect(cache.size).toBe(0)
  })

  test("evicts least recently used documents", async () => {
    const { indexChunks } = await import("@/knowledge/search")
    const cache = new Map<string, { hash: string; chunks: any[] }>()
    for (const id of ["a", "b", "c"]) {
      indexChunks([{ id, collectionID: "c1", title: id, content: id + " body", hash: id }], cache, 2)
    }
    expect(cache.size).toBe(2)
    expect(cache.has("a")).toBe(false)
  })
})
