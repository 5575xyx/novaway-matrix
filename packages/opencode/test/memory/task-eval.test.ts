import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Memory } from "../../src/memory/service"
import { evaluateTaskCoverage, summarizeTaskComparison, type TaskComparisonScenario } from "../../src/memory/task-eval"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"

const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

function seedSession(id: string) {
  const sessionID = SessionID.make(id)
  Database.use((db) => {
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run()
    db.insert(SessionTable)
      .values({
        id: sessionID,
        project_id: ProjectID.global,
        slug: id,
        directory: "",
        title: id,
        version: "test",
      })
      .onConflictDoNothing()
      .run()
  })
  return sessionID
}

describe("memory task comparison", () => {
  test("measures no memory vs memory only vs memory plus relations", async () => {
    const sessionID = seedSession(`ses_task_eval_${Date.now()}`)
    const [product, customer, preference] = await Promise.all([
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "NovaWay 是主产品线，团队决定长期投入。",
            scope: "global",
            kind: "decision",
            entities: [{ name: "NovaWay", type: "product" }],
          }),
        ),
      ),
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "张伟是 NovaWay 的客户，负责产品采购。",
            scope: "global",
            kind: "relationship",
            entities: [
              { name: "张伟", type: "person" },
              { name: "NovaWay", type: "product" },
            ],
          }),
        ),
      ),
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "我喜欢晚上工作，深夜专注力最好。",
            scope: "global",
            kind: "preference",
          }),
        ),
      ),
    ])

    const scenarios: TaskComparisonScenario[] = [
      { id: "product", task: "NovaWay 主产品线 决定", expectedMemoryIds: [product.id] },
      {
        id: "customer",
        task: "张伟 NovaWay 客户 采购",
        expectedMemoryIds: [customer.id],
        expectedRelationClues: ["张伟 是 NovaWay"],
      },
      { id: "preference", task: "晚上工作 偏好 专注", expectedMemoryIds: [preference.id] },
    ]

    const results = []
    for (const scenario of scenarios) {
      const items = await runMemory(
        Memory.Service.use((memory) =>
          memory.list({
            scope: "global",
            search: scenario.task,
            limit: 5,
          }),
        ),
      )
      const context = await runMemory(
        Memory.Service.use((memory) =>
          memory.prefetch({
            query: scenario.task,
            projectID: ProjectID.global,
            sessionID,
            limit: 5,
          }),
        ),
      )
      results.push(
        evaluateTaskCoverage({
          scenario,
          memoryIds: items.map((item) => item.id),
          prefetchText: context,
        }),
      )
    }
    const summary = summarizeTaskComparison(results)

    expect(summary.noMemoryCoverage).toBe(0)
    expect(summary.memoryOnlyCoverage).toBeGreaterThanOrEqual(0.75)
    expect(summary.memoryPlusRelationsCoverage).toBeGreaterThanOrEqual(0.75)
    expect(summary.relationCoverage).toBeGreaterThanOrEqual(0.75)
  })
})
