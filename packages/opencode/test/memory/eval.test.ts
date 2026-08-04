import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Memory } from "../../src/memory/service"
import { evaluateRetrieval, summarizeRetrievalEval, type RetrievalEvalCase } from "../../src/memory/eval"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Database } from "../../src/storage/db"

const runMemory = <A>(effect: Effect.Effect<A, unknown, Memory.Service>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Memory.defaultLayer)))

function seedProject() {
  Database.use((db) =>
    db.insert(ProjectTable).values({ id: ProjectID.global, worktree: "", sandboxes: [] }).onConflictDoNothing().run(),
  )
}

describe("memory retrieval eval", () => {
  test("measures precision, recall, MRR and hit rate over representative scenarios", async () => {
    seedProject()
    const [product, customer, preference, episodic, office, ops, research, personal] = await Promise.all([
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
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "上周完成了季度会议，确定了下半年目标。",
            scope: "global",
            kind: "episodic",
          }),
        ),
      ),
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "季度会议每周三上午 10 点，使用腾讯会议。",
            scope: "global",
            kind: "procedure",
          }),
        ),
      ),
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "生产环境告警先查日志再回滚，避免直接重启。",
            scope: "global",
            kind: "lesson",
          }),
        ),
      ),
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "竞品分析关注定价、渠道和交付方式。",
            scope: "global",
            kind: "semantic",
          }),
        ),
      ),
      runMemory(
        Memory.Service.use((memory) =>
          memory.add({
            content: "我需要提前一天收到重要日程提醒。",
            scope: "global",
            kind: "preference",
          }),
        ),
      ),
    ])

    const cases: RetrievalEvalCase[] = [
      { query: "NovaWay 主产品线 决定", expected: [product.id], k: 3 },
      { query: "张伟 NovaWay 客户 采购", expected: [customer.id], k: 3 },
      { query: "晚上工作 偏好 专注", expected: [preference.id], k: 3 },
      { query: "季度会议 下半年 目标", expected: [episodic.id], k: 3 },
      { query: "周三 腾讯会议 季度会议", expected: [office.id], k: 3 },
      { query: "生产告警 回滚 日志", expected: [ops.id], k: 3 },
      { query: "竞品 定价 渠道 交付", expected: [research.id], k: 3 },
      { query: "日程提醒 提前一天", expected: [personal.id], k: 3 },
    ]
    const results = []
    for (const scenario of cases) {
      const items = await runMemory(
        Memory.Service.use((memory) =>
          memory.list({
            scope: "global",
            search: scenario.query,
            limit: scenario.k,
          }),
        ),
      )
      results.push(
        evaluateRetrieval({
          query: scenario.query,
          expected: scenario.expected,
          retrieved: items.map((item) => item.id),
          k: scenario.k,
        }),
      )
    }
    const summary = summarizeRetrievalEval(results)

    expect(summary.cases).toBe(8)
    expect(summary.expected).toBe(8)
    expect(summary.hitRate).toBeGreaterThanOrEqual(0.75)
    expect(summary.avgMrr).toBeGreaterThanOrEqual(0.75)
    expect(summary.avgRecallAtK).toBeGreaterThanOrEqual(0.75)
  })
})
