import type { Acceptance } from "./verification"
import type { Report, VerificationResult } from "./orchestrator"

/**
 * 验证器（§19.2 / §19.3）。
 *
 * 这里只放两个纯函数：怎么问、怎么读。真正的判断由另一个会话里的模型给出，
 * 所以「可信」不能靠提示词自觉，而要靠读回来的结果守规矩：
 *
 * 1. 解析不了 JSON = `unverified`，绝不默认通过；
 * 2. **声称 `pass` 却给不出证据位置 = `unverified`**。没有证据的通过是
 *    「验证器说自己通过了」，与没验过没有区别；
 * 3. `fail` 可以没有证据（失败本身已经是否定结论，不会把坏东西放过去）。
 *
 * `evaluate()` 用于 §19.3 的回归夹具：喂一批「已知有缺陷 / 已知无问题」
 * 的样本与判定结果，算召回率与误杀率，低于阈值就当作发布门禁不通过。
 */

export type Interpretation = Pick<VerificationResult, "outcome" | "measured" | "evidenceRef" | "verifierVersion">

/** 从模型输出里取出第一个 JSON 对象；取不到返回 undefined。 */
export function parseJSON(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** 读回验证器的判断。没有证据的 `pass` 会被降级并写明原因。 */
export function interpret(text: string, version = "agent-v1"): Interpretation {
  const parsed = parseJSON(text)
  const raw = parsed?.outcome
  const measured = typeof parsed?.measured === "string" ? parsed.measured : undefined
  const evidenceRef = typeof parsed?.evidence === "string" ? parsed.evidence.trim() : undefined
  if (raw === "fail") return { outcome: "fail", measured, evidenceRef, verifierVersion: version }
  if (raw !== "pass") return { outcome: "unverified", measured, evidenceRef, verifierVersion: version }
  if (!evidenceRef) {
    return {
      outcome: "unverified",
      measured: measured ? measured + "（未给出可复核的证据位置）" : "声称通过但未给出可复核的证据位置",
      evidenceRef,
      verifierVersion: version,
    }
  }
  return { outcome: "pass", measured, evidenceRef, verifierVersion: version }
}

/** 构造验证提示词。规则直接写在提示里，别指望模型自己想起「不要相信自述」。 */
export function prompt(acceptance: Pick<Acceptance, "text" | "expected">, report: Pick<Report, "claims">) {
  const evidence = report.claims
    .map((claim) => "- " + claim.text + (claim.evidence ? "｜证据：" + claim.evidence : "｜无证据"))
    .join("\n")
  return [
    "你只做一件事：判断下面这条验收在当前代码快照上是否成立。",
    "不要相信交付方的自述；没有可复核证据就回答 unverified。",
    "回答 pass 时必须在 evidence 里给出可复核的位置（文件、命令输出、测试名）。",
    "",
    "【验收】" + acceptance.text,
    acceptance.expected ? "【预期】" + acceptance.expected : "",
    "【交付方自述】",
    evidence || "（无）",
    "",
    "只输出 JSON：",
    '{"outcome":"pass|fail|unverified","measured":"实测结果或原因","evidence":"证据位置"}',
  ]
    .filter(Boolean)
    .join("\n")
}

export type Case = {
  name: string
  /** 已知有缺陷的样本应判 fail；对照组应判 pass。 */
  expected: "pass" | "fail"
  /** 验证器对这条样本的原始回复（用来跑解析与降级规则）。 */
  reply: string
}

export type Score = {
  recall: number
  falseKill: number
  missed: string[]
  killed: string[]
}

/** 计算缺陷集召回率与对照组误杀率。 */
export function evaluate(cases: readonly Case[]): Score {
  const bad = cases.filter((item) => item.expected === "fail")
  const good = cases.filter((item) => item.expected === "pass")
  const missed = bad.filter((item) => interpret(item.reply).outcome !== "fail").map((item) => item.name)
  const killed = good.filter((item) => interpret(item.reply).outcome !== "pass").map((item) => item.name)
  return {
    recall: bad.length === 0 ? 1 : (bad.length - missed.length) / bad.length,
    falseKill: good.length === 0 ? 0 : killed.length / good.length,
    missed,
    killed,
  }
}

/** §21.3 的门禁阈值：召回 ≥ 90%，误杀 ≤ 5%。 */
export const GATE = { recall: 0.9, falseKill: 0.05 } as const

export function gate(score: Score) {
  return {
    passed: score.recall >= GATE.recall && score.falseKill <= GATE.falseKill,
    score,
  }
}

export * as TeamVerifier from "./verifier"
