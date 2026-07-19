import path from "node:path"
import { Identifier } from "@/id/id"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import * as Database from "@/storage/db"
import { and, eq } from "@/storage/db"
import { Effect, Schema } from "effect"
import { PowersNexusChangeBindingTable } from "./binding.sql"
import type { VersionRef } from "./schema"
import { ChangeName, WorkflowLevel } from "./workflow-schema"

export type Binding = {
  id: string
  projectID: ProjectID
  worktree: string
  changeName: string
  rootSessionID?: SessionID
  powersnexusVersion: string
  powersnexusDigest: string
  protocolVersion: string
  level: WorkflowLevel
  active: boolean
  revision: number
  todoState: { artifactRevision: number; sessionRevision: number; origin: "artifact" | "session" }
  archive?: { actionID: string; requestDigest: string; path: string }
  time: { created: number; updated: number }
}

export class RepositoryError extends Schema.TaggedErrorClass<RepositoryError>()("PowersNexusRepositoryError", {
  code: Schema.String,
  message: Schema.String,
}) {}

export type CreateBinding = {
  projectID: ProjectID
  worktree: string
  changeName: string
  level: WorkflowLevel
  version: VersionRef
}

export interface Interface {
  readonly create: (input: CreateBinding) => Effect.Effect<Binding, RepositoryError>
  readonly get: (id: string) => Effect.Effect<Binding | undefined, RepositoryError>
  readonly find: (input: Pick<CreateBinding, "projectID" | "worktree" | "changeName">) => Effect.Effect<Binding | undefined, RepositoryError>
  readonly listActive: (projectID: ProjectID, worktree?: string) => Effect.Effect<Binding[], RepositoryError>
  readonly bindSession: (input: {
    id: string
    sessionID: SessionID
    expectedRevision: number
  }) => Effect.Effect<Binding, RepositoryError>
  readonly deactivate: (input: { id: string; expectedRevision: number }) => Effect.Effect<Binding, RepositoryError>
  readonly updateTodoState: (input: {
    id: string
    artifactRevision: number
    sessionRevision: number
    origin: "artifact" | "session"
  }) => Effect.Effect<Binding, RepositoryError>
  readonly markArchived: (input: {
    id: string
    actionID: string
    requestDigest: string
    path: string
  }) => Effect.Effect<Binding, RepositoryError>
}

function fromRow(row: typeof PowersNexusChangeBindingTable.$inferSelect): Binding {
  return {
    id: row.id,
    projectID: row.project_id,
    worktree: row.worktree,
    changeName: row.change_name,
    ...(row.root_session_id ? { rootSessionID: row.root_session_id } : {}),
    powersnexusVersion: row.powersnexus_version,
    powersnexusDigest: row.powersnexus_digest,
    protocolVersion: row.protocol_version,
    level: row.level,
    active: row.active,
    revision: row.revision,
    todoState: {
      artifactRevision: row.todo_artifact_revision,
      sessionRevision: row.todo_session_revision,
      origin: row.todo_origin,
    },
    ...(row.archive_action_id && row.archive_request_digest && row.archive_path
      ? {
          archive: {
            actionID: row.archive_action_id,
            requestDigest: row.archive_request_digest,
            path: row.archive_path,
          },
        }
      : {}),
    time: { created: row.time_created, updated: row.time_updated },
  }
}

function repositoryError(code: string, message: string) {
  return new RepositoryError({ code, message })
}

function normalizeWorktree(worktree: string) {
  if (!path.isAbsolute(worktree)) throw repositoryError("PATH_OUTSIDE_WORKTREE", "worktree 必须是绝对路径")
  return path.resolve(worktree)
}

function wrap<A>(run: () => A, message: string) {
  return Effect.try({
    try: run,
    catch: (cause) =>
      cause instanceof RepositoryError
        ? cause
        : repositoryError("INTERNAL_WORKFLOW_ERROR", cause instanceof Error ? cause.message : message),
  })
}

