/**
 * 知识库检索评测。
 *
 * 目的：改检索参数（切片大小、RRF 权重、是否开图谱扩展）之前，先有一套
 * "问题 → 应该命中的文档" 的用例，跑一次就能看到效果是变好还是变差。
 *
 * 用例存在集合目录下（`eval.json`），随集合一起导出/备份。
 * 指标只依赖 `search()` 的返回顺序，纯函数计算，便于单测。
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Identifier } from "@/id/id"
import { knowledgeRoot } from "./store"
import type { SearchHit } from "./search"

export type EvalCase = {
  id: string
  query: string
  /** 期望命中的文档：id / 标题 / 来源文件名，任意一种匹配都算命中。 */
  expected: string[]
  notes?: string
  createdAt: number
}

export type EvalCaseResult = {
  id: string
  query: string
  expected: string[]
  /** 实际命中的文档（按检索顺序）。 */
  hits: string[]
  /** 第一条期望文档的排名（1 起），没命中为 0。 */
  rank: number
  reciprocalRank: number
  recall: number
  latencyMs: number
}

export type EvalMetrics = {
  cases: number
  k: number
  hitRate: number
  recall: number
  mrr: number
  avgLatencyMs: number
}

export type EvalRun = {
  ranAt: number
  k: number
  metrics: EvalMetrics
  results: EvalCaseResult[]
}

const ID = /^[A-Za-z0-9_-]+$/
export const EVAL_K = 5
const MAX_CASES = 200

const evalFile = (root: string, collectionID: string) => path.join(root, "collections", collectionID, "eval.json")

function assertID(value: string, label: string) {
  if (!ID.test(value)) throw new Error("Invalid " + label + ": " + value)
}

async function readJSON<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

async function writeJSON(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + "." + process.pid + "." + Date.now() + ".tmp"
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8")
  await fs.rename(tmp, file)
}

export async function listCases(collectionID: string, root = knowledgeRoot()): Promise<EvalCase[]> {
  assertID(collectionID, "collection id")
  const value = await readJSON<{ cases?: EvalCase[] }>(evalFile(root, collectionID))
  return Array.isArray(value?.cases) ? value!.cases!.slice() : []
}

export async function saveCase(
  collectionID: string,
  input: { id?: string; query: string; expected: string[]; notes?: string },
  root = knowledgeRoot(),
): Promise<EvalCase> {
  assertID(collectionID, "collection id")
  const query = input.query.trim()
  if (!query) throw new Error("Query is required")
  const expected = Array.from(new Set(input.expected.map((item) => item.trim()).filter(Boolean)))
  if (expected.length === 0) throw new Error("Pick at least one expected document")
  const cases = await listCases(collectionID, root)
  const existing = input.id ? cases.find((item) => item.id === input.id) : undefined
  const next: EvalCase = {
    id: existing?.id ?? Identifier.create("kbe", "ascending"),
    query,
    expected,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    createdAt: existing?.createdAt ?? Date.now(),
  }
  const merged = existing
    ? cases.map((item) => (item.id === existing.id ? next : item))
    : [...cases, next].slice(-MAX_CASES)
  await writeJSON(evalFile(root, collectionID), { cases: merged })
  return next
}

export async function removeCase(collectionID: string, caseID: string, root = knowledgeRoot()) {
  assertID(collectionID, "collection id")
  assertID(caseID, "case id")
  const cases = await listCases(collectionID, root)
  const next = cases.filter((item) => item.id !== caseID)
  if (next.length === cases.length) return false
  await writeJSON(evalFile(root, collectionID), { cases: next })
  return true
}

/** 一条用例的排名：按 hits 顺序找第一个能匹配 expected 的文档。 */
export function scoreCase(input: {
  expected: readonly string[]
  hits: readonly Pick<SearchHit, "title" | "documentID">[]
  k: number
}): { rank: number; reciprocalRank: number; recall: number; matched: string[] } {
  const expected = input.expected.map((item) => item.toLowerCase())
  const matched: string[] = []
  let rank = 0
  input.hits.slice(0, input.k).forEach((hit, index) => {
    const title = hit.title.toLowerCase()
    const id = hit.documentID.toLowerCase()
    const hitExpected = expected.find((item) => item === title || item === id)
    if (!hitExpected) return
    if (rank === 0) rank = index + 1
    if (!matched.includes(hitExpected)) matched.push(hitExpected)
  })
  return {
    rank,
    reciprocalRank: rank === 0 ? 0 : 1 / rank,
    recall: expected.length === 0 ? 0 : matched.length / expected.length,
    matched,
  }
}

