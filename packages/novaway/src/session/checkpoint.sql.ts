import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import { Timestamps } from "@/storage/schema.sql"

export interface CheckpointData {
  // 编码后的 MessageV2.WithParts[](Schema.encode 产物,JSON 安全),恢复时 decode 回写。
  messages: unknown[]
  // 建检查点时的文件快照 id;恢复时 Snapshot.checkout 回滚工作区文件。
  snapshot?: string
  context: Record<string, unknown>
  metadata: {
    reason?: string
    tags?: string[]
    createdAt: string
  }
}

export const SessionCheckpointTable = sqliteTable("session_checkpoint", {
  id: text().primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  name: text().notNull(),
  reason: text(),
  tags: text({ mode: "json" }).$type<string[]>().default([]),
  data: text({ mode: "json" }).$type<CheckpointData>().notNull(),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

// 自动检查点的间隔计数状态,按会话累加轮次;仿 evolution_review_state。
export const SessionCheckpointStateTable = sqliteTable(
  "session_checkpoint_state",
  {
    session_id: text("session_id")
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    turn_count: integer().notNull().default(0),
    last_checkpoint_id: text("last_checkpoint_id"),
    last_checkpoint_at: integer("last_checkpoint_at"),
    ...Timestamps,
  },
  (table) => [index("session_checkpoint_state_updated_idx").on(table.time_updated)],
)
