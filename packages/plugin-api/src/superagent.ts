import type { PluginError } from "./errors"
import type { JSONSchema } from "./json"
import type { Disposable } from "./registry"

/**
 * super-agent 运行时的贡献点与 DTO（docs/super-agent-plugin-design.md）。
 *
 * 运行时五层：Trigger → Thread → Router → Worker → Watchdog。内核只认识这些契约，
 * 任何具体业务（哪种触发、怎么判进度、推到哪个 IM）都必须是下面的贡献点。
 */

export type ThreadStatus = "open" | "running" | "waiting" | "paused" | "done" | "failed" | "aborted"

export type ThreadOrigin = "pr" | "mail" | "im" | "ci" | "timer" | "manual" | "plugin"

export type EventPriority = "high" | "normal" | "low"

export type ThreadBudget = {
  tokens?: number
  cost?: number
  wallClockMs?: number
}

/** 事件来源键：线程归属的唯一可靠判据，不用语义相似度（§5.3、Q3/Q14）。 */
export type SourceKey = string

export type Thread = {
  id: string
  title: string
  goal: string
  constraints: string[]
  sourceKey?: SourceKey
  origin: ThreadOrigin
  /** 未被认领时为 undefined（§5.4 冷启动）。 */
  ownerWorkerID?: string
  status: ThreadStatus
  activeTurn?: string
  cwd?: string
  environment?: string
  budget?: ThreadBudget
  usage: { tokens: number; cost: number; turns: number }
  triggers: string[]
  lastSessionID?: string
  generation: number
  createdAt: number
  updatedAt: number
}

export type ThreadEvent = {
  id: string
  threadID: string
  kind: "trigger" | "user" | "worker" | "watchdog" | "system"
  priority: EventPriority
  dedupeKey?: string
  payload: unknown
  consumedAt?: number
  createdAt: number
}

/** 进展判据来自可观测事实，不接受模型自评（§7.2、Q9）。 */
export type ProgressFacts = {
  todosCompleted?: number
  blockersCleared?: number
  artifactsAdded?: number
  memoriesWritten?: number
  planChanged?: boolean
}

export type ThreadTurn = {
  id: string
  threadID: string
  sessionID: string
  /** `"trigger:watch-build"` / `"user"` / `"worker:abc"` / `"recovered"` */
  reason: string
  outcome?: "progress" | "no-progress" | "blocked" | "failed" | "aborted"
  facts?: ProgressFacts
  summary?: string
  startedAt: number
  endedAt?: number
}

export type ThreadInfo = Pick<Thread, "id" | "title" | "goal" | "status" | "usage"> & {
  sourceKey?: SourceKey
  ownerWorkerID?: string
  updatedAt: number
}

export type ThreadHandle = Thread

/* 触发器（贡献点 ⑲） */

export type TriggerKind = "timer" | "event" | "webhook" | "fs" | "git" | "condition" | "custom"

export type TriggerInput =
  | { kind: "timer"; at?: number; cron?: string }
  | { kind: "event"; type: string; properties: unknown }
  | { kind: "webhook"; method: string; path: string; headers: Record<string, string>; body: unknown }
  | { kind: "fs"; path: string; change: "add" | "change" | "unlink" }
  | { kind: "git"; repo: string; ref: string; event: "push" | "commit" | "conflict" }
  | { kind: "condition"; expression: string; every: number }
  | { kind: "custom"; payload: unknown }

export type TriggerEvent = {
  triggerID: string
  /** 缺省由事件内容哈希得到（§3.4）。 */
  dedupeKey?: string
  /** 同一来源的事件归同一条线程（§5.3）。 */
  sourceKey?: SourceKey
  priority?: EventPriority
  payload: unknown
  at: number
}

/** 事件到线程的映射；默认 `reuse`（Q12）。 */
export type ThreadTriggerBinding = {
  mode: "new" | "reuse" | "broadcast"
  /** `reuse`/`broadcast` 的匹配键，缺省为 `triggerID`。 */
  key?: string
}

export type TriggerContribution = {
  id: string
  kind: TriggerKind
  config?: JSONSchema
  /** 纯函数：快、无副作用（§3.2）。 */
  match(input: TriggerInput): boolean | Promise<boolean>
  normalize?(input: TriggerInput): TriggerEvent | TriggerEvent[]
  thread?: ThreadTriggerBinding
}

/* 快速路径 Fast path（贡献点 ⑳） */

export type FastPathContext = {
  /** 命中规则后写下的 0 token 结论。 */
  record(summary: string): Promise<void>
}

export type FastPathResult = { handled: true; summary: string } | { handled: false }

export type FastPathRule = {
  id: string
  when(event: TriggerEvent): boolean | Promise<boolean>
  handle(event: TriggerEvent, ctx: FastPathContext): Promise<FastPathResult>
  escalateOnError?: boolean
}

/** 内核只内置这 5 条通用规则，其余全部插件化（§3.3、Q11）。 */
export const builtinFastPathRules = [
  "builtin.dedupe",
  "builtin.known-issue",
  "builtin.heartbeat",
  "builtin.budget-exhausted",
  "builtin.mechanical-action",
] as const

