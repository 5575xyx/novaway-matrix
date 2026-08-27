import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { OrchestratorService, defaultLayer } from "../../src/orchestrator/orchestrator"
import type { RunAgent } from "../../src/session/agent-step"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"

const runOrch = <A>(effect: Effect.Effect<A, unknown, OrchestratorService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(defaultLayer)))

function seedSession(id: string) {
  const sessionID = SessionID.make(id)
  Database.use((db) => {
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run()
    db.insert(SessionTable)
      .values({ id: sessionID, project_id: ProjectID.global, slug: id, directory: "", title: id, version: "test" })
      .onConflictDoNothing()
      .run()
  })
  return sessionID
}

// 顺序记录 + 回显的假 runAgent。
function makeRecordingAgent() {
  const order: string[] = []
  const prompts: string[] = []
  const runAgent: RunAgent = (input) =>
    Effect.sync(() => {
      order.push(input.agent)
      prompts.push(input.prompt)
      return `out:${input.title}`
    })
  return { runAgent, order, prompts }
}

describe("orchestrator executePlan", () => {
  test("runs dependent tasks after their dependencies and interpolates results", async () => {
    const sessionID = seedSession(`ses_orch_deps_${Date.now()}`)
    const { runAgent, prompts } = makeRecordingAgent()

    const result = await runOrch(
      OrchestratorService.use((orch) =>
        Effect.gen(function* () {
        const plan = yield* orch.createPlan({
          sessionId: sessionID,
          name: "deps",
          tasks: [
            { name: "first", type: "agent", config: { agent: "build", prompt: "do first" }, dependencies: [] },
            {
              name: "second",
              type: "agent",
              // 依赖 task_0,提示词插值上游结果
              config: { agent: "build", prompt: "use {{task_0}}" },
              dependencies: ["task_0"],
            },
          ],
        })
        return yield* orch.executePlan({ planId: plan.id, runAgent, defaultAgent: "build" })
        }),
      ),
    )

    expect(result.status).toBe("completed")
    const [t0, t1] = result.tasks
    expect(t0.status).toBe("completed")
    expect(t1.status).toBe("completed")
    expect(t0.result).toBe("out:first")
    // second 任务提示词应包含 first 的结果(插值成功证明依赖先完成)
    expect(prompts).toContain("use out:first")
  })

  test("fails the plan when a task has an unsatisfiable dependency", async () => {
    const sessionID = seedSession(`ses_orch_missing_${Date.now()}`)
    const { runAgent } = makeRecordingAgent()

    const result = await runOrch(
      OrchestratorService.use((orch) =>
        Effect.gen(function* () {
        const plan = yield* orch.createPlan({
          sessionId: sessionID,
          name: "missing-dep",
          tasks: [
            {
              name: "orphan",
              type: "agent",
              config: { agent: "build", prompt: "never runs" },
              dependencies: ["task_99"], // 不存在的依赖
            },
          ],
        })
        return yield* orch.executePlan({ planId: plan.id, runAgent, defaultAgent: "build" })
        }),
      ),
    )

    expect(result.status).toBe("failed")
    expect(result.tasks[0].status).toBe("failed")
    expect(result.error).toBeTruthy()
  })

  test("marks the plan failed but does not crash when a task errors", async () => {
    const sessionID = seedSession(`ses_orch_err_${Date.now()}`)
    const runAgent: RunAgent = (input) =>
      input.title === "bad" ? Effect.fail(new Error("task boom")) : Effect.succeed("ok")

    const result = await runOrch(
      OrchestratorService.use((orch) =>
        Effect.gen(function* () {
        const plan = yield* orch.createPlan({
          sessionId: sessionID,
          name: "one-fails",
          tasks: [
            { name: "good", type: "agent", config: { agent: "build", prompt: "ok" }, dependencies: [] },
            { name: "bad", type: "agent", config: { agent: "build", prompt: "fail" }, dependencies: [] },
          ],
        })
        return yield* orch.executePlan({ planId: plan.id, runAgent, defaultAgent: "build" })
        }),
      ),
    )

    expect(result.status).toBe("failed")
    const bad = result.tasks.find((t) => t.name === "bad")
    const good = result.tasks.find((t) => t.name === "good")
    expect(good?.status).toBe("completed")
    expect(bad?.status).toBe("failed")
    expect(bad?.error).toContain("task boom")
  })
})
