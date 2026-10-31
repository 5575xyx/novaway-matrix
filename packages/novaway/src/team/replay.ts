import { summarize, type Acceptance, type EffectiveOutcome, type Verification } from "./verification"
import type { RunEvent } from "./run"

/**
 * 决策链回放（§12）。
 *
 * 回答的是「**为什么它认为完成了**」，不是「重跑会得到同样的结果」——
 * 后者取决于模型、网络与依赖版本，跟事件日志无关（§8.5 要求两者在产品文案上分开）。
 *
 * 三条边界：
 *
 * 1. **不改写历史。** 每一步都是事件里的种类与结构字段，原样按 `seq` 排；
 *    拿不到的字段就不出现，不推断「当时大概是……」。事件种类不在白名单里也照样保留，
 *    只是不带任何 payload —— 悄悄丢事件等于藏证据。
 * 2. **不展示原文。** payload 里可能有命令、路径与错误原文（`message` / `notes`），
 *    按既有约束不往界面上铺：只带 id、轮次、结论、快照、验证器版本这类结构字段。
 * 3. **不折叠未验证。** 结论里的 pass / fail / unverified / stale 分列，
 *    未验证与过期永远不计入 pass；「事件流里有没有对应证据」单独标出，
 *    旧版本运行缺这条事件时如实说「部分结论只存在于验证表」。
 */

/** 白名单字段之外的 payload 一律不读；字符串只取已确认是「代码/枚举」的少数几个。 */
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined
const field = (payload: Record<string, unknown> | undefined, key: string): unknown =>
  payload ? Reflect.get(payload, key) : undefined

export type Step = {
  seq: number
  at: number
  /** 事件种类原样保留（`team.dispatched` / `verification.recorded` …）。 */
  kind: string
  teamID?: string
  round?: number
  attempt?: number
  acceptanceID?: string
  outcome?: string
  snapshotID?: string
  verifierVersion?: string
  /** 计数类字段（`claims` / `acceptance` / `merged` / `omitted` 条数）。 */
  count?: number
  /** 只保留少数枚举原因（`commit` / `merged-verification` / `no-integration`…）。 */
  reason?: string
  /** 事件发生在哪一次租约（僵尸写入的判别依据）。 */
  leaseEpoch?: number
}

/** 原因字段里可能出现自由文本，只放行这几类已知的枚举值。 */
const REASONS = new Set([
  "commit",
  "merged-verification",
  "no-deliverable",
  "no-integration",
  "conflict",
  "dirty",
  "detached",
  "cancelled",
])

/** 只在有值时写字段：缺字段与「值是 undefined」在响应里要长得一样。 */
const add = <T extends object, K extends string, V>(target: T, key: K, value: V | undefined): T & Partial<Record<K, V>> =>
  value === undefined ? target : Object.assign(target, { [key]: value })

const stepOf = (event: RunEvent): Step => {
  const payload = event.payload
  const reason = str(field(payload, "reason"))
  // 计数既有数字字段（`claims`）也有列表字段（`merged`）：只报条数，不复制内容。
  const counts =
    ["claims", "acceptance", "removed", "failed"]
      .map((key) => num(field(payload, key)))
      .find((value) => value !== undefined) ??
    ["merged", "omitted"]
      .map((key) => {
        const value = field(payload, key)
        return Array.isArray(value) ? value.length : undefined
      })
      .find((value) => value !== undefined)

  const step: Step = { seq: event.seq, at: event.at, kind: event.kind }
  add(step, "teamID", str(field(payload, "teamID")))
  add(step, "round", num(field(payload, "round")))
  add(step, "attempt", num(field(payload, "attempt")))
  add(step, "acceptanceID", str(field(payload, "acceptanceID")))
  add(step, "outcome", str(field(payload, "outcome")))
  add(step, "snapshotID", str(field(payload, "snapshotID")))
  add(step, "verifierVersion", str(field(payload, "verifierVersion")))
  // 只报条数：具体内容属于「要复跑时去本地读」的那一列。
  add(step, "count", counts)
  if (reason !== undefined && REASONS.has(reason)) add(step, "reason", reason)
  add(step, "leaseEpoch", event.leaseEpoch)
  return step
}

