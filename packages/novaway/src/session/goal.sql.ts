import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"

export interface GoalProgress {
  readonly total: number
  readonly completed: number
  readonly percentage: number
}

export const GoalTable = sqliteTable("goal", {
  id: text().primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  parent_id: text("parent_id"),
  title: text().notNull(),
  description: text(),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  success_criteria: text("success_criteria"),
  deadline: integer("deadline", { mode: "timestamp_ms" }),
  progress: real("progress").notNull().default(0),
  tags: text({ mode: "json" }).$type<string[]>().default([]),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})
