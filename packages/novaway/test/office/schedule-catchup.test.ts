import { describe, expect, test } from "bun:test"

/**
 * 定时任务的补跑与并发策略。
 *
 * 这里测的是纯计算部分（补跑次数），调度器本身依赖 InstanceState，
 * 集成测试在 office/platform.test.ts 里。
 */

type Trigger =
  | { type: "interval"; minutes: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; dayOfWeek: number; time: string }
  | { type: "monthly"; dayOfMonth: number; time: string }
  | { type: "days"; everyDays: number; time: string }

/** 与 office/platform 中 catchUpCount 的周期口径保持一致。 */
function periodOf(trigger: Trigger) {
  switch (trigger.type) {
    case "interval":
      return Math.max(trigger.minutes, 1) * 60_000
    case "weekly":
      return 7 * 24 * 60 * 60_000
    case "monthly":
      return 30 * 24 * 60 * 60_000
    case "days":
      return Math.max(trigger.everyDays, 1) * 24 * 60 * 60_000
    default:
      return 24 * 60 * 60_000
  }
}

function catchUp(nextRunAt: number, now: number, trigger: Trigger) {
  if (!(nextRunAt < now)) return 0
  return Math.floor((now - nextRunAt) / periodOf(trigger))
}

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

describe("schedule catch-up", () => {
  test("no catch-up when the schedule is not overdue", () => {
    expect(catchUp(1000, 500, { type: "daily", time: "09:00" })).toBe(0)
  })

  test("counts missed days for a daily schedule", () => {
    expect(catchUp(0, 3 * DAY, { type: "daily", time: "09:00" })).toBe(3)
  })

  test("counts missed intervals", () => {
    expect(catchUp(0, 90 * 60_000, { type: "interval", minutes: 30 })).toBe(3)
  })

  test("clamps interval period to at least one minute", () => {
    expect(catchUp(0, 10 * 60_000, { type: "interval", minutes: 0 })).toBe(10)
  })

  test("counts missed weeks and months", () => {
    expect(catchUp(0, 2 * 7 * DAY, { type: "weekly", dayOfWeek: 1, time: "09:00" })).toBe(2)
    expect(catchUp(0, 60 * DAY, { type: "monthly", dayOfMonth: 1, time: "09:00" })).toBe(2)
  })

  test("counts missed multi-day intervals", () => {
    expect(catchUp(0, 9 * DAY, { type: "days", everyDays: 3, time: "09:00" })).toBe(3)
  })

  test("a single overdue run counts as zero missed periods", () => {
    // 刚过点 1 小时：还没跨过一个完整周期，按 1 次正常执行处理。
    expect(catchUp(DAY - HOUR, DAY, { type: "daily", time: "09:00" })).toBe(0)
  })
})
