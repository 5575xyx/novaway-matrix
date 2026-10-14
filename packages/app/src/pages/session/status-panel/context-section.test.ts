import { describe, expect, test } from "bun:test"
import type { Message } from "@novaway/sdk/v2/client"
import type { SessionContextBreakdownSegment } from "@/components/session/session-context-breakdown"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { contextSectionModel, contextUsageSummary } from "./context-section-model"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
) =>
  ({
    id,
    role: "assistant",
    providerID: "openai",
    modelID: "gpt-4.1",
    cost: 0.1,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: { read: tokens.read, write: tokens.write },
    },
    time: { created: 1 },
  }) as unknown as Message

const metrics = (withLimit: boolean) =>
  getSessionContextMetrics(
    [assistant("a1", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 })],
    withLimit
      ? [{ id: "openai", name: "OpenAI", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 1000 } } } }]
      : [],
  )

const segment: SessionContextBreakdownSegment = { key: "user", tokens: 300, width: 100, percent: 100 }

describe("contextUsageSummary", () => {
  test("reports a percentage while a usage ratio is available", () => {
    expect(contextUsageSummary(50, 500)).toEqual({ kind: "percent", value: 50 })
  })

  test("falls back to the total token count when usage is unknown", () => {
    expect(contextUsageSummary(null, 500)).toEqual({ kind: "tokens", value: 500 })
  })
})

describe("contextSectionModel", () => {
  test("returns null when there is no session at all", () => {
    expect(contextSectionModel(undefined, [])).toBeNull()
  })

  test("returns null when the session carries no context data", () => {
    expect(contextSectionModel(getSessionContextMetrics([]), [])).toBeNull()
  })

  test("exposes the usage percentage and every token bucket when a context limit is known", () => {
    const model = contextSectionModel(metrics(true), [segment])
    expect(model).toEqual({
      summary: { kind: "percent", value: 50 },
      usage: 50,
      limit: 1000,
      total: 500,
      input: 300,
      output: 100,
      reasoning: 50,
      cacheRead: 25,
      cacheWrite: 25,
      breakdown: [segment],
    })
  })

  test("falls back to total tokens for the summary when the model exposes no context limit", () => {
    const model = contextSectionModel(metrics(false), [segment])
    if (!model) return
    expect(model.summary).toEqual({ kind: "tokens", value: 500 })
    expect(model.usage).toBeNull()
    expect(model.limit).toBeUndefined()
    expect(model.total).toBe(500)
    expect(model.breakdown).toEqual([segment])
  })

  test("passes an empty breakdown through instead of inventing one", () => {
    const model = contextSectionModel(metrics(true), [])
    if (!model) return
    expect(model.breakdown).toEqual([])
  })
})
