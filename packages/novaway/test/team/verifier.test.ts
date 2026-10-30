import { describe, expect, test } from "bun:test"
import { TeamVerifier } from "../../src/team/verifier"

const reply = (outcome: string, evidence?: string, measured = "measured") =>
  JSON.stringify({ outcome, measured, ...(evidence ? { evidence } : {}) })

describe("team.verifier", () => {
  test("defect corpus reaches the release-gate recall without killing the control group", () => {
    const score = TeamVerifier.evaluate(TeamVerifier.CORPUS)
    expect(score.missed).toEqual([])
    expect(score.killed).toEqual([])
    expect(score.recall).toBeGreaterThanOrEqual(TeamVerifier.GATE.recall)
    expect(score.falseKill).toBeLessThanOrEqual(TeamVerifier.GATE.falseKill)
    expect(TeamVerifier.gate(score).passed).toBe(true)
  })

  test("a pass without an evidence location is downgraded, not counted", () => {
    // 没有证据的「通过」是验证器在自说自话；降级成 unverified 才诚实。
    expect(TeamVerifier.interpret(reply("pass")).outcome).toBe("unverified")
    expect(TeamVerifier.interpret(reply("pass", "   ")).outcome).toBe("unverified")
    expect(TeamVerifier.interpret(reply("pass", "src/a.ts:12")).outcome).toBe("pass")
  })

  test("unparsable or unknown answers never become pass", () => {
    expect(TeamVerifier.interpret("looks good to me").outcome).toBe("unverified")
    expect(TeamVerifier.interpret("{}").outcome).toBe("unverified")
    expect(TeamVerifier.interpret(reply("maybe", "src/a.ts:1")).outcome).toBe("unverified")
    // fail 不需要证据：否定结论不会把坏东西放过去。
    expect(TeamVerifier.interpret(reply("fail")).outcome).toBe("fail")
  })

  test("a missing evidence on the control group is a false kill, not a silent pass", () => {
    const score = TeamVerifier.evaluate([{ name: "good-no-evidence", expected: "pass", reply: reply("pass") }])
    expect(score.falseKill).toBe(1)
    expect(TeamVerifier.gate(score).passed).toBe(false)
  })

  test("the prompt forbids trusting the reporter and demands evidence for pass", () => {
    const text = TeamVerifier.prompt(
      { text: "checkout rejects expired cards", expected: "402" },
      { claims: [{ text: "done", evidence: "tests pass" }, { text: "also done" }] },
    )
    expect(text).toContain("不要相信交付方的自述")
    expect(text).toContain("可复核的位置")
    expect(text).toContain("checkout rejects expired cards")
    expect(text).toContain("｜无证据")
  })
})
