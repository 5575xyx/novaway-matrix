import { describe, expect, test } from "bun:test"
import {
  collectEdits,
  evaluateVerificationGate,
  isNonTrivial,
  parseVerificationReport,
  skipRequested,
  type EditRecord,
} from "../../src/session/verify-gate"

const REPORT = (verdict: string) =>
  [
    "### Check: login returns a session cookie",
    "- **Command run:** `bun test auth`",
    "- **Output observed:** `3 pass, 0 fail`",
    "- **Result:** PASS",
    "",
    "### Check: expired token is rejected",
    "- **Command run:** `bun test auth:expired`",
    "- **Output observed:** `401 Unauthorized`",
    "- **Result:** PASS",
    "",
    "### Adversarial probe: replay the cookie after logout",
    "- **Command run:** `bun test auth:replay`",
    "- **Output observed:** `rejected after logout`",
    "- **Result:** PASS",
    "",
    `VERDICT: ${verdict}`,
  ].join("\n")

describe("parseVerificationReport", () => {
  test("accepts a fully evidenced PASS with a probe", () => {
    const report = parseVerificationReport(REPORT("PASS"))
    expect(report.verdict).toBe("PASS")
    expect(report.checks).toHaveLength(3)
    expect(report.adversarialProbes).toBe(1)
    expect(report.violations).toEqual([])
  })

  test("parses multi-line fenced evidence", () => {
    const report = parseVerificationReport(
      [
        "### Check: build succeeds",
        "- **Command run:**",
        "  ```",
        "  bun run build",
        "  ```",
        "- **Output observed:**",
        "  ```",
        "  built in 1.2s",
        "  ```",
        "- **Result:** PASS",
        "",
        "### Adversarial probe: malformed input",
        "- **Command run:** `printf '{{' | bun run parse`",
        "- **Output observed:** `exit 1, no crash`",
        "- **Result:** PASS",
        "VERDICT: PASS",
      ].join("\n"),
    )
    expect(report.verdict).toBe("PASS")
    expect(report.checks[0]?.commandRun).toBe("bun run build")
    expect(report.checks[0]?.outputObserved).toBe("built in 1.2s")
  })

  test("rejects PASS without observed output", () => {
    const report = parseVerificationReport(
      [
        "### Check: it works",
        "- **Command run:** `bun test`",
        "- **Result:** PASS",
        "",
        "### Adversarial probe: try to break it",
        "- **Command run:** `bun test bad`",
        "- **Output observed:** `ok`",
        "- **Result:** PASS",
        "VERDICT: PASS",
      ].join("\n"),
    )
    expect(report.verdict).toBe("UNVERIFIED")
    expect(report.violations.join("\n")).toContain("it works")
  })

  test("rejects PASS with no independent check or probe", () => {
    const report = parseVerificationReport("Everything looks good.\n\nVERDICT: PASS")
    expect(report.verdict).toBe("UNVERIFIED")
    expect(report.violations).toContain("PASS without any `### Check:` entry")
    expect(report.violations).toContain("PASS without an adversarial probe")
  })

  test("rejects a missing verdict line", () => {
    const report = parseVerificationReport(
      "### Check: it works\n- **Command run:** `bun test`\n- **Output observed:** `ok`",
    )
    expect(report.verdict).toBe("UNVERIFIED")
    expect(report.violations[0]).toContain("VERDICT")
  })

  test("accepts translated field labels but requires the English VERDICT line", () => {
    const report = parseVerificationReport(
      [
        "### 检查: 登录返回 cookie",
        "- **执行的命令:** `bun test auth`",
        "- **观察到的输出:** `3 pass`",
        "- **结果:** PASS",
        "### 对抗性验证: 退出后重放 cookie",
        "- **执行的命令:** `bun test auth:replay`",
        "- **观察到的输出:** `rejected`",
        "- **结果:** PASS",
        "VERDICT: PASS",
      ].join("\n"),
    )
    expect(report.verdict).toBe("PASS")
    expect(report.adversarialProbes).toBe(1)
  })

  test("keeps FAIL and PARTIAL as declared", () => {
    expect(parseVerificationReport("VERDICT: FAIL").verdict).toBe("FAIL")
    expect(parseVerificationReport("VERDICT: PARTIAL").verdict).toBe("PARTIAL")
  })
})

type MsgPart = Parameters<typeof collectEdits>[0][number]["parts"][number]

const msg = (parts: MsgPart[], role = "assistant") => ({ info: { role }, parts })

const editPart = (tool: string, path: string, at: number, status = "completed") => ({
  type: "tool",
  tool,
  state: { status, input: { filePath: path }, time: { start: at - 1, end: at } },
})

