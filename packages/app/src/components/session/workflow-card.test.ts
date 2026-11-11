import { describe, expect, test } from "bun:test"
import { describeWorkflowCard } from "./workflow-card"

// 卡片同时活在两个阶段：跑着的时候只有元数据里的进度，结束后只有输出文本。
// 口径必须自洽——「3/5 步完成」配一条满格进度条，比没有进度还糟。

describe("工作流卡片", () => {
  test("跑着的时候用元数据里的进度画", () => {
    const card = describeWorkflowCard({
      input: { name: "评审本次改动" },
      status: "running",
      metadata: {
        runId: "dwfrun-1",
        progress: {
          phase: "调查",
          phaseIndex: 2,
          phaseCount: 3,
          steps: { total: 5, done: 3, failed: 1, running: 1, cached: 0 },
          reports: 2,
        },
      },
    })
    expect(card.title).toBe("评审本次改动")
    expect(card.phaseLabel).toBe("调查（2/3）")
    // 分母是「已经开始」的步数，完成 + 失败都算「结束」。
    expect(card.percent).toBe(80)
    expect(card.summary).toBe("4/5 步结束（1 步失败）")
    expect(card.reports).toBe(2)
    expect(card.running).toBe(true)
  })

  test("还没有进度时既不画进度条也不编摘要", () => {
    const card = describeWorkflowCard({
      input: { saved: "review-diff" },
      status: "pending",
      metadata: { runId: "dwfrun-2" },
    })
    expect(card.title).toBe("review-diff")
    expect(card.percent).toBe(0)
    expect(card.summary).toBeUndefined()
    expect(card.phaseLabel).toBeUndefined()
    expect(card.running).toBe(true)
  })

  test("只有一个阶段时只显示阶段名", () => {
    const card = describeWorkflowCard({
      input: {},
      metadata: { runId: "dwfrun-3", progress: { phase: "汇总", phaseIndex: 1, phaseCount: 1 } },
    })
    expect(card.phaseLabel).toBe("汇总")
    // 没有名字时退回 run id：卡片总得有个标题，假装它叫「工作流」反而不利于定位。
    expect(card.title).toBe("dwfrun-3")
  })

  test("名字两边都是空白时不算名字", () => {
    const card = describeWorkflowCard({ input: { name: "   " }, metadata: { runId: "dwfrun-4" } })
    expect(card.title).toBe("dwfrun-4")
  })

  test("结算之后不再显示为运行中", () => {
    const card = describeWorkflowCard({
      input: { name: "跑完了" },
      status: "completed",
      metadata: { runId: "dwfrun-5", progress: { steps: { total: 2, done: 2 } } },
    })
    expect(card.running).toBe(false)
    expect(card.percent).toBe(100)
    expect(card.summary).toBe("2/2 步完成")
  })

  test("恢复时缓存命中单独可见", () => {
    const card = describeWorkflowCard({
      input: {},
      metadata: { runId: "dwfrun-6", progress: { steps: { total: 4, done: 4, cached: 3 } } },
    })
    expect(card.cached).toBe(3)
  })
})
