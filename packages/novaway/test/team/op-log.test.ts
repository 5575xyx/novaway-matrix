import { describe, expect, it as test } from "bun:test"
import { Effect } from "effect"
import { Service as OpLogService, defaultLayer as OpLogLayer, idempotencyKey } from "@/team/op-log"
import { ToolOp } from "@/session/tool-op"
import { SessionID } from "@/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(OpLogLayer)

const runID = () => "run_" + Math.random().toString(36).slice(2, 9)

describe("team op-log", () => {
  test("keys the same call identically regardless of argument order", () => {
    const scope = { runID: "run_1", taskID: "team_a", attempt: 2 }
    const a = idempotencyKey({ scope, tool: "write", args: { filePath: "a.txt", content: "x" } })
    const b = idempotencyKey({ scope, tool: "write", args: { content: "x", filePath: "a.txt" } })
    expect(a).toBe(b)
    expect(a).not.toBe(idempotencyKey({ scope, tool: "edit", args: { filePath: "a.txt", content: "x" } }))
    expect(a).not.toBe(
      idempotencyKey({ scope: { ...scope, attempt: 3 }, tool: "write", args: { filePath: "a.txt", content: "x" } }),
    )
    expect(a.startsWith("run_1:team_a:2:write:")).toBe(true)
  })

  it.effect("a finished operation replays instead of re-running", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const id = runID()
      const key = idempotencyKey({ scope: { runID: id }, tool: "write", args: { path: "a" } })
      const first = yield* ops.begin({ runID: id, tool: "write", idempotencyKey: key })
      expect(first.replayed).toBe(false)
      yield* ops.finish({ id: first.op.id, outcome: "succeeded" })

      const second = yield* ops.begin({ runID: id, tool: "write", idempotencyKey: key })
      expect(second.replayed).toBe(true)
      expect(second.op.outcome).toBe("succeeded")
    }),
  )

  it.effect("stale started operations become unknown and need review", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const id = runID()
      const key = idempotencyKey({ scope: { runID: id }, tool: "bash", args: { command: "git push" } })
      yield* ops.begin({ runID: id, tool: "bash", idempotencyKey: key })
      // 进程被杀后重启：没有任何回填，恢复时统一判 unknown。
      const marked = yield* ops.markUnknown({ runID: id, olderThanMs: -1 })
      expect(marked).toBe(1)
      const pending = yield* ops.needsReview(id)
      expect(pending.map((op) => op.outcome)).toEqual(["unknown"])
    }),
  )

  it.instance("scope is per session and can be cleared", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const sessionID = SessionID.make("ses_scope")
      expect(yield* ops.scopeOf(sessionID)).toBeUndefined()
      yield* ops.scope({ sessionID, runID: "run_1", taskID: "team_a", attempt: 2 })
      expect(yield* ops.scopeOf(sessionID)).toEqual({ runID: "run_1", taskID: "team_a", attempt: 2 })
      yield* ops.unscope(sessionID)
      expect(yield* ops.scopeOf(sessionID)).toBeUndefined()
      expect((yield* TestInstance).directory).toBeTruthy()
    }),
  )
})

describe("tool op replay decision", () => {
  const op = (outcome: "started" | "succeeded" | "failed" | "unknown") => ({
    id: "op_1",
    runID: "run_1",
    tool: "write",
    idempotencyKey: "run_1:-:0:write:abc",
    startedAt: 1,
    outcome,
  })

  test("runs when there is no previous attempt", () => {
    expect(ToolOp.decide("write", undefined)).toEqual({ kind: "execute" })
  })

  test("skips a finished call instead of running it twice", () => {
    const skipped = ToolOp.decide("write", op("succeeded"))
    expect(skipped.kind).toBe("skip")
    if (skipped.kind !== "skip") return
    expect(skipped.output).toContain("already executed")
    expect(skipped.metadata.replayed).toBe(true)
  })

  test("refuses to continue when the previous outcome is unknown", () => {
    expect(ToolOp.decide("write", op("unknown")).kind).toBe("fail")
    expect(ToolOp.decide("write", op("started")).kind).toBe("fail")
  })
})
