import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"
import { PowersNexusChangeBindingTable } from "./binding.sql"

export type RunStatus = "pending" | "running" | "passed" | "failed" | "cancelled" | "interrupted"
export type StepStatus = "pending" | "running" | "passed" | "failed" | "cancelled" | "skipped"
export type StepKind = "profile" | "retry_probe"

export const PowersNexusRunTable = sqliteTable(
  "powersnexus_run",
  {
    id: text().primaryKey(),
    binding_id: text()
      .notNull()
      .references(() => PowersNexusChangeBindingTable.id, { onDelete: "cascade" }),
    action: text().notNull(),
    status: text().$type<RunStatus>().notNull().default("pending"),
    attempt: integer().notNull().default(1),
    snapshot_revision: integer().notNull(),
    fingerprint: text(),
    error_code: text(),
    log_directory: text().notNull(),
    recovery_policy: text().notNull(),
    evidence_files: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    time_started: integer(),
    time_ended: integer(),
    ...Timestamps,
  },
  (table) => [
    index("powersnexus_run_binding_idx").on(table.binding_id),
    index("powersnexus_run_status_idx").on(table.status),
  ],
)

export const PowersNexusRunStepTable = sqliteTable(
  "powersnexus_run_step",
  {
    id: text().primaryKey(),
    run_id: text()
      .notNull()
      .references(() => PowersNexusRunTable.id, { onDelete: "cascade" }),
    step_id: text().notNull(),
    sequence: integer().notNull(),
    kind: text().$type<StepKind>().notNull().default("profile"),
    profile_step_id: text().notNull(),
    argv: text({ mode: "json" }).$type<string[]>().notNull(),
    cwd: text().notNull(),
    timeout_ms: integer(),
    status: text().$type<StepStatus>().notNull().default("pending"),
    exit_code: integer(),
    stdout_file: text(),
    stderr_file: text(),
    artifacts: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    evidence_digest: text(),
    time_started: integer(),
    time_ended: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("powersnexus_run_step_identity_idx").on(table.run_id, table.step_id),
    index("powersnexus_run_step_status_idx").on(table.status),
  ],
)
