import { BLOCKING_KINDS, type BlockerKind } from "./blockers"
import type { RunState } from "./run"

/**
 * 运行指标（§12）：本地统计，不上报，不排名。
 *
 * 只回答「这批运行发生了什么」，不回答「谁更好」—— 那是 §12.1 明确禁止的。
 * 三条口径写死在这里，界面照抄即可：
 *
 * 1. **未知不并入已知。** 用量不明的运行单独计数，不摊进已结算；
 *    没有提供方回报就是缺失，不估算、不补零。
 * 2. **分母不够就不给百分比。** 失败尝试率只看有事件记录的运行；一次派发都没有时
 *    这个数就是「不知道」，而不是 0%。
 * 3. **算不出来的指标要明说。** 验证开销占比需要把「验证花的钱」和「成员花的钱」
 *    分开，而账本按团队汇总、两者用同一个 actor —— 这里不编一个比例，列进
 *    `unavailable` 并写清原因。
 */

export type RunSample = {
  id: string
  state: RunState
  roundMain: number
  attempts: { business: number; formatRetry: number }
  /** 落库的用量快照（运行时写的，读的时候按不可信输入处理）。 */
  usage?: Record<string, unknown>
  createdAt: number
}

export type EventSample = { kind: string; payload?: Record<string, unknown> }

export type Sample = { run: RunSample; events: readonly EventSample[] }

export type Report = {
  window: {
    runs: number
    /** 有事件记录的运行数：百分比类指标的分母是它，不是全部运行。 */
    eventsCovered: number
    from?: number
    to?: number
  }
  states: Array<{ state: RunState; runs: number }>
  tokens: {
    settled: number
    /** 用量不明（按预占额上界），**不**计入 settled。 */
    unknown: number
    /** 有用量快照的运行数：覆盖率。 */
    covered: number
    overrunRuns: number
  }
  rounds: Array<{ round: number; runs: number }>
  rework: { total: number; top: Array<{ reason: string; count: number }> }
  attempts: { dispatched: number; failed: number; failureRate?: number }
  blockers: { runs: number; rate?: number; byKind: Array<{ kind: BlockerKind; count: number }> }
  unavailable: Array<{ metric: string; reason: string }>
}

/** 顺序固定：界面按这个顺序画，不用自己排。 */
const STATES: readonly RunState[] = [
  "planning",
  "awaiting_approval",
  "running",
  "blocked",
  "paused",
  "done",
  "partial",
  "failed",
  "exceeded",
  "cancelled",
  "needs_review",
]

