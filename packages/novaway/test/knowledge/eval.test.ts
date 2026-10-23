import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { listCases, removeCase, runEval, saveCase, scoreCase, summarize } from "@/knowledge/eval"

const roots: string[] = []
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-eval-"))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("knowledge.eval", () => {
  test("scores rank, reciprocal rank and recall", () => {
    const result = scoreCase({
      expected: ["Deployment guide", "Rollback"],
      hits: [
        { title: "Design tokens", documentID: "d2" },
        { title: "Deployment guide", documentID: "d1" },
        { title: "Rollback", documentID: "d3" },
      ],
      k: 5,
    })
    expect(result.rank).toBe(2)
    expect(result.reciprocalRank).toBe(0.5)
    expect(result.recall).toBe(1)
  })

  test("missing expected documents score zero", () => {
    const result = scoreCase({
      expected: ["Nothing"],
      hits: [{ title: "Something", documentID: "d1" }],
      k: 5,
    })
    expect(result.rank).toBe(0)
    expect(result.recall).toBe(0)
  })

  test("summarizes metrics", () => {
    const metrics = summarize(
      [
        { id: "1", query: "a", expected: ["A"], hits: ["A"], rank: 1, reciprocalRank: 1, recall: 1, latencyMs: 10 },
        { id: "2", query: "b", expected: ["B"], hits: ["X"], rank: 0, reciprocalRank: 0, recall: 0, latencyMs: 30 },
      ],
      5,
    )
    expect(metrics.hitRate).toBe(0.5)
    expect(metrics.mrr).toBe(0.5)
    expect(metrics.avgLatencyMs).toBe(20)
  })

  test("stores, updates and removes cases", async () => {
    const root = await tempRoot()
    const created = await saveCase("kb_test", { query: "how to deploy", expected: ["Deployment", "Rollback"] }, root)
    expect(created.id.startsWith("kbe_")).toBe(true)
    expect(await listCases("kb_test", root)).toHaveLength(1)

    const updated = await saveCase(
      "kb_test",
      { id: created.id, query: "how to deploy safely", expected: ["Deployment"], notes: "tweak" },
      root,
    )
    expect(updated.id).toBe(created.id)
    expect(updated.query).toBe("how to deploy safely")
    expect(updated.notes).toBe("tweak")
    expect(await listCases("kb_test", root)).toHaveLength(1)

    expect(await removeCase("kb_test", created.id, root)).toBe(true)
    expect(await listCases("kb_test", root)).toHaveLength(0)
  })

  test("runs every case and reports latency", async () => {
    const root = await tempRoot()
    await saveCase("kb_run", { query: "deploy", expected: ["Deployment"] }, root)
    await saveCase("kb_run", { query: "billing", expected: ["Billing"] }, root)

    const run = await runEval(
      {
        collectionID: "kb_run",
        k: 3,
        search: async (query) =>
          query === "deploy"
            ? [{ title: "Deployment", documentID: "d1" } as never]
            : [{ title: "Billing", documentID: "d2" } as never],
      },
      root,
    )
    expect(run.results).toHaveLength(2)
    expect(run.metrics.hitRate).toBe(1)
    expect(run.metrics.mrr).toBe(1)
    expect(run.k).toBe(3)
  })

  test("rejects invalid ids", async () => {
    await expect(listCases("../etc")).rejects.toThrow()
  })
})

describe("knowledge.eval history", () => {
  const run = (k: number, hitRate: number, mrr: number, latency = 10) => ({
    ranAt: Date.now(),
    k,
    metrics: { cases: 2, k, hitRate, recall: hitRate, mrr, avgLatencyMs: latency },
    results: [],
  })

  test("appends and caps history", async () => {
    const root = await tempRoot()
    const { appendHistory, listHistory, HISTORY_LIMIT } = await import("@/knowledge/eval")
    for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
      await appendHistory("kb_hist", run(5, index / 100, index / 100), root)
    }
    const list = await listHistory("kb_hist", root)
    expect(list).toHaveLength(HISTORY_LIMIT)
    // 保留最新的（hitRate 最大）
    expect(list[list.length - 1].metrics.hitRate).toBeCloseTo((HISTORY_LIMIT + 4) / 100, 5)
  })

  test("trend compares only runs with the same k", async () => {
    const root = await tempRoot()
    const { appendHistory, listHistory, trend } = await import("@/knowledge/eval")
    const first = await appendHistory("kb_trend", run(5, 0.4, 0.3, 20), root)
    const second = await appendHistory("kb_trend", run(10, 0.9, 0.8, 5), root)
    const third = await appendHistory("kb_trend", run(5, 0.6, 0.5, 15), root)
    expect(first.k).toBe(5)

    const history = await listHistory("kb_trend", root)
    const result = trend(history, third)
    expect(result.baseline?.id).toBe(first.id)
    expect(result.delta.hitRate).toBeCloseTo(0.2, 5)
    expect(result.delta.mrr).toBeCloseTo(0.2, 5)
    expect(result.delta.avgLatencyMs).toBe(-5)

    // 不同 k 不参与比较
    expect(trend(history, second).baseline).toBeUndefined()
  })

  test("series returns chronological points with deltas", async () => {
    const root = await tempRoot()
    const { appendHistory, listHistory, series } = await import("@/knowledge/eval")
    await appendHistory("kb_series", run(5, 0.3, 0.2), root)
    await appendHistory("kb_series", run(5, 0.5, 0.4), root)
    const points = series(await listHistory("kb_series", root), 5)
    expect(points).toHaveLength(2)
    expect(points[0].hitRateDelta).toBe(0)
    expect(points[1].hitRateDelta).toBeCloseTo(0.2, 5)
    expect(points[1].mrrDelta).toBeCloseTo(0.2, 5)
  })

  test("clears history", async () => {
    const root = await tempRoot()
    const { appendHistory, clearHistory, listHistory } = await import("@/knowledge/eval")
    await appendHistory("kb_clear", run(5, 0.1, 0.1), root)
    await clearHistory("kb_clear", root)
    expect(await listHistory("kb_clear", root)).toEqual([])
  })
})

