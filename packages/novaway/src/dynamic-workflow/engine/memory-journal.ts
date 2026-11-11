/**
 * 内存 journal：引擎的测试替身，也是恢复语义的参照实现。
 *
 * 它不做持久化，但**记录的东西与 SQLite 实现必须一模一样**——同一组事件、同一个顺序、
 * 同样只保存有界的字段。否则「内存里能恢复、数据库里恢复不了」会成为只在生产暴露的 bug。
 *
 * 存储形状刻意与计划里的四张表对齐：run / actor / node / event 各一个数组，键也同名。
 */

import { DEFAULT_MAX_RECORD_BYTES, boundRecord } from "./bound"
import type {
  ActorRecord,
  EventInput,
  EventRecord,
  JournalPort,
  NodeRecord,
  NodeStatus,
  RunId,
  RunStatus,
  StopReason,
} from "./types"

/** 一条节点的最终形态（含结算结果）。 */
export interface StoredNode extends NodeRecord {
  status: NodeStatus
  result?: unknown
  failure?: unknown
}

/** 一次 run 的内存快照。 */
export interface StoredRun {
  runId: RunId
  scriptHash: string
  maxConcurrency: number
  status: RunStatus
  stopReason?: StopReason
  result?: unknown
  failure?: unknown
  spentTokens: number
  actors: ActorRecord[]
  nodes: StoredNode[]
  events: EventRecord[]
}

/** 内存 journal。测试用；生产用 SQLite 实现（见 M3）。 */
export class MemoryJournal implements JournalPort {
  private readonly runs = new Map<RunId, StoredRun>()
  private sequence = 0

  constructor(
    /** 单条结果落盘前的上限（字节）。超限记成一个截断说明，而不是让 run 失败。 */
    private readonly maxRecordBytes = DEFAULT_MAX_RECORD_BYTES,
  ) {}

  startRun(input: { runId: RunId; scriptHash: string; maxConcurrency: number; status: RunStatus }): void {
    // 恢复用的还是同一个 run id：一次逻辑上的 run 只有一份 journal，状态从 stopped 回到 running。
    // 若这里换成一个新对象，恢复就要么丢掉历史，要么得自己把旧行搬过来。
    const existing = this.runs.get(input.runId)
    if (existing) {
      existing.status = input.status
      existing.maxConcurrency = input.maxConcurrency
      return
    }
    this.runs.set(input.runId, {
      runId: input.runId,
      scriptHash: input.scriptHash,
      maxConcurrency: input.maxConcurrency,
      status: input.status,
      spentTokens: 0,
      actors: [],
      nodes: [],
      events: [],
    })
  }

  settleRun(input: {
    runId: RunId
    status: RunStatus
    stopReason?: StopReason
    result?: unknown
    failure?: unknown
    spentTokens?: number
  }): void {
    const run = this.require(input.runId)
    run.status = input.status
    if (input.stopReason) run.stopReason = input.stopReason
    if (input.result !== undefined) run.result = this.bound(input.result)
    if (input.failure !== undefined) run.failure = input.failure
    if (input.spentTokens !== undefined) run.spentTokens = input.spentTokens
  }

  appendActor(record: ActorRecord): void {
    this.require(record.runId).actors.push({ ...record })
  }

  recordActorSession(input: { runId: RunId; actor: { siteId: string; ordinal: number }; session: unknown }): void {
    const run = this.require(input.runId)
    const actor = run.actors.find(
      (item) => item.actor.siteId === input.actor.siteId && item.actor.ordinal === input.actor.ordinal,
    )
    if (!actor) return
    if (typeof input.session === "string") {
      run.actors[run.actors.indexOf(actor)] = { ...actor, sessionID: input.session }
    }
  }

  appendNode(record: NodeRecord): void {
    const run = this.require(record.runId)
    // 同一实例重复落行是引擎的 bug（ordinal 只该铸造一次）。这里不静默覆盖——
    // 覆盖会让 journal 看起来正常，而恢复时却少了一次执行。
    const duplicate = run.nodes.some((node) => node.siteId === record.siteId && node.ordinal === record.ordinal)
    if (duplicate) {
      throw new Error(`journal 重复：${record.siteId}@${record.ordinal} 已经存在。`)
    }
    run.nodes.push({ ...record })
  }

  reopenNode(input: { runId: RunId; instance: { siteId: string; ordinal: number } }): void {
    const run = this.require(input.runId)
    const node = run.nodes.find(
      (item) => item.siteId === input.instance.siteId && item.ordinal === input.instance.ordinal,
    )
    if (!node) throw new Error(`journal 找不到节点 ${input.instance.siteId}@${input.instance.ordinal}。`)
    node.status = "running"
  }

  settleNode(input: {
    runId: RunId
    instance: { siteId: string; ordinal: number }
    status: NodeStatus
    result?: unknown
    failure?: unknown
  }): void {
    const run = this.require(input.runId)
    const node = run.nodes.find(
      (item) => item.siteId === input.instance.siteId && item.ordinal === input.instance.ordinal,
    )
    if (!node) throw new Error(`journal 找不到节点 ${input.instance.siteId}@${input.instance.ordinal}。`)
    node.status = input.status
    if (input.result !== undefined) node.result = this.bound(input.result)
    if (input.failure !== undefined) node.failure = input.failure
  }

  appendEvent(record: EventInput): number {
    const run = this.require(record.runId)
    this.sequence += 1
    run.events.push({
      runId: record.runId,
      sequence: this.sequence,
      type: record.type,
      payload: this.bound(record.payload),
    })
    return this.sequence
  }

  /** 读一次 run 的快照。测试用；生产侧按需分页读。 */
  get(runId: RunId): StoredRun | undefined {
    return this.runs.get(runId)
  }

  /** 某个实例的节点。 */
  node(runId: RunId, siteId: string, ordinal: number): StoredNode | undefined {
    return this.runs.get(runId)?.nodes.find((item) => item.siteId === siteId && item.ordinal === ordinal)
  }

  /** 某个站点的全部节点，按 ordinal。 */
  nodesAt(runId: RunId, siteId: string): StoredNode[] {
    return (this.runs.get(runId)?.nodes ?? [])
      .filter((item) => item.siteId === siteId)
      .sort((a, b) => a.ordinal - b.ordinal)
  }

  private require(runId: RunId): StoredRun {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`journal 里没有 run ${runId}：startRun 必须最先调用。`)
    return run
  }

  /** 有界化：与 SQLite 实现共用同一份规则（见 bound.ts）。 */
  private bound(value: unknown): unknown {
    return boundRecord(value, this.maxRecordBytes)
  }
}
