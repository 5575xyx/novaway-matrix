import { describe, expect, it } from "bun:test"
import { classify, estimate, plan, violations, type Facts } from "@/team/economy"

const base: Facts = { kind: "test", paths: 1 }

describe("verification economy", () => {
  it("never lets a merged acceptance be anything but heavy", () => {
    expect(classify({ ...base, merged: true }).tier).toBe("heavy")
  })

  it("escalates irreversible and cross-module work to heavy", () => {
    expect(classify({ ...base, irreversible: true }).tier).toBe("heavy")
    expect(classify({ ...base, crossModule: true }).tier).toBe("heavy")
  })

  it("keeps subjective acceptance above the light tier", () => {
    expect(classify({ ...base, kind: "rubric" }).tier).toBe("medium")
    expect(classify({ ...base, kind: "human" }).tier).toBe("medium")
  })

  it("uses the light tier only for small, verifiable changes", () => {
    expect(classify(base).tier).toBe("light")
    expect(classify({ kind: "test", paths: 5, hasAffectedTests: true }).tier).toBe("medium")
    expect(classify({ kind: "test", paths: 5 }).tier).toBe("medium")
  })

  it("flags a tier that does not match the facts", () => {
    const facts: Facts[] = [
      { ...base, merged: true },
      { ...base, irreversible: true },
      { ...base, kind: "rubric" },
    ]
    const downgraded = plan(facts).map(() => ({ tier: "light" as const, reason: "自报" }))
    const codes = violations(downgraded, facts).map((item) => item.code)
    expect(codes).toContain("merged-must-be-heavy")
    expect(codes).toContain("irreversible-must-not-be-light")
    expect(codes).toContain("subjective-must-not-be-light")
  })

  it("reports the distribution instead of a single number", () => {
    expect(estimate(plan([base, { ...base, merged: true }]))).toEqual({ light: 1, medium: 0, heavy: 1 })
  })
})
