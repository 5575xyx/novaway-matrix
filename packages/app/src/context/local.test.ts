import { describe, expect, test } from "bun:test"
import { visibleAgentList } from "./local-agent"

const agents = [
  { name: "creova", mode: "primary", options: {} },
  { name: "office-ppt", mode: "primary", options: { modeGroup: "office" } },
  { name: "office-document", mode: "primary", options: { modeGroup: "office", workbench: { id: "zen" } } },
  { name: "explore", mode: "subagent", options: {} },
  { name: "hidden", mode: "primary", hidden: true, options: {} },
] as const

describe("visibleAgentList", () => {
  test("Creova mode exposes all visible primary agents, including workbench agents", () => {
    expect(visibleAgentList(agents, "forge").map((agent) => agent.name)).toEqual([
      "creova",
      "office-ppt",
      "office-document",
    ])
  })

  test("office mode exposes only office agents", () => {
    expect(visibleAgentList(agents, "zen").map((agent) => agent.name)).toEqual(["office-ppt", "office-document"])
  })

  test("no selected mode keeps the primary agent list", () => {
    expect(visibleAgentList(agents, undefined).map((agent) => agent.name)).toEqual([
      "creova",
      "office-ppt",
      "office-document",
    ])
  })
})
