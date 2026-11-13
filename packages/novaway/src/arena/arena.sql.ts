import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core"

export const ArenaRunTable = sqliteTable(
  "arena_run",
  {
    id: text().primaryKey(),
    task: text().notNull(),
    status: text("status").$type<"completed" | "failed">().notNull().default("completed"),
    winner: text(),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    note: text(),
    created_at: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("arena_run_created_idx").on(table.created_at)],
)

export const ArenaContenderTable = sqliteTable(
  "arena_contender",
  {
    id: text().primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => ArenaRunTable.id, { onDelete: "cascade" }),
    contender_id: text("contender_id").notNull(),
    status: text("status").$type<"completed" | "failed" | "skipped">().notNull(),
    session_id: text("session_id"),
    directory: text(),
    text: text(),
    diff: text({ mode: "json" }).$type<unknown>(),
    usage: text({ mode: "json" }).$type<unknown>(),
    error: text(),
    duration_ms: integer("duration_ms"),
    verdict: text().$type<"pass" | "fail">(),
    score: real(),
  },
  (table) => [index("arena_contender_run_idx").on(table.run_id)],
)
