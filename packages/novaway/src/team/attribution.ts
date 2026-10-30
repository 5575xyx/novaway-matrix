import type { Entry } from "./ledger"
import { snapshotFrom } from "./profile"
import type { RunTeam } from "./run"

/**
 * 用量归属（§10.3）。
 *
 * 账本回答「花了多少」，归属回答「谁花的」。三个维度：
 *
 * | 维度     | 来源                                              |
 * | -------- | ------------------------------------------------- |
 * | `run`    | 全部条目求和，与预算对比                          |
 * | `actor`  | 按账本里的 actor（团队）汇总，再映射到**队长**岗位 |
 * | `job`    | 把 actor 汇总跨团队并到岗位，用于性价比判断        |
 *
 * 一处必须说清楚的边界：现在只有队长真正跑 agent 会话，成员是队长用 `task` 派发的，
 * 其用量没有按人单独计量。所以这里的 `byActor` 是**队长口径**（`basis: "captain"`），
 * 不是「每个成员花了多少」。想按人计量，需要成员级会话自带用量上报 —— 那时把
 * `basis` 改成 `member` 即可，但绝不能在此之前假装已经按人拆开。
 */

export type ActorUsage = {
  /** 账本里的 actor（当前是团队 ID）。 */
  actor: string
  teamID: string
  /** 队长对应的员工与岗位；名册读不回来时缺省。 */
  employeeID?: string
  job?: string
  reserved: number
  settled: number
  unknown: number
  /** 承诺量 = 预占 + 已结算 + 用量不明，与预算判断同一口径。 */
  committed: number
  basis: "captain"
}

export type Attribution = {
  reserved: number
  settled: number
  unknown: number
  committed: number
  byActor: ActorUsage[]
  /** 岗位汇总：同一个岗位在多支团队里工作时合并。 */
  byJob: Array<{ job: string; committed: number }>
}

const empty = () => ({ reserved: 0, settled: 0, unknown: 0 })

function accumulate(target: { reserved: number; settled: number; unknown: number }, entry: Entry) {
  if (entry.state === "released") return
  if (entry.state === "reserved") target.reserved += entry.reservedTokens
  if (entry.state === "settled" || entry.state === "overrun") target.settled += entry.settledTokens
  if (entry.state === "unknown") target.unknown += entry.reservedTokens
}

export function summarize(input: { entries: readonly Entry[]; teams: readonly RunTeam[] }): Attribution {
  const captains = new Map<string, { employeeID?: string; job?: string }>()
  for (const team of input.teams) {
    const roster = snapshotFrom(team.rosterSnapshot)
    const captain = roster?.roster.find((entry) => entry.employee.id === roster.captain)
    captains.set(team.id, captain ? { employeeID: captain.employee.id, job: captain.employee.job } : {})
  }

  /** 新的一行：actor 就是团队 ID，再补上该团队队长的员工与岗位。 */
  const start = (actor: string): ActorUsage => ({
    actor,
    teamID: actor,
    ...captains.get(actor),
    ...empty(),
    committed: 0,
    basis: "captain",
  })

  const byActor = new Map<string, ActorUsage>()
  for (const entry of input.entries) {
    const current = byActor.get(entry.actor) ?? start(entry.actor)
    accumulate(current, entry)
    byActor.set(entry.actor, current)
  }

  const actors = [...byActor.values()]
    .map((item) => ({ ...item, committed: item.reserved + item.settled + item.unknown }))
    .sort((a, b) => b.committed - a.committed)

  const jobs = new Map<string, number>()
  for (const actor of actors) {
    const job = actor.job ?? "unknown"
    jobs.set(job, (jobs.get(job) ?? 0) + actor.committed)
  }

  const total = empty()
  for (const entry of input.entries) accumulate(total, entry)

  return {
    ...total,
    committed: total.reserved + total.settled + total.unknown,
    byActor: actors,
    byJob: [...jobs.entries()]
      .map(([job, committed]) => ({ job, committed }))
      .sort((a, b) => b.committed - a.committed),
  }
}

export * as TeamAttribution from "./attribution"
