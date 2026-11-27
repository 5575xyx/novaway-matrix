import { describe, expect, test } from "bun:test"
import { agentDescription, agentDisplayName } from "./agent"

describe("agent display localization", () => {
  test("localizes namespaced Agency ids", () => {
    expect(agentDisplayName("academic/academic-anthropologist")).toBe("人类学研究员")
    expect(agentDisplayName("engineering/engineering-frontend-developer")).toContain("前端")
  })

  test("uses Chinese summaries for Agency employees", () => {
    expect(agentDescription("academic/academic-geographer", "An academic geography specialist", { category: "学术研究" })).toContain(
      "学术研究",
    )
  })
})
