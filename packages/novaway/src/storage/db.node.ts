import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"

export function init(path: string) {
  const sqlite = new DatabaseSync(path)
  const db = drizzle({ client: sqlite })
  return db
}

/** 只读打开另一个库，数一下里面的会话数（见 db.bun.ts 的同名实现）。 */
export function countSessions(path: string) {
  const sqlite = new DatabaseSync(path, { readOnly: true })
  try {
    const row = sqlite.prepare("SELECT COUNT(*) AS count FROM session").get() as { count?: number } | undefined
    return Number(row?.count ?? 0)
  } finally {
    sqlite.close()
  }
}

/** 只读一次性查询（导入旧 dbx 连接用），与 db.bun.ts 的同名实现保持一致。 */
export function readAll(path: string, sql: string) {
  const sqlite = new DatabaseSync(path, { readOnly: true })
  try {
    return sqlite.prepare(sql).all() as Array<Record<string, unknown>>
  } finally {
    sqlite.close()
  }
}
