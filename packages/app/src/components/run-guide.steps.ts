/**
 * 使用引导的步骤状态推导（§4.3）。
 *
 * 抽成纯函数是因为这段规则最容易变：新增一个状态、调整「批准」与「执行」的分界，
 * 界面就会整条错位。测试直接喂状态进去，不用渲染整个看板。
 *
 * 五步的顺序是产品约定，不按后端状态名排序：
 * 写目标 → 批准 → 执行 → 看结论 → 合并。
 */

export type GuideStepState = "done" | "current" | "todo" | "attention"

export type GuideStepId = "goal" | "approve" | "execute" | "verdict" | "merge"

export type GuideState = { id: GuideStepId; state: GuideStepState }

const TERMINAL = new Set(["done", "partial", "failed", "exceeded", "cancelled"])
/** 只有「交付成立」的两个终态可以合并；失败/取消/超预算的结论不能当成可交付物。 */
const DELIVERED = new Set(["done", "partial"])

const MAX_STEPS: GuideStepId[] = ["goal", "approve", "execute", "verdict", "merge"]

export function guideStates(input: {
  state: string
  mergeState?: string
  /** 这次运行有没有验收项：没有验收就无从谈「怎样算做到」。 */
  accepted: boolean
  /** 有没有留下可合并的分支：没有就不显示「合并」这一步。 */
  hasWorktrees: boolean
}): GuideState[] {
  const terminal = TERMINAL.has(input.state)
  const delivered = DELIVERED.has(input.state)
  const approved = input.state !== "planning" && input.state !== "awaiting_approval"
  const all: Record<GuideStepId, GuideStepState> = {
    // 有验收项就说明目标写清楚了；已批准则更不必说（批准覆盖的就是这份目标与验收）。
    goal: input.accepted || approved ? "done" : "current",
    approve: approved ? "done" : input.state === "awaiting_approval" ? "current" : "todo",
    execute: terminal ? "done" : approved ? "current" : "todo",
    // 结论已经出来但交付不成立：不是完成，是需要人处理。
    verdict: delivered ? "done" : terminal ? "attention" : "todo",
    merge: input.mergeState === "merged" ? "done" : delivered ? "current" : "todo",
  }
  return MAX_STEPS.filter((id) => id !== "merge" || input.hasWorktrees).map((id) => ({ id, state: all[id] }))
}
