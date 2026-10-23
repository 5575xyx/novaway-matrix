import { describe, expect, test } from "bun:test"
import { aiFixLabels, buildAiFixDetails, normalizePathForPrompt, tailLog } from "./ai-fix"

const labels = aiFixLabels((key, params) => {
  const map: Record<string, string> = {
    "aiFix.context.status": "Status: " + (params?.value ?? ""),
    "aiFix.context.error": "Error: " + (params?.value ?? ""),
    "aiFix.context.hint": "Hint: " + (params?.value ?? ""),
    "aiFix.context.log": "Recent log:",
  }
  return map[key] ?? key
})

describe("ai-fix context", () => {
  test("joins status, error, hint and facts in order", () => {
    const details = buildAiFixDetails(
      {
        status: "no engine",
        error: "install failed",
        hint: "check network",
        facts: { runtime: "missing", empty: "", skipped: undefined },
      },
      labels,
    )
    expect(details).toBe(
      ["Status: no engine", "Error: install failed", "Hint: check network", "- runtime: missing"].join("\n"),
    )
  })

  test("returns an empty string when there is nothing to report", () => {
    expect(buildAiFixDetails({}, labels)).toBe("")
    expect(buildAiFixDetails({ status: "   ", log: "\n" }, labels)).toBe("")
  })

  test("keeps only the tail of long logs and drops the partial first line", () => {
    const log = Array.from({ length: 500 }, (_, index) => "line " + index).join("\n")
    const trimmed = tailLog(log, 200)
    expect(trimmed.length).toBeLessThanOrEqual(200)
    expect(trimmed.startsWith("line ")).toBe(true)
    expect(trimmed).not.toContain("line 0\n")
  })

  test("short logs are returned untouched", () => {
    expect(tailLog("short log", 100)).toBe("short log")
  })

  test("appends the tail log block when a log exists", () => {
    const details = buildAiFixDetails({ log: "step 1\nstep 2" }, labels)
    expect(details).toBe("Recent log:\nstep 1\nstep 2")
  })

  test("normalizes windows paths for prompts", () => {
    expect(normalizePathForPrompt("C:\\Users\\me\\.local\\share\\novaway")).toBe("C:/Users/me/.local/share/novaway")
  })
})
