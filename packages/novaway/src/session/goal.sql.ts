import { index, sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"
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
  /** 目标循环的持久执行参数，跨进程恢复时继续使用同一套边界。 */
  execution_config: text("execution_config"),
  /** 跨进程目标执行租约；过期后其他实例才可接管。 */
  run_owner: text("run_owner"),
  run_lease_until: integer("run_lease_until", { mode: "timestamp_ms" }),
  created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

/** 每个目标的累计用量，跨进程重启持久；目标删除时级联清理。 */
export const GoalBudgetTable = sqliteTable(
  "goal_budget",
  {
    goal_id: text("goal_id")
      .primaryKey()
      .references(() => GoalTable.id, { onDelete: "cascade" }),
    session_id: text("session_id").notNull(),
    turns: integer("turns").notNull().default(0),
    tokens: integer("tokens").notNull().default(0),
    started_at: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("goal_budget_session_idx").on(t.session_id)],
)