export function summarize(results: readonly EvalCaseResult[], k: number): EvalMetrics {
  if (results.length === 0) {
    return { cases: 0, k, hitRate: 0, recall: 0, mrr: 0, avgLatencyMs: 0 }
  }
  const hit = results.filter((item) => item.rank > 0).length
  return {
    cases: results.length,
    k,
    hitRate: hit / results.length,
    recall: results.reduce((sum, item) => sum + item.recall, 0) / results.length,
    mrr: results.reduce((sum, item) => sum + item.reciprocalRank, 0) / results.length,
    avgLatencyMs: Math.round(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length),
  }
}

/** 跑评测：逐条检索并汇总。串行执行，避免并发把延迟指标打乱。 */
export async function runEval(
  input: {
    collectionID: string
    k?: number
    search: (query: string) => Promise<SearchHit[]>
  },
  root = knowledgeRoot(),
): Promise<EvalRun> {
  const k = Math.max(1, Math.min(input.k ?? EVAL_K, 20))
  const cases = await listCases(input.collectionID, root)
  const results: EvalCaseResult[] = []
  for (const item of cases) {
    const started = Date.now()
    const hits = await input.search(item.query).catch(() => [] as SearchHit[])
    const latencyMs = Date.now() - started
    const score = scoreCase({ expected: item.expected, hits, k })
    results.push({
      id: item.id,
      query: item.query,
      expected: item.expected,
      hits: hits.slice(0, k).map((hit) => hit.title),
      rank: score.rank,
      reciprocalRank: score.reciprocalRank,
      recall: score.recall,
      latencyMs,
    })
  }
  return { ranAt: Date.now(), k, metrics: summarize(results, k), results }
}

// ---------------------------------------------------------------------------
// 运行历史：每次评测存一条，用来比较「参数改动到底有没有变好」。
// 只保留摘要指标 + 逐条结果，不存文档正文；上限 50 条，超出淘汰最老的。
// ---------------------------------------------------------------------------
const historyFile = (root: string, collectionID: string) =>
  path.join(root, "collections", collectionID, "eval-history.json")

export const HISTORY_LIMIT = 50

export type EvalHistoryEntry = {
  id: string
  ranAt: number
  k: number
  metrics: EvalMetrics
  /** 本次运行的用例数（用例增删后老记录仍可解释）。 */
  cases: number
  /**
   * 逐条压缩结果：只留 id / query / rank，用于两次运行之间做用例级 diff。
   * 老版本记录没有这个字段，diff 时按"未知"处理。
   */
  results?: Array<{ id: string; query: string; rank: number }>
}

/** 上升/下降：hitRate 与 MRR 越大越好，延迟越小越好。 */
export type EvalTrend = {
  baseline?: EvalHistoryEntry
  delta: {
    hitRate: number
    recall: number
    mrr: number
    avgLatencyMs: number
  }
}

export async function listHistory(collectionID: string, root = knowledgeRoot()): Promise<EvalHistoryEntry[]> {
  assertID(collectionID, "collection id")
  const value = await readJSON<{ runs?: EvalHistoryEntry[] }>(historyFile(root, collectionID))
  return Array.isArray(value?.runs) ? value!.runs!.slice() : []
}

export async function appendHistory(
  collectionID: string,
  run: EvalRun,
  root = knowledgeRoot(),
): Promise<EvalHistoryEntry> {
  assertID(collectionID, "collection id")
  const entry: EvalHistoryEntry = {
    id: Identifier.create("kbr", "ascending"),
    ranAt: run.ranAt,
    k: run.k,
    metrics: run.metrics,
    cases: run.metrics.cases,
    results: run.results.map((item) => ({ id: item.id, query: item.query, rank: item.rank })),
  }
  const runs = [...(await listHistory(collectionID, root)), entry].slice(-HISTORY_LIMIT)
  await writeJSON(historyFile(root, collectionID), { runs })
  return entry
}

export async function clearHistory(collectionID: string, root = knowledgeRoot()) {
  assertID(collectionID, "collection id")
  await writeJSON(historyFile(root, collectionID), { runs: [] })
}

/**
 * 与上一次运行对比。
 *
 * 只在 **k 相同** 时比较：不同 k 的 hitRate 天然不同，混着比会误导。
 * 找不到同 k 的基线就只返回空 delta。
 */
