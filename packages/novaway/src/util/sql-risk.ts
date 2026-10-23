/**
 * SQL 风险识别（服务端与 UI 共用同一份规则）。
 *
 * 与 `app/src/utils/sql-guard.ts` 的区别：那边面向「执行前确认」，
 * 这边面向「只读模式强制拦截」。两边的关键字集合保持一致。
 */
export type SqlRisk = "safe" | "write" | "destructive"

const DESTRUCTIVE =
  /\b(drop|truncate|delete|alter|rename|shutdown|kill|revoke|grant|flushdb|flushall|swapdb|eval|evalsha|deletemany|deleteone|findoneanddelete|dropdatabase|dropcollection|dropindex|renamecollection)\b/i
const WRITE =
  /\b(insert|update|merge|replace|create|upsert|copy|load|call|do|set|setex|setnx|mset|hset|hmset|lpush|rpush|sadd|srem|zadd|zrem|incr|decr|expire|persist|publish|insertmany|insertone|updatemany|updateone|replaceone|findoneandupdate|findoneandreplace|bulkwrite|createindex)\b/i

function strip(input: string) {
  return input
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
}

export function sqlRisk(sql: string): SqlRisk {
  const text = strip(sql)
  if (!text.trim()) return "safe"
  if (DESTRUCTIVE.test(text)) return "destructive"
  if (WRITE.test(text)) return "write"
  return "safe"
}
