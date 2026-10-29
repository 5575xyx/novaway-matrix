import { describe, expect, test } from "bun:test"
import { TeamVerifier } from "../../src/team/verifier"

const reply = (outcome: string, evidence?: string, measured = "measured") =>
  JSON.stringify({ outcome, measured, ...(evidence ? { evidence } : {}) })

/**
 * §19.3 的缺陷注入集与对照组。
 *
 * 样本本身是「验证器会怎么回答」：有缺陷的历史 diff 应得到 fail，
 * 对照组应得到带证据的 pass。门禁看的是**读回结果**之后还不还成立 ——
 * 解析不了、没有证据的通过都不能算抓到/放过，这正是回归要防的失效方式。
 */
const BAD = [
  "missing tests for the new branch",
  "error path still swallows the exception",
  "config default flipped silently",
  "acceptance changed to match the code",
  "unrelated file rewritten",
  "regression test deleted",
  "hard-coded value instead of reading config",
  "race left unguarded",
  "log line leaks the token",
  "migration missing the rollback",
].map((name, index) => ({
  name: "bad-" + index,
  expected: "fail" as const,
  reply: reply("fail", undefined, name),
}))

const GOOD = Array.from({ length: 20 }, (_, index) => ({
  name: "good-" + index,
  expected: "pass" as const,
  // 对照组每条都带可复核的证据位置：不带证据的 pass 会被降级，不计入通过。
  reply: reply("pass", "src/checkout/flow.ts:" + (index + 1) + " + tests/checkout.test.ts"),
}))

describe("team.verifier", () => {
  test("defect corpus reaches the release-gate recall without killing the control group", () => {
    const score = TeamVerifier.evaluate([...BAD, ...GOOD])
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
