/**
 * 执行引擎的对外词汇表：站点/实例的身份、驱动的边界、journal 的形状、结算结果。
 *
 * 这一层是**纯的**：不读盘、不起进程、不认识 Session 或 Tool。它只知道「脚本要求做一件事」，
 * 以及「有人会去做这件事并告诉我结果」。所有真实世界的接线都在 `driver/` 里，靠本文件的接口
 * 对上号。这条界线是恢复能力的前提：重放时，引擎面对的是同一个驱动接口和另一份 journal，
 * 而不是一个还在跑的子代理。
 */

import type { WorldReadOp } from "../analysis/sites"

// ————————————————————————————————————————————————————————————————
// 身份
// ————————————————————————————————————————————————————————————————

/** 一次 run 的 id。形如 `dwfrun-<ulid>`。 */
export type RunId = string

/** 一个子代理。`actor#2` 的第 1 个实例是 `{ siteId: "actor#2", ordinal: 1 }`。 */
export interface ActorRef {
  readonly siteId: string
  readonly ordinal: number
}

/** 一次执行。站点 + 第几次到达。 */
export interface InstanceRef {
  readonly siteId: string
  readonly ordinal: number
}

/** `actor#2@1` —— 日志与界面里用的短标识。 */
export function actorLabel(ref: ActorRef): string {
  return `${ref.siteId}@${ref.ordinal}`
}

/** `ask#3@2`。 */
export function instanceLabel(ref: InstanceRef): string {
  return `${ref.siteId}@${ref.ordinal}`
}

// ————————————————————————————————————————————————————————————————
// 驱动（Boundary B）
// ————————————————————————————————————————————————————————————————

/** 一个子代理背后的常驻会话。具体是什么，引擎不关心，原样传回驱动。 */
export type SessionRef = unknown

/** 交给驱动的派发请求。 */
export interface AskRequest {
  readonly runId: RunId
  readonly instance: InstanceRef
  readonly actor: ActorRef
  /** 这个子代理的常驻会话。同一个 actor 的多次 ask 拿到的永远是同一个会话。 */
  readonly session: SessionRef
  /** 作者的指令原文。 */
  readonly instructions: string
  /** 词法阶段（可能缺席）。驱动可以拿它给子会话起标题。 */
  readonly phase?: string
  /** run 被停止 / 取消时触发。驱动应当据此中断这一轮。 */
  readonly signal: AbortSignal
}

/** 子代理的答复。 */
export interface AskAnswer {
  /** 最后一条 assistant 文本。 */
  readonly text: string
  /** 本轮消耗，用于 `spent_tokens`。读不到就不填。 */
  readonly usage?: { readonly tokens?: number; readonly cost?: number }
}

/** 世界读取的请求。 */
export interface WorldReadRequest {
  readonly runId: RunId
  readonly instance: InstanceRef
  readonly op: WorldReadOp
  /** 脚本调用点的位置实参，原样传过来。元数与校验归驱动。 */
  readonly args: readonly unknown[]
  readonly signal: AbortSignal
}

/** 创建一个 actor 的会话。 */
export interface CreateActorRequest {
  readonly runId: RunId
  readonly actor: ActorRef
  /** 作者给的字面量名字（可能缺席）。 */
  readonly name?: string
  /** 作者给的人格设定，`string | { system?: string }`。 */
  readonly persona?: unknown
}

/**
 * 引擎 → 世界的唯一出口。
 *
 * 三个方法都是 Promise 而不是回调：引擎的调度器决定**什么时候**开始，驱动负责**怎么**做完。
 * 这个分工让「每个子代理一次只答一个」「全局最多 N 个在飞」全部收在引擎里，而重试、解析、
 * 校验这些与模型相关的策略全部收在驱动里。
 */
export interface WorkflowDriver {
  /** 建一个常驻会话。引擎在第一次 ask 之前 await 它一次，之后复用。 */
  createActorSession(input: CreateActorRequest): Promise<SessionRef>
  /**
   * 恢复时接回上一次的会话。
   *
   * 驱动能接就接（返回同一个会话句柄），接不上就不实现——引擎会退回 `createActorSession`，
   * 代价是子代理忘了上一轮说过什么，但缓存答案仍然生效，不会白花 token。
   */
  attachActorSession?(input: { runId: RunId; actor: ActorRef; sessionID: string }): Promise<SessionRef>
  /** 派一轮。拒绝即该 ask 失败；signal 触发时应当尽快停止。 */
  startAsk(input: AskRequest): Promise<AskAnswer>
  /** 一次世界读取。拒绝即该 world-read 失败。 */
  executeWorldRead(input: WorldReadRequest): Promise<unknown>
  /** run 结算后的清理。失败不影响结算。 */
  dispose?(): Promise<void>
}

// ————————————————————————————————————————————————————————————————
// journal（Boundary B 的另一半）
// ————————————————————————————————————————————————————————————————

/** 节点种类。与站点表里的 kind 对齐（join / fan-out 是展示用的，不落节点）。 */
export type NodeKind = "ask" | "world-read" | "report"

/** 一次 run 的终态。 */
export type RunStatus = "running" | "completed" | "errored" | "stopped"

/** 停止的原因。`completed` / `errored` 没有这个字段。 */
export type StopReason = "user" | "model" | "provider" | "interrupted"

/** 节点的结算状态。 */
export type NodeStatus = "running" | "completed" | "failed"

