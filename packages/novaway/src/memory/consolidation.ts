import { and, desc, eq, inArray } from "@/storage/db"
import * as Database from "@/storage/db"
import { Identifier } from "@/id/id"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import { MemoryConsolidationTable } from "./memory.sql"
import type { ConsolidationAudit, ConsolidationOp, ConsolidationState, MemoryID } from "./schema"

export interface NewAudit {
  projectID?: ProjectID
  sessionID?: SessionID
  op: ConsolidationOp
  memoryID?: MemoryID
  before?: string
  after?: string
  source?: string
  state?: ConsolidationState
  note?: string
  runAt?: number
}

export function insert(input: NewAudit): ConsolidationAudit {
  const now = Date.now()
  const id = Identifier.create("mcn", "ascending")
  const runAt = input.runAt ?? now
  Database.use((db) =>
    db
      .insert(MemoryConsolidationTable)
      .values({
        id,
        project_id: input.projectID ?? null,
        session_id: input.sessionID ?? null,
        op: input.op,
        memory_id: input.memoryID ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        source: input.source ?? "dream",
        state: input.state ?? "prepared",
        note: input.note ?? null,
        run_at: runAt,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return {
    id,
    ...(input.projectID ? { projectID: input.projectID } : {}),
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    op: input.op,
    ...(input.memoryID ? { memoryID: input.memoryID } : {}),
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.after === undefined ? {} : { after: input.after }),
    source: input.source ?? "dream",
    state: input.state ?? "prepared",
    ...(input.note === undefined ? {} : { note: input.note }),
    runAt,
  }
}

export function insertMany(items: NewAudit[]) {
  return items.map(insert)
}

export function list(input?: {
  projectID?: ProjectID
  sessionID?: SessionID
  state?: ConsolidationState
  limit?: number
}) {
  const rows = Database.use((db) =>
    db
      .select()
      .from(MemoryConsolidationTable)
      .where(
        and(
          input?.projectID ? eq(MemoryConsolidationTable.project_id, input.projectID) : undefined,
          input?.sessionID ? eq(MemoryConsolidationTable.session_id, input.sessionID) : undefined,
          input?.state ? eq(MemoryConsolidationTable.state, input.state) : undefined,
        ),
      )
      .orderBy(desc(MemoryConsolidationTable.run_at))
      .limit(input?.limit ?? 100)
      .all(),
  )
  return rows.map(
    (row): ConsolidationAudit => ({
      id: row.id,
      ...(row.project_id ? { projectID: row.project_id } : {}),
      ...(row.session_id ? { sessionID: row.session_id } : {}),
      op: row.op,
      ...(row.memory_id ? { memoryID: row.memory_id } : {}),
      ...(row.before === null ? {} : { before: row.before }),
      ...(row.after === null ? {} : { after: row.after }),
      source: row.source,
      state: row.state,
      ...(row.note === null ? {} : { note: row.note }),
      runAt: row.run_at,
    }),
  )
}

export function mark(input: { id: string; state: ConsolidationState; note?: string }) {
  Database.use((db) =>
    db
      .update(MemoryConsolidationTable)
      .set({ state: input.state, ...(input.note === undefined ? {} : { note: input.note }), time_updated: Date.now() })
      .where(eq(MemoryConsolidationTable.id, input.id))
      .run(),
  )
}

export function markMany(input: { ids: string[]; state: ConsolidationState; note?: string }) {
  if (!input.ids.length) return
  Database.use((db) =>
    db
      .update(MemoryConsolidationTable)
      .set({ state: input.state, ...(input.note === undefined ? {} : { note: input.note }), time_updated: Date.now() })
      .where(inArray(MemoryConsolidationTable.id, input.ids))
      .run(),
  )
}
