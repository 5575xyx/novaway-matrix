/**
 * 进程内的 run 登记表。
 *
 * M2 阶段还没有 SQLite journal，但「跑完之后还能查」是工具集能否自洽的前提：`create_workflow`
 * 交出 runId，用户下一句话可能就是「那次跑得怎么样」。所以先在这里留一份有界的快照。
 *
 * 它与未来的 SQLite journal 是**同一个读侧契约**的两种实现：查一次 run 的状态、阶段、
 * 节点计数、报告、用量。把形状定在这里，M3 换成数据库时工具层不用改。
 */

import type { WorkflowEngine } from "../engine/engine"
import type { MemoryJournal } from "../engine/memory-journal"
import type { Settlement } from "../engine/types"

/** 一次 run 在进程内的快照。 */
export interface RunEntry {
  readonly runId: string
  readonly name?: string
  readonly scriptText: string
  readonly phaseNames: readonly string[]
  readonly siteIds: readonly string[]
  readonly startedAt: number
  settledAt?: number
  settlement?: Settlement
  /** 报告，按到达顺序。有界：超过上限只留前 N 条。 */
  reports: unknown[]
  /** 停下来。run 已结算时是 no-op。 */
  stop?: (reason: "user" | "model") => void
}

/** 最多留多少条 run。再老的丢掉——它们本来也没有持久化。 */
const MAX_ENTRIES = 50
/** 每条 run 最多留多少条报告。 */
const MAX_REPORTS = 200

const entries = new Map<string, RunEntry>()

/** 新建一条。`create_workflow` 在启动前调用。 */
export function register(input: {
  runId: string
  name?: string
  scriptText: string
  phaseNames: readonly string[]
  siteIds: readonly string[]
}): RunEntry {
  const entry: RunEntry = {
    runId: input.runId,
    ...(input.name ? { name: input.name } : {}),
    scriptText: input.scriptText,
    phaseNames: input.phaseNames,
    siteIds: input.siteIds,
    startedAt: Date.now(),
    reports: [],
  }
  entries.set(input.runId, entry)
  trim()
  return entry
}

/** 接上引擎的停止把手。 */
export function attach(runId: string, engine: WorkflowEngine): void {
  const entry = entries.get(runId)
  if (!entry) return
  entry.stop = (reason) => engine.stop(reason)
}

/** 记一条报告。超限之后不再收集——界面能显示的也就前几条。 */
export function addReport(runId: string, item: unknown): void {
  const entry = entries.get(runId)
  if (!entry) return
  if (entry.reports.length >= MAX_REPORTS) return
  entry.reports.push(item)
}

/** 结算。 */
export function settle(runId: string, settlement: Settlement): void {
  const entry = entries.get(runId)
  if (!entry) return
  entry.settlement = settlement
  entry.settledAt = Date.now()
  entry.stop = undefined
}

/** 取一条。 */
export function get(runId: string): RunEntry | undefined {
  return entries.get(runId)
}

/** 最近的若干条，最新的在前。 */
export function list(limit = 10): RunEntry[] {
  return [...entries.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.max(1, limit))
}

/** 清空。测试用。 */
export function reset(): void {
  entries.clear()
}

function trim(): void {
  if (entries.size <= MAX_ENTRIES) return
  const oldest = [...entries.values()].sort((a, b) => a.startedAt - b.startedAt)
  for (const entry of oldest.slice(0, entries.size - MAX_ENTRIES)) entries.delete(entry.runId)
}
