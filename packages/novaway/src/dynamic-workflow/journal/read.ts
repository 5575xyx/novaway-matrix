/**
 * journal 的**读侧**。
 *
 * 写侧只有一个消费者（引擎），读侧有三个：`workflow_run` 的列表与详情、恢复规划、测试。
 * 三者的共同要求是「不许全表加载」——一次 run 可能留下上千个节点，把整张表读进内存再过滤，
 * 在界面上就是一次几百毫秒的卡顿。所以每个读函数都显式说明取什么：哪个 run、哪些 kind、
 * 多少条、从哪个序号之后。
 */

import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ActorTable, EventTable, NodeTable, RunTable } from "../journal.sql"
import { buildReplayPlan } from "../engine/replay"
import type { ActorRef, InstanceRef, NodeStatus, RunId, RunStatus, StopReason } from "../engine/types"

/** 列表页的一行。够界面画出「哪次、什么时候、什么结果」。 */
export interface RunSummary {
  readonly runId: RunId
  readonly name?: string
  readonly cwd: string
  readonly status: RunStatus
  readonly stopReason?: StopReason
  readonly spentTokens: number
  readonly maxConcurrency: number
  readonly timeCreated: number
  readonly timeUpdated: number
}

/** 一次 run 的头部。恢复前要校验 `scriptHash`，详情页要展示名字与终态。 */
export interface RunHeader extends RunSummary {
  readonly scriptText: string
  readonly scriptHash: string
  readonly parentSessionID?: string
  readonly resumedFrom?: string
  readonly args?: Record<string, unknown>
  readonly result?: unknown
  readonly failure?: unknown
}

/** 一条节点。`result` / `failure` 只在需要时才读（`withResult`）。 */
export interface NodeRow {
  readonly siteId: string
  readonly ordinal: number
  readonly kind: string
  readonly status: NodeStatus
  readonly inputHash: string
  readonly phase?: string
  readonly actor?: ActorRef
  readonly actorSeq?: number
  readonly result?: unknown
  readonly failure?: unknown
  /** 落行时间。界面画时间线与耗时用它——两端的差就是这一步花了多久。 */
  readonly timeCreated: number
  readonly timeUpdated: number
}

function parse(text: string | null): unknown {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function listRuns(input: { cwd?: string; limit?: number } = {}): RunSummary[] {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 100))
  return Database.use((db) => {
    const base = db
      .select({
        id: RunTable.id,
        name: RunTable.name,
        cwd: RunTable.cwd,
        status: RunTable.status,
        stop_reason: RunTable.stop_reason,
        spent_tokens: RunTable.spent_tokens,
        caps: RunTable.caps_max_concurrency,
        time_created: RunTable.time_created,
        time_updated: RunTable.time_updated,
      })
      .from(RunTable)
      .$dynamic()
    const filtered = input.cwd ? base.where(eq(RunTable.cwd, input.cwd)) : base
    // 排序键是**创建时间**，不是更新时间：一次跑得久的 run 中间不会推进 run 行的时间戳
    // （推进它意味着每个节点都多一次写），按更新时间排会让它被后来的一串短 run 挤出去——
    // 恰恰是最该被看见的那条不见了。`time_updated` 与 id 只作为同一毫秒内的稳定次序。
    return filtered
      .orderBy(desc(RunTable.time_created), desc(RunTable.time_updated), desc(RunTable.id))
      .limit(limit)
      .all()
      .map(toSummary)
  })
}

