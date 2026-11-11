/**
 * 工作流事件的总线出口（Boundary C 的公开形态）。
 *
 * 为什么单开一组事件而不是复用 `agent.*`：工作流有自己的时间轴——阶段、报告、每个节点的
 * 起止。把它们塞进子代理事件里，界面就只能显示「有 N 个子代理在跑」，显示不了「现在在
 * 第几步、跑出了什么」。
 *
 * **有界**：报告是模型产出的任意 JSON，一条就可能几十 KB。事件走的是进程内广播 + 全局
 * 事件流，堆大的东西进总线只会让每个订阅者都替它付内存。所以这里按字节截断，截断后明确
 * 标出来，而不是让接收方以为「报告就长这样」。
 */

import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import type { RunEvent, Settlement } from "./engine/types"

/** 单条事件载荷的上限（字节）。超过就换成一个截断说明。 */
const MAX_PAYLOAD_BYTES = 16 * 1024

/** 把任意值压到上限以内。与 journal 的策略一致：换掉，不截半截 JSON。 */
function bounded(value: unknown): unknown {
  try {
    const text = JSON.stringify(value)
    if (text !== undefined && Buffer.byteLength(text, "utf8") <= MAX_PAYLOAD_BYTES) return value
  } catch {
    return { truncated: true, reason: "无法序列化为 JSON" }
  }
  return { truncated: true, reason: `超过 ${MAX_PAYLOAD_BYTES} 字节` }
}

/** 结算的线上形态。刻意与 `Settlement` 同构，但把值压到有界。 */
export const SettlementSchema = Schema.Struct({
  status: Schema.Literals(["completed", "errored", "stopped"]),
  value: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      message: Schema.String,
      code: Schema.optional(Schema.String),
      retryable: Schema.optional(Schema.Boolean),
    }),
  ),
  reason: Schema.optional(Schema.Literals(["user", "model", "provider", "interrupted"])),
  spentTokens: Schema.Number,
}).annotate({ identifier: "DynamicWorkflowSettlement" })

export const Event = {
  /** 一次 run 开始。带形状（阶段、站点数），界面据此先画出骨架。 */
  RunStarted: BusEvent.define(
    "workflow.run.started",
    Schema.Struct({
      runId: Schema.String,
      name: Schema.optional(Schema.String),
      parentSessionID: Schema.optional(Schema.String),
      phases: Schema.Array(Schema.String),
      siteCount: Schema.Number,
      maxConcurrency: Schema.Number,
      resumedFrom: Schema.optional(Schema.String),
    }),
  ),
  /** 进入了一个阶段。名字就是作者写在 `phase("…")` 里的词。 */
  PhaseEntered: BusEvent.define("workflow.phase.entered", Schema.Struct({ runId: Schema.String, name: Schema.String })),
  /** 一条中间结果（`report(item)`）。`item` 已按 {@link MAX_PAYLOAD_BYTES} 有界。 */
  Report: BusEvent.define("workflow.report", Schema.Struct({ runId: Schema.String, item: Schema.Unknown })),
  /** 一个节点开始或结束。`cached` 为真表示答案来自 journal，本次没有真的执行。 */
  NodeChanged: BusEvent.define(
    "workflow.node.changed",
    Schema.Struct({
      runId: Schema.String,
      siteId: Schema.String,
      ordinal: Schema.Number,
      kind: Schema.String,
      status: Schema.Literals(["running", "completed", "failed"]),
      phase: Schema.optional(Schema.String),
      cached: Schema.optional(Schema.Boolean),
    }),
  ),
  /** 结算。终态一次。 */
  RunSettled: BusEvent.define(
    "workflow.run.settled",
    Schema.Struct({
      runId: Schema.String,
      name: Schema.optional(Schema.String),
      settlement: SettlementSchema,
    }),
  ),
} as const

/** 结算的线上形态：与 `Settlement` 同构，但结算值要压到有界。 */
function settlementOf(settlement: Settlement): Schema.Schema.Type<typeof SettlementSchema> {
  return {
    status: settlement.status,
    ...(settlement.status === "completed" ? { value: bounded(settlement.value) } : {}),
    ...(settlement.status === "errored"
      ? {
          error: {
            name: settlement.error.name,
            message: settlement.error.message,
            ...(settlement.error.code ? { code: settlement.error.code } : {}),
            ...(settlement.error.retryable !== undefined ? { retryable: settlement.error.retryable } : {}),
          },
        }
      : {}),
    ...(settlement.status === "stopped"
      ? {
          reason: settlement.reason,
          ...(settlement.error ? { error: { name: settlement.error.name, message: settlement.error.message } } : {}),
        }
      : {}),
    spentTokens: settlement.spentTokens,
  }
}

/**
 * 把引擎事件翻成总线事件。
 *
 * 返回 `undefined` 的那些（`log`、`actor-created`）刻意不上总线：日志是旁白，子代理列表
 * 由会话事件自己负责，重复一份只会让订阅者去重。
 */
/** 一条待发布的总线事件。`properties` 的类型由 `def` 决定，这里只保证成对出现。 */
export interface BusPublishable {
  readonly def: BusEvent.Definition<string, Schema.Top>
  readonly properties: Record<string, unknown>
}

export function toBusEvents(
  event: RunEvent,
  context: {
    readonly phases: readonly string[]
    readonly siteCount: number
    readonly name?: string
    readonly parentSessionID?: string
    readonly resumedFrom?: string
  },
): BusPublishable[] {
  const out: BusPublishable[] = []
  const push = (def: BusEvent.Definition<string, Schema.Top>, properties: Record<string, unknown>) =>
    out.push({ def, properties })

  switch (event.type) {
    case "run-started":
      push(Event.RunStarted, {
        runId: event.runId,
        ...(context.name ? { name: context.name } : {}),
        ...(context.parentSessionID ? { parentSessionID: context.parentSessionID } : {}),
        phases: [...context.phases],
        siteCount: context.siteCount,
        maxConcurrency: event.maxConcurrency,
        ...(context.resumedFrom ? { resumedFrom: context.resumedFrom } : {}),
      })
      return out
    case "phase-entered":
      push(Event.PhaseEntered, { runId: event.runId, name: event.name })
      return out
    case "report":
      push(Event.Report, { runId: event.runId, item: bounded(event.item) })
      return out
    case "node-started":
      push(Event.NodeChanged, {
        runId: event.runId,
        siteId: event.instance.siteId,
        ordinal: event.instance.ordinal,
        kind: event.kind,
        status: "running",
        ...(event.phase ? { phase: event.phase } : {}),
      })
      return out
    case "node-settled":
      push(Event.NodeChanged, {
        runId: event.runId,
        siteId: event.instance.siteId,
        ordinal: event.instance.ordinal,
        kind: event.kind,
        status: event.status,
        ...(event.cached ? { cached: true } : {}),
      })
      return out
    case "run-settled":
      push(Event.RunSettled, {
        runId: event.runId,
        ...(context.name ? { name: context.name } : {}),
        settlement: settlementOf(event.settlement),
      })
      return out
    default:
      return out
  }
}
