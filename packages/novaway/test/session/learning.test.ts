import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Learning } from "../../src/session/learning"
import { BackgroundJob } from "../../src/background/job"
import { testEffect } from "../lib/effect"

const it = testEffect(BackgroundJob.defaultLayer)

describe("session learning evidence", () => {
  test("detects secrets without rejecting personal preferences", () => {
    expect(Learning.sensitive("api_key: abcdefghijklmnop")).toBe(true)
    expect(Learning.sensitive("I prefer concise answers and call me Alex")).toBe(false)
  })

  test("blocks opted-out content from the evidence window and triggers", () => {
    const user = (id: string, text: string) =>
      ({
        info: { id, role: "user" },
        parts: [{ type: "text", text }],
      }) as unknown as import("../../src/session/message-v2").MessageV2.WithParts
    const context = Learning.window([user("u1", "不要记住这段偏好")], "u1")
    expect(context.optedOut).toBe(true)
    expect(context.entries).toEqual([])
    expect(Learning.trigger({ enabled: true, review: true, interval: 1, window: context })).toEqual({
      due: false,
      reason: "opt-out",
    })
  })

  test("accelerates review on corrections and repeated patterns", () => {
    const correction = Learning.trigger({
      enabled: true,
      review: true,
      interval: 3,
      window: {
        entries: [],
        transcript: "[]",
        sourceMessageIDs: [],
        turnCount: 1,
        optedOut: false,
        sensitive: false,
        signal: "correction",
        repeated: false,
        toolCallCount: 0,
      },
    })
    const repeated = Learning.trigger({
      enabled: true,
      review: true,
      interval: 3,
      window: {
        entries: [],
        transcript: "[]",
        sourceMessageIDs: [],
        turnCount: 1,
        optedOut: false,
        sensitive: false,
        repeated: true,
        toolCallCount: 0,
      },
    })
    expect(correction).toEqual({ due: true, reason: "correction" })
    expect(repeated).toEqual({ due: true, reason: "repeated-pattern" })
    expect(
      Learning.trigger({
        enabled: true,
        review: true,
        interval: 1,
        window: {
          entries: [],
          transcript: "[]",
          sourceMessageIDs: [],
          turnCount: 1,
          optedOut: false,
          sensitive: true,
          repeated: false,
          toolCallCount: 0,
        },
      }),
    ).toEqual({ due: false, reason: "sensitive" })
  })

  test("triggers skill extraction on tool activity, independent of the review interval", () => {
    const window = {
      entries: [],
      transcript: "[]",
      sourceMessageIDs: [],
      turnCount: 3,
      optedOut: false,
      sensitive: false,
      repeated: false,
      toolCallCount: 20,
    }
    expect(Learning.trigger({ enabled: true, review: true, interval: 2, window, toolThreshold: 20 })).toEqual({
      due: true,
      reason: "tool-activity",
    })
    // A zero review interval disables periodic review but not tool-activity extraction.
    expect(Learning.trigger({ enabled: true, review: true, interval: 0, window, toolThreshold: 20 })).toEqual({
      due: true,
      reason: "tool-activity",
    })
    expect(
      Learning.trigger({
        enabled: true,
        review: true,
        interval: 0,
        window: { ...window, toolCallCount: 3 },
        toolThreshold: 20,
      }),
    ).toEqual({ due: false, reason: "interval-zero" })
    expect(
      Learning.trigger({
        enabled: true,
        review: true,
        interval: 2,
        window: { ...window, toolCallCount: 3 },
        toolThreshold: 20,
      }),
    ).toEqual({ due: false, reason: "interval-not-due" })
    // Sensitive content still wins over tool activity.
    expect(
      Learning.trigger({
        enabled: true,
        review: true,
        interval: 2,
        window: { ...window, sensitive: true },
        toolThreshold: 20,
      }),
    ).toEqual({ due: false, reason: "sensitive" })
  })

  test("counts tool parts as tool calls in the evidence window", () => {
    const messages = [
      {
        info: { id: "u1", role: "user" },
        parts: [{ type: "text", text: "fix the build" }],
      },
      {
        info: { id: "a1", role: "assistant" },
        parts: [
          { type: "tool", tool: "bash", state: { status: "completed", output: "ok" } },
          { type: "tool", tool: "read", state: { status: "completed", output: "file" } },
          { type: "text", text: "done" },
        ],
      },
    ] as unknown as import("../../src/session/message-v2").MessageV2.WithParts[]
    expect(Learning.window(messages, "u1").toolCallCount).toBe(2)
  })

  test("requires exact user evidence and rejects conflicting automatic writes", () => {
    const context = {
      entries: [{ turnID: "u1", messageID: "u1", role: "user" as const, text: "Please always use tabs." }],
      transcript: "[]",
      sourceMessageIDs: ["u1"],
      sourceMessageID: "u1",
      turnCount: 1,
      optedOut: false,
      sensitive: false,
      repeated: false,
      toolCallCount: 0,
    }
    const grounded = {
      content: "Always use tabs",
      factKey: "indentation",
      operation: "add" as const,
      confidence: 0.95,
      basis: "explicit" as const,
      evidence: [{ messageID: "u1", quote: "always use tabs" }],
    }
    expect(Learning.cited(grounded, context)).toHaveLength(1)
    expect(Learning.autoApply(grounded, context, [])).toBe(true)
    expect(
      Learning.autoApply(grounded, context, [{ id: "existing", factKey: "indentation", content: "Use spaces" }]),
    ).toBe(false)
    expect(Learning.cited({ evidence: [{ messageID: "u1", quote: "invented quote" }] }, context)).toEqual([])
  })

  test("requires durable evidence before evolution review", () => {
    const context = {
      entries: [{ turnID: "u1", messageID: "u1", role: "user" as const, text: "以后每次改代码后都运行相关测试。" }],
      transcript: "[]",
      sourceMessageIDs: ["u1"],
      sourceMessageID: "u1",
      turnCount: 1,
      optedOut: false,
      sensitive: false,
      repeated: false,
      toolCallCount: 0,
    }
    const proposal = {
      content: "Run focused tests after each code change.",
      expectedOutcomes: ["Every code change has a focused test run recorded."],
      evidence: [{ messageID: "u1", quote: "以后每次改代码后都运行相关测试。" }],
    }
    expect(Learning.evolutionEvidence(proposal, context)).toBe(true)
    expect(Learning.evolutionEvidence({ ...proposal, evidence: [] }, context)).toBe(false)
  })

  it.instance("persists job outcomes and safe failure stages", () =>
    Effect.gen(function* () {
      const background = yield* BackgroundJob.Service
      const schedule = yield* Learning.makeScheduler
      const input = {
        type: "learning.memory" as const,
        projectID: "project-learning-test",
        sessionID: "session-learning-test",
        sourceMessageID: "message-learning-test",
        trigger: "correction",
        run: Effect.succeed(Learning.output("candidates", "awaiting-review", 2)),
      }
      const id = yield* schedule(background, input)
      if (!id) throw new Error("learning job was not scheduled")
      const result = yield* background.wait({ id })
      expect(result.info?.status).toBe("completed")
      expect(result.info?.metadata).toMatchObject({ trigger: "correction", outcome: "candidates", candidateCount: 2 })
      expect(JSON.parse(result.info?.output ?? "{}")).toMatchObject({ outcome: "candidates", candidateCount: 2 })

      const failedInput = {
        ...input,
        sourceMessageID: "message-learning-failure-test",
        run: Learning.stage("memory-inference", Effect.fail(new Error("secret request data should not persist"))).pipe(
          Effect.mapError((error): unknown => error),
        ),
      }
      const failedID = yield* schedule(background, failedInput)
      if (!failedID) throw new Error("failed learning job was not scheduled")
      const failed = yield* background.wait({ id: failedID })
      expect(failed.info?.status).toBe("error")
      expect(failed.info?.error).toBe("Learning failed at memory-inference")
      expect(failed.info?.metadata).toMatchObject({ stage: "memory-inference" })
      expect(JSON.stringify(failed.info)).not.toContain("secret request data")
    }),
  )
})