export const make = Effect.fn("PowersNexus.Repository.make")(function* () {
  const get = (id: string) =>
    wrap(
      () => {
        const row = Database.use((db) =>
          db.select().from(PowersNexusChangeBindingTable).where(eq(PowersNexusChangeBindingTable.id, id)).get(),
        )
        return row ? fromRow(row) : undefined
      },
      "读取 binding 失败",
    )

  const find = (input: Pick<CreateBinding, "projectID" | "worktree" | "changeName">) =>
    wrap(
      () => {
        const worktree = normalizeWorktree(input.worktree)
        const changeName = Schema.decodeUnknownSync(ChangeName)(input.changeName)
        const row = Database.use((db) =>
          db
            .select()
            .from(PowersNexusChangeBindingTable)
            .where(
              and(
                eq(PowersNexusChangeBindingTable.project_id, input.projectID),
                eq(PowersNexusChangeBindingTable.worktree, worktree),
                eq(PowersNexusChangeBindingTable.change_name, changeName),
              ),
            )
            .get(),
        )
        return row ? fromRow(row) : undefined
      },
      "查找 binding 失败",
    )

  const create = Effect.fn("PowersNexus.Repository.create")(function* (input: CreateBinding) {
    const existing = yield* find(input)
    if (existing) return existing
    if (!input.version.verified || !input.version.compatible) {
      return yield* repositoryError("POWERSNEXUS_NOT_AVAILABLE", "binding 必须固定到已验证且兼容的 PowersNexus 版本")
    }
    const worktree = yield* wrap(() => normalizeWorktree(input.worktree), "worktree 无效")
    const changeName = yield* wrap(
      () => Schema.decodeUnknownSync(ChangeName)(input.changeName),
      "changeName 无效",
    )
    return yield* wrap(
      () => {
        const now = Date.now()
        const row = Database.use((db) =>
          db
            .insert(PowersNexusChangeBindingTable)
            .values({
              id: Identifier.create("pnb", "ascending"),
              project_id: input.projectID,
              worktree,
              change_name: changeName,
              powersnexus_version: input.version.version,
              powersnexus_digest: input.version.digest,
              protocol_version: input.version.protocolVersion,
              level: input.level,
              active: true,
              revision: 0,
              time_created: now,
              time_updated: now,
            })
            .returning()
            .get(),
        )
        return fromRow(row)
      },
      "创建 binding 失败",
    )
  })

  const listActive = (projectID: ProjectID, worktree?: string) =>
    wrap(
      () => {
        const normalized = worktree ? normalizeWorktree(worktree) : undefined
        const rows = Database.use((db) =>
          db
            .select()
            .from(PowersNexusChangeBindingTable)
            .where(
              and(
                eq(PowersNexusChangeBindingTable.project_id, projectID),
                eq(PowersNexusChangeBindingTable.active, true),
                normalized ? eq(PowersNexusChangeBindingTable.worktree, normalized) : undefined,
              ),
            )
            .all(),
        )
        return rows.map(fromRow)
      },
      "列出活动 binding 失败",
    )

  const update = (input: {
    id: string
    expectedRevision: number
    values: Partial<Pick<typeof PowersNexusChangeBindingTable.$inferInsert, "root_session_id" | "active">>
  }) =>
    wrap(
      () => {
        const row = Database.use((db) =>
          db
            .update(PowersNexusChangeBindingTable)
            .set({ ...input.values, revision: input.expectedRevision + 1, time_updated: Date.now() })
            .where(
              and(
                eq(PowersNexusChangeBindingTable.id, input.id),
                eq(PowersNexusChangeBindingTable.revision, input.expectedRevision),
              ),
            )
            .returning()
            .get(),
        )
        if (!row) throw repositoryError("REVISION_CONFLICT", "binding revision 已变化，请刷新后重试")
        return fromRow(row)
      },
      "更新 binding 失败",
    )

  return {
    create,
    get,
    find,
    listActive,
    bindSession: (input) =>
      update({ id: input.id, expectedRevision: input.expectedRevision, values: { root_session_id: input.sessionID } }),
    deactivate: (input) => update({ id: input.id, expectedRevision: input.expectedRevision, values: { active: false } }),
    updateTodoState: (input) =>
      wrap(
        () => {
          const row = Database.use((db) =>
            db
              .update(PowersNexusChangeBindingTable)
              .set({
                todo_artifact_revision: input.artifactRevision,
                todo_session_revision: input.sessionRevision,
                todo_origin: input.origin,
                time_updated: Date.now(),
              })
              .where(eq(PowersNexusChangeBindingTable.id, input.id))
              .returning()
              .get(),
          )
          if (!row) throw repositoryError("CHANGE_NOT_FOUND", `binding 不存在：${input.id}`)
          return fromRow(row)
        },
        "更新 Todo 协调状态失败",
      ),
    markArchived: (input) =>
      wrap(
        () => {
          const row = Database.use((db) =>
            db
              .update(PowersNexusChangeBindingTable)
              .set({
                active: false,
                archive_action_id: input.actionID,
                archive_request_digest: input.requestDigest,
                archive_path: input.path,
                time_updated: Date.now(),
              })
              .where(and(eq(PowersNexusChangeBindingTable.id, input.id), eq(PowersNexusChangeBindingTable.active, true)))
              .returning()
              .get(),
          )
          if (!row) throw repositoryError("ARCHIVE_CONFLICT", "Change 已归档或 binding 状态已变化")
          return fromRow(row)
        },
        "记录 PowersNexus 归档结果失败",
      ),
  } satisfies Interface
})

export * as PowersNexusRepository from "./repository"