function toSummary(row: {
  id: string
  name: string | null
  cwd: string
  status: string
  stop_reason: string | null
  spent_tokens: number
  caps: number
  time_created: number
  time_updated: number
}): RunSummary {
  return {
    runId: row.id,
    ...(row.name ? { name: row.name } : {}),
    cwd: row.cwd,
    status: row.status as RunStatus,
    ...(row.stop_reason ? { stopReason: row.stop_reason as StopReason } : {}),
    spentTokens: row.spent_tokens,
    maxConcurrency: row.caps,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function readRun(runId: RunId): RunHeader | undefined {
  return Database.use((db) => {
    const row = db.select().from(RunTable).where(eq(RunTable.id, runId)).get()
    if (!row) return undefined
    return {
      runId: row.id,
      ...(row.name ? { name: row.name } : {}),
      cwd: row.cwd,
      status: row.status as RunStatus,
      ...(row.stop_reason ? { stopReason: row.stop_reason as StopReason } : {}),
      spentTokens: row.spent_tokens,
      maxConcurrency: row.caps_max_concurrency,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
      scriptText: row.script_text,
      scriptHash: row.script_hash,
      ...(row.parent_session_id ? { parentSessionID: row.parent_session_id } : {}),
      ...(row.resumed_from ? { resumedFrom: row.resumed_from } : {}),
      ...(row.args_json ? { args: parse(row.args_json) as Record<string, unknown> } : {}),
      ...(row.result_json ? { result: parse(row.result_json) } : {}),
      ...(row.failure_json ? { failure: parse(row.failure_json) } : {}),
    }
  })
}

/**
 * 读节点。
 *
 * `kinds` 与 `limit` 都是**必填的选项**而不是「不填就全读」：这条路径会在 UI 的每次刷新里
 * 跑一遍，默认值必须是「小」而不是「全」。
 */
export function readNodes(
  runId: RunId,
  options: { kinds?: ReadonlyArray<string>; limit: number; withResult?: boolean },
): NodeRow[] {
  return Database.use((db) => {
    const conditions = [eq(NodeTable.run_id, runId)]
    if (options.kinds && options.kinds.length > 0) conditions.push(inArray(NodeTable.kind, [...options.kinds]))
    return db
      .select()
      .from(NodeTable)
      .where(and(...conditions))
      .orderBy(asc(NodeTable.id))
      .limit(Math.max(1, options.limit))
      .all()
      .map((row) => toNodeRow(row, options.withResult === true))
  })
}

/** 某个实例的节点。恢复时用它查缓存答案。 */
export function readNode(runId: RunId, instance: InstanceRef): NodeRow | undefined {
  return Database.use((db) => {
    const row = db
      .select()
      .from(NodeTable)
      .where(
        and(
          eq(NodeTable.run_id, runId),
          eq(NodeTable.site_id, instance.siteId),
          eq(NodeTable.ordinal, instance.ordinal),
        ),
      )
      .get()
    return row ? toNodeRow(row, true) : undefined
  })
}

function toNodeRow(row: typeof NodeTable.$inferSelect, withResult: boolean): NodeRow {
  return {
    siteId: row.site_id,
    ordinal: row.ordinal,
    kind: row.kind,
    status: row.status as NodeStatus,
    inputHash: row.input_hash,
    ...(row.phase_name ? { phase: row.phase_name } : {}),
    ...(row.actor_site_id && row.actor_ordinal !== null
      ? { actor: { siteId: row.actor_site_id, ordinal: row.actor_ordinal } }
      : {}),
    ...(row.actor_seq !== null ? { actorSeq: row.actor_seq } : {}),
    ...(withResult && row.result_json ? { result: parse(row.result_json) } : {}),
    ...(withResult && row.error_json ? { failure: parse(row.error_json) } : {}),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

/** 一次 run 的全部子代理，按创建顺序。恢复时用来复用会话。 */
export function readActors(runId: RunId): ReadonlyArray<{
  readonly actor: ActorRef
  readonly name?: string
  readonly sessionID?: string
  readonly persona?: unknown
}> {
  return Database.use((db) =>
    db
      .select()
      .from(ActorTable)
      .where(eq(ActorTable.run_id, runId))
      .orderBy(asc(ActorTable.id))
      .all()
      .map((row) => ({
        actor: { siteId: row.site_id, ordinal: row.ordinal },
        ...(row.name ? { name: row.name } : {}),
        ...(row.session_id ? { sessionID: row.session_id } : {}),
        ...(row.persona_json ? { persona: parse(row.persona_json) } : {}),
      })),
  )
}

/** 事件按序号分页。默认只取前 64 条；时间线往上翻时才用 `after`。 */
export function readEvents(
  runId: RunId,
  options: { after?: number; limit: number },
): ReadonlyArray<{
  readonly sequence: number
  readonly type: string
  readonly payload: unknown
  readonly timeCreated: number
}> {
  return Database.use((db) => {
    const conditions = [eq(EventTable.run_id, runId)]
    if (options.after !== undefined) conditions.push(gt(EventTable.sequence, options.after))
    return db
      .select()
      .from(EventTable)
      .where(and(...conditions))
      .orderBy(asc(EventTable.sequence))
      .limit(Math.max(1, options.limit))
      .all()
      .map((row) => ({
        sequence: row.sequence,
        type: row.type,
        payload: parse(row.payload_json),
        timeCreated: row.time_created,
      }))
  })
}

/**
 * 一次 run 的计数摘要。
 *
 * 界面的卡片只要这一行就够画「走到第几步」：节点明细可能有上千条，而卡片只需要
 * 「完成 / 失败 / 在跑」三个数。用 `group by` 让数据库数，不要把行读到内存里再数。
 *
 * 报告（`report` 节点）单列：它是脚本主动交出的结论，与「执行了几步」不是一回事。
 */
export interface RunProgress {
  readonly nodes: {
    readonly total: number
    readonly completed: number
    readonly failed: number
    readonly running: number
    readonly reports: number
  }
  readonly actors: number
  readonly events: number
}

export function summarizeRun(runId: RunId): RunProgress {
  return Database.use((db) => {
    const rows = db
      .select({ kind: NodeTable.kind, status: NodeTable.status, n: sql<number>`count(*)` })
      .from(NodeTable)
      .where(eq(NodeTable.run_id, runId))
      .groupBy(NodeTable.kind, NodeTable.status)
      .all()
    const nodes = { total: 0, completed: 0, failed: 0, running: 0, reports: 0 }
    for (const row of rows) {
      const count = Number(row.n)
      nodes.total += count
      if (row.status === "completed") nodes.completed += count
      if (row.status === "failed") nodes.failed += count
      if (row.status === "running") nodes.running += count
      if (row.kind === "report" && row.status === "completed") nodes.reports += count
    }
    const actors = db
      .select({ n: sql<number>`count(*)` })
      .from(ActorTable)
      .where(eq(ActorTable.run_id, runId))
      .get()
    const events = db
      .select({ n: sql<number>`count(*)` })
      .from(EventTable)
      .where(eq(EventTable.run_id, runId))
      .get()
    return { nodes, actors: Number(actors?.n ?? 0), events: Number(events?.n ?? 0) }
  })
}

/**
 * 从库里攒出一份恢复计划。
 *
 * 上限是**故意的**：一条超长的历史不该让「恢复」变成一次全表扫描。10k 个节点已经远超任何
 * 一次真实 run；到了那个量级，恢复本身也该换一种做法（而不是悄悄截断）。事件同理——
 * 结算顺序只需要每个实例的第一次 `node-settled`。
 */
export function loadReplayPlan(runId: RunId) {
  const nodes = readNodes(runId, { limit: 10_000, withResult: true })
  const events = readEvents(runId, { limit: 20_000 })
  const actors = readActors(runId)
  return buildReplayPlan({
    nodes: nodes.map((node) => ({
      siteId: node.siteId,
      ordinal: node.ordinal,
      status: node.status,
      inputHash: node.inputHash,
      ...(node.result !== undefined ? { result: node.result } : {}),
      ...(node.failure !== undefined ? { failure: node.failure } : {}),
      ...(node.actor ? { actor: node.actor } : {}),
      ...(node.actorSeq !== undefined ? { actorSeq: node.actorSeq } : {}),
    })),
    events,
    actors,
  })
}
