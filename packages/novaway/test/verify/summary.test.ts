import { describe, expect, test } from "bun:test"
import { parseSummary, summarize, tail } from "@/verify/summary"

describe("verify.summary", () => {
  test("parses jest counts", () => {
    const parsed = parseSummary("Tests:       1 failed, 12 passed, 13 total")
    expect(parsed.failed).toBe(1)
    expect(parsed.passed).toBe(12)
  })

  test("parses vitest counts", () => {
    const parsed = parseSummary("Tests  2 failed | 10 passed (12)")
    expect(parsed.failed).toBe(2)
    expect(parsed.passed).toBe(10)
  })

  test("parses pytest counts", () => {
    const parsed = parseSummary("===== 1 failed, 7 passed, 2 skipped in 0.42s =====")
    expect(parsed.failed).toBe(1)
    expect(parsed.passed).toBe(7)
    expect(parsed.skipped).toBe(2)
  })

  test("parses cargo counts", () => {
    const parsed = parseSummary("test result: FAILED. 4 passed; 1 failed; 0 ignored")
    expect(parsed.passed).toBe(4)
    expect(parsed.failed).toBe(1)
  })

  test("collects failing case names", () => {
    const parsed = parseSummary(["FAIL  src/a.test.ts > adds numbers", "--- FAIL: TestLogin (0.01s)"].join("\n"))
    expect(parsed.failures).toContain("src/a.test.ts > adds numbers")
    expect(parsed.failures).toContain("TestLogin (0.01s)")
  })

  test("summarizes pass and failure", () => {
    expect(summarize({ output: "Tests  5 passed (5)", exitCode: 0 })).toMatchObject({
      ok: true,
      passed: 5,
      summary: "5 passed",
    })
    expect(summarize({ output: "", exitCode: 2 })).toMatchObject({ ok: false, summary: "failed (exit 2)" })
    expect(summarize({ output: "", exitCode: null, timedOut: true })).toMatchObject({
      ok: false,
      summary: "timed out",
    })
  })

  test("tails long output", () => {
    const output = Array.from({ length: 200 }, (_, index) => "line " + index).join("\n")
    const result = tail(output, 10)
    expect(result.startsWith("...(truncated)")).toBe(true)
    expect(result).toContain("line 199")
  })
})
