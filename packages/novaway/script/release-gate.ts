#!/usr/bin/env bun
/**
 * 发布门禁（§21.3）：`bun run script/release-gate.ts`
 *
 * 七条门禁里，G1–G5 与 G7 都由 `test/team/release-gate.test.ts` 真的跑一遍
 * （门禁必须能在干净环境复现，不能靠人工勾选）；本脚本负责把它们汇总成一张表，
 * 并在任何一条不通过时以非 0 退出 —— 「不通过不发版」只能由退出码保证。
 *
 * G6（误判通过率）无法自动化：判定「这条 pass 是不是假的」本身需要人。
 * 这里只读取复核记录并核对阈值；**没有记录就是没复核**，按不通过处理。
 *
 * 复核记录格式（`.artifacts/release-gate/false-pass-review.json`）：
 *   { "sampled": 24, "reviewed": 24, "wrong": 1, "note": "谁在什么时候复核的" }
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ReleaseGate } from "../src/team/release-gate"

const root = join(import.meta.dir, "..")
const artifacts = join(root, ".artifacts", "release-gate")
const reviewFile = join(artifacts, "false-pass-review.json")

const GATES = [
  ["G1", "可复验：抽样 pass 能展开到快照 + 验证器版本 + 实测值"],
  ["G2", "终态覆盖：五种异常都落到预定义状态，无「一直转圈」"],
  ["G3", "崩溃恢复：未知项被列出且不自动重跑"],
  ["G4", "预算：并发预占 + 结算从未超过 cap"],
  ["G5", "验证器回归：召回 ≥ 90%、误杀 ≤ 5%"],
  ["G6", "误判通过率：人工抽样复核后 ≤ 10%"],
  ["G7", "unverified 不折叠：任何汇总都不把它计入 pass"],
] as const

type Outcome = { id: (typeof GATES)[number][0]; title: string; passed: boolean; detail: string[] }

/**
 * G6：读取人工复核记录。
 *
 * 刻意不做「没有记录就默认通过」：那正是 §21.4 警告的「误判通过率靠自评」。
 */
function falsePassGate(): Outcome {
  const title = GATES.find(([id]) => id === "G6")![1]
  type Review = { sampled?: number; reviewed?: number; wrong?: number; note?: string }
  const review: Review | undefined = (() => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(reviewFile, "utf8"))
      return parsed && typeof parsed === "object" ? (parsed as Review) : undefined
    } catch {
      return undefined
    }
  })()
  if (!review) {
    return {
      id: "G6",
      title,
      passed: false,
      detail: [
        "找不到复核记录：" + reviewFile,
        "先用 release-gate 的抽样结果（samplePass）抽 10–20% 的 pass 人工复核，再写入该文件。",
      ],
    }
  }
  const sampled = review.sampled ?? 0
  const reviewed = review.reviewed ?? 0
  const wrong = review.wrong ?? 0
  const detail: string[] = []
  if (sampled <= 0) detail.push("没有抽样，无法评估误判通过率")
  if (reviewed <= 0) detail.push("没有人工复核记录；未复核不等于无问题")
  if (wrong > reviewed) detail.push("误判数大于复核数，记录不合法")
  const rate = reviewed > 0 ? wrong / reviewed : 1
  if (reviewed > 0 && rate > 0.1) detail.push("误判通过率 " + (rate * 100).toFixed(1) + "% 超过 10%")
  return {
    id: "G6",
    title,
    passed: detail.length === 0,
    detail: detail.length === 0 ? ["抽样 " + sampled + "、复核 " + reviewed + "、误判 " + wrong] : detail,
  }
}