export function trend(history: readonly EvalHistoryEntry[], current: EvalHistoryEntry): EvalTrend {
  const baseline = history
    .filter((item) => item.id !== current.id && item.k === current.k && item.ranAt <= current.ranAt)
    .sort((a, b) => b.ranAt - a.ranAt)[0]
  if (!baseline) {
    return { delta: { hitRate: 0, recall: 0, mrr: 0, avgLatencyMs: 0 } }
  }
  return {
    baseline,
    delta: {
      hitRate: current.metrics.hitRate - baseline.metrics.hitRate,
      recall: current.metrics.recall - baseline.metrics.recall,
      mrr: current.metrics.mrr - baseline.metrics.mrr,
      avgLatencyMs: current.metrics.avgLatencyMs - baseline.metrics.avgLatencyMs,
    },
  }
}

/** 折线图用的点：按时间升序，附带与上一点的差值。 */
export function series(history: readonly EvalHistoryEntry[], k: number) {
  const points = history.filter((item) => item.k === k).sort((a, b) => a.ranAt - b.ranAt)
  return points.map((item, index) => {
    const previous = points[index - 1]
    return {
      id: item.id,
      ranAt: item.ranAt,
      hitRate: item.metrics.hitRate,
      recall: item.metrics.recall,
      mrr: item.metrics.mrr,
      avgLatencyMs: item.metrics.avgLatencyMs,
      hitRateDelta: previous ? item.metrics.hitRate - previous.metrics.hitRate : 0,
      mrrDelta: previous ? item.metrics.mrr - previous.metrics.mrr : 0,
    }
  })
}

/** 用例级 diff 的状态。 */
export type EvalDiffStatus = "improved" | "regressed" | "still-hit" | "still-miss" | "new" | "removed"

export type EvalDiffCase = {
  id: string
  query: string
  /** 旧运行里的排名，0 表示未命中；undefined 表示这次运行没有这条用例。 */
  before?: number
  /** 新运行里的排名；undefined 表示用例已被删除。 */
  after?: number
  status: EvalDiffStatus
}

export type EvalDiff = {
  from: { id: string; ranAt: number; k: number }
  to: { id: string; ranAt: number; k: number }
  summary: {
    improved: number
    regressed: number
    new: number
    removed: number
    unchanged: number
  }
  cases: EvalDiffCase[]
}

/**
 * 两次运行之间逐用例比较。
 *
 * - improved：从 miss 变成 hit，或排名前移
 * - regressed：从 hit 变成 miss，或排名后移
 * - still-hit / still-miss：排名不变（同 miss 或同命中同位置）
 * - new / removed：用例本身在两次运行之间被增删
 *
 * 只比较**同 k** 的运行：不同 k 的排名不可直接对照。
 */
export function diffRuns(from: EvalHistoryEntry, to: EvalHistoryEntry): EvalDiff {
  const before = new Map((from.results ?? []).map((item) => [item.id, item]))
  const after = new Map((to.results ?? []).map((item) => [item.id, item]))
  const ids = Array.from(new Set([...before.keys(), ...after.keys()]))
  const cases: EvalDiffCase[] = []
  const summary = { improved: 0, regressed: 0, new: 0, removed: 0, unchanged: 0 }

  for (const id of ids) {
    const old = before.get(id)
    const next = after.get(id)
    const query = next?.query ?? old?.query ?? id
    if (!old && next) {
      summary.new++
      cases.push({ id, query, after: next.rank, status: "new" })
      continue
    }
    if (old && !next) {
      summary.removed++
      cases.push({ id, query, before: old.rank, status: "removed" })
      continue
    }
    if (!old || !next) continue
    const status = compareRank(old.rank, next.rank)
    if (status === "improved") summary.improved++
    else if (status === "regressed") summary.regressed++
    else summary.unchanged++
    cases.push({ id, query, before: old.rank, after: next.rank, status })
  }

  // 变化大的排前面，方便一眼看到"这次改了什么"。
  const weight: Record<EvalDiffStatus, number> = {
    improved: 0,
    regressed: 0,
    new: 1,
    removed: 1,
    "still-miss": 2,
    "still-hit": 3,
  }
  cases.sort((a, b) => weight[a.status] - weight[b.status])
  return {
    from: { id: from.id, ranAt: from.ranAt, k: from.k },
    to: { id: to.id, ranAt: to.ranAt, k: to.k },
    summary,
    cases,
  }
}

/** 0 = miss；排名越小越好。 */
function compareRank(before: number, after: number): EvalDiffStatus {
  if (before === 0 && after > 0) return "improved"
  if (before > 0 && after === 0) return "regressed"
  if (before === after) return before > 0 ? "still-hit" : "still-miss"
  return after < before ? "improved" : "regressed"
}

