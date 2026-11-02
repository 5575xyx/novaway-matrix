import { describe, expect, it } from "bun:test"
import { interpret } from "@/team/structure"
import type { Acceptance } from "@/team/verification"
import type { Report } from "@/team/orchestrator"

const acceptance = (kind: Acceptance["kind"]): Pick<Acceptance, "kind" | "text" | "expected"> => ({
  kind,
  text: "改动说明包含可复核的位置",
})

const report = (claims: Report["claims"]): Pick<Report, "claims"> => ({ claims })

describe("light-tier structural verification", () => {
  it("passes only when every cited location exists, and says no semantics were judged", () => {
    const result = interpret({
      acceptance: acceptance("file"),
      report: report([
        { text: "补了回归", evidence: "src/team/worktree.ts:42" },
        { text: "也改了测试", evidence: "test/team/economy.test.ts:1" },
      ]),
      changed: ["src/team/worktree.ts"],
      exists: () => true,
    })
    expect(result.outcome).toBe("pass")
    expect(result.measured).toContain("未做语义判断")
    expect(result.evidenceRef).toBe("src/team/worktree.ts:42")
  })

  it("never turns missing evidence into a pass", () => {
    const result = interpret({
      acceptance: acceptance("file"),
      report: report([{ text: "做完了" }]),
      changed: [],
      exists: () => true,
    })
    expect(result.outcome).toBe("unverified")
    expect(result.measured).toContain("path:line")
  })

  it("treats a missing file as unverified, not as a failure", () => {
    const result = interpret({
      acceptance: acceptance("file"),
      report: report([{ text: "补了", evidence: "src/gone.ts:3" }]),
      changed: [],
      exists: () => false,
    })
    expect(result.outcome).toBe("unverified")
    expect(result.measured).toContain("不存在")
  })

  it("requires diff evidence to be part of this round's changes", () => {
    const result = interpret({
      acceptance: acceptance("diff"),
      report: report([{ text: "改了", evidence: "src/old.ts:3" }]),
      changed: ["src/new.ts"],
      exists: () => true,
    })
    expect(result.outcome).toBe("unverified")
    expect(result.measured).toContain("不在本次改动里")
  })

  it("ignores absolute paths, URLs and traversal", () => {
    const result = interpret({
      acceptance: acceptance("file"),
      report: report([{ text: "证据", evidence: "/etc/passwd:1 https://example.com/x.ts:1 ../../secret.ts:2" }]),
      changed: [],
      exists: () => true,
    })
    expect(result.outcome).toBe("unverified")
  })
})
