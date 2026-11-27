import { describe, expect, test } from "bun:test"
import { shouldNotifyTeamRun } from "./notification.logic"

describe("team-run background notifications", () => {
  test("notifies once for every attention state edge", () => {
    for (const state of ["done", "partial", "failed", "needs_review", "blocked"]) {
      expect(shouldNotifyTeamRun({ initialized: false, previous: "running", state })).toBe(false)
      expect(shouldNotifyTeamRun({ initialized: true, previous: "running", state })).toBe(true)
      expect(shouldNotifyTeamRun({ initialized: true, previous: state, state })).toBe(false)
    }
  })

  test("ignores non-attention progress states and unknown initial runs", () => {
    expect(shouldNotifyTeamRun({ initialized: true, state: "running" })).toBe(false)
    expect(shouldNotifyTeamRun({ initialized: true, state: "done" })).toBe(false)
    expect(shouldNotifyTeamRun({ initialized: true, previous: "planning", state: "working" })).toBe(false)
  })
})
