import { describe, expect, test } from "bun:test"
import { RunProgress, createProgressPump, type RunProgressSnapshot } from "../../src/dynamic-workflow/progress"
import type { RunEvent } from "../../src/dynamic-workflow/engine/types"

// 工具元数据是 run 跑着的时候唯一能往前端推东西的口子。三件事必须钉住：
// 计数口径（report 不算一步）、节流（不每个事件都重绘）、终态（结算那次一定推）。

const runId = "dwfrun-progress"

const started = (siteId: string, kind: "ask" | "world-read" | "report" = "ask"): RunEvent => ({
  type: "node-started",
  runId,
  instance: { siteId, ordinal: 1 },
  kind,
})

const settled = (
  siteId: string,
  kind: "ask" | "world-read" | "report" = "ask",
  status = "completed",
  cached = false,
): RunEvent => ({
  type: "node-settled",
  runId,
  instance: { siteId, ordinal: 1 },
  kind,
  status: status as "completed" | "failed",
  ...(cached ? { cached: true } : {}),
})

const phase = (name: string): RunEvent => ({ type: "phase-entered", runId, name })
const report = (): RunEvent => ({ type: "report", runId, instance: { siteId: "report#1", ordinal: 1 }, item: {} })

/** 手动触发的调度器：测试里不必和真实时间赛跑，但 `cancel` 必须真的取消。 */
function manualPump(phases: string[]) {
  const pushed: RunProgressSnapshot[] = []
  const queued: Array<{ run: () => void; cancelled: boolean }> = []
  const pump = createProgressPump({
    progress: new RunProgress(phases),
    push: (snapshot) => pushed.push(snapshot),
    intervalMs: 250,
    schedule: (run) => {
      queued.push({ run, cancelled: false })
      return queued.at(-1)!
    },
    cancel: (handle) => {
      ;(handle as { cancelled: boolean }).cancelled = true
    },
  })
  /** 把当前排着的那一次跑掉（被取消的就跳过）。 */
  const tick = () => {
    const next = queued.shift()
    if (next && !next.cancelled) next.run()
  }
  return { pump, pushed, tick, queued }
}

describe("运行进度", () => {
  test("阶段名与序号来自脚本里的阶段表", () => {
    const progress = new RunProgress(["调查", "评审", "汇总"])
    expect(progress.snapshot()).toEqual({
      phaseCount: 3,
      steps: { total: 0, done: 0, failed: 0, running: 0, cached: 0 },
      reports: 0,
    })
    progress.apply(phase("评审"))
    expect(progress.snapshot().phase).toBe("评审")
    expect(progress.snapshot().phaseIndex).toBe(2)
    // 重复进入同一阶段不是变化：界面不用重绘。
    expect(progress.apply(phase("评审"))).toBe(false)
  })

  test("ask 与 world-read 都算一步，report 不算", () => {
    const progress = new RunProgress([])
    progress.apply(started("ask#1"))
    progress.apply(started("world-read#1", "world-read"))
    // report 的起止在同一个同步块里发生，混进 steps 会让进度条瞬间跳满。
    progress.apply(started("report#1", "report"))
    progress.apply(settled("report#1", "report"))
    progress.apply(report())

    const snapshot = progress.snapshot()
    expect(snapshot.steps).toEqual({ total: 2, done: 0, failed: 0, running: 2, cached: 0 })
    expect(snapshot.reports).toBe(1)
  })

  test("结算往上数，缓存命中单独记一栏", () => {
    const progress = new RunProgress([])
    progress.apply(started("ask#1"))
    progress.apply(started("ask#2"))
    progress.apply(started("ask#3"))
    progress.apply(settled("ask#1"))
    progress.apply(settled("ask#2", "ask", "completed", true))
    progress.apply(settled("ask#3", "ask", "failed"))

    expect(progress.snapshot().steps).toEqual({ total: 3, done: 2, failed: 1, running: 0, cached: 1 })
  })
})

describe("进度推送", () => {
  test("第一条事件立刻推，之后按间隔攒起来", () => {
    const { pump, pushed, tick, queued } = manualPump(["调查"])
    pump.apply(phase("调查"))
    // 第一条马上出现：调用方刚挂上工具行，晚 250ms 才看到阶段名是没必要的。
    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.phase).toBe("调查")

    pump.apply(started("ask#1"))
    pump.apply(settled("ask#1"))
    // 间隔内的变化攒着，一个定时器都没多开。
    expect(pushed).toHaveLength(1)
    expect(queued).toHaveLength(1)

    tick()
    expect(pushed).toHaveLength(2)
    expect(pushed[1]!.steps).toMatchObject({ total: 1, done: 1 })
    pump.stop()
  })

  test("结算时强制推一次，哪怕刚推过", () => {
    const { pump, pushed } = manualPump([])
    pump.apply(started("ask#1"))
    expect(pushed).toHaveLength(1)
    pump.flush()
    expect(pushed).toHaveLength(2)
    expect(pushed[1]!.steps.running).toBe(1)
    pump.stop()
  })

  test("stop 之后不再推，也不留定时器", () => {
    const { pump, pushed, tick, queued } = manualPump([])
    pump.apply(started("ask#1"))
    pump.apply(settled("ask#1"))
    pump.stop()
    tick()
    expect(pushed).toHaveLength(1)
    expect(queued).toHaveLength(0)
  })
})
