import { describe, expect, test } from "bun:test"
import { formatRelativeTime } from "./relative-time"

const t = (key: string, p?: Record<string, string | number>) => `${key}:${p?.count ?? ""}`
const now = 1_000_000_000_000

describe("formatRelativeTime", () => {
  test("buckets by seconds / minutes / hours / days / weeks", () => {
    expect(formatRelativeTime(now - 30_000, now, t)).toBe("time.now:0")
    expect(formatRelativeTime(now - 5 * 60_000, now, t)).toBe("time.minute:5")
    expect(formatRelativeTime(now - 3 * 3_600_000, now, t)).toBe("time.hour:3")
    expect(formatRelativeTime(now - 2 * 86_400_000, now, t)).toBe("time.day:2")
    expect(formatRelativeTime(now - 3 * 7 * 86_400_000, now, t)).toBe("time.week:3")
  })

  test("returns empty for missing or future timestamps", () => {
    expect(formatRelativeTime(undefined, now, t)).toBe("")
    expect(formatRelativeTime(now + 60_000, now, t)).toBe("")
  })
})