describe("collectEdits", () => {
  test("only completed file-modifying calls", () => {
    const edits = collectEdits([
      msg([editPart("write", "/repo/a.ts", 10), editPart("read", "/repo/b.ts", 11)]),
      msg([editPart("edit", "/repo/c.ts", 12, "running")]),
      msg([editPart("edit", "/repo/d.ts", 13)], "user"),
    ])
    expect(edits.map((edit) => edit.path)).toEqual(["/repo/a.ts"])
  })

  test("filters by since and strips cwd", () => {
    const edits = collectEdits([msg([editPart("write", "/repo/a.ts", 10), editPart("edit", "/repo/src/b.ts", 20)])], {
      since: 15,
      cwd: "/repo",
    })
    expect(edits).toEqual([{ path: "src/b.ts", tool: "edit", at: 20 }])
  })
})

describe("isNonTrivial", () => {
  const edit = (path: string, at: number): EditRecord => ({ path, tool: "edit", at })
  test("three edits cross the threshold", () => {
    expect(isNonTrivial([edit("a.ts", 1), edit("b.ts", 2)])).toBe(false)
    expect(isNonTrivial([edit("a.ts", 1), edit("b.ts", 2), edit("c.ts", 3)])).toBe(true)
  })
  test("dependency and CI files count even as a single edit", () => {
    expect(isNonTrivial([edit("package.json", 1)])).toBe(true)
    expect(isNonTrivial([edit(".github/workflows/ci.yml", 1)])).toBe(true)
  })
})

describe("evaluateVerificationGate", () => {
  const edits = [
    { path: "src/a.ts", tool: "edit", at: 10 },
    { path: "src/b.ts", tool: "edit", at: 20 },
    { path: "src/c.ts", tool: "edit", at: 30 },
  ]
  test("skips small turns", () => {
    expect(evaluateVerificationGate({ edits: edits.slice(0, 2), verifications: [] }).action).toBe("skip")
  })
  test("requires verification for non-trivial turns", () => {
    const decision = evaluateVerificationGate({ edits, verifications: [] })
    expect(decision.action).toBe("require")
    if (decision.action !== "require") return
    expect(decision.reason).toBe("missing")
    expect(decision.message).toContain('subagent_type: "verification"')
  })
  test("a PASS after the last edit satisfies the gate", () => {
    expect(evaluateVerificationGate({ edits, verifications: [{ verdict: "PASS", completedAt: 31 }] })).toEqual({
      action: "satisfied",
      verdict: "PASS",
    })
  })
  test("a PASS before the last edit does not count", () => {
    const decision = evaluateVerificationGate({ edits, verifications: [{ verdict: "PASS", completedAt: 25 }] })
    expect(decision.action).toBe("require")
    if (decision.action !== "require") return
    expect(decision.reason).toBe("missing")
  })
  test("the latest FAIL blocks completion", () => {
    const decision = evaluateVerificationGate({
      edits,
      verifications: [{ verdict: "FAIL", completedAt: 31, summary: "logout still returns 200" }],
    })
    expect(decision.action).toBe("require")
    if (decision.action !== "require") return
    expect(decision.reason).toBe("failed")
    expect(decision.message).toContain("logout still returns 200")
  })
  test("an unevidenced PASS is treated as unverified", () => {
    const decision = evaluateVerificationGate({ edits, verifications: [{ verdict: "UNVERIFIED", completedAt: 31 }] })
    expect(decision.action).toBe("require")
    if (decision.action !== "require") return
    expect(decision.reason).toBe("unverified")
  })
  test("a running verifier is awaited instead of duplicated", () => {
    const decision = evaluateVerificationGate({
      edits,
      verifications: [{ verdict: "UNVERIFIED", completedAt: 0, running: true }],
    })
    expect(decision.action).toBe("require")
    if (decision.action !== "require") return
    expect(decision.reason).toBe("running")
  })
  test("PARTIAL is acceptable but reported as such", () => {
    expect(evaluateVerificationGate({ edits, verifications: [{ verdict: "PARTIAL", completedAt: 31 }] })).toEqual({
      action: "satisfied",
      verdict: "PARTIAL",
    })
  })
  test("respects an explicit user request to skip verification", () => {
    expect(skipRequested("改完就行，不用验证")).toBe(true)
    expect(skipRequested("Skip verification for this small change")).toBe(true)
    expect(skipRequested("please verify the login flow")).toBe(false)
    expect(evaluateVerificationGate({ edits, verifications: [], userText: "不用验证" }).action).toBe("skip")
  })
})
