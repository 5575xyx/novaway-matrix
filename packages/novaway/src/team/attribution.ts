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
 * 数字的口径（2026-10-31 起）：派发结束后读的是**整棵子会话树**的累计用量
 * （队长会话 + 它派生的成员会话 + 成员的子代理），所以 `byActor` 是**团队口径**
 * （`basis: "team"`）—— 「这支队伍这次花了多少」，不是「队长自己花了多少」。
 *
 * 仍未做到的：按**人**拆开。成员是队长用 `task` 派生出来的会话，身上没有编制里
 * 的员工身份，只能看到 agent（岗位）。要按人计量，得让派发时把 employeeID 带到
 * 子会话上；在那之前，任何「某员工花了 N」的说法都是编的。
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
  basis: "team"
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
    basis: "team",
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