/** 只接受有限的非负数：负数与 NaN 只可能是记录写错，静默归零会让报表说谎。 */
const amount = (value: unknown): number | undefined => {
  if (typeof value !== "number") return undefined
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

const usageOf = (run: RunSample) => {
  const usage = run.usage ?? {}
  return {
    settled: amount(Reflect.get(usage, "settled")),
    unknown: amount(Reflect.get(usage, "unknown")),
    overrun: Reflect.get(usage, "overrun") === true,
  }
}

/** 返工原因：优先用结构化字段，其次用事件上的 `reason`，最后才落「未分类」。 */
function reasonsOf(event: EventSample): string[] {
  const payload = event.payload ?? {}
  const failed: unknown = Reflect.get(payload, "failed")
  const texts: string[] = []
  if (Array.isArray(failed)) {
    for (const item of failed) {
      if (!item || typeof item !== "object") continue
      const text: unknown = Reflect.get(item, "text")
      if (typeof text === "string" && text.trim()) texts.push(text.trim())
    }
  }
  if (texts.length > 0) return texts
  const reason: unknown = Reflect.get(payload, "reason")
  if (typeof reason === "string" && reason.trim()) return [reason.trim()]
  return ["未分类"]
}

const kindOf = (event: EventSample) => event.kind

/**
 * 稳定的文本比较：用码元顺序而不是 `localeCompare`。
 *
 * 指标是给人看的统计，但顺序必须与机器环境无关 —— `localeCompare` 依赖运行环境的
 * 语言设置，同一批数据在不同机器上会排出不同顺序，报表就没法对照了。
 */
const stable = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** 阻塞类事件的种类判定；类型收窄在判断函数里完成，调用处不必再断言。 */
const isBlocking = (kind: string): kind is BlockerKind => BLOCKING_KINDS.some((item) => item === kind)

export function report(samples: readonly Sample[], top = 5): Report {
  const runs = samples.map((sample) => sample.run)
  const counts = new Map<RunState, number>()
  for (const run of runs) counts.set(run.state, (counts.get(run.state) ?? 0) + 1)

  const tokens = { settled: 0, unknown: 0, covered: 0, overrunRuns: 0 }
  for (const run of runs) {
    const usage = usageOf(run)
    if (usage.settled === undefined && usage.unknown === undefined) continue
    tokens.covered += 1
    tokens.settled += usage.settled ?? 0
    tokens.unknown += usage.unknown ?? 0
    if (usage.overrun) tokens.overrunRuns += 1
  }

  const rounds = new Map<number, number>()
  for (const run of runs) {
    const round = Number.isFinite(run.roundMain) && run.roundMain >= 0 ? Math.floor(run.roundMain) : 0
    rounds.set(round, (rounds.get(round) ?? 0) + 1)
  }

  const reasons = new Map<string, number>()
  let reworkTotal = 0
  let dispatched = 0
  let failed = 0
  let eventsCovered = 0
  let blockedRuns = 0
  const blockerKinds = new Map<BlockerKind, number>()

  for (const sample of samples) {
    if (sample.events.length > 0) eventsCovered += 1
    for (const event of sample.events) {
      if (kindOf(event) === "team.rework") {
        reworkTotal += 1
        for (const reason of reasonsOf(event)) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      }
      if (kindOf(event) === "team.dispatched") dispatched += 1
      if (kindOf(event) === "team.failed") failed += 1
    }
    // 只数事件种类，不重建 Blocker：指标不需要原因原文，也不该把命令写进汇总。
    const blocked = sample.events.filter((event) => isBlocking(event.kind))
    if (blocked.length > 0) blockedRuns += 1
    for (const event of blocked) {
      if (!isBlocking(event.kind)) continue
      blockerKinds.set(event.kind, (blockerKinds.get(event.kind) ?? 0) + 1)
    }
  }

  const top5 = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1] || stable(a[0], b[0]))
    .slice(0, Math.max(0, top))
    .map(([reason, count]) => ({ reason, count }))

  const stamps = runs.map((run) => run.createdAt).filter((value) => Number.isFinite(value))

  return {
    window: {
      runs: runs.length,
      eventsCovered,
      ...(stamps.length > 0 ? { from: Math.min(...stamps), to: Math.max(...stamps) } : {}),
    },
    states: STATES.filter((state) => (counts.get(state) ?? 0) > 0).map((state) => ({
      state,
      runs: counts.get(state) ?? 0,
    })),
    tokens,
    rounds: [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([round, count]) => ({ round, runs: count })),
    rework: { total: reworkTotal, top: top5 },
    attempts: {
      dispatched,
      failed,
      // 没有派发记录时不给百分比：0 派遣 ≠ 0% 失败。
      ...(dispatched > 0 ? { failureRate: failed / dispatched } : {}),
    },
    blockers: {
      runs: blockedRuns,
      ...(eventsCovered > 0 ? { rate: blockedRuns / eventsCovered } : {}),
      byKind: [...blockerKinds.entries()]
        .sort((a, b) => b[1] - a[1] || stable(a[0], b[0]))
        .map(([kind, count]) => ({ kind, count })),
    },
    unavailable: [
      {
        metric: "验证开销占比",
        reason: "账本按团队汇总，验证与成员会话用同一个 actor，无法把验证花费单独拆出来。",
      },
    ],
  }
}
