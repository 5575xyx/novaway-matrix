/**
 * 执行进度：把引擎事件折成一个可以随时塞进工具元数据的小快照。
 *
 * 为什么需要它：`create_workflow` 会一直阻塞到 run 结束——一次跑几分钟的话，界面上那
 * 一行工具调用就只有「执行中」三个字。作者写了三个阶段、扇出了八个子代理，用户却看不到
 * 走到了哪一步。工具元数据是唯一能在不结束调用的情况下往前端推送东西的口子。
 *
 * 三条纪律：
 *   - **小**：快照只带计数与当前阶段名，绝不带报告正文或结果（那些走总线事件）。
 *   - **有节奏**：每来一条事件就推一次，每秒几十次会让工具行不停重绘。默认 250ms 一次，
 *     并把间隔内的变化攒到下一次；结算那一刻强制推一次，保证终态是准的。
 *   - **不阻塞**：推送走的是旁路，失败就放弃这一次，绝不让 run 等它。
 */

import type { RunEvent } from "./engine/types"

/** 一次 run 此刻的样子。字段全是计数或名字，可以直接进工具元数据。 */
export interface RunProgressSnapshot {
  /** 当前阶段名（还没进过任何阶段时缺席）。 */
  readonly phase?: string
  /** 当前阶段是第几个（从 1 起）。 */
  readonly phaseIndex?: number
  /** 脚本里一共几个阶段。 */
  readonly phaseCount: number
  readonly steps: {
    /** 已经开始的节点数（`ask` 与 `world-read`；`report` 不算一步）。 */
    readonly total: number
    readonly done: number
    readonly failed: number
    readonly running: number
    /** 其中直接从 journal 拿回来的（恢复时才有）。 */
    readonly cached: number
  }
  /** 到达过的 `report` 条数。 */
  readonly reports: number
}

/**
 * 把事件流折成快照。
 *
 * 只认 `node-started` / `node-settled` / `phase-entered` / `report` 四种：它们才是「进度」。
 * `log` 是旁白，`run-started` / `run-settled` 改的是整次 run 的态，都不在这里。
 */
export class RunProgress {
  private readonly phases: readonly string[]
  private entered: string | undefined
  private total = 0
  private done = 0
  private failed = 0
  private cached = 0
  private reports = 0

  constructor(phases: readonly string[]) {
    this.phases = phases
  }

  /** 吃一条事件。返回是否真的改了快照（没改就不用重推）。 */
  apply(event: RunEvent): boolean {
    switch (event.type) {
      case "phase-entered":
        if (this.entered === event.name) return false
        this.entered = event.name
        return true
      case "node-started":
        // `report` 不算「走了一步」：它是脚本顺手交出的结论，不是一次耗时的工作。
        // 混进 steps 会让进度条在一次密集 report 的循环里瞬间跳满，看起来像跑完了。
        if (event.kind === "report") return false
        this.total += 1
        return true
      case "node-settled":
        if (event.kind === "report") return false
        if (event.status === "completed") this.done += 1
        else if (event.status === "failed") this.failed += 1
        if (event.cached) this.cached += 1
        return true
      case "report":
        this.reports += 1
        return true
      default:
        return false
    }
  }

  snapshot(): RunProgressSnapshot {
    const index = this.entered === undefined ? -1 : this.phases.indexOf(this.entered)
    return {
      ...(this.entered !== undefined ? { phase: this.entered } : {}),
      ...(index >= 0 ? { phaseIndex: index + 1 } : {}),
      phaseCount: this.phases.length,
      steps: {
        total: this.total,
        done: this.done,
        failed: this.failed,
        running: Math.max(0, this.total - this.done - this.failed),
        cached: this.cached,
      },
      reports: this.reports,
    }
  }
}

export interface ProgressPump {
  /** 吃一条引擎事件。 */
  apply(event: RunEvent): void
  /** 立刻推一次当前状态（结算时用）。 */
  flush(): void
  /** 停掉定时器。run 结束之后必须调用，否则测试里会留下未清理的 timer。 */
  stop(): void
}

/**
 * 带节流的推送器。
 *
 * 定时器是注入的：测试里换成手动触发，就不用 `setTimeout` 与真实时间赛跑。
 */
export function createProgressPump(input: {
  readonly progress: RunProgress
  readonly push: (snapshot: RunProgressSnapshot) => void
  readonly intervalMs?: number
  readonly schedule?: (run: () => void, ms: number) => unknown
  readonly cancel?: (handle: unknown) => void
}): ProgressPump {
  const interval = input.intervalMs ?? 250
  const schedule = input.schedule ?? ((run, ms) => setTimeout(run, ms))
  const cancel = input.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let handle: unknown
  let dirty = false

  const fire = () => {
    handle = undefined
    if (!dirty) return
    dirty = false
    input.push(input.progress.snapshot())
  }

  const arm = () => {
    if (handle !== undefined) return
    handle = schedule(fire, interval)
  }

  return {
    apply(event) {
      const changed = input.progress.apply(event)
      if (!changed) return
      dirty = true
      // 第一条事件立刻推：调用方刚把工具行挂上去，晚 250ms 才出现阶段名是没必要的。
      if (handle === undefined) fire()
      arm()
    },
    flush() {
      if (handle !== undefined) {
        cancel(handle)
        handle = undefined
      }
      // 结算时无论有没有「变化」都推最后一次：前面被节流吞掉的那次可能就是终态。
      dirty = false
      input.push(input.progress.snapshot())
    },
    stop() {
      if (handle === undefined) return
      cancel(handle)
      handle = undefined
    },
  }
}
