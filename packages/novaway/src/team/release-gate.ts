import { isTerminal, type RunState } from "./run"
import type { EffectiveOutcome, Summary, Verification } from "./verification"
import type { Usage } from "./ledger"
import { evaluate, gate as verifierGate, GATE as VERIFIER_GATE, type Case } from "./verifier"

/**
 * 发布门禁（§21.3）。
 *
 * 七条门禁里，能判定的部分全部做成纯函数：同样的输入永远得到同样的结论，
 * 因此既能被 `bun test` 跑，也能被 `script/release-gate.ts` 汇总。
 * 唯一需要人的一条（误判通过率）不假装自动化 —— 这里只负责「抽哪几条」与
 * 「复核结果是否超过阈值」，判定本身必须由人来做。
 *
 * 共同前提：**门禁不通过就不能发版**。所以任何一条的 `passed` 都必须是
 * 「观察到的事实满足判据」，而不是「没观察到问题」。
 */

export type GateID = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7"

export type Check = { id: GateID; title: string; passed: boolean; detail: string[] }

const check = (id: GateID, title: string, failures: string[], passedDetail: string): Check => ({
  id,
  title,
  passed: failures.length === 0,
  detail: failures.length === 0 ? [passedDetail] : failures,
})

/** G1：每条 pass 都必须能展开到快照 + 验证器版本 + 实测值。 */
export function auditPassEvidence(records: readonly Verification[]) {
  const passing = records.filter((record) => record.outcome === "pass")
  const failures: string[] = []
  for (const record of passing) {
    const missing = [
      !record.snapshotID || record.snapshotID === "unknown" ? "snapshot" : undefined,
      !record.verifierVersion || record.verifierVersion === "none" ? "verifierVersion" : undefined,
      !record.measured ? "measured" : undefined,
    ].filter((item): item is string => item !== undefined)
    if (missing.length) failures.push(record.id + " 缺少 " + missing.join(" / "))
  }
  return check(
    "G1",
    "可复验：每条 pass 都能展开到快照 + 验证器版本 + 实测值",
    failures,
    "抽查 " + passing.length + " 条 pass，全部可展开",
  )
}

/**
 * G2：五种异常逐项注入，运行必须落到预定义终态，不存在「一直转圈」。
 *
 * 期望值来自 §18 的异常映射：格式错/超时/权限拒绝会让团队失败（没有交付时
 * 整体 failed），崩溃留下的未知操作把运行压到 needs_review，用户取消是
 * cancelled。任何落不进这些状态的观察都算门禁失败 —— 包括「还在 running」。
 */
export const ANOMALIES = [
  { kind: "format", title: "格式错误", allowed: ["failed", "partial"] },
  { kind: "timeout", title: "超时", allowed: ["failed", "partial"] },
  { kind: "permission", title: "权限拒绝", allowed: ["failed", "partial"] },
  { kind: "crash", title: "崩溃（未知操作）", allowed: ["needs_review"] },
  { kind: "cancel", title: "用户取消", allowed: ["cancelled"] },
] as const

export type AnomalyKind = (typeof ANOMALIES)[number]["kind"]

export function auditAnomaly(kind: AnomalyKind, state: RunState): Check {
  const spec = ANOMALIES.find((item) => item.kind === kind)
  const title = "终态覆盖：" + (spec ? spec.title : kind)
  if (!spec) return check("G2", title, ["未知异常类型 " + kind], "")
  // needs_review 是等待复核的静止状态，不是终态；其余必须是终态。
  const resting = isTerminal(state) || state === "needs_review"
  const failures: string[] = []
  if (!resting) failures.push(kind + ": 运行停在 " + state + "（既不是终态也不在复核态）")
  const allowed = spec.allowed as readonly RunState[]
  if (!allowed.includes(state)) failures.push(kind + ": 落到 " + state + "，期望 " + allowed.join(" / "))
  return check("G2", title, failures, kind + " 落到 " + state)
}

/** G3：崩溃恢复 —— `started` 超时后必须变 `unknown`，且不会被自动重跑。 */
export function auditRecovery(input: {
  marked: number
  pending: readonly { tool: string; outcome: string }[]
  replays: readonly { tool: string; replayed: boolean }[]
}) {
  const failures: string[] = []
  if (input.marked <= 0) failures.push("没有任何 started 被标记为 unknown（注入没生效？）")
  const unknown = input.pending.filter((item) => item.outcome === "unknown")
  if (input.pending.length === 0) failures.push("重启后没有列出未知操作")
  if (input.pending.length > 0 && unknown.length === 0) failures.push("待复核列表里没有 unknown 项")
  for (const replay of input.replays) {
    if (!replay.replayed) failures.push(replay.tool + ": 未知操作被当成新调用重跑")
  }
  return check(
    "G3",
    "崩溃恢复：未知项被列出且不自动重跑",
    failures,
    "标记 " +
      input.marked +
      " 条、列出 " +
      input.pending.length +
      " 条待复核、" +
      input.replays.length +
      " 次重放均被拦住",
  )
}

/** G4：并发压测后 committed（reserved + settled + unknown）从未越过 cap。 */
export function auditBudget(usages: readonly Usage[], cap: number) {
  const failures: string[] = []
  for (const [index, usage] of usages.entries()) {
    if (cap > 0 && usage.committed > cap) {
      failures.push("第 " + (index + 1) + " 个采样点超支：committed=" + usage.committed + " > cap=" + cap)
    }
    if (usage.overrun !== (cap > 0 && usage.committed > cap)) {
      failures.push("第 " + (index + 1) + " 个采样点 overrun 标记与实际不符")
    }
  }
  return check(
    "G4",
    "预算：并发预占 + 结算从未超过 cap",
    failures,
    usages.length + " 个采样点均未超支（cap=" + cap + "）",
  )
}

