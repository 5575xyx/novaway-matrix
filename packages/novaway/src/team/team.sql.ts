import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import type { SessionID } from "@/session/schema"

export const TeamTable = sqliteTable(
  "team",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    description: text(),
    root_session_id: text().$type<SessionID>().notNull(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [index("team_root_session_idx").on(table.root_session_id)],
)

export const TeamMemberTable = sqliteTable(
  "team_member",
  {
    team_id: text().notNull(),
    session_id: text().$type<SessionID>().notNull(),
    name: text().notNull(),
    agent: text().notNull(),
    role: text().notNull().default("worker"),
    status: text().notNull().default("idle"),
    current_task_id: text(),
    worktree_path: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [index("team_member_team_idx").on(table.team_id)],
)

export const AgentTaskTable = sqliteTable(
  "agent_task",
  {
    id: text().primaryKey(),
    team_id: text().notNull(),
    subject: text().notNull(),
    description: text().notNull(),
    active_form: text(),
    status: text().notNull().default("pending"),
    owner_session_id: text().$type<SessionID>(),
    blocks: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    blocked_by: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    created_by: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [index("agent_task_team_idx").on(table.team_id), index("agent_task_owner_idx").on(table.owner_session_id)],
)

export const AgentMessageTable = sqliteTable(
  "agent_message",
  {
    id: text().primaryKey(),
    team_id: text().notNull(),
    from_session_id: text().$type<SessionID>().notNull(),
    to_session_id: text().$type<SessionID>(),
    broadcast: integer().notNull().default(0),
    summary: text(),
    content: text().notNull(),
    read_at: integer(),
    created_at: integer().notNull(),
  },
  (table) => [index("agent_message_to_idx").on(table.to_session_id), index("agent_message_team_idx").on(table.team_id)],
)

export * as TeamTables from "./team.sql"
