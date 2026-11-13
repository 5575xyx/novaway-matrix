import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import type { ProjectID } from "@/project/schema"
import { Timestamps } from "@/storage/schema.sql"

/**
 * Dream/distill 的持久化触发与互斥状态。
 *
 * 用表代替进程内的轮次 Map：重启后节流仍成立，跨进程也只有一个整合 job 能拿到锁。
 */
export const DreamStateTable = sqliteTable("dream_state", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  turn_count: integer().notNull().default(0),
  last_run_at: integer(),
  cursor_at: integer(),
  lock_owner: text(),
  lock_expires_at: integer(),
  ...Timestamps,
})
