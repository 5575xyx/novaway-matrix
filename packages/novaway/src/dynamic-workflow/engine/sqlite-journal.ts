/**
 * SQLite journal：生产实现，也是「关掉进程还认得这次 run」的唯一来源。
 *
 * 与 {@link MemoryJournal} 记录的东西**一模一样**（同一组行、同一个顺序、同样只保存有界字段），
 * 区别只在载体。这条等价性有测试钉着（`sqlite-journal.test.ts` 对两者跑同一组用例）——
 * 不然「内存里能恢复、数据库里恢复不了」会成为只在生产暴露的那类 bug。
 *
 * 全部同步。{@link JournalPort} 的注释解释了为什么不能异步：写入发生在引擎的决策点上，
 * 顺序本身就是语义（report 的到达顺序承重）。
 */

import { and, asc, eq, sql } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ActorTable, EventTable, NodeTable, RunTable } from "../journal.sql"
import { DEFAULT_MAX_RECORD_BYTES, boundJson } from "./bound"
import type {
  ActorRecord,
  ActorRef,
  EventInput,
  InstanceRef,
  JournalPort,
  NodeRecord,
  NodeStatus,
  RunId,
  RunStatus,
  SessionRef,
  StopReason,
} from "./types"

/** run 级元数据。构造时给一次，`startRun` 写进第一行。 */
export interface SqliteJournalMeta {
  /** 工作区根目录。`list(cwd)` 按它分组。 */
  readonly cwd: string
  readonly parentSessionID?: string
  readonly name?: string
  /** 作者脚本原文。恢复时逐字节比对，所以必须原样存。 */
  readonly scriptText: string
  readonly scriptPath?: string
  readonly args?: Record<string, unknown>
  readonly toolCallID?: string
  /** 从哪次 run 恢复来的。 */
  readonly resumedFrom?: string
}

const now = () => Date.now()

export class SqliteJournal implements JournalPort {
  /** 每个 run 已写到的最大序号。惰性从库里读一次，之后只在内存里递增。 */
  private readonly sequences = new Map<RunId, number>()

  constructor(
    private readonly meta: SqliteJournalMeta,
    private readonly maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
  ) {}

  startRun(input: { runId: RunId; scriptHash: string; maxConcurrency: number; status: RunStatus }): void {
    const at = now()
    if (this.findRun(input.runId)) {
      // 恢复：同一个 run id 从 stopped 回到 running。脚本与实参保持第一次生命里的那一份——
      // 调用方在恢复前已经比对过 script_hash，因此不存在「悄悄换了脚本」的可能。
      Database.use((db) =>
        db
          .update(RunTable)
          .set({ status: input.status, caps_max_concurrency: input.maxConcurrency, time_updated: at })
          .where(eq(RunTable.id, input.runId))
          .run(),
      )
      return
    }
    Database.use((db) =>
      db
        .insert(RunTable)
        .values({
          id: input.runId,
          parent_session_id: this.meta.parentSessionID ?? null,
          cwd: this.meta.cwd,
          name: this.meta.name ?? null,
          script_text: this.meta.scriptText,
          script_hash: input.scriptHash,
          script_path: this.meta.scriptPath ?? null,
          args_json: boundJson(this.meta.args, this.maxRecordBytes) ?? null,
          tool_call_id: this.meta.toolCallID ?? null,
          resumed_from: this.meta.resumedFrom ?? null,
          caps_max_concurrency: input.maxConcurrency,
          spent_tokens: 0,
          status: input.status,
          stop_reason: null,
          result_json: null,
          failure_json: null,
          time_created: at,
          time_updated: at,
        })
        .run(),
    )
  }

  settleRun(input: {
    runId: RunId
    status: RunStatus
    stopReason?: StopReason
    result?: unknown
    failure?: unknown
    spentTokens?: number
  }): void {
    const patch: Record<string, unknown> = { status: input.status, time_updated: now() }
    if (input.stopReason !== undefined) patch.stop_reason = input.stopReason
    if (input.result !== undefined) patch.result_json = boundJson(input.result, this.maxRecordBytes) ?? null
    if (input.failure !== undefined) patch.failure_json = JSON.stringify(input.failure)
    if (input.spentTokens !== undefined) patch.spent_tokens = input.spentTokens
    Database.use((db) => db.update(RunTable).set(patch).where(eq(RunTable.id, input.runId)).run())
  }

  appendActor(record: ActorRecord): void {
    Database.use((db) =>
      db
        .insert(ActorTable)
        .values({
          run_id: record.runId,
          site_id: record.actor.siteId,
          ordinal: record.actor.ordinal,
          name: record.name ?? null,
          persona_json: boundJson(record.persona, this.maxRecordBytes) ?? null,
          session_id: record.sessionID ?? null,
          resolved_model: record.model ?? null,
          time_created: now(),
        })
        .run(),
    )
  }

