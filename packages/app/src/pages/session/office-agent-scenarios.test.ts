import { describe, expect, test } from "bun:test"
import { zenActions } from "@/pages/home/zen-office"
import { installedOfficeAgent, officeAgentPromptDraft, officeAgentScenario } from "./office-agent-scenarios"

describe("office agent scenarios", () => {
  test("只路由到已激活且场景匹配的办公插件", () => {
    const agents = [
      { name: "office-ppt", mode: "primary", options: {} },
      {
        name: "office-suite_office-document",
        mode: "primary",
        options: { modeGroup: "office", scene: "document", defaultSkill: "office-suite_office-document" },
      },
      {
        name: "office-suite_office-ppt",
        mode: "primary",
        options: { modeGroup: "office", scene: "ppt", defaultSkill: "office-suite_office-ppt" },
      },
    ]
    expect(installedOfficeAgent([], "ppt")).toBeUndefined()
    expect(installedOfficeAgent(agents.slice(0, 2), "ppt")).toBeUndefined()
    expect(installedOfficeAgent(agents, "ppt")?.name).toBe("office-suite_office-ppt")
    expect(
      installedOfficeAgent(
        agents.map((agent) => ({ ...agent, hidden: true })),
        "ppt",
      ),
    ).toBeUndefined()
    expect(
      installedOfficeAgent(
        agents.map((agent) => ({ ...agent, mode: "subagent" })),
        "ppt",
      ),
    ).toBeUndefined()
    expect(installedOfficeAgent([agents[2]!, { ...agents[2]!, name: "other_ppt" }], "ppt", "other_ppt")?.name).toBe(
      "other_ppt",
    )
  })

  test("keeps every zen office action backed by scenario details", () => {
    for (const action of zenActions) {
      const scenario = officeAgentScenario(action.id)

      expect(scenario.intent.length).toBeGreaterThan(0)
      expect(scenario.workflow.length).toBeGreaterThanOrEqual(4)
      expect(scenario.inputFocus.length).toBeGreaterThanOrEqual(4)
      expect(scenario.attachmentHints.length).toBeGreaterThanOrEqual(4)
      expect(scenario.deliverables.length).toBeGreaterThanOrEqual(4)
      expect(scenario.outputFocus.length).toBeGreaterThanOrEqual(4)
      expect(scenario.qualityChecks.length).toBeGreaterThanOrEqual(3)
      expect(scenario.reviewQuestions.length).toBeGreaterThanOrEqual(3)
      expect(scenario.memoryFocus.length).toBeGreaterThanOrEqual(4)
      expect(scenario.quickPrompts.length).toBeGreaterThanOrEqual(3)
      expect(scenario.agentName).toBe(scenario.skillName)
      expect(scenario.skillName).toMatch(/^office-/)
    }
  })

  test("creates a concise visible prompt draft without leaking internal instructions", () => {
    const draft = officeAgentPromptDraft("ppt", "生成项目汇报 PPT")

    expect(draft).toBe("生成项目汇报 PPT")
    expect(draft).not.toContain("办公场景")
    expect(draft).not.toContain("绑定 Skill")
    expect(draft).not.toContain("质量检查")
  })
})
