import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const BackgroundJobTable = sqliteTable(
  "background_job",
  {
    id: text().primaryKey(),
    type: text().notNull(),
    title: text(),
    status: text().notNull(),
    started_at: integer().notNull(),
    completed_at: integer(),
    output: text(),
    error: text(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
  },
  (table) => [index("background_job_status_idx").on(table.status)],
)
