import { describe, expect, it as test } from "bun:test"
import { Effect } from "effect"
import { Service as OpLogService, defaultLayer as OpLogLayer, idempotencyKey, lockKey } from "@/team/op-log"
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
      //
      // `olderThanMs: 0` 就是恢复时用的值：刚刚才开始的操作同样要定性 ——
      // 它与恢复落在同一毫秒时，严格小于会把它漏掉，随后被当成「没执行过」。
      const marked = yield* ops.markUnknown({ runID: id, olderThanMs: 0 })
      expect(marked).toBe(1)
      // 已经回填结果的操作不是「不明」：恢复不该改写已知的事实。
      const doneKey = idempotencyKey({ scope: { runID: id }, tool: "bash", args: { command: "git status" } })
      const done = yield* ops.begin({ runID: id, tool: "bash", idempotencyKey: doneKey })
      yield* ops.finish({ id: done.op.id, outcome: "succeeded" })
      expect(yield* ops.markUnknown({ runID: id, olderThanMs: 0 })).toBe(0)
      const pending = yield* ops.needsReview(id)
      expect(pending.map((op) => op.outcome)).toEqual(["unknown"])
    }),
  )

  it.instance("scope is per session and can be cleared", () =>
    Effect.gen(function* () {
      const ops = yield* OpLogService
      const sessionID = SessionID.make("ses_scope")
      expect(yield* ops.scopeOf(sessionID)).toBeUndefined()
      yield* ops.scope({ sessionID, runID: "run_1", taskID: "team_a", attempt: 2, readOnly: false })
      // 策略随坐标一起登记，工具漏斗不用每次查库；未显式给出时字段缺省（按只读处理）。
      expect(yield* ops.scopeOf(sessionID)).toEqual({
        runID: "run_1",
        taskID: "team_a",
        attempt: 2,
        readOnly: false,
      })
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

describe("tool write lock key", () => {
  test("all sessions of one team share a key: a team has one worktree", () => {
    const scope = { runID: "run_1", taskID: "rt_1" }
    // 队长与成员是两个会话，写的是同一份工作区 —— 锁必须落在同一把钥匙上。
    expect(lockKey(scope, "ses_captain")).toBe(lockKey(scope, "ses_member"))
    expect(lockKey(scope, "ses_captain")).toBe("run:run_1:task:rt_1")
  })

  test("different teams in the same run do not share a key", () => {
    expect(lockKey({ runID: "run_1", taskID: "rt_1" }, "a")).not.toBe(lockKey({ runID: "run_1", taskID: "rt_2" }, "a"))
  })

  test("outside a run the session is the key, so unrelated chats never block each other", () => {
    expect(lockKey(undefined, "ses_a")).toBe("session:ses_a")
    expect(lockKey(undefined, "ses_a")).not.toBe(lockKey(undefined, "ses_b"))
  })

  test("a scoped session without a team id falls back to the run itself", () => {
    // 运行根会话（没有团队坐标）也不能和别的运行共用钥匙。
    expect(lockKey({ runID: "run_1" }, "ses_root")).toBe("run:run_1:task:-")
    expect(lockKey({ runID: "run_1" }, "ses_root")).not.toBe(lockKey({ runID: "run_2" }, "ses_root"))
  })
})
