import { describe, expect, test } from "bun:test"
import {
  backgroundJobStat,
  formatElapsed,
  hideTeamMemberJobs,
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

  test("drops subagent jobs already shown in the team roster", () => {
    const rows = [
      job({ id: "ses_worker", metadata: { sessionId: "ses_worker" } }),
      // 后台命令也带 sessionId，但它不在团队卡片里，必须保留
      job({ id: "job_shell", type: "shell", metadata: { sessionId: "ses_worker" } }),
      job({ id: "ses_other" }),
    ]

    expect(hideTeamMemberJobs(rows, new Set(["ses_worker"])).map((item) => item.id)).toEqual([
      "job_shell",
      "ses_other",
    ])
    // 没有团队成员时原样返回
    expect(hideTeamMemberJobs(rows, new Set()).map((item) => item.id)).toEqual([
      "ses_worker",
      "job_shell",
      "ses_other",
    ])
  })

  test("elapsed formatting", () => {
    expect(formatElapsed(0, undefined, 45_000)).toBe("45s")
    expect(formatElapsed(0, undefined, 125_000)).toBe("2m 5s")
    expect(formatElapsed(0, undefined, 3_725_000)).toBe("1h 2m")
  })

  // 回归：卡片里写的是 `Number(job.completed_at)`，运行中的任务传进来的是 `NaN` 而不是 `undefined`。
  // 之前判 `end === undefined` 会把 `NaN` 当成结束时间、算出 0 秒，
  // 于是运行中的任务永远显示 `0s`，点一次停止（completed_at 变成真实时间戳）才正常。
  test("elapsed survives the Number(undefined) -> NaN coercion from the call site", () => {
    expect(formatElapsed(1_000, Number(undefined), 46_000)).toBe("45s")
    expect(formatElapsed(1_000, NaN, 46_000)).toBe("45s")
    // 结束后定格在 completed_at，不再跟随 now 增长
    expect(formatElapsed(1_000, 121_000, 999_000)).toBe("2m 0s")
  })
})
