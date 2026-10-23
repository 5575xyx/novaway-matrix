import { describe, expect, test } from "bun:test"
import { mergeExtracted, parseGraphJson, sharedEntities } from "@/knowledge/graph-llm"

describe("knowledge.graph-llm", () => {
  test("parses fenced JSON with string entities", () => {
    const parsed = parseGraphJson(
      '```json\n{"entities":["NovaWay","Payment Gateway"],"relations":[{"source":"NovaWay","target":"Payment Gateway","relation":"uses"}]}\n```',
    )
    expect(parsed?.entities).toEqual(["NovaWay", "Payment Gateway"])
    expect(parsed?.relations).toEqual([{ source: "NovaWay", target: "Payment Gateway", relation: "uses" }])
  })

  test("accepts entity objects and alternate relation keys", () => {
    const parsed = parseGraphJson(
      JSON.stringify({
        entities: [{ name: "Order Service" }, { name: "Inventory" }],
        relations: [{ from: "Order Service", to: "Inventory", type: "checks" }],
      }),
    )
    expect(parsed?.entities).toEqual(["Order Service", "Inventory"])
    expect(parsed?.relations[0]).toEqual({
      source: "Order Service",
      target: "Inventory",
      relation: "checks",
    })
  })

  test("returns undefined for garbage", () => {
    expect(parseGraphJson("not json")).toBeUndefined()
    expect(parseGraphJson('{"entities":[]}')).toBeUndefined()
  })

  test("merges extracted graphs with weights", () => {
    const base = {
      nodes: [{ id: "A", label: "A", type: "term" as const, documents: 1, weight: 1 }],
      edges: [],
    }
    const merged = mergeExtracted(base, [
      {
        hash: "h1",
        modelID: "llm",
        createdAt: 0,
        entities: ["A", "B"],
        relations: [{ source: "A", target: "B", relation: "uses" }],
      },
    ])
    expect(merged.nodes.find((node) => node.id === "A")?.documents).toBe(2)
    expect(merged.nodes.find((node) => node.id === "B")?.documents).toBe(1)
    expect(merged.edges[0]).toEqual({ source: "A", target: "B", weight: 2 })
  })

  test("shared entities ignore duplicates", () => {
    expect(sharedEntities({ entities: ["A", "B"] }, { entities: ["B", "B", "C"] })).toEqual(["B"])
  })
})
