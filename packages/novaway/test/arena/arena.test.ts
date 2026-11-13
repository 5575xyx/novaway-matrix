import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Arena, type ArenaDeps, type ContenderResult } from "@/arena/arena"
import type { RunAgent } from "@/session/agent-step"

function harness(input?: { skipped?: string; fail?: string }) {
  let active = 0
  let peak = 0
  const removed: string[] = []
  const called: string[] = []
  const runAgent: RunAgent = (request) =>
    Effect.gen(function* () {
      const name = request.title?.replace("Arena: ", "") ?? "unknown"
      called.push(name)
      if (name === input?.fail) {
        return yield* Effect.die(new Error("model exploded"))
      }
      active += 1
      peak = Math.max(peak, active)
      yield* Effect.sleep("10 millis")
      active -= 1
      return {
        text: `result from ${name}`,
        sessionID: name as never,
        usage: { cost: 0.1, tokens: 10 },
      }
    })

  const deps: ArenaDeps = {
    createWorktree: ({ name }) =>
      Effect.succeed(
        name === input?.skipped
          ? { kind: "skipped" as const, reason: "not a git repository" }
          : {
              kind: "created" as const,
              worktree: {
                directory: `/worktrees/${name}`,
                branch: `arena/${name}`,
                base: "/repo",
                baseSHA: "abc",
              },
            },
      ),
    runAgent,
    commit: () => Effect.succeed({ kind: "committed" as const, sha: "def", files: 1 }),
    diff: ({ directory }) =>
      Effect.succeed({
        baseSHA: "abc",
        head: "def",
        files: [{ path: `${directory}/file.ts`, added: 3, removed: 1, binary: false }],
        untracked: [],
        truncated: false,
      }),
    removeWorktree: ({ directory }) =>
      Effect.sync(() => {
        removed.push(directory)
      }),
  }

  return {
    deps,
    removed,
    called,
    peak: () => peak,
  }
}

const contenders = [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }]

describe("arena.run", () => {
  test("runs contenders concurrently in isolated worktrees and cleans them up", async () => {
    const h = harness()
    const result = await Effect.runPromise(
      Arena.run({ runID: "run-1", task: "fix the bug", contenders, concurrency: 2 }, h.deps),
    )

    expect(result.contenders).toHaveLength(3)
    expect(result.contenders.every((item) => item.status === "completed")).toBe(true)
    expect(result.contenders[0].diff?.files[0].path).toBe("/worktrees/alpha/file.ts")
    expect(h.peak()).toBe(2)
    expect(h.removed.sort()).toEqual(["/worktrees/alpha", "/worktrees/beta", "/worktrees/gamma"])
    expect(result.verified).toBe(false)
    expect(result.winner).toBeUndefined()
    expect(result.note).toContain("No verifier")
  })

  test("skips a contender whose worktree cannot be created instead of using the live checkout", async () => {
    const h = harness({ skipped: "beta" })
    const result = await Effect.runPromise(
      Arena.run({ runID: "run-2", task: "fix", contenders, concurrency: 1 }, h.deps),
    )

    const beta = result.contenders.find((item) => item.id === "beta")!
    expect(beta.status).toBe("skipped")
    expect(beta.error).toContain("not a git repository")
    expect(h.called).not.toContain("beta")
  })

  test("reports a failing contender but continues the others and still cleans up", async () => {
    const h = harness({ fail: "beta" })
    const result = await Effect.runPromise(
      Arena.run({ runID: "run-3", task: "fix", contenders, concurrency: 3 }, h.deps),
    )

    const beta = result.contenders.find((item) => item.id === "beta")!
    expect(beta.status).toBe("failed")
    expect(beta.error).toContain("model exploded")
    expect(h.removed).toContain("/worktrees/beta")
    expect(result.contenders.filter((item) => item.status === "completed")).toHaveLength(2)
  })

  test("only names a winner when verification leaves exactly one best contender", async () => {
    const h = harness()
    const verified = await Effect.runPromise(
      Arena.run(
        { runID: "run-4", task: "fix", contenders, concurrency: 2 },
        {
          ...h.deps,
          verify: ({ contender }) => Effect.succeed({ pass: true, score: contender.id === "gamma" ? 10 : 0 }),
        },
      ),
    )
    expect(verified.verified).toBe(true)
    expect(verified.winner).toBe("gamma")

    const tied = await Effect.runPromise(
      Arena.run(
        { runID: "run-5", task: "fix", contenders, concurrency: 2 },
        { ...h.deps, verify: () => Effect.succeed({ pass: true, score: 1 }) },
      ),
    )
    expect(tied.winner).toBeUndefined()
    expect(tied.note).toContain("tied")

    const nonePassed = await Effect.runPromise(
      Arena.run(
        { runID: "run-6", task: "fix", contenders, concurrency: 2 },
        { ...h.deps, verify: () => Effect.succeed({ pass: false }) },
      ),
    )
    expect(nonePassed.contenders.every((item: ContenderResult) => item.verdict === "fail")).toBe(true)
    expect(nonePassed.winner).toBeUndefined()
  })

  test("rejects duplicate contender ids instead of silently merging them", async () => {
    const h = harness()
    await expect(
      Effect.runPromise(Arena.run({ runID: "run-7", task: "fix", contenders: [{ id: "a" }, { id: "a" }] }, h.deps)),
    ).rejects.toThrow("duplicated")
  })

  // 验收命令在 worktree 里执行：早一步删掉副本，命令只能跑在空目录上，所有
  // contender 一律 fail —— 这正是真机跑出来的症状。
  test("keeps every worktree alive until verification finishes", async () => {
    const h = harness()
    let verified = 0
    const result = await Effect.runPromise(
      Arena.run(
        { runID: "run-8", task: "fix", contenders, concurrency: 2 },
        {
          ...h.deps,
          verify: ({ result }) =>
            Effect.sync(() => {
              verified += 1
              expect(h.removed).not.toContain(result.directory)
              return { pass: true, score: 1 }
            }),
        },
      ),
    )

    expect(verified).toBe(3)
    expect(h.removed.sort()).toEqual(["/worktrees/alpha", "/worktrees/beta", "/worktrees/gamma"])
    expect(result.contenders.every((item) => item.verdict === "pass")).toBe(true)
  })
})
