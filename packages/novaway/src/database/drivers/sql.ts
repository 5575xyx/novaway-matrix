/**
 * SQL 方言无关的小工具：分页包装、只读校验、行数截断。
 *
 * 分页策略（重要）：
 * - `SELECT` / `WITH` 且顶层没有 `LIMIT` 时，包成
 *   `SELECT * FROM (<sql>) AS __novaway_page LIMIT n OFFSET m`，
 *   由数据库真正做分页，不会把百万行拉进内存；
 * - 其它情况（已带 LIMIT、写语句、多语句）原样执行，
 *   由驱动层截断到 limit+1 并标记 `truncated`。
 */
import { sqlRisk } from "@/util/sql-risk"

/** 去掉注释和字符串字面量，供关键字检测使用。 */
export function strip(sql: string) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
}

/** 是否是「可以安全包装分页」的查询。 */
export function pageable(sql: string) {
  const text = strip(sql)
  if (!/^\s*(select|with)\b/i.test(text)) return false
  if (text.includes(";")) return false
  // 顶层已有 LIMIT：交给用户控制，避免嵌套语义冲突。
  if (/\blimit\b/i.test(text)) return false
  return true
}

export function wrapForPage(sql: string, limit: number, offset: number) {
  const body = sql.trim().replace(/;\s*$/, "")
  return `SELECT * FROM (${body}) AS __novaway_page LIMIT ${Math.max(1, limit)} OFFSET ${Math.max(0, offset)}`
}

/** 只读模式：写语句直接拒绝。 */
export function assertReadOnly(sql: string) {
  if (sqlRisk(sql) !== "safe") throw new Error("当前为只读查询模式，拒绝执行写操作。")
}

/** 截断到 limit 行，并报告是否还有更多。 */
export function capRows<T>(rows: T[], limit: number) {
  const truncated = rows.length > limit
  return { rows: truncated ? rows.slice(0, limit) : rows, truncated }
}
