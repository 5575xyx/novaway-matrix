import { describe, expect, test } from "bun:test"
import { buildGraph, extractEntities } from "@/knowledge/graph"

describe("knowledge.graph", () => {
  test("extracts repeated terms and proper nouns", () => {
    const entities = extractEntities("NovaWay Agent uses NovaWay Agent runtime. 知识库检索与知识库索引。")
    expect(entities.some((item) => item.includes("NovaWay"))).toBe(true)
    expect(entities.some((item) => item.includes("知识库"))).toBe(true)
  })

  test("edges connect co-occurring entities", () => {
    const graph = buildGraph([
      {
        id: "d1",
        collectionID: "c1",
        title: "Doc",
        content: "NovaWay Agent NovaWay Agent knowledge knowledge",
      },
    ])
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.edges[0].weight).toBeGreaterThan(0)
  })

  test("empty corpus yields empty graph", () => {
    expect(buildGraph([])).toEqual({ nodes: [], edges: [] })
  })
})
