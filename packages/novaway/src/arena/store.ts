import { count, desc, eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { ArenaContenderTable, ArenaRunTable } from "./arena.sql"
import type { ContenderResult, RunResult } from "./arena"

export type ArenaRunRow = typeof ArenaRunTable.$inferSelect
export type ArenaContenderRow = typeof ArenaContenderTable.$inferSelect

export type ArenaRunDetail = {
  run: ArenaRunRow
  contenders: ArenaContenderRow[]
}

export type ArenaRunSummary = {
  run: ArenaRunRow
  contenders: number
}

/**
 * 落库只用于「事后对比」，不参与判定。
 *
 * 写失败不能连带把已经跑完的 arena 结果变成错误 —— 结果本身仍然有效，
 * 最多是这次运行不进历史列表。调用方用 `Effect.ignore` 包住即可。
 */
export function record(result: RunResult) {
  const createdAt = new Date()
  const status =
    result.contenders.length > 0 && result.contenders.every((item) => item.status !== "completed")
      ? "failed"
      : "completed"
  Database.use((db) => {
    db.insert(ArenaRunTable)
      .values({
        id: result.runID,
        task: result.task,
        status,
        winner: result.winner,
        verified: result.verified,
        note: result.note,
        created_at: createdAt,
      })
      .run()
    if (result.contenders.length === 0) return
    db.insert(ArenaContenderTable)
      .values(
        result.contenders.map((item: ContenderResult) => ({
          id: `${result.runID}:${item.id}`,
          run_id: result.runID,
          contender_id: item.id,
          status: item.status,
          session_id: item.sessionID,
          directory: item.directory,
          text: item.text,
          diff: item.diff,
          usage: item.usage,
          error: item.error,
          duration_ms: item.durationMs,
          verdict: item.verdict,
          score: item.score,
        })),
      )
      .run()
  })
}

export function list(limit = 20): ArenaRunSummary[] {
  return Database.use((db) =>
    db
      .select({ run: ArenaRunTable, contenders: count(ArenaContenderTable.id) })
      .from(ArenaRunTable)
      .leftJoin(ArenaContenderTable, eq(ArenaContenderTable.run_id, ArenaRunTable.id))
      .groupBy(ArenaRunTable.id)
      .orderBy(desc(ArenaRunTable.created_at))
      .limit(limit)
      .all()
      .map((row) => ({ run: row.run, contenders: row.contenders })),
  )
}

export function get(runID: string): ArenaRunDetail | undefined {
  return Database.use((db) => {
    const run = db.select().from(ArenaRunTable).where(eq(ArenaRunTable.id, runID)).limit(1).all()[0]
    if (!run) return undefined
    const contenders = db.select().from(ArenaContenderTable).where(eq(ArenaContenderTable.run_id, runID)).all()
    return { run, contenders }
  })
}

export * as ArenaStore from "./store"
