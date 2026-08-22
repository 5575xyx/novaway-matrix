import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import type { ProjectID } from "@/project/schema"
import type { SessionID, MessageID } from "@/session/schema"
import type {
  Domain,
  MemoryID,
  MemoryOperation,
  RelationID,
  ReviewCandidateID,
  ReviewCandidateStatus,
  Scope,
  Source,
  Target,
} from "./schema"
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
    domain: text().$type<Domain>().notNull().default("general"),
    content: text().notNull(),
    summary: text(),
    tags: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    importance: real().notNull().default(0.5),
    confidence: real().notNull().default(0.7),
    fact_key: text(),
    version: integer().notNull().default(1),
    supersedes_id: text().$type<MemoryID>(),
    source: text().$type<Source>().notNull(),
    origin_message_id: text().$type<MessageID>(),
    created_by: text(),
    ...Timestamps,
    time_archived: integer(),
    valid_from: integer(),
    valid_to: integer(),
    last_confirmed_at: integer(),
    /** Dense embedding JSON float array; null when using local-only semantic. */
    embedding_json: text(),
    embedding_model: text(),
    embedding_dims: integer(),
  },
  (table) => [
    index("memory_entry_project_idx").on(table.project_id),
    index("memory_entry_session_idx").on(table.session_id),
    index("memory_entry_target_scope_idx").on(table.target, table.scope),
    index("memory_entry_archived_idx").on(table.time_archived),
    index("memory_entry_domain_idx").on(table.domain),
    index("memory_entry_fact_key_idx").on(table.fact_key),
    index("memory_entry_valid_to_idx").on(table.valid_to),
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
    domain: text().$type<Domain>().notNull().default("general"),
    content: text().notNull(),
    summary: text(),
    tags: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    importance: real().notNull().default(0.5),
    confidence: real().notNull().default(0.7),
    fact_key: text(),
    operation: text().$type<MemoryOperation>().notNull().default("add"),
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
    index("memory_review_candidate_domain_idx").on(table.domain),
    index("memory_review_candidate_operation_idx").on(table.operation),
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

export const MemoryRelationTable = sqliteTable(
  "memory_relation",
  {
    id: text().$type<RelationID>().primaryKey(),
    memory_id: text()
      .$type<MemoryID>()
      .references(() => MemoryEntryTable.id, { onDelete: "cascade" }),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    source: text().notNull(),
    source_type: text(),
    relation: text().notNull(),
    target: text().notNull(),
    target_type: text(),
    confidence: real().notNull().default(0.7),
    valid_from: integer(),
    valid_to: integer(),
    last_confirmed_at: integer(),
    origin_message_id: text().$type<MessageID>(),
    ...Timestamps,
  },
  (table) => [
    index("memory_relation_memory_idx").on(table.memory_id),
    index("memory_relation_project_idx").on(table.project_id),
    index("memory_relation_session_idx").on(table.session_id),
    index("memory_relation_source_idx").on(table.source),
    index("memory_relation_target_idx").on(table.target),
    index("memory_relation_relation_idx").on(table.relation),
    index("memory_relation_valid_to_idx").on(table.valid_to),
  ],
)
