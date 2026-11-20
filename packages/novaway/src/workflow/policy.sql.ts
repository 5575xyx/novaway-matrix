import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"

export const SessionWorkflowPolicyTable = sqliteTable(
  "session_workflow_policy",
  {
    session_id: text("session_id")
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    turn_id: text("turn_id").notNull(),
    route: text("route").notNull(),
    phase: text("phase").notNull(),
    route_locked: integer("route_locked").notNull().default(1),
    escalation_reason: text("escalation_reason"),
    question_calls: integer("question_calls").notNull().default(0),
    question_budget: integer("question_budget").notNull().default(1),
    verification_status: text("verification_status").notNull().default("not_required"),
    delivery_status: text("delivery_status").notNull().default("not_started"),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updated_at: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("session_workflow_policy_turn_idx").on(table.turn_id)],
)

export const SessionWorkflowEventTable = sqliteTable(
  "session_workflow_event",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    turn_id: text("turn_id").notNull(),
    type: text("type").notNull(),
    route: text("route").notNull(),
    phase: text("phase").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("session_workflow_event_session_idx").on(table.session_id, table.created_at)],
)
