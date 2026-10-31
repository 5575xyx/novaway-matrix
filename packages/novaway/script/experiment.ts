#!/usr/bin/env bun
/**
 * 对照实验汇总（§17）：`bun run experiment:report <records.jsonl>`
 *
 * 输入：每行一条观测 `{ taskID, group, verdict, tokens?, cost?, wallMs? }`，
 * 组别 A 单 Agent、B 单 Agent + 同等验证器、C 团队编排。
 *
 * 输出：分层表 + **只在 `both_pass` 里**算的差值（团队相对 B），以及每个指标的覆盖率。
 * 这里刻意不产出结论：分层是事实，L1–L4 的结论等级与措辞由人负责，
 * 「团队更好」这种句子不能由脚本替人写出来。
 *
 * 记录错误（同一任务同一组出现两次、负的耗时、未知组别）直接以非 0 退出，
 * 绝不挑一条继续 —— 把数据问题变成结论问题是最糟的失败方式。
 */

import { readFileSync } from "node:fs"
import { report, type Group, type Observation, type Verdict } from "../src/team/experiment"

const file = process.argv[2]
if (!file) {
  console.error("用法：bun run experiment:report <records.jsonl>")
  process.exit(2)
}

const GROUPS: Group[] = ["A", "B", "C"]
const VERDICTS: Verdict[] = ["pass", "fail", "unknown"]

const observations: Observation[] = readFileSync(file, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line, index) => {
    const where = "第 " + (index + 1) + " 行"
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error(where + " 不是合法 JSON")
    }
    const record = value as Partial<Observation>
    if (typeof record.taskID !== "string" || !record.taskID) throw new Error(where + " 缺少 taskID")
    if (!GROUPS.includes(record.group as Group)) throw new Error(where + " 的 group 必须是 A / B / C")
    if (!VERDICTS.includes(record.verdict as Verdict)) throw new Error(where + " 的 verdict 必须是 pass / fail / unknown")
    return record as Observation
  })

const result = report(observations)

const number = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(3))
const delta = (metric: { team: number; baseline: number; delta: number; ratio?: number }) =>
  metric.team + " vs " + metric.baseline + "（Δ" + (metric.delta > 0 ? "+" : "") + number(metric.delta) +
  (metric.ratio === undefined ? "" : "，×" + number(metric.ratio)) + "）"

console.log("对照实验（§17）：" + result.tasks.length + " 个任务，可比较 " + result.comparable + " 个")
console.log("")
for (const layer of ["both_pass", "only_team_pass", "only_single_pass", "both_fail", "indeterminate"] as const) {
  const ids = result.layers[layer]
  console.log(layer.padEnd(16) + " " + (ids.length ? ids.join(", ") : "—"))
}
console.log("")

for (const task of result.tasks) {
  if (task.comparison) {
    const parts = [
      task.comparison.cost ? "成本 C " + delta(task.comparison.cost) : undefined,
      task.comparison.wallMs ? "耗时 C " + delta(task.comparison.wallMs) : undefined,
      task.comparison.tokens ? "tokens C " + delta(task.comparison.tokens) : undefined,
      task.comparison.missing.length ? "缺 " + task.comparison.missing.join(" / ") : undefined,
    ].filter(Boolean)
    console.log("  " + task.taskID + "  " + parts.join("  "))
    continue
  }
  // 结果不同或证据不足：只报分层，不给任何成本数字。
  console.log("  " + task.taskID + "  " + task.layer + "（不比成本）")
}

console.log("")
console.log(
  "覆盖（both_pass 内）：" +
    (["cost", "wallMs", "tokens"] as const)
      .map((metric) => metric + " " + result.coverage[metric].covered + "/" + result.coverage[metric].total)
      .join("，"),
)
if (result.note) console.log(result.note)
