import { describe, expect, test } from "bun:test"
import { zenActions } from "@/pages/home/zen-office"
import { officeAgentPromptDraft, officeAgentScenario } from "./office-agent-scenarios"

describe("office agent scenarios", () => {
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
