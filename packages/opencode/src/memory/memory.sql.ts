import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import type { ProjectID } from "@/project/schema"
import type { SessionID, MessageID } from "@/session/schema"
import type { MemoryID, ReviewCandidateID, ReviewCandidateStatus, Scope, Source, Target } from "./schema"
import { Timestamps } from "@/storage/schema.sql"

export const MemoryEntryTable = sqliteTable(
  "memory_entry",
  {
    id: text().$type<MemoryID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    target: text().$type<Target>().notNull(),
    scope: text().$type<Scope>().notNull(),
    content: text().notNull(),
    summary: text(),
    tags: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    importance: real().notNull().default(0.5),
    source: text().$type<Source>().notNull(),
    origin_message_id: text().$type<MessageID>(),
    created_by: text(),
    ...Timestamps,
    time_archived: integer(),
  },
  (table) => [
    index("memory_entry_project_idx").on(table.project_id),
    index("memory_entry_session_idx").on(table.session_id),
    index("memory_entry_target_scope_idx").on(table.target, table.scope),
    index("memory_entry_archived_idx").on(table.time_archived),
  ],
)

export const MemoryReviewCandidateTable = sqliteTable(
  "memory_review_candidate",
  {
    id: text().$type<ReviewCandidateID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    target: text().$type<Target>().notNull(),
    scope: text().$type<Scope>().notNull(),
    content: text().notNull(),
    summary: text(),
    tags: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    importance: real().notNull().default(0.5),
    reason: text().notNull(),
    source_message_id: text().$type<MessageID>(),
    status: text().$type<ReviewCandidateStatus>().notNull().default("pending"),
    ...Timestamps,
    time_applied: integer(),
  },
  (table) => [
    index("memory_review_candidate_project_idx").on(table.project_id),
    index("memory_review_candidate_session_idx").on(table.session_id),
    index("memory_review_candidate_status_idx").on(table.status),
    index("memory_review_candidate_source_idx").on(table.source_message_id),
  ],
)

export const MemoryReviewStateTable = sqliteTable(
  "memory_review_state",
  {
    session_id: text()
      .$type<SessionID>()
      .primaryKey()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    turn_count: integer().notNull().default(0),
    last_reviewed_message_id: text().$type<MessageID>(),
    last_reviewed_at: integer(),
    ...Timestamps,
  },
  (table) => [index("memory_review_state_project_idx").on(table.project_id)],
)
