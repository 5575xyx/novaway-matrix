/**
 * SQL 危险操作识别。
 *
 * 数据库页面的查询框是"直连执行"，之前 DELETE / DROP 点一下就发出去了，
 * 拼错库名或者 AI 生成的语句里带一句 DROP，数据就没了。
 * 这里只做**识别**，弹确认由 UI 负责 —— 不阻止用户执行，但必须让他看见。
 */

export type SqlRisk = "safe" | "write" | "destructive"

const DESTRUCTIVE =
  /\b(drop|truncate|delete|alter|rename|shutdown|kill|revoke|grant|flushdb|flushall|swapdb|eval|evalsha|deletemany|deleteone|findoneanddelete|dropdatabase|dropcollection|dropindex|renamecollection)\b/i
const WRITE =
  /\b(insert|update|merge|replace|create|upsert|copy|load|call|do|set|setex|setnx|mset|hset|hmset|lpush|rpush|sadd|srem|zadd|zrem|incr|decr|expire|persist|publish|insertmany|insertone|updatemany|updateone|replaceone|findoneandupdate|findoneandreplace|bulkwrite|createindex)\b/i

/**
 * 去掉注释与字符串字面量后再匹配，避免 `SELECT '-- drop'` 这种误报。
 */
function strip(input: string) {
  return input
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
}

/** 一条 SQL 的风险等级。多条语句按最高风险算。 */
export function sqlRisk(sql: string): SqlRisk {
  const text = strip(sql)
  if (!text.trim()) return "safe"
  if (DESTRUCTIVE.test(text)) return "destructive"
  if (WRITE.test(text)) return "write"
  return "safe"
}

/** 命中危险关键字时返回具体动词，用于确认文案（例如「这条语句包含 DELETE」）。 */
export function sqlRiskKeyword(sql: string): string | undefined {
  const text = strip(sql)
  const destructive = DESTRUCTIVE.exec(text)
  if (destructive) return destructive[1].toUpperCase()
  const write = WRITE.exec(text)
  if (write) return write[1].toUpperCase()
  return undefined
}

/** 是否是多语句（分号分隔），危险操作确认文案需要提示"会执行多条"。 */
export function sqlStatementCount(sql: string) {
  return strip(sql)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean).length
}
