import type { Acceptance, Outcome } from "./verification"
import type { Report } from "./orchestrator"

/**
 * 轻档结构校验（设计文档 §19.1）。
 *
 * 轻档要回答的**不是**「这条验收在语义上成立吗」，而是「引用的东西真的在」：
 * 报告有没有给出 `path:line`、这些文件是否存在、改动清单能不能读到。
 * 语义判断留给中 / 重档，也留给用户——这里绝不假装自己做过。
 *
 * 三条边界：
 *
 * 1. **结构不过 ≠ 失败。** 缺证据、文件不存在、路径越界，一律 `unverified`：
 *    我们只知道「没验成」，不知道「没做到」。把它判 `fail` 会让没问题的交付
 *    白白消耗一次返工额度。
 * 2. **通过也必须说清楚是怎么通过的。** `measured` 固定写明「结构校验，未做语义判断」，
 *    界面和事件里都能看出这一条没有经过模型判断。
 * 3. **不读文件内容。** 只做存在性与改动归属判断；读内容就等于开始做语义判断，
 *    而且会把凭据、日志之类的东西带进验证路径。
 */

export const VERSION = "structure:v1"

export type Input = {
  acceptance: Pick<Acceptance, "kind" | "text" | "expected">
  report: Pick<Report, "claims">
  /** 本次团队相对起点的改动清单；读不到时传空数组。 */
  changed: readonly string[]
  /** 文件是否存在；由调用方绑定到团队 worktree，避免这里猜目录。 */
  exists: (path: string) => boolean
}

export type Interpretation = {
  outcome: Outcome
  measured?: string
  evidenceRef?: string
  verifierVersion: string
}

/** 证据里的 `path:line`。只认相对路径；绝对路径与 URL 不当作证据。 */
const LOCATION = /(?<![A-Za-z0-9_./@:-])([A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*\.[A-Za-z][A-Za-z0-9]*):(\d+)/g

type Located = { path: string; line: number }

function locations(evidence: string): Located[] {
  const out: Located[] = []
  for (const match of evidence.matchAll(LOCATION)) {
    const path = match[1]
    if (!path || path.split("/").includes("..") || path.startsWith("/") || path.includes("://")) continue
    out.push({ path, line: Number(match[2]) })
  }
  return out
}

/** 归一化路径：去掉 `./` 前缀，统一分隔符，便于和改动清单比较。 */
const clean = (path: string) => path.replace(/\\/g, "/").replace(/^\.\//, "").trim()

const unverified = (measured: string, evidenceRef?: string): Interpretation => ({
  outcome: "unverified",
  measured,
  ...(evidenceRef ? { evidenceRef } : {}),
  verifierVersion: VERSION,
})

/**
 * 结构校验。
 *
 * `diff` 类验收还要求证据落在本次改动里：拿一份「本来就存在、但这轮没动过」的
 * 文件当证据，等于用旧结果冒充新交付。`file` 类只要求文件存在。
 */
export function interpret(input: Input): Interpretation {
  const found = input.report.claims.flatMap((claim) => (claim.evidence ? locations(claim.evidence) : []))
  if (found.length === 0) return unverified("轻档结构校验：报告没有给出可复核的 path:line 证据位置")

  const changed = new Set(input.changed.map(clean))
  for (const item of found) {
    const path = clean(item.path)
    if (input.acceptance.kind === "diff" && changed.size === 0)
      return unverified("轻档结构校验：读不到本次改动清单，无法判断证据是否属于这轮交付")
    if (input.acceptance.kind === "diff" && !changed.has(path))
      return unverified("轻档结构校验：证据文件不在本次改动里", path + ":" + item.line)
    if (!input.exists(path)) return unverified("轻档结构校验：证据引用的文件不存在", path + ":" + item.line)
  }

  const first = found[0]
  return {
    outcome: "pass",
    measured:
      "轻档结构校验：" +
      found.length +
      " 条证据位置可复核" +
      (input.acceptance.kind === "diff" ? "，且落在本次改动内" : "") +
      "；未做语义判断",
    evidenceRef: clean(first.path) + ":" + first.line,
    verifierVersion: VERSION,
  }
}
