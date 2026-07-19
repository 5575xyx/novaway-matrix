import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import type { ProjectID } from "@/project/schema"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { Timestamps } from "@/storage/schema.sql"
import type { WorkflowLevel } from "./workflow-schema"

export const PowersNexusChangeBindingTable = sqliteTable(
  "powersnexus_change_binding",
  {
    id: text().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    worktree: text().notNull(),
    change_name: text().notNull(),
    root_session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    powersnexus_version: text().notNull(),
    powersnexus_digest: text().notNull(),
    protocol_version: text().notNull(),
    level: text().$type<WorkflowLevel>().notNull(),
    active: integer({ mode: "boolean" }).notNull().default(true),
    revision: integer().notNull().default(0),
    todo_artifact_revision: integer().notNull().default(0),
    todo_session_revision: integer().notNull().default(0),
    todo_origin: text().$type<"artifact" | "session">().notNull().default("artifact"),
    archive_action_id: text(),
    archive_request_digest: text(),
    archive_path: text(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("powersnexus_binding_change_idx").on(table.project_id, table.worktree, table.change_name),
    uniqueIndex("powersnexus_binding_root_session_idx").on(table.root_session_id),
    index("powersnexus_binding_project_active_idx").on(table.project_id, table.active),
    index("powersnexus_binding_digest_idx").on(table.powersnexus_digest),
  ],
)
