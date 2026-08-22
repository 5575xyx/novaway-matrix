import { describe, expect, test } from "bun:test"
import { evaluateEvolutionCandidate, summarizeEvolutionEval } from "../../src/evolution/eval"

describe("evolution eval", () => {
  test("accepts complete generic evolution candidates", () => {
    const results = [
      evaluateEvolutionCandidate({
        title: "每周复盘",
        kind: "habit",
        target: "weekly-review",
        content: "每周复盘：目标、决策、经验与下一步计划。",
        reason: "固化可复用的个人工作节奏。",
        expectedKind: "habit",
        requiredSections: ["每周复盘"],
      }),
      evaluateEvolutionCandidate({
        title: "客户沟通策略",
        kind: "strategy",
        target: "customer-communication",
        content: "面对客户异议时先确认需求，再给出方案。",
        reason: "提升通用业务沟通质量。",
        expectedKind: "strategy",
      }),
      evaluateEvolutionCandidate({
        title: "会议纪要模板",
        kind: "knowledge",
        target: "meeting-notes-template",
        content: "会议纪要包含结论、待办、负责人和截止时间。",
        reason: "沉淀可复用知识模板。",
        expectedKind: "knowledge",
        requiredSections: ["待办", "负责人"],
      }),
    ]
    const summary = summarizeEvolutionEval(results)
    expect(summary.valid).toBe(3)
    expect(summary.validRate).toBe(1)
  })

  test("rejects candidates missing required structure", () => {
    const result = evaluateEvolutionCandidate({
      title: "坏候选",
      kind: "strategy",
      target: "x",
      content: "短",
      reason: "",
      expectedKind: "strategy",
      requiredSections: ["结论"],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeGreaterThanOrEqual(3)
  })
})