/**
 * G7：`unverified` 不折叠。
 *
 * 不只抽查一个样本：把四种结果的所有组合都喂进汇总，逐条核对
 * 「通过数只等于 pass」且「四类计数覆盖全部验收项」。折叠的实现无法通过这条。
 */
const OUTCOMES: readonly EffectiveOutcome[] = ["pass", "fail", "unverified", "stale"]

export function auditNoFold(summarize: (outcomes: readonly EffectiveOutcome[]) => Summary) {
  const failures: string[] = []
  let cases = 0
  const walk = (prefix: readonly EffectiveOutcome[], depth: number) => {
    if (depth === 0) {
      cases += 1
      const summary = summarize(prefix)
      const tag = "[" + prefix.join(",") + "]"
      const pass = prefix.filter((item) => item === "pass").length
      const fail = prefix.filter((item) => item === "fail").length
      const unverified = prefix.filter((item) => item === "unverified").length
      const stale = prefix.filter((item) => item === "stale").length
      if (summary.pass !== pass) failures.push(tag + " pass 计数错误：" + summary.pass + " ≠ " + pass)
      if (summary.fail !== fail) failures.push(tag + " fail 计数错误：" + summary.fail + " ≠ " + fail)
      if (summary.unverified !== unverified)
        failures.push(tag + " unverified 计数错误：" + summary.unverified + " ≠ " + unverified)
      if (summary.stale !== stale) failures.push(tag + " stale 计数错误：" + summary.stale + " ≠ " + stale)
      if (summary.pass + summary.fail + summary.unverified + summary.stale !== prefix.length)
        failures.push(tag + " 四类计数没有覆盖全部验收项")
      if (fail > 0 && summary.verdict !== "failed") failures.push(tag + " 有 fail 却判为 " + summary.verdict)
      if (summary.pass === prefix.length && prefix.length > 0 && summary.verdict !== "complete")
        failures.push(tag + " 全部通过却判为 " + summary.verdict)
      return
    }
    for (const outcome of OUTCOMES) walk([...prefix, outcome], depth - 1)
  }
  for (let length = 0; length <= 4; length += 1) walk([], length)
  return check("G7", "unverified 不折叠：任何汇总都不把 unverified 计入 pass", failures, cases + " 种组合全部成立")
}

/**
 * G5：验证器回归。
 *
 * 召回率与误杀率来自 `verifier.ts` 的缺陷注入集；阈值固定写在 `GATE`，
 * 不随调用方变化 —— 门禁的阈值不能被被测对象自己定义。
 */
export function auditVerifier(cases: readonly Case[]) {
  const score = evaluate(cases)
  const result = verifierGate(score)
  const pct = (value: number) => (value * 100).toFixed(1) + "%"
  return check(
    "G5",
    "验证器回归：召回 ≥ " + VERIFIER_GATE.recall * 100 + "%、误杀 ≤ " + VERIFIER_GATE.falseKill * 100 + "%",
    result.passed
      ? []
      : [
          "召回 " + pct(score.recall) + "（漏判：" + (score.missed.join("、") || "无") + "）",
          "误杀 " + pct(score.falseKill) + "（误杀：" + (score.killed.join("、") || "无") + "）",
        ],
    "召回 " + pct(score.recall) + "、误杀 " + pct(score.falseKill),
  )
}

/** 确定性等距抽样：每次发版抽到同一批，结论可复现。 */
export function samplePass(ids: readonly string[], ratio: number) {
  const sorted = [...ids].sort()
  if (sorted.length === 0) return []
  const bounded = Math.min(Math.max(ratio, 0.01), 1)
  const step = Math.max(1, Math.floor(1 / bounded))
  return sorted.filter((_, index) => index % step === 0)
}

export const FALSE_PASS_THRESHOLD = 0.1

/**
 * G6：误判通过率。
 *
 * 只能由人复核：这里拒绝「没有复核记录就通过」—— 未复核与无问题是两件事。
 */
export function auditFalsePass(reviewed: number, sampled: number, wrong: number) {
  const failures: string[] = []
  if (sampled <= 0) failures.push("没有抽样，无法评估误判通过率")
  if (reviewed <= 0) failures.push("没有人工复核记录；未复核不等于无问题")
  if (wrong > reviewed) failures.push("误判数大于复核数，记录不合法")
  const rate = reviewed > 0 ? wrong / reviewed : 1
  if (reviewed > 0 && rate > FALSE_PASS_THRESHOLD)
    failures.push("误判通过率 " + (rate * 100).toFixed(1) + "% 超过阈值 " + FALSE_PASS_THRESHOLD * 100 + "%")
  return check(
    "G6",
    "误判通过率：人工抽样复核后不超过 10%",
    failures,
    "抽样 " + sampled + " 条、复核 " + reviewed + " 条、误判 " + wrong + " 条",
  )
}

/** 汇总：任何一条不通过，发版就不通过；空清单也不算通过。 */
export function release(checks: readonly Check[]) {
  return {
    passed: checks.length > 0 && checks.every((item) => item.passed),
    failed: checks.filter((item) => !item.passed),
    checks,
  }
}

export * as ReleaseGate from "./release-gate"
