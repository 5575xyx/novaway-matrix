import { randomUUID } from "node:crypto"
import { and, eq, isNull, lt, or, sql } from "@/storage/db"
import * as Database from "@/storage/db"
import type { ProjectID } from "@/project/schema"
import { DreamStateTable } from "./dream.sql"

const LOCK_TTL_MS = 5 * 60_000

export type State = {
  projectID: ProjectID
  turnCount: number
  lastRunAt?: number
  cursorAt?: number
  lockOwner?: string
  lockExpiresAt?: number
}

function ensure(projectID: ProjectID, now: number) {
  Database.use((db) =>
    db
      .insert(DreamStateTable)
      .values({ project_id: projectID, turn_count: 0, time_created: now, time_updated: now })
      .onConflictDoNothing()
      .run(),
  )
}

export function read(projectID: ProjectID): State | undefined {
  const row = Database.use((db) =>
    db.select().from(DreamStateTable).where(eq(DreamStateTable.project_id, projectID)).get(),
  )
  if (!row) return undefined
  return {
    projectID: row.project_id,
    turnCount: row.turn_count,
    ...(row.last_run_at === null ? {} : { lastRunAt: row.last_run_at }),
    ...(row.cursor_at === null ? {} : { cursorAt: row.cursor_at }),
    ...(row.lock_owner === null ? {} : { lockOwner: row.lock_owner }),
    ...(row.lock_expires_at === null ? {} : { lockExpiresAt: row.lock_expires_at }),
  }
}

/** 记录一轮,返回是否到了 interval 触发点。interval<=0 视为关闭。 */
export function due(input: { projectID: ProjectID; interval: number; now: number }) {
  if (!Number.isFinite(input.interval) || input.interval <= 0) return false
  ensure(input.projectID, input.now)
  Database.use((db) =>
    db
      .update(DreamStateTable)
      .set({ turn_count: sql`${DreamStateTable.turn_count} + 1`, time_updated: input.now })
      .where(eq(DreamStateTable.project_id, input.projectID))
      .run(),
  )
  const state = read(input.projectID)
  return (state?.turnCount ?? 0) % Math.floor(input.interval) === 0
}

/** 距上次成功整合是否已过 minHours。 */
export function ready(input: { projectID: ProjectID; minHours: number; now: number }) {
  if (input.minHours <= 0) return true
  const state = read(input.projectID)
  if (!state?.lastRunAt) return true
  return input.now - state.lastRunAt >= input.minHours * 3_600_000
}

export function tryLock(input: { projectID: ProjectID; now: number; ttlMs?: number }) {
  ensure(input.projectID, input.now)
  const owner = randomUUID()
  const expires = input.now + (input.ttlMs ?? LOCK_TTL_MS)
  const claimed = Database.use((db) =>
    db
      .update(DreamStateTable)
      .set({ lock_owner: owner, lock_expires_at: expires, time_updated: input.now })
      .where(
        and(
          eq(DreamStateTable.project_id, input.projectID),
          or(isNull(DreamStateTable.lock_owner), lt(DreamStateTable.lock_expires_at, input.now)),
        ),
      )
      .returning({ projectID: DreamStateTable.project_id })
      .all(),
  )
  if (claimed.length === 0) return undefined
  return owner
}

export function finish(input: { projectID: ProjectID; owner: string; now: number; cursorAt?: number }) {
  Database.use((db) =>
    db
      .update(DreamStateTable)
      .set({
        last_run_at: input.now,
        ...(input.cursorAt === undefined ? {} : { cursor_at: input.cursorAt }),
        lock_owner: null,
        lock_expires_at: null,
        time_updated: input.now,
      })
      .where(and(eq(DreamStateTable.project_id, input.projectID), eq(DreamStateTable.lock_owner, input.owner)))
      .run(),
  )
}

/** 失败时只释放锁,不推进 last_run_at,让下一轮还能重试。 */
export function release(input: { projectID: ProjectID; owner: string; now: number }) {
  Database.use((db) =>
    db
      .update(DreamStateTable)
      .set({ lock_owner: null, lock_expires_at: null, time_updated: input.now })
      .where(and(eq(DreamStateTable.project_id, input.projectID), eq(DreamStateTable.lock_owner, input.owner)))
      .run(),
  )
}
