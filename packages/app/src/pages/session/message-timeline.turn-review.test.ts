import { afterEach, describe, expect, test } from "bun:test"
import { approveTurn, isTurnApproved, turnDiffSignature, undoTurnApproval } from "./message-timeline.turn-review"

const key = "novaway-turn-review.v1"
const diffs = [{ file: "page.html", additions: 1, deletions: 1, patch: "-old\n+new" }]

afterEach(() => localStorage.removeItem(key))

describe("local turn review", () => {
  test("records approval for only the chosen session and turn", () => {
    expect(isTurnApproved("session", "turn", diffs)).toBe(false)
    expect(approveTurn("session", "turn", diffs)).toBe(true)
    expect(isTurnApproved("session", "turn", diffs)).toBe(true)
    expect(isTurnApproved("other", "turn", diffs)).toBe(false)
    expect(isTurnApproved("session", "other", diffs)).toBe(false)
    expect(undoTurnApproval("session", "turn")).toBe(true)
    expect(isTurnApproved("session", "turn", diffs)).toBe(false)
  })

  test("invalidates approval when patch changes without changing line counts", () => {
    approveTurn("session", "turn", diffs)
    const changed = [{ ...diffs[0], patch: "-old\n+different" }]
    expect(turnDiffSignature(changed)).not.toBe(turnDiffSignature(diffs))
    expect(isTurnApproved("session", "turn", changed)).toBe(false)
  })

  test("handles corrupted or obsolete persisted data", () => {
    for (const raw of ["null", "[]", "broken", '{"session/turn":{"signature":"old"}}']) {
      localStorage.setItem(key, raw)
      expect(isTurnApproved("session", "turn", diffs)).toBe(false)
      expect(approveTurn("session", "turn", diffs)).toBe(true)
      expect(isTurnApproved("session", "turn", diffs)).toBe(true)
    }
  })
})
