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

/** 分页语法族：MySQL/Postgres/SQLite 用 LIMIT，Oracle 用 FETCH，SQL Server 用 TOP+FETCH。 */
export type PageDialect = "limit" | "fetch" | "top"

export function wrapForPage(sql: string, limit: number, offset: number) {
  const body = sql.trim().replace(/;\s*$/, "")
  return `SELECT * FROM (${body}) AS __novaway_page LIMIT ${Math.max(1, limit)} OFFSET ${Math.max(0, offset)}`
}

/**
 * 按方言给查询加分页。
 *
 * - `limit`：包一层子查询再 LIMIT/OFFSET（MySQL / Postgres / SQLite / ClickHouse）。
 * - `fetch`：Oracle 12c+ 的 `OFFSET n ROWS FETCH NEXT m ROWS ONLY`。Oracle 允许外层
 *   `SELECT * FROM (...)`，所以仍然包一层，用户写的 ORDER BY 留在子查询里。
 * - `top`：SQL Server。**不能包层**——派生表里出现 ORDER BY 是语法错误，所以直接
 *   接在用户语句末尾；用户没写 ORDER BY 时补一个 `ORDER BY (SELECT NULL)`，
 *   否则 OFFSET/FETCH 会被拒绝。
 */
export function wrapForPageDialect(sql: string, limit: number, offset: number, dialect: PageDialect = "limit") {
  const rows = Math.max(1, limit)
  const skip = Math.max(0, offset)
  if (dialect === "fetch") {
    const body = sql.trim().replace(/;\s*$/, "")
    return `SELECT * FROM (${body}) __novaway_page OFFSET ${skip} ROWS FETCH NEXT ${rows} ROWS ONLY`
  }
  if (dialect === "top") {
    const body = sql.trim().replace(/;\s*$/, "")
    const order = hasTopLevelOrderBy(body) ? "" : " ORDER BY (SELECT NULL)"
    return `${body}${order} OFFSET ${skip} ROWS FETCH NEXT ${rows} ROWS ONLY`
  }
  return wrapForPage(sql, rows, skip)
}

/** 只看括号深度 0 处的 ORDER BY，避免把子查询里的排序当成顶层排序。 */
export function hasTopLevelOrderBy(sql: string) {
  const text = strip(sql)
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === "(") depth += 1
    else if (char === ")") depth = Math.max(0, depth - 1)
    else if (depth === 0 && /\s/.test(char) && /^\s+order\s+by\b/i.test(text.slice(index))) return true
  }
  return false
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