/** 一条节点记录。`(runId, siteId, ordinal)` 是唯一键。 */
export interface NodeRecord {
  readonly runId: RunId
  readonly siteId: string
  readonly ordinal: number
  readonly kind: NodeKind
  readonly phase?: string
  /** ask 专属：派给哪个子代理。 */
  readonly actor?: ActorRef
  /** ask 专属：在这个子代理的序列里排第几（从 1 起）。 */
  readonly actorSeq?: number
  /** ask = instructions 的哈希；world-read = op+args；report = item。 */
  readonly inputHash: string
  /**
   * 调用点的实参快照（ask 是 instructions，world-read 是 op+args）。刻意**不含** report：
   * 它的输入就是结果本身，存两遍没有意义。恢复只靠 `inputHash` 比对，这份原文是给人看的。
   */
  readonly input?: unknown
  readonly status: NodeStatus
}

/** 一条子代理记录。 */
export interface ActorRecord {
  readonly runId: RunId
  readonly actor: ActorRef
  readonly name?: string
  readonly phase?: string
  /** 作者给的人格设定（`string | { system?: string }`）。 */
  readonly persona?: unknown
  /** 驱动建好的常驻会话 id。恢复时复用，子代理才「记得」上一轮说过什么。 */
  readonly sessionID?: string
  /** 实际解析到的模型，形如 `provider/model`。 */
  readonly model?: string
}

/** 一条事件。`sequence` 在一次 run 内连续递增，是回放的顺序键。 */
export interface EventRecord {
  readonly runId: RunId
  readonly sequence: number
  readonly type: string
  readonly payload: unknown
}

/**
 * 写事件时给 journal 的东西。
 *
 * `sequence` **不在这里**：它只由 journal 铸造。调用方自带序号会让两个写入者（在线路径与
 * 恢复路径）各数各的，回放顺序就散了。
 */
export interface EventInput {
  readonly runId: RunId
  readonly type: string
  readonly payload: unknown
}

/**
 * journal 的唯一入口。
 *
 * 全部同步：写入发生在引擎的决策点上，顺序本身是语义（report 的到达顺序承重）。异步 journal
 * 会让「先写后发」变成「先发后写」，恢复时看到的顺序就和在线时不一样了。SQLite 实现用同步
 * 驱动即可，这也正是我们把表设计成窄行的原因。
 */
export interface JournalPort {
  startRun(input: { runId: RunId; scriptHash: string; maxConcurrency: number; status: RunStatus }): void
  settleRun(input: {
    runId: RunId
    status: RunStatus
    stopReason?: StopReason
    result?: unknown
    failure?: unknown
    spentTokens?: number
  }): void
  appendActor(record: ActorRecord): void
  /** 记下子代理背后的会话（驱动建好后才有）。没有可持久化的会话身份时实现方可以忽略。 */
  recordActorSession(input: { runId: RunId; actor: ActorRef; session: SessionRef }): void
  /** 落一条 running 节点。 */
  appendNode(record: NodeRecord): void
  /**
   * 恢复时重新打开一条上次没跑完的节点。
   *
   * 为什么不能简单地再 `appendNode` 一次：`(runId, siteId, ordinal)` 是唯一键，重插会撞。
   * 为什么不能什么都不做：`status` 停在 `running` 会让下一次恢复又把它当成「在飞」。
   */
  reopenNode(input: { runId: RunId; instance: InstanceRef }): void
  /** 结算一条节点。 */
  settleNode(input: {
    runId: RunId
    instance: InstanceRef
    status: NodeStatus
    result?: unknown
    failure?: unknown
  }): void
  /** 追加一条事件，返回它在本 run 内的序号（从 1 起）。 */
  appendEvent(record: EventInput): number
}

// ————————————————————————————————————————————————————————————————
// 事件（Boundary C）
// ————————————————————————————————————————————————————————————————

/** 引擎向外发的事件。全是**有界**的：脚本正文、结果、报告各自限量，超限截断。 */
export type RunEvent =
  | { readonly type: "run-started"; readonly runId: RunId; readonly maxConcurrency: number }
  | { readonly type: "phase-entered"; readonly runId: RunId; readonly name: string }
  | { readonly type: "log"; readonly runId: RunId; readonly message: string }
  | { readonly type: "actor-created"; readonly runId: RunId; readonly actor: ActorRef; readonly name?: string }
  | {
      readonly type: "node-started"
      readonly runId: RunId
      readonly instance: InstanceRef
      readonly kind: NodeKind
      readonly phase?: string
    }
  | {
      readonly type: "node-settled"
      readonly runId: RunId
      readonly instance: InstanceRef
      /** 与 `node-started` 的 kind 相同。订阅者据此区分「第几次搜索」与「第几次提问」。 */
      readonly kind: NodeKind
      readonly status: NodeStatus
      readonly cached?: boolean
    }
  | { readonly type: "report"; readonly runId: RunId; readonly instance: InstanceRef; readonly item: unknown }
  | { readonly type: "run-settled"; readonly runId: RunId; readonly settlement: Settlement }

/** run 的结算。 */
export type Settlement =
  | { readonly status: "completed"; readonly value: unknown; readonly spentTokens: number }
  | { readonly status: "errored"; readonly error: RunFailure; readonly spentTokens: number }
  | {
      readonly status: "stopped"
      readonly reason: StopReason
      readonly error?: RunFailure
      readonly spentTokens: number
    }

/** 一次失败的结构化形态。跨边界时按这个形状走，脚本侧据此重建 Error。 */
export interface RunFailure {
  readonly name: string
  readonly message: string
  readonly code?: string
  /** 脚本可以据此判断该不该重试。 */
  readonly retryable?: boolean
  readonly stack?: string
}

/** 把任意抛出物规整成 RunFailure。 */
export function toFailure(error: unknown): RunFailure {
  if (error && typeof error === "object") {
    const item = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown }
    return {
      name: typeof item.name === "string" ? item.name : "Error",
      message: typeof item.message === "string" ? item.message : String(error),
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(typeof item.stack === "string" ? { stack: item.stack } : {}),
    }
  }
  return { name: "Error", message: String(error) }
}
