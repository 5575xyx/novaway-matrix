/**
 * 队长回报的解析（§8.4 / §7.2）。
 *
 * 队长被要求只输出一个 JSON 对象。它有时会加一段说明、用 ```json 包起来、或者干脆
 * 忘了字段。**格式问题不是业务问题**：把它当成「这一轮没达标」会让它消耗业务额度，
 * 最后用户看到的是「交付失败」，而真正的原因是模型没按格式回话。
 *
 * 所以这里把「读得出」与「读不出」分开，并给出人能看懂的原因（只描述结构，
 * 不复制模型原文 —— 原文可能很长，也可能夹带不该进日志的内容）。
 */
import { parseJSON } from "./verifier"
import type { Artifact, Claim } from "./orchestrator"

export type Parsed = {
  summary: string
  claims: Claim[]
  artifacts: Artifact[]
  done: boolean
}

export type Result =
  | { ok: true; report: Parsed }
  /** 结构不合法：`reason` 是给人看的一句话，不是模型原文。 */
  | { ok: false; reason: string }

/**
 * 一段回复是否「像一份报告」：必须是 JSON 对象，且至少出现一个约定字段。
 *
 * 不要求 `claims` 非空 —— 队长判定「没东西可交」时给空数组是合法的；
 * 但三者全缺，说明它回的是别的东西（闲聊、解释、半截 JSON），重问一次才有意义。
 */
export function parse(text: string): Result {
  const parsed = parseJSON(text)
  if (!parsed) return { ok: false, reason: "回复里没有可解析的 JSON 对象" }
  if (!("summary" in parsed) && !("claims" in parsed) && !("done" in parsed))
    return { ok: false, reason: "JSON 对象里缺少 summary / claims / done 任何一个约定字段" }

  const claims: Claim[] = Array.isArray(parsed.claims)
    ? parsed.claims
        .filter((claim): claim is Record<string, unknown> => !!claim && typeof claim === "object")
        .map((claim) => ({
          acceptanceID: typeof claim.acceptanceID === "string" ? claim.acceptanceID : undefined,
          text: typeof claim.text === "string" ? claim.text : "",
          evidence: typeof claim.evidence === "string" ? claim.evidence : undefined,
        }))
    : []

  const artifacts: Artifact[] = Array.isArray(parsed.artifacts)
    ? parsed.artifacts
        .filter((artifact): artifact is Record<string, unknown> => !!artifact && typeof artifact === "object")
        .map((artifact, index) => ({
          name: typeof artifact.name === "string" ? artifact.name : "artifact-" + index,
          version: typeof artifact.version === "number" ? artifact.version : 1,
          hash: typeof artifact.hash === "string" ? artifact.hash : undefined,
        }))
    : []

  return {
    ok: true,
    report: {
      // 没有 `summary` 时用原文前 500 字：它不是判定依据，只是给人看的一句说明。
      summary: typeof parsed.summary === "string" ? parsed.summary : text.slice(0, 500),
      claims,
      artifacts,
      done: parsed.done === true,
    },
  }
}

export * as TeamReport from "./report"