describe("knowledge.eval diff", () => {
  const entry = (id: string, ranAt: number, results: Array<{ id: string; query: string; rank: number }>) => ({
    id,
    ranAt,
    k: 5,
    cases: results.length,
    results,
    metrics: { cases: results.length, k: 5, hitRate: 0, recall: 0, mrr: 0, avgLatencyMs: 0 },
  })

  test("classifies improved, regressed, unchanged, new and removed", async () => {
    const { diffRuns } = await import("@/knowledge/eval")
    const from = entry("r1", 1, [
      { id: "a", query: "a", rank: 0 },
      { id: "b", query: "b", rank: 2 },
      { id: "c", query: "c", rank: 3 },
      { id: "d", query: "d", rank: 0 },
    ])
    const to = entry("r2", 2, [
      { id: "a", query: "a", rank: 1 },
      { id: "b", query: "b", rank: 0 },
      { id: "c", query: "c", rank: 3 },
      { id: "e", query: "e", rank: 2 },
    ])
    const diff = diffRuns(from, to)
    const status = Object.fromEntries(diff.cases.map((item) => [item.id, item.status]))
    expect(status.a).toBe("improved")
    expect(status.b).toBe("regressed")
    expect(status.c).toBe("still-hit")
    expect(status.d).toBe("removed")
    expect(status.e).toBe("new")
    expect(diff.summary).toEqual({ improved: 1, regressed: 1, new: 1, removed: 1, unchanged: 1 })
  })

  test("treats a better rank as improved", async () => {
    const { diffRuns } = await import("@/knowledge/eval")
    const diff = diffRuns(
      entry("r1", 1, [{ id: "a", query: "a", rank: 4 }]),
      entry("r2", 2, [{ id: "a", query: "a", rank: 2 }]),
    )
    expect(diff.cases[0].status).toBe("improved")
  })

  test("handles legacy runs without per-case results", async () => {
    const { diffRuns } = await import("@/knowledge/eval")
    const legacy = {
      id: "r0",
      ranAt: 0,
      k: 5,
      cases: 2,
      metrics: { cases: 2, k: 5, hitRate: 0, recall: 0, mrr: 0, avgLatencyMs: 0 },
    }
    const diff = diffRuns(legacy, entry("r1", 1, [{ id: "a", query: "a", rank: 1 }]))
    expect(diff.cases).toHaveLength(1)
    expect(diff.cases[0].status).toBe("new")
  })
})

describe("knowledge.eval report", () => {
  test("renders metrics, trend and case table", async () => {
    const { renderReport } = await import("@/knowledge/eval")
    const run = {
      ranAt: Date.UTC(2026, 0, 2, 3, 4),
      k: 5,
      metrics: { cases: 2, k: 5, hitRate: 0.5, recall: 0.5, mrr: 0.4, avgLatencyMs: 20 },
      results: [
        {
          id: "a",
          query: "deploy",
          expected: ["A"],
          hits: ["A"],
          rank: 1,
          reciprocalRank: 1,
          recall: 1,
          latencyMs: 10,
        },
        { id: "b", query: "billing", expected: ["B"], hits: [], rank: 0, reciprocalRank: 0, recall: 0, latencyMs: 30 },
      ],
    }
    const history = [
      {
        id: "r1",
        ranAt: 1,
        k: 5,
        cases: 2,
        metrics: { cases: 2, k: 5, hitRate: 0.3, recall: 0.3, mrr: 0.2, avgLatencyMs: 30 },
      },
      { id: "r2", ranAt: 2, k: 5, cases: 2, metrics: run.metrics },
    ]
    const report = renderReport({
      collection: "Specs",
      run,
      history,
      diff: {
        from: { id: "r1", ranAt: 1, k: 5 },
        to: { id: "r2", ranAt: 2, k: 5 },
        summary: { improved: 1, regressed: 0, new: 0, removed: 0, unchanged: 1 },
        cases: [{ id: "a", query: "deploy", before: 0, after: 1, status: "improved" }],
      },
    })
    expect(report).toContain("# 检索评测报告 · Specs")
    expect(report).toContain("| 命中率@5 | 50.0% |")
    expect(report).toContain("变好 1")
    expect(report).toContain("| deploy | 未命中 | #1 | 变好 |")
    expect(report).toContain("| billing | 未命中 | 0.0% | 30ms |")
  })
})
