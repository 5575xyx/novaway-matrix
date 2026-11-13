import { describe, expect, test } from "bun:test"
import { ArenaStore } from "@/arena/store"
import type { RunResult } from "@/arena/arena"

const diff = {
  baseSHA: "0000000",
  head: "1111111",
  files: [{ path: "src/a.ts", added: 3, removed: 1, binary: false }],
  untracked: ["src/new.ts"],
  truncated: false,
}

const result = (runID: string, statuses: Array<"completed" | "failed"> = ["completed"]): RunResult => ({
  runID,
  task: "make the tests pass",
  contenders: statuses.map((status, index) => ({
    id: index === 0 ? "alpha" : "beta",
    status,
    ...(status === "completed"
      ? {
          sessionID: `ses_${runID}_${index}`,
          text: `answer ${index}`,
          diff,
          usage: { cost: 0.5, tokens: 1200 },
          verdict: index === 0 ? ("pass" as const) : ("fail" as const),
          score: index === 0 ? 9 : 2,
        }
      : { error: "worktree failed" }),
    durationMs: 1000 + index,
  })),
  ...(statuses.includes("completed") ? { winner: "alpha" } : {}),
  verified: true,
  note: "verified by command",
})

describe("arena store", () => {
  test("round-trips a run and its contenders", () => {
    const runID = "arena-test-roundtrip"
    ArenaStore.record(result(runID))

    const summary = ArenaStore.list(50).find((item) => item.run.id === runID)
    expect(summary).toBeDefined()
    expect(summary!.contenders).toBe(1)
    expect(summary!.run.winner).toBe("alpha")
    expect(summary!.run.verified).toBe(true)
    expect(summary!.run.note).toBe("verified by command")

    const detail = ArenaStore.get(runID)
    expect(detail).toBeDefined()
    expect(detail!.contenders).toHaveLength(1)
    const contender = detail!.contenders[0]
    expect(contender.contender_id).toBe("alpha")
    expect(contender.status).toBe("completed")
    expect(contender.verdict).toBe("pass")
    expect(contender.score).toBe(9)
    expect(contender.usage).toEqual({ cost: 0.5, tokens: 1200 })
    expect(contender.diff).toEqual(diff)
  })

  test("marks a run failed when every contender failed", () => {
    const runID = "arena-test-all-failed"
    ArenaStore.record(result(runID, ["failed", "failed"]))

    const detail = ArenaStore.get(runID)
    expect(detail!.run.status).toBe("failed")
    expect(detail!.run.winner).toBeNull()
    expect(detail!.contenders.map((item) => item.error)).toEqual(["worktree failed", "worktree failed"])
  })

  test("returns undefined for an unknown run", () => {
    expect(ArenaStore.get("arena-test-missing")).toBeUndefined()
  })
})
