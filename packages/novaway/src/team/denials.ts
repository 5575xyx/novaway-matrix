import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { TeamRunDenialTable } from "./run.sql"

/**
 * 权限拒绝在本次运行内保持有效（§11.2）。
 *
 * 规则原文：「同一动作被拒绝后，在本次运行内保持拒绝，不重复弹窗；要改判定
 * 必须由用户显式放行。」这里只做事实存储与查找，判定发生在工具漏斗里：
 *
 * 1. **动作 = 工具 + 排序后的 patterns**。patterns 是权限系统判定用的模式串
 *    （例如一条 bash 命令），所以同一动作在任何团队/会话里都会得到同一个键。
 * 2. **只存哈希不存原文。** 被拒的往往是带 token 的命令或 URL —— 原文落库即泄露，
 *    而「同一动作」的判断只需要相等性，不需要原文。
 * 3. **换人不解决权限。** 存储键里没有员工、没有会话：另一个人执行同一个动作
 *    同样被拒（§11.2「权限被拒不能换人」）；放行只有一条路 —— 用户显式清除。
 */

export type Denial = { tool: string; reason?: string; at: number }

/** 同一动作的键：工具名 + 排序后的模式串，取 SHA-256。 */
export function actionKey(tool: string, patterns: readonly string[]): string {
  // 排序让 patterns 的顺序不影响判定：`["a","b"]` 与 `["b","a"]` 是同一个动作。
  // JSON 把工具名和各模式串分别转义，不会出现「换一种切法拼出同一个串」的碰撞。
  const canonical = JSON.stringify([tool, ...[...patterns].sort()])
  return createHash("sha256").update(canonical).digest("hex")
}

const toDenial = (row: typeof TeamRunDenialTable.$inferSelect): Denial => ({
  tool: row.tool,
  ...(row.reason ? { reason: row.reason } : {}),
  at: row.at,
})

/** 记一次拒绝。同一动作重复记录时保留第一次的时间：它才是「什么时候被判死的」。 */
export function remember(input: {
  runID: string
  tool: string
  patterns: readonly string[]
  reason?: string
}): void {
  const action = actionKey(input.tool, input.patterns)
  Database.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(TeamRunDenialTable)
        .where(and(eq(TeamRunDenialTable.run_id, input.runID), eq(TeamRunDenialTable.action, action)))
        .all()[0]
      if (existing) {
        // reason 可能有更新（用户补充了说明），时间不动 —— 判定时刻不变。
        if (input.reason && input.reason !== existing.reason)
          tx.update(TeamRunDenialTable)
            .set({ reason: input.reason })
            .where(eq(TeamRunDenialTable.id, existing.id))
            .run()
        return
      }
      tx.insert(TeamRunDenialTable)
        .values({
          id: "den_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
          run_id: input.runID,
          tool: input.tool,
          action,
          reason: input.reason ?? null,
          at: Date.now(),
        })
        .run()
    },
    { behavior: "immediate" },
  )
}

/** 查这个动作是否已经被拒过；有就返回当时的说明（不再弹窗）。 */
export function lookup(input: { runID: string; tool: string; patterns: readonly string[] }): Denial | undefined {
  const action = actionKey(input.tool, input.patterns)
  const row = Database.use((db) =>
    db
      .select()
      .from(TeamRunDenialTable)
      .where(and(eq(TeamRunDenialTable.run_id, input.runID), eq(TeamRunDenialTable.action, action)))
      .all(),
  )[0]
  return row ? toDenial(row) : undefined
}

/** 用户的显式放行：清掉本次运行的所有拒绝记录。返回清掉了几条。 */
export function clear(runID: string): number {
  return Database.use((db) => {
    const count = db.select().from(TeamRunDenialTable).where(eq(TeamRunDenialTable.run_id, runID)).all().length
    db.delete(TeamRunDenialTable).where(eq(TeamRunDenialTable.run_id, runID)).run()
    return count
  })
}

/** 本次运行里被拒过的动作（界面用；不带原文）。 */
export function list(runID: string): Denial[] {
  return Database.use((db) =>
    db.select().from(TeamRunDenialTable).where(eq(TeamRunDenialTable.run_id, runID)).orderBy(TeamRunDenialTable.at).all(),
  ).map(toDenial)
}

