import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import type { ProjectID } from "@/project/schema"
import type { SessionID, MessageID } from "@/session/schema"
import type { ContentFormat, EvolutionCandidateID, Kind, Status } from "./schema"
import { Timestamps } from "@/storage/schema.sql"

export const EvolutionCandidateTable = sqliteTable(
  "evolution_candidate",
  {
    id: text().$type<EvolutionCandidateID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    kind: text().$type<Kind>().notNull(),
    target: text().notNull(),
    title: text().notNull(),
    content: text().notNull(),
    content_format: text().$type<ContentFormat>().notNull().default("content"),
    reason: text().notNull(),
    tags: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    source_message_id: text().$type<MessageID>(),
    status: text().$type<Status>().notNull().default("pending"),
    ...Timestamps,
    time_applied: integer(),
  },
  (table) => [
    index("evolution_candidate_project_idx").on(table.project_id),
    index("evolution_candidate_session_idx").on(table.session_id),
    index("evolution_candidate_kind_idx").on(table.kind),
    index("evolution_candidate_status_idx").on(table.status),
    index("evolution_candidate_source_idx").on(table.source_message_id),
  ],
)

export const EvolutionReviewStateTable = sqliteTable(
  "evolution_review_state",
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
  (table) => [index("evolution_review_state_project_idx").on(table.project_id)],
)
