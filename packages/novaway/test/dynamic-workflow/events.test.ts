import { describe, expect, test } from "bun:test"
import { Event, toBusEvents } from "../../src/dynamic-workflow/events"
import type { RunEvent } from "../../src/dynamic-workflow/engine/types"

// 总线事件是界面唯一的输入。这里钉两件事：映射不丢东西，以及载荷有界——
// 一条 1 MB 的 report 进了总线，每个订阅者都得替它付内存。

const context = { phases: ["调查", "复核"], siteCount: 7, name: "评审", parentSessionID: "ses_1" }

function map(event: RunEvent) {
  return toBusEvents(event, context)
}

describe("总线事件映射", () => {
  test("run-started 带上形状，界面先画骨架", () => {
    const [item] = map({ type: "run-started", runId: "r1", maxConcurrency: 6 })
    expect(item!.def.type).toBe(Event.RunStarted.type)
    expect(item!.properties).toEqual({
      runId: "r1",
      name: "评审",
      parentSessionID: "ses_1",
      phases: ["调查", "复核"],
      siteCount: 7,
      maxConcurrency: 6,
    })
  })

  test("恢复时标出从哪一次来的", () => {
    const [item] = toBusEvents(
      { type: "run-started", runId: "r2", maxConcurrency: 2 },
      {
        ...context,
        resumedFrom: "r1",
      },
    )
    expect((item!.properties as { resumedFrom?: string }).resumedFrom).toBe("r1")
  })

  test("阶段与报告各走一条，报告被有界化", () => {
    const [phase] = map({ type: "phase-entered", runId: "r1", name: "复核" })
    expect(phase!.def.type).toBe(Event.PhaseEntered.type)
    expect(phase!.properties).toEqual({ runId: "r1", name: "复核" })

    const [report] = map({
      type: "report",
      runId: "r1",
      instance: { siteId: "report#1", ordinal: 1 },
      item: { ok: true },
    })
    expect(report!.def.type).toBe(Event.Report.type)
    expect(report!.properties).toEqual({ runId: "r1", item: { ok: true } })

    const [big] = map({
      type: "report",
      runId: "r1",
      instance: { siteId: "report#1", ordinal: 2 },
      item: { blob: "x".repeat(64 * 1024) },
    })
    expect(big!.properties).toEqual({
      runId: "r1",
      item: { truncated: true, reason: expect.stringContaining("超过") },
    })
  })

  test("节点起止都带上种类，结算标出是否走缓存", () => {
    const [started] = map({
      type: "node-started",
      runId: "r1",
      instance: { siteId: "world-read#1", ordinal: 2 },
      kind: "world-read",
      phase: "调查",
    })
    expect(started!.properties).toEqual({
      runId: "r1",
      siteId: "world-read#1",
      ordinal: 2,
      kind: "world-read",
      status: "running",
      phase: "调查",
    })

    const [settled] = map({
      type: "node-settled",
      runId: "r1",
      instance: { siteId: "ask#1", ordinal: 1 },
      kind: "ask",
      status: "completed",
      cached: true,
    })
    expect(settled!.properties).toEqual({
      runId: "r1",
      siteId: "ask#1",
      ordinal: 1,
      kind: "ask",
      status: "completed",
      cached: true,
    })
  })

  test("结算只保留给界面看的字段，值仍然有界", () => {
    const [done] = map({
      type: "run-settled",
      runId: "r1",
      settlement: { status: "completed", value: { blob: "y".repeat(64 * 1024) }, spentTokens: 42 },
    })
    expect(done!.def.type).toBe(Event.RunSettled.type)
    const properties = done!.properties as { settlement: { status: string; spentTokens: number; value: unknown } }
    expect(properties.settlement.status).toBe("completed")
    expect(properties.settlement.spentTokens).toBe(42)
    expect(properties.settlement.value).toEqual({ truncated: true, reason: expect.stringContaining("超过") })

    const [stopped] = map({
      type: "run-settled",
      runId: "r1",
      settlement: { status: "stopped", reason: "user", spentTokens: 3 },
    })
    expect((stopped!.properties as { settlement: unknown }).settlement).toEqual({
      status: "stopped",
      reason: "user",
      spentTokens: 3,
    })
  })

  test("旁白与子代理创建不上总线", () => {
    expect(map({ type: "log", runId: "r1", message: "…" })).toHaveLength(0)
    expect(map({ type: "actor-created", runId: "r1", actor: { siteId: "actor#1", ordinal: 1 } })).toHaveLength(0)
  })
})