export type BuiltinFastPathRule = (typeof builtinFastPathRules)[number]

/* 路由策略（贡献点 ㉑） */

export type RoutingInput = {
  event: TriggerEvent
  /** 该线程的一句话摘要，不带完整历史（§5.2）。 */
  threadSummary?: string
  candidates: ThreadInfo[]
}

/** 结构化判据，不是自由文本；结果写进 `router_decision`（§5.2）。 */
export type RoutingDecision = {
  act: boolean
  reason: string
  targetThread?: string
}

export type RoutingPolicyContribution = {
  id: string
  /** 只能用轻量模型（Q13）；Router 不做计划（§5.1）。 */
  decide(input: RoutingInput): Promise<RoutingDecision>
}

/* Worker 类型（贡献点 ㉒） */

export type WorkerType = "task" | "background" | "team" | "workflow"

export type WorkerUpdate =
  | { kind: "progress"; summary: string; artifactID?: string }
  | { kind: "message"; text: string }
  | { kind: "done"; summary: string; result?: unknown }
  | { kind: "error"; error: PluginError; retryable: boolean }

export type WorkerHandle = {
  id: string
  type: WorkerType | (string & {})
  /** 返回表示已受理，不代表完成（§6.2）。 */
  start(): Promise<void>
  /** 全双工：向运行中的 Worker 追加输入。 */
  send(input: { text: string; meta?: unknown }): Promise<void>
  next(): Promise<WorkerUpdate>
  stop(reason?: string): Promise<{ clean: boolean; partial?: string }>
}

export type WorkerStartInput = {
  threadID: string
  turnID: string
  goal: string
  constraints: string[]
  context: string
  budget?: ThreadBudget
}

export type WorkerTypeContribution = {
  id: WorkerType | (string & {})
  start(input: WorkerStartInput): Promise<WorkerHandle>
}

/* 监督规则（贡献点 ㉓） */

export type WatchdogAction = "nudge" | "replan" | "abort" | "none"

export type WatchdogVerdict = "stuck" | "no-progress" | "slow" | "healthy"

export type WatchdogInput = {
  thread: Thread
  turns: ThreadTurn[]
  /** 连续 `no-progress` 轮数（2 nudge / 4 replan / 6 abort，§7.3）。 */
  noProgressStreak: number
  /** 同一错误重复次数，3 次转 `known_issue`（§7.3）。 */
  repeatedErrorCount: number
  streamIdleMs: number
  budgetExhausted: boolean
}

export type WatchdogPolicyContribution = {
  id: string
  /** 规则层，每轮都跑且 0 token；Agent 解释层由内核按需创建（§7.4）。 */
  evaluate(input: WatchdogInput): WatchdogAction | undefined
}

export type ThreadDiagnosis = {
  id: string
  threadID: string
  turnID?: string
  verdict: WatchdogVerdict
  evidence: unknown[]
  suggestion?: string
  action: WatchdogAction
  /** 对应 Watchdog Session，用户可以在这个会话里继续追问（S10）。 */
  watchdogSessionID?: string
  createdAt: number
}

/* 通知通道（贡献点 ㉔） */

/** 对话通道不限长度；IM 通道 ≤ 100 字；结构化通道用卡片/表单/状态行（§9.1）。 */
export type ChannelKind = "conversation" | "im" | "structured"

export const imChannelTextLimit = 100

export type ChannelMessage = {
  threadID: string
  priority: EventPriority
  /** 同一线程在不同通道要给出不同粒度，禁止把对话内容直接推给 IM（§9.1）。 */
  text: string
  card?: Record<string, unknown>
  /** 需要人决策时携带；回复必须映射回具体 askID，超时未回 = 拒绝（§9.4）。 */
  askID?: string
}

export type ChannelContribution = {
  id: string
  kind: ChannelKind
  publish(message: ChannelMessage): Promise<void>
  subscribe?(handler: (message: ChannelMessage) => void): Disposable
}

/* KernelApi 的 super-agent 扩展（§12.2，第三方拿不到） */

export type KernelApiSuperAgent = {
  readonly threads: {
    open(input: {
      goal: string
      title?: string
      sourceKey?: SourceKey
      triggers?: string[]
      budget?: ThreadBudget
    }): Promise<ThreadHandle>
    get(threadID: string): Promise<Thread>
    post(input: { threadID: string; text: string; priority?: EventPriority }): Promise<void>
    wait(threadID: string, input?: { until?: "done" | "waiting"; timeoutMs?: number }): Promise<Thread>
    close(threadID: string, reason?: string): Promise<void>
    list(input?: { status?: ThreadStatus[] }): Promise<ThreadInfo[]>
    turns(threadID: string): Promise<ThreadTurn[]>
    claim(threadID: string, input: { worker: string }): Promise<void>
  }
  readonly channels: {
    publish(channelID: string, payload: unknown): Promise<void>
    subscribe(channelID: string, handler: (payload: unknown) => void): Disposable
  }
  readonly triggers: {
    register(trigger: TriggerContribution): Disposable
    /** 测试与手动触发（S1/S5 演练依赖它）。 */
    fire(triggerID: string, payload: unknown): Promise<void>
  }
}