/** 跑门禁测试，把每条的结果按 G1–G7 归位。 */
function runGateTests(): Outcome[] {
  mkdirSync(artifacts, { recursive: true })
  const junit = join(artifacts, "gate-test.xml")
  // 默认 reporter 只打印失败项，成功的门禁会「查无此人」；JUnit 才有逐用例记录。
  const proc = Bun.spawnSync(
    [
      "bun",
      "test",
      "test/team/release-gate.test.ts",
      "test/team/verifier.test.ts",
      "--timeout",
      "120000",
      "--reporter=junit",
      "--reporter-outfile=" + junit,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )
  writeFileSync(join(artifacts, "gate-test.log"), proc.stdout.toString() + proc.stderr.toString())

  let xml = ""
  try {
    xml = readFileSync(junit, "utf8")
  } catch {
    xml = ""
  }

  const outcomes: Outcome[] = []
  for (const [id, title] of GATES) {
    if (id === "G6") continue
    // name 必须是 testcase 的第一个属性：`classname` 结尾也含 name，
    // 用贪婪的 `[^>]*name=` 会匹配到 classname 的值，门禁就永远找不到执行记录。
    const cases = [...xml.matchAll(/<testcase\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g)].filter((match) =>
      new RegExp("^" + id + "[:：]").test(decode(match[1])),
    )
    if (cases.length === 0) {
      // 自闭合的 testcase（成功且没有输出）也要认。
      const selfClosing = [...xml.matchAll(/<testcase\s+name="([^"]*)"[^>]*\/>/g)].find((match) =>
        new RegExp("^" + id + "[:：]").test(decode(match[1])),
      )
      if (selfClosing) {
        outcomes.push({ id, title, passed: true, detail: [decode(selfClosing[1])] })
        continue
      }
      outcomes.push({ id, title, passed: false, detail: ["没有找到 " + id + " 的执行记录（测试被跳过或改坏了）"] })
      continue
    }
    const failedCase = cases.find((match) => /<failure|<error/.test(match[2]))
    outcomes.push({
      id,
      title,
      passed: !failedCase,
      detail: [decode((failedCase ?? cases[0])[1])],
    })
  }
  return outcomes
}

const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

const readID = (item: object) => {
  const value = (item as { id?: unknown }).id
  return typeof value === "string" ? value : undefined
}

/**
 * `--sample`：从导出的 pass 记录里抽 10–20% 人工复核。
 *
 * 抽样是确定性的（同一批记录永远抽到同一批），所以复核记录可以复用；
 * 这里只写模板，`reviewed`/`wrong` 必须由复核者自己填 —— 脚本不替人下结论。
 */
function writeSample() {
  const source = join(artifacts, "pass-records.json")
  const records: Array<{ id?: string }> | undefined = (() => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(source, "utf8"))
      if (!Array.isArray(parsed)) return undefined
      return parsed.map((item: unknown) => (item && typeof item === "object" ? { id: readID(item) } : {}))
    } catch {
      return undefined
    }
  })()
  if (!records) {
    console.error("找不到 pass 记录：" + source)
    console.error('先导出验证记录（形如 [{ "id": "ver_..." }, ...]），再运行 --sample。')
    process.exit(1)
  }
  const ids = records.flatMap((item) => (typeof item.id === "string" ? [item.id] : []))
  const sample = ReleaseGate.samplePass(ids, 0.2)
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(
    join(artifacts, "false-pass-sample.txt"),
    sample.map((id) => id).join(String.fromCharCode(10)) + String.fromCharCode(10),
  )
  writeFileSync(
    reviewFile,
    JSON.stringify({ sampled: sample.length, reviewed: 0, wrong: 0, note: "待人工复核" }, null, 2) +
      String.fromCharCode(10),
  )
  console.log("已抽 " + sample.length + "/" + ids.length + " 条 pass：" + join(artifacts, "false-pass-sample.txt"))
  console.log("逐条复核后填写 " + reviewFile + " 的 reviewed / wrong，再运行门禁。")
}

if (process.argv.includes("--sample")) {
  writeSample()
  process.exit(0)
}

const checks = [...runGateTests(), falsePassGate()].sort((a, b) => a.id.localeCompare(b.id))
const failed = checks.filter((item) => !item.passed)

for (const item of checks) {
  console.log((item.passed ? "PASS " : "FAIL ") + item.id + "  " + item.title)
  for (const line of item.detail) console.log("        " + line)
}

console.log("")
if (failed.length > 0) {
  console.log(failed.length + " 条门禁未通过：" + failed.map((item) => item.id).join("、"))
  console.log("门禁不通过不发版（§21.3）。")
  process.exit(1)
}
console.log("全部 " + checks.length + " 条门禁通过。")