/**
 * 生成可分享的评测报告（Markdown）。
 *
 * 把「指标 + 趋势 + 用例级 diff + 收尾结论」放在一份文档里，
 * 可以直接贴进 PR / issue / 周报，不用再手工抄数字。
 */
export function renderReport(input: {
  collection: string
  run: Pick<EvalRun, "ranAt" | "k" | "metrics"> & { results?: EvalRun["results"] }
  history?: readonly EvalHistoryEntry[]
  diff?: EvalDiff
}): string {
  const lines: string[] = []
  const percent = (value: number) => (Math.round(value * 1000) / 10).toFixed(1) + "%"
  lines.push("# 检索评测报告 · " + input.collection)
  lines.push("")
  lines.push("- 运行时间：" + new Date(input.run.ranAt).toLocaleString())
  lines.push("- Top-K：" + input.run.k)
  lines.push("- 用例数：" + input.run.metrics.cases)
  lines.push("")
  lines.push("## 指标")
  lines.push("")
  lines.push("| 指标 | 数值 |")
  lines.push("| --- | --- |")
  lines.push("| 命中率@" + input.run.k + " | " + percent(input.run.metrics.hitRate) + " |")
  lines.push("| 召回率 | " + percent(input.run.metrics.recall) + " |")
  lines.push("| MRR | " + input.run.metrics.mrr.toFixed(3) + " |")
  lines.push("| 平均延迟 | " + input.run.metrics.avgLatencyMs + "ms |")
  lines.push("")

  const history = (input.history ?? []).filter((item) => item.k === input.run.k).sort((a, b) => a.ranAt - b.ranAt)
  if (history.length > 1) {
    const previous = history[history.length - 2]
    lines.push("## 与上次相比")
    lines.push("")
    lines.push(
      "- 命中率：" +
        percent(input.run.metrics.hitRate) +
        "（" +
        signed(percentDelta(input.run.metrics.hitRate, previous.metrics.hitRate)) +
        "）",
    )
    lines.push(
      "- MRR：" +
        input.run.metrics.mrr.toFixed(3) +
        "（" +
        signed(input.run.metrics.mrr - previous.metrics.mrr, 3) +
        "）",
    )
    lines.push(
      "- 平均延迟：" +
        input.run.metrics.avgLatencyMs +
        "ms（" +
        signed(input.run.metrics.avgLatencyMs - previous.metrics.avgLatencyMs, 0) +
        "ms）",
    )
    lines.push("")
  }

  const diff = input.diff
  if (diff) {
    lines.push("## 用例变化")
    lines.push("")
    lines.push(
      "- 变好 " +
        diff.summary.improved +
        " · 变差 " +
        diff.summary.regressed +
        " · 新增 " +
        diff.summary.new +
        " · 移除 " +
        diff.summary.removed,
    )
    lines.push("")
    const changed = diff.cases.filter((item) => item.status === "improved" || item.status === "regressed")
    if (changed.length > 0) {
      lines.push("| 用例 | 之前 | 之后 | 结果 |")
      lines.push("| --- | --- | --- | --- |")
      for (const item of changed) {
        lines.push(
          "| " +
            item.query.replace(/\|/g, "\|") +
            " | " +
            (item.before && item.before > 0 ? "#" + item.before : "未命中") +
            " | " +
            (item.after && item.after > 0 ? "#" + item.after : "未命中") +
            " | " +
            (item.status === "improved" ? "变好" : "变差") +
            " |",
        )
      }
      lines.push("")
    }
  }

  if (!input.run.results || input.run.results.length === 0) {
    lines.push("## 用例明细")
    lines.push("")
    lines.push("_本次报告未包含逐条结果（历史记录只保留指标与排名）。_")
    lines.push("")
    return lines.join(String.fromCharCode(10))
  }
  lines.push("## 用例明细")
  lines.push("")
  lines.push("| 用例 | 排名 | 召回 | 延迟 |")
  lines.push("| --- | --- | --- | --- |")
  for (const item of input.run.results) {
    lines.push(
      "| " +
        item.query.replace(/\|/g, "\|") +
        " | " +
        (item.rank > 0 ? "#" + item.rank : "未命中") +
        " | " +
        percent(item.recall) +
        " | " +
        item.latencyMs +
        "ms |",
    )
  }
  lines.push("")
  return lines.join("\n")
}

const percentDelta = (value: number, baseline: number) => (value - baseline) * 100

const signed = (value: number, digits = 1) => {
  const rounded = Number(value.toFixed(digits))
  if (rounded === 0) return "+-" + (0).toFixed(digits)
  return (rounded > 0 ? "+" : "") + rounded.toFixed(digits)
}
