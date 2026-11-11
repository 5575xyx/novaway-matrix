/**
 * 动态工作流的运行卡片：把工具元数据里的进度快照折成可以直接渲染的东西。
 *
 * 为什么不直接读总线事件：工具行是「这次调用」的视图，而事件流是「这次 run」的视图。
 * 一张卡片要同时活着于运行中（只有元数据在推）、结束后（只有输出文本）两个阶段，
 * 所以它的输入必须是从工具调用本身拿得到的：input（作者给的参数）+ metadata（进度）+ output。
 *
 * 这里只做纯计算，不碰 DOM、不读时间，方便单测钉住口径：进度百分比、阶段标签、
 * 状态词三者在任何组合下都要自洽——「已完成 3/5」却画一条满格进度条，比没有进度还糟。
 */

/** 工具元数据里的进度快照（结构见 `novaway/src/dynamic-workflow/progress.ts`）。 */
export type ProgressSnapshot = {
  phase?: string
  phaseIndex?: number
  phaseCount?: number
  steps?: {
    total?: number
    done?: number
    failed?: number
    running?: number
    cached?: number
  }
  reports?: number
}

export type WorkflowCardState = "pending" | "running" | "completed" | "stopped" | "errored" | "invalid"

export type WorkflowCard = {
  /** 显示用的名字：作者给的名字优先，其次是保存的工作流名，最后退回 run id。 */
  title: string
  /** 阶段标签，例如「调查（2/3）」。没有阶段信息时缺席。 */
  phaseLabel?: string
  /** 进度百分比；没有节点信息时为 0（界面不该画一条假的满格）。 */
  percent: number
  /** 一句计数摘要，例如「3/5 步完成」。 */
  summary?: string
  /** 报告条数。 */
  reports: number
  /** 恢复时命中缓存的步数：直接回答「这次省下了多少」。 */
  cached: number
  failed: number
  running: boolean
}

/** 工具状态（part.state.status）与结算状态（metadata.status）都要看。 */
export function describeWorkflowCard(input: {
  input: Record<string, unknown>
  metadata: Record<string, any>
  status?: string
}): WorkflowCard {
  const progress = (input.metadata?.progress ?? {}) as ProgressSnapshot
  const steps = progress.steps ?? {}
  const total = Math.max(0, steps.total ?? 0)
  const done = Math.max(0, steps.done ?? 0)
  const failed = Math.max(0, steps.failed ?? 0)

  const name =
    typeof input.input?.name === "string" && input.input.name.trim() !== ""
      ? input.input.name.trim()
      : typeof input.input?.saved === "string" && input.input.saved.trim() !== ""
        ? input.input.saved.trim()
        : typeof input.metadata?.runId === "string"
          ? input.metadata.runId
          : "工作流"

  const phase = progress.phase
  const index = progress.phaseIndex
  const count = progress.phaseCount ?? 0
  const phaseLabel =
    phase === undefined ? undefined : index !== undefined && count > 1 ? `${phase}（${index}/${count}）` : phase

  // 分母只用「已经开始」的步数，不用「总共会有多少」：引擎在扇出之前并不知道总数，
  // 编一个估计值会让进度条先冲到 80% 再倒回去。宁可它是一段一段往前，也不能倒退。
  const percent = total === 0 ? 0 : Math.min(100, Math.round(((done + failed) / total) * 100))

  const running = input.status === "pending" || input.status === "running"
  const summary =
    total === 0
      ? undefined
      : failed > 0
        ? `${done + failed}/${total} 步结束（${failed} 步失败）`
        : `${done}/${total} 步完成`

  return {
    title: name,
    ...(phaseLabel ? { phaseLabel } : {}),
    percent,
    ...(summary ? { summary } : {}),
    reports: Math.max(0, progress.reports ?? 0),
    cached: Math.max(0, steps.cached ?? 0),
    failed,
    running,
  }
}
