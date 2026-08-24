import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"

export interface WorkflowStep {
  readonly id: string
  readonly name: string
  readonly type: "agent" | "tool" | "skill" | "condition" | "parallel"
  readonly config: Record<string, any>
  readonly next?: string
  readonly nextTrue?: string
  readonly nextFalse?: string
  readonly steps?: string[]
}

export interface WorkflowState {
  readonly currentStep: string
  readonly completedSteps: string[]
  readonly outputs: Record<string, any>
  readonly startedAt: Date
  readonly completedAt?: Date
}

export const WorkflowTable = sqliteTable(
  "workflow",
  {
    id: text().primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    steps: text({ mode: "json" }).$type<WorkflowStep[]>().notNull(),
    status: text("status").notNull().default("draft"),
    state: text({ mode: "json" }).$type<WorkflowState>(),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("workflow_session_idx").on(table.session_id),
    index("workflow_status_idx").on(table.status),
  ],
)

export const WorkflowRunTable = sqliteTable(
  "workflow_run",
  {
    id: text().primaryKey(),
    workflow_id: text("workflow_id")
      .notNull()
      .references(() => WorkflowTable.id, { onDelete: "cascade" }),
    session_id: text("session_id")
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    state: text({ mode: "json" }).$type<WorkflowState>(),
    error: text(),
    started_at: integer("started_at", { mode: "timestamp_ms" }),
    completed_at: integer("completed_at", { mode: "timestamp_ms" }),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("workflow_run_workflow_idx").on(table.workflow_id),
    index("workflow_run_session_idx").on(table.session_id),
  ],
)
