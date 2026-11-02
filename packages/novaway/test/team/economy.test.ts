import { describe, expect, it } from "bun:test"
import {
  classify,
  crossModule,
  estimate,
  irreversibleChange,
  moduleRoots,
  plan,
  violations,
  type Facts,
} from "@/team/economy"

const base: Facts = { kind: "file", paths: 1 }

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

  it("uses the light tier only for small, structurally checkable changes", () => {
    expect(classify(base).tier).toBe("light")
    expect(classify({ kind: "test", paths: 1, hasCommand: true }).tier).toBe("light")
    expect(classify({ kind: "test", paths: 5, hasAffectedTests: true, hasCommand: true }).tier).toBe("medium")
    expect(classify({ kind: "test", paths: 5, hasCommand: true }).tier).toBe("medium")
  })

  it("does not call a test light when there is nothing cheap to run", () => {
    // 没有可执行命令时，「结构校验」证明不了测试通过：升到中档做语义复核。
    const decision = classify({ kind: "test", paths: 1 })
    expect(decision.tier).toBe("medium")
    expect(decision.reason).toContain("没有可执行的测试命令")
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

describe("facts read from paths, not from self-description", () => {
  it("counts a monorepo package as one module", () => {
    expect(moduleRoots(["packages/app/a.ts", "packages/app/b.ts"])).toEqual(["packages/app"])
    expect(crossModule(["packages/app/a.ts", "packages/app/b.ts"])).toBe(false)
    expect(crossModule(["packages/app/a.ts", "packages/novaway/b.ts"])).toBe(true)
    expect(crossModule(["src/a.ts", "src/deep/b.ts"])).toBe(false)
    expect(crossModule(["src/a.ts", "docs/x.md"])).toBe(true)
  })

  it("treats lockfiles and migrations as irreversible", () => {
    expect(irreversibleChange(["bun.lock"])).toBe(true)
    expect(irreversibleChange(["packages/novaway/migration/001/migration.sql"])).toBe(true)
    expect(irreversibleChange(["src/team/run.ts"])).toBe(false)
  })
})