export type ConclusionLine = {
  acceptanceID: string
  text: string
  outcome: EffectiveOutcome
  snapshotID?: string
  verifierVersion?: string
  attempt?: number
  at?: number
}

export type EvidenceTrace = "complete" | "partial" | "absent"

export type Conclusion = {
  /** 最终状态与措辞档位（`complete` 才允许说「已验证交付」）。 */
  state: string
  verdict: "complete" | "partial" | "failed"
  deliverable: boolean
  lines: ConclusionLine[]
  counts: { pass: number; fail: number; unverified: number; stale: number }
  /**
   * 每条 pass 是否都能在事件流里找到同一条 `verification.recorded`
   * （acceptanceID + attempt + outcome）。
   */
  evidence: EvidenceTrace
  /** 必须照实说的边界，界面直接显示，不自己再组织措辞。 */
  notes: string[]
}

export type Replay = {
  steps: Step[]
  conclusion: Conclusion
  /** 事件是不是可用的审计源：没有任何事件时不编一条链出来。 */
  source: "events" | "empty"
}

const MAX_NOTES = 4

/**
 * 纯函数：把事件流与验证记录还原成「决策链 + 最终依据」。
 *
 * `currentSnapshot` 缺省时按验证表里最近一条的快照算 —— 与运行详情页的
 * `summary` 是同一口径，两处看同一个运行不能得出两套结论。
 */
export function replay(input: {
  state: string
  events: readonly RunEvent[]
  acceptances: readonly Acceptance[]
  verifications: readonly Verification[]
  currentSnapshot?: string
}): Replay {
  const steps = [...input.events].sort((a, b) => a.seq - b.seq).map(stepOf)

  const latest = [...input.verifications].sort((a, b) => b.at - a.at)[0]
  const summary = summarize(input.acceptances, input.verifications, input.currentSnapshot ?? latest?.snapshotID ?? "")

  const lines: ConclusionLine[] = summary.lines.map((line) => ({
    acceptanceID: line.acceptance.id,
    text: line.acceptance.text,
    outcome: line.outcome,
    ...(line.verification
      ? {
          snapshotID: line.verification.snapshotID,
          verifierVersion: line.verification.verifierVersion,
          attempt: line.verification.attempt,
          at: line.verification.at,
        }
      : {}),
  }))

  // 事件里的 pass 证据：旧版本运行没有 `verification.recorded`，不能假装有。
  const recorded = new Set(
    input.events
      .filter((event) => event.kind === "verification.recorded")
      .map((event) => {
        const payload = event.payload ?? {}
        return [str(field(payload, "acceptanceID")), num(field(payload, "attempt")), str(field(payload, "outcome"))].join(":")
      }),
  )
  const passes = summary.lines.filter((line) => line.outcome === "pass")
  const traced = passes.filter((line) => {
    const verification = line.verification
    if (!verification) return false
    return recorded.has([line.acceptance.id, verification.attempt, verification.outcome].join(":"))
  }).length
  const evidence: EvidenceTrace =
    passes.length === 0
      ? "complete"
      : traced === passes.length
        ? "complete"
        : traced === 0
          ? "absent"
          : "partial"

  const notes: string[] = []
  if (summary.unverified > 0) notes.push("有 " + summary.unverified + " 条验收没有通过验证证据，未计入通过。")
  if (summary.stale > 0)
    notes.push("有 " + summary.stale + " 条证据绑定的快照与当前代码不一致，按未验证计。")
  if (summary.fail > 0) notes.push("有 " + summary.fail + " 条验收未达标。")
  if (evidence === "partial") notes.push("部分结论只存在于验证表，事件流里没有对应记录。")
  if (evidence === "absent" && passes.length > 0) notes.push("结论来自验证表；这次运行没有写入验证事件。")
  if (input.events.length === 0) notes.push("这次运行没有事件记录，决策链无法还原。")

  return {
    steps,
    source: input.events.length > 0 ? "events" : "empty",
    conclusion: {
      state: input.state,
      verdict: summary.verdict,
      deliverable: summary.deliverable,
      lines,
      counts: {
        pass: summary.pass,
        fail: summary.fail,
        unverified: summary.unverified,
        stale: summary.stale,
      },
      evidence,
      notes: notes.slice(0, MAX_NOTES),
    },
  }
}