  recordActorSession(input: { runId: RunId; actor: ActorRef; session: SessionRef }): void {
    // 会话不是字符串就记不下来——那不是错误，只是这个驱动没有可持久化的会话身份。
    if (typeof input.session !== "string") return
    const sessionID = input.session
    Database.use((db) =>
      db
        .update(ActorTable)
        .set({ session_id: sessionID })
        .where(
          and(
            eq(ActorTable.run_id, input.runId),
            eq(ActorTable.site_id, input.actor.siteId),
            eq(ActorTable.ordinal, input.actor.ordinal),
          ),
        )
        .run(),
    )
  }

  appendNode(record: NodeRecord): void {
    const existing = this.findNode(record.runId, record)
    // 与内存实现同一条规矩：重复落行是引擎的 bug（ordinal 只该铸造一次）。
    // 交给唯一索引去撞的话，报出来的是 SQLITE_CONSTRAINT，看不出是哪一处。
    if (existing) throw new Error(`journal 重复：${record.siteId}@${record.ordinal} 已经存在。`)

    const at = now()
    Database.use((db) =>
      db
        .insert(NodeTable)
        .values({
          run_id: record.runId,
          site_id: record.siteId,
          ordinal: record.ordinal,
          kind: record.kind,
          actor_site_id: record.actor?.siteId ?? null,
          actor_ordinal: record.actor?.ordinal ?? null,
          actor_seq: record.actorSeq ?? null,
          phase_name: record.phase ?? null,
          input_hash: record.inputHash,
          input_json: boundJson(record.input, this.maxRecordBytes) ?? null,
          status: record.status,
          result_json: null,
          error_json: null,
          stats_json: null,
          time_created: at,
          time_updated: at,
        })
        .run(),
    )
  }

  reopenNode(input: { runId: RunId; instance: InstanceRef }): void {
    if (!this.findNode(input.runId, input.instance)) {
      throw new Error(`journal 找不到节点 ${input.instance.siteId}@${input.instance.ordinal}。`)
    }
    Database.use((db) =>
      db
        .update(NodeTable)
        .set({ status: "running", time_updated: now() })
        .where(
          and(
            eq(NodeTable.run_id, input.runId),
            eq(NodeTable.site_id, input.instance.siteId),
            eq(NodeTable.ordinal, input.instance.ordinal),
          ),
        )
        .run(),
    )
  }

  private findRun(runId: RunId): { id: string } | undefined {
    return Database.use((db) => db.select({ id: RunTable.id }).from(RunTable).where(eq(RunTable.id, runId)).get())
  }

  private findNode(runId: RunId, instance: InstanceRef): { id: number } | undefined {
    return Database.use((db) =>
      db
        .select({ id: NodeTable.id })
        .from(NodeTable)
        .where(
          and(
            eq(NodeTable.run_id, runId),
            eq(NodeTable.site_id, instance.siteId),
            eq(NodeTable.ordinal, instance.ordinal),
          ),
        )
        .get(),
    )
  }

  settleNode(input: {
    runId: RunId
    instance: InstanceRef
    status: NodeStatus
    result?: unknown
    failure?: unknown
  }): void {
    const patch: Record<string, unknown> = { status: input.status, time_updated: now() }
    if (input.result !== undefined) patch.result_json = boundJson(input.result, this.maxRecordBytes) ?? null
    if (input.failure !== undefined) patch.error_json = JSON.stringify(input.failure)
    if (!this.findNode(input.runId, input.instance)) {
      throw new Error(`journal 找不到节点 ${input.instance.siteId}@${input.instance.ordinal}。`)
    }
    Database.use((db) =>
      db
        .update(NodeTable)
        .set(patch)
        .where(
          and(
            eq(NodeTable.run_id, input.runId),
            eq(NodeTable.site_id, input.instance.siteId),
            eq(NodeTable.ordinal, input.instance.ordinal),
          ),
        )
        .run(),
    )
  }

  appendEvent(record: EventInput): number {
    const sequence = this.nextSequence(record.runId)
    Database.use((db) =>
      db
        .insert(EventTable)
        .values({
          run_id: record.runId,
          sequence,
          type: record.type,
          payload_json: boundJson(record.payload, this.maxRecordBytes) ?? "null",
          time_created: now(),
        })
        .run(),
    )
    this.sequences.set(record.runId, sequence)
    return sequence
  }

  private nextSequence(runId: RunId): number {
    const cached = this.sequences.get(runId)
    if (cached !== undefined) return cached + 1
    const row = Database.use((db) =>
      db
        .select({ last: sql<number | null>`max(${EventTable.sequence})` })
        .from(EventTable)
        .where(eq(EventTable.run_id, runId))
        .get(),
    )
    return (row?.last ?? 0) + 1
  }
}
