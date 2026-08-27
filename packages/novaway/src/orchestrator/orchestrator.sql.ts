import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"

export interface OrchestratorTask {
  readonly id: string
  readonly name: string
  readonly type: "agent" | "tool" | "skill"
  readonly config: Record<string, any>
  readonly dependencies: string[]
  readonly status: "pending" | "running" | "completed" | "failed"
  readonly result?: any
  readonly error?: string
}

export const OrchestratorPlanTable = sqliteTable(
  "orchestrator_plan",
  {
    id: text().primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    tasks: text({ mode: "json" }).$type<OrchestratorTask[]>().notNull(),
    status: text("status").notNull().default("draft"),
    error: text(),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("orchestrator_plan_session_idx").on(table.session_id),
    index("orchestrator_plan_status_idx").on(table.status),
  ],
)
