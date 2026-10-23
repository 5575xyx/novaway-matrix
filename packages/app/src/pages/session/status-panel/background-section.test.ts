import { describe, expect, test } from "bun:test"
import {
  backgroundJobStat,
  formatElapsed,
  isJobVisible,
  visibleBackgroundJobs,
  type BackgroundJob,
} from "./background-section-model"

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: "job_1",
  type: "task",
  status: "running",
  started_at: 1_000,
  ...over,
})

describe("background section model", () => {
  test("running jobs are always visible", () => {
    expect(isJobVisible(job(), 10_000)).toBe(true)
  })

  test("finished jobs disappear after the grace period", () => {
    const done = job({ status: "completed", completed_at: 5_000 })
    expect(isJobVisible(done, 30_000)).toBe(true)
    expect(isJobVisible(done, 200_000)).toBe(false)
  })

  test("running jobs sort before finished ones", () => {
    const rows = visibleBackgroundJobs(
      [
        job({ id: "done", status: "completed", started_at: 9_000, completed_at: 9_500 }),
        job({ id: "run", started_at: 1_000 }),
      ],
      10_000,
    )
    expect(rows.map((item) => item.id)).toEqual(["run", "done"])
  })

  test("summary counts running and total", () => {
    expect(
      backgroundJobStat([job({ id: "a" }), job({ id: "b", status: "completed", completed_at: 9_500 })], 10_000),
    ).toBe("1/2")
  })

  test("elapsed formatting", () => {
    expect(formatElapsed(0, undefined, 45_000)).toBe("45s")
    expect(formatElapsed(0, undefined, 125_000)).toBe("2m 5s")
    expect(formatElapsed(0, undefined, 3_725_000)).toBe("1h 2m")
  })
})
