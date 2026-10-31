import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

export function init(path: string) {
  const sqlite = new Database(path, { create: true })
  const db = drizzle({ client: sqlite })
  return db
}

/**
 * 只读打开另一个库，数一下里面的会话数。
 *
 * 开发构建按分支分库，启动时要把"其他分支的库里还有历史"提示出来，
 * 只能自己去读 —— 不走 drizzle，免得为了一个数字初始化整套客户端和迁移。
 * 放在这里而不是 db.ts：`bun:sqlite` 不能被 node 构建（Electron sidecar）看到。
 */
export function countSessions(path: string) {
  const sqlite = new Database(path, { readonly: true })
  try {
    const row = sqlite.query("SELECT COUNT(*) AS count FROM session").get() as { count?: number } | undefined
    return Number(row?.count ?? 0)
  } finally {
    sqlite.close()
  }
}

/** 只读一次性查询（导入旧 dbx 连接用）；同样不能把 bun:sqlite 泄漏进 node 构建。 */
export function readAll(path: string, sql: string) {
  const sqlite = new Database(path, { readonly: true })
  try {
    return sqlite.query(sql).all() as Array<Record<string, unknown>>
  } finally {
    sqlite.close()
  }
}
