import { eq } from "drizzle-orm"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"

/**
 * 「某个人花了多少」（§10.3 / §12.1）。
 *
 * 数据源是**会话行**，不是账本：账本回答「这次运行花了多少」（预算按团队预占与结算），
 * 会话回答「这一段工作是谁做的」。两者不能互相替代 —— 账本一条记录覆盖整个团队，
 * 再按人拆就等于编数字。
 *
 * 会话行上能写出三个口径：
 *
 * | 口径               | 来源                                                         |
 * | ------------------ | ------------------------------------------------------------ |
 * | 某人                | `session.employee_id`，派发时队长按名册姓名指认               |
 * | 某次运行            | `session.run_id`，派发时带上运行坐标                          |
 * | 未归属（本次运行内） | 同一次运行里没有 `employee_id` 的会话（验证、匿名派发等）      |
 *
 * 「未归属」必须单列：把它并进任何一个员工，都会让那个人看起来花了更多。
 */

export type Row = {
  readonly sessionID: string
  readonly employeeID?: string
  readonly runID?: string
  readonly cost: number
  readonly tokens: number
  readonly updatedAt: number
}

export type Amount = { readonly tokens: number; readonly cost: number; readonly sessions: number }

export type RunUsage = Amount & { readonly runID: string; readonly lastAt: number }

export type Usage = {
  readonly totals: Amount
  /** 按运行分组，最近的在前。 */
  readonly runs: RunUsage[]
  /** 这些运行里没有归属到具体人的会话：说明「某人」的数字不是完整账单。 */
  readonly unattributed: Amount
  /** 有归属却没有运行坐标的会话（理论上是 0；不为 0 说明有写入路径漏了坐标）。 */
  readonly outsideRuns: Amount
  readonly lastUsedAt?: number
}

type Acc = { tokens: number; cost: number; sessions: number }
type RunAcc = Acc & { runID: string; lastAt: number }

const zero = (): Acc => ({ tokens: 0, cost: 0, sessions: 0 })

function add(target: Acc, row: Row) {
  target.tokens += row.tokens
  target.cost += row.cost
  target.sessions += 1
}

/** 纯函数：给一堆会话行，算出「这个人」的用量。 */
export function summarize(input: { rows: readonly Row[]; employeeID: string }): Usage {
  const mine = input.rows.filter((row) => row.employeeID === input.employeeID)
  const runIDs = new Set(mine.flatMap((row) => (row.runID ? [row.runID] : [])))

  const totals = zero()
  const outsideRuns = zero()
  const groups = new Map<string, RunAcc>()
  let lastUsedAt: number | undefined

  for (const row of mine) {
    add(totals, row)
    lastUsedAt = lastUsedAt === undefined ? row.updatedAt : Math.max(lastUsedAt, row.updatedAt)
    if (!row.runID) {
      add(outsideRuns, row)
      continue
    }
    const group = groups.get(row.runID) ?? { runID: row.runID, tokens: 0, cost: 0, sessions: 0, lastAt: 0 }
    group.tokens += row.tokens
    group.cost += row.cost
    group.sessions += 1
    group.lastAt = Math.max(group.lastAt, row.updatedAt)
    groups.set(row.runID, group)
  }

  const unattributed = zero()
  for (const row of input.rows) {
    if (row.employeeID) continue
    if (!row.runID || !runIDs.has(row.runID)) continue
    add(unattributed, row)
  }

  return {
    totals,
    runs: [...groups.values()].sort((a, b) => b.lastAt - a.lastAt),
    unattributed,
    outsideRuns,
    ...(lastUsedAt !== undefined ? { lastUsedAt } : {}),
  }
}

/**
 * 读这个人名下的全部会话（含他派生出的子代理：它们继承了同一个 `employee_id`）。
 *
 * 不按项目过滤：员工本身是全局身份（员工库没有项目字段），同一个人可以在几个项目里
 * 被编进团队，按人汇总才有意义。需要项目口径时，调用方自己按 `runID` 或目录再切。
 */
export function of(employeeID: string): Usage {
  // 一次读全表的用量列：未归属要在「这个人参与过的运行」里找，
  // 分开查反而要读两遍同一张表。这四列之外什么都不读。
  const rows = Database.use((db) =>
    db
      .select({
        sessionID: SessionTable.id,
        employeeID: SessionTable.employee_id,
        runID: SessionTable.run_id,
        cost: SessionTable.cost,
        input: SessionTable.tokens_input,
        output: SessionTable.tokens_output,
        reasoning: SessionTable.tokens_reasoning,
        cacheRead: SessionTable.tokens_cache_read,
        cacheWrite: SessionTable.tokens_cache_write,
        updatedAt: SessionTable.time_updated,
      })
      .from(SessionTable)
      .all(),
  )

  return summarize({
    rows: rows.map((row) => ({
      sessionID: row.sessionID,
      ...(row.employeeID ? { employeeID: row.employeeID } : {}),
      ...(row.runID ? { runID: row.runID } : {}),
      cost: row.cost,
      tokens: row.input + row.output + row.reasoning + row.cacheRead + row.cacheWrite,
      updatedAt: row.updatedAt,
    })),
    employeeID,
  })
}

export * as TeamEmployeeUsage from "./employee-usage"
