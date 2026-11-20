import { describe, expect, test } from "bun:test"
import { classify } from "../../src/workflow/policy"

describe("workflow policy classifier", () => {
  test("routes mechanical edits to L0 with one-question budget", () => {
    expect(classify("fix the typo in the README")).toEqual({ route: "l0", questionBudget: 1 })
  })

  test("routes ordinary bug fixes to L1", () => {
    expect(classify("修复登录按钮点击后没有反应的 bug")).toEqual({ route: "l1", questionBudget: 1 })
  })

  test("routes module and integration work to L2", () => {
    expect(classify("implement a new API integration module")).toEqual({ route: "l2", questionBudget: 6 })
  })

  test("routes architecture and migration work upward", () => {
    expect(classify("重构架构并执行数据库迁移")).toEqual({ route: "l3", questionBudget: 8 })
  })

  test("routes security and production incidents to L4", () => {
    expect(classify("perform a security audit for the production incident")).toEqual({ route: "l4", questionBudget: 8 })
  })

  test("keeps non-coding requests out of the coding ladder", () => {
    expect(classify("写一份产品 PRD 和运营方案")).toEqual({ route: "non-coding", questionBudget: 8 })
  })
})
