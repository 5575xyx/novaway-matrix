import { describe, expect, it } from "bun:test"
import { summarize, UNVERIFIED_THRESHOLD, type Acceptance, type Verification } from "@/team/verification"

const acceptance = (id: string): Acceptance => ({
  id,
  runID: "run_1",
  specID: "spec_" + id,
  version: 1,
  text: "验收项 " + id,
  kind: "test",
})

const verification = (acceptanceID: string, outcome: "pass" | "fail", extra?: Partial<Verification>): Verification => ({
  id: "ver_" + acceptanceID + "_" + (extra?.attempt ?? 0),
  acceptanceID,
  runID: "run_1",
  attempt: 0,
  snapshotID: "snap_1",
  verifierVersion: "v1",
  outcome,
  at: 1,
  ...extra,
})

describe("verification.summarize", () => {
  it("does not turn a missing verification into pass", () => {
    const summary = summarize([acceptance("a")], [], "snap_1")
    expect(summary.unverified).toBe(1)
    expect(summary.pass).toBe(0)
    expect(summary.deliverable).toBe(false)
    expect(summary.verdict).not.toBe("complete")
  })

  it("counts stale evidence as unresolved, never as pass", () => {
    const summary = summarize([acceptance("a")], [verification("a", "pass", { snapshotID: "snap_old" })], "snap_new")
    expect(summary.stale).toBe(1)
    expect(summary.pass).toBe(0)
    expect(summary.unresolved).toBe(1)
    expect(summary.deliverable).toBe(false)
  })

  it("keeps fail and unverified counted separately", () => {
    const summary = summarize(
      [acceptance("a"), acceptance("b"), acceptance("c")],
      [verification("a", "pass"), verification("b", "fail")],
      "snap_1",
    )
    expect(summary.pass).toBe(1)
    expect(summary.fail).toBe(1)
    expect(summary.unverified).toBe(1)
    expect(summary.verdict).toBe("failed")
  })

  it("uses the latest attempt for the same acceptance", () => {
    const summary = summarize(
      [acceptance("a")],
      [verification("a", "fail", { attempt: 1, at: 10 }), verification("a", "pass", { attempt: 2, at: 20 })],
      "snap_1",
    )
    expect(summary.pass).toBe(1)
    expect(summary.verdict).toBe("complete")
  })

  it("downgrades the verdict when the unverified ratio passes the threshold", () => {
    const lines = Array.from({ length: 10 }, (_, index) => acceptance("a" + index))
    const verified = lines.slice(0, 6).map((item) => verification(item.id, "pass"))
    const summary = summarize(lines, verified, "snap_1")
    expect(summary.unresolved / summary.lines.length).toBeGreaterThan(UNVERIFIED_THRESHOLD)
    expect(summary.verdict).toBe("partial")
    expect(summary.deliverable).toBe(false)
  })

  it("refuses to call an empty acceptance set complete", () => {
    const summary = summarize([], [], "snap_1")
    expect(summary.deliverable).toBe(false)
    expect(summary.verdict).toBe("partial")
  })
})
