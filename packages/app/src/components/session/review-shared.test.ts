import { describe, expect, test } from "bun:test"
import { formatWait, kindLabelKey } from "./review-shared"

describe("document review helpers", () => {
  test("formats the waiting time at every scale", () => {
    expect(formatWait(0)).toBe("0s")
    expect(formatWait(55_000)).toBe("55s")
    expect(formatWait(3 * 60_000 + 20_000)).toBe("3m")
    expect(formatWait(60 * 60_000)).toBe("1h")
    expect(formatWait(3600_000 + 5 * 60_000)).toBe("1h 5m")
  })

  test("never shows a negative wait when the clock drifts", () => {
    expect(formatWait(-5_000)).toBe("0s")
  })

  test("maps known kinds to their label and falls back to other", () => {
    expect(kindLabelKey("prd")).toBe("session.review.kind.prd")
    expect(kindLabelKey("plan")).toBe("session.review.kind.plan")
    expect(kindLabelKey("unknown")).toBe("session.review.kind.other")
    expect(kindLabelKey(undefined)).toBe("session.review.kind.other")
    expect(kindLabelKey(42)).toBe("session.review.kind.other")
  })
})
