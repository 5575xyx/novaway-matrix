import { describe, expect, test } from "bun:test"
import { nextRun, nextRunAt, parse, validate } from "../../src/cron/cron"

const at = (iso: string) => new Date(iso)

describe("cron.parse", () => {
  test("expands wildcards, steps, ranges and lists", () => {
    const fields = parse("*/15 9-17 * * 1-5")
    expect(fields).toBeDefined()
    expect(fields!.minute).toEqual([0, 15, 30, 45])
    expect(fields!.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(fields!.dayOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(parse("0 9 1,15 * *")!.dayOfMonth).toEqual([1, 15])
    expect(parse("0 0 * * 7")!.dayOfWeek).toEqual([0])
  })

  test("rejects malformed expressions", () => {
    for (const value of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "0 0 0 * *", "abc * * * *"]) {
      expect(parse(value)).toBeUndefined()
    }
  })

  test("validate returns a readable error", () => {
    expect(validate("*/5 * * * *")).toBeUndefined()
    expect(validate("nope")).toContain("Invalid cron expression")
  })
})

describe("cron.nextRun", () => {
  test("finds the next matching minute", () => {
    const next = nextRun(parse("30 14 * * *")!, at("2026-03-10T09:00:00"))
    expect(next).toEqual(at("2026-03-10T14:30:00"))
  })

  test("is strictly after the given time", () => {
    const next = nextRun(parse("30 14 * * *")!, at("2026-03-10T14:30:00"))
    expect(next).toEqual(at("2026-03-11T14:30:00"))
  })

  test("walks across day boundaries for weekday schedules", () => {
    // 2026-03-13 is a Friday; the next weekday 09:00 is Monday the 16th.
    const next = nextRun(parse("0 9 * * 1-5")!, at("2026-03-13T10:00:00"))
    expect(next).toEqual(at("2026-03-16T09:00:00"))
  })

  test("uses OR semantics when both day fields are constrained", () => {
    // "the 1st of the month, or any Monday" at 08:00
    const next = nextRun(parse("0 8 1 * 1")!, at("2026-03-02T00:00:00"))
    expect(next).toEqual(at("2026-03-02T08:00:00")) // Monday
  })

  test("nextRunAt accepts a string expression", () => {
    const next = nextRunAt("*/5 * * * *", at("2026-03-10T09:02:00"))
    expect(next).toBe(at("2026-03-10T09:05:00").getTime())
    expect(nextRunAt("bogus", new Date())).toBeUndefined()
  })
})
