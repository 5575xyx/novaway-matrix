import { and, desc, eq, isNull, or } from "@/storage/db"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import * as Database from "@/storage/db"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Context, Effect, Layer, Schema } from "effect"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { MemoryEntryTable, MemoryReviewCandidateTable, MemoryReviewStateTable } from "./memory.sql"
import {
  MemoryID,
  ReviewCandidateID,
  type AddInput,
  type Info,
  type ListInput,
  type PrefetchInput,
  type ReviewCandidate,
  type ReviewCandidateSource,
  type ReviewCandidateProposal,
  type ReviewCandidateListInput,
  type ReviewInput,
  type ReviewStatus,
  type UpdateInput,
} from "./schema"

const DEFAULT_LIMIT = 50
const PREFETCH_LIMIT = 5

type ReviewServiceInput = ReviewInput & { reviewInterval?: number; skipReviewState?: boolean }
type ReviewCompactionInput = {
  messagesText: string
  projectID?: AddInput["projectID"]
  sessionID?: AddInput["sessionID"]
  sourceMessageID?: AddInput["originMessageID"]
}
type ReviewSessionEndInput = ReviewCompactionInput
type MemoryFileLocation = {
  directory: string
  worktree: string
}
type FileBackedAddInput = AddInput & {
  location?: MemoryFileLocation
}

export const Event = {
  ReviewUpdated: BusEvent.define(
    "memory.review.updated",
    Schema.Struct({
      projectID: Schema.optional(ProjectID),
      sessionID: Schema.optional(SessionID),
    }),
  ),
}

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  readonly add: (input: FileBackedAddInput) => Effect.Effect<Info>
  readonly update: (input: UpdateInput) => Effect.Effect<Info | undefined>
  readonly remove: (id: MemoryID) => Effect.Effect<boolean>
  readonly prefetch: (input: PrefetchInput) => Effect.Effect<string>
  readonly syncTurn: (input: {
    userContent: string
    assistantContent: string
    projectID: AddInput["projectID"]
    sessionID: AddInput["sessionID"]
    originMessageID?: AddInput["originMessageID"]
    agent?: string
  }) => Effect.Effect<void>
  readonly status: (input?: { projectID?: AddInput["projectID"]; sessionID?: AddInput["sessionID"] }) => Effect.Effect<{
    total: number
    active: number
    archived: number
    latest?: number
  }>
  readonly review: (input: ReviewServiceInput) => Effect.Effect<ReviewCandidate[]>
  readonly reviewCompaction: (input: ReviewCompactionInput) => Effect.Effect<ReviewCandidate[]>
  readonly reviewSessionEnd: (input: ReviewSessionEndInput) => Effect.Effect<ReviewCandidate[]>
  readonly reviewDue: (input: ReviewServiceInput) => Effect.Effect<boolean>
  readonly listReviewCandidates: (input?: ReviewCandidateListInput) => Effect.Effect<ReviewCandidate[]>
  readonly applyReviewCandidate: (id: ReviewCandidateID, location?: MemoryFileLocation) => Effect.Effect<Info | undefined>
  readonly dismissReviewCandidate: (id: ReviewCandidateID) => Effect.Effect<ReviewCandidate | undefined>
  readonly reviewStatus: (input?: {
    projectID?: AddInput["projectID"]
    sessionID?: AddInput["sessionID"]
  }) => Effect.Effect<ReviewStatus>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

function rowToInfo(row: typeof MemoryEntryTable.$inferSelect): Info {
  return {
    id: row.id,
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    target: row.target,
    scope: row.scope,
    content: row.content,
    ...(row.summary ? { summary: row.summary } : {}),
    tags: row.tags,
    importance: row.importance,
    source: row.source,
    ...(row.origin_message_id ? { originMessageID: row.origin_message_id } : {}),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_archived ? { archived: row.time_archived } : {}),
    },
  }
}

function rowToCandidate(row: typeof MemoryReviewCandidateTable.$inferSelect): ReviewCandidate {
  return {
    id: row.id,
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    target: row.target,
    scope: row.scope,
    content: row.content,
    ...(row.summary ? { summary: row.summary } : {}),
    tags: row.tags,
    importance: row.importance,
    reason: row.reason,
    ...(row.source_message_id ? { sourceMessageID: row.source_message_id } : {}),
    status: row.status,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_applied ? { applied: row.time_applied } : {}),
    },
  }
}

function conditions(input?: ListInput) {
  return [
    input?.includeArchived ? undefined : isNull(MemoryEntryTable.time_archived),
    input?.projectID
      ? input.includeGlobal
        ? or(eq(MemoryEntryTable.project_id, input.projectID), isNull(MemoryEntryTable.project_id))
        : eq(MemoryEntryTable.project_id, input.projectID)
      : undefined,
    input?.sessionID ? eq(MemoryEntryTable.session_id, input.sessionID) : undefined,
    input?.target ? eq(MemoryEntryTable.target, input.target) : undefined,
    input?.scope ? eq(MemoryEntryTable.scope, input.scope) : undefined,
  ].filter((item) => item !== undefined)
}

function reviewConditions(input?: ReviewCandidateListInput) {
  return [
    input?.projectID ? eq(MemoryReviewCandidateTable.project_id, input.projectID) : undefined,
    input?.sessionID ? eq(MemoryReviewCandidateTable.session_id, input.sessionID) : undefined,
    input?.status ? eq(MemoryReviewCandidateTable.status, input.status) : undefined,
  ].filter((item) => item !== undefined)
}

function reviewCandidateSource(item: ReviewCandidate): ReviewCandidateSource {
  if (item.tags.includes("session-end")) return "session-end"
  if (item.tags.includes("compaction")) return "compaction"
  if (item.tags.includes("explicit")) return "explicit"
  return "background"
}

function emptyReviewSourceCounts(): ReviewStatus["source"] {
  return {
    all: 0,
    explicit: 0,
    background: 0,
    compaction: 0,
    "session-end": 0,
  }
}

function reviewSourceCounts(items: ReviewCandidate[]): ReviewStatus["source"] {
  return items.reduce((counts, item) => {
    const source = reviewCandidateSource(item)
    return {
      ...counts,
      all: counts.all + 1,
      [source]: counts[source] + 1,
    }
  }, emptyReviewSourceCounts())
}

function score(query: string, item: Info) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
  if (!terms.length) return item.importance
  const haystack = [item.content, item.summary ?? "", ...item.tags].join(" ").toLowerCase()
  const hits = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0)
  return hits * 10 + item.importance
}

function explicitMemory(text: string) {
  const patterns = [
    /(?:please\s+)?remember(?:\s+that)?\s+(.+)/i,
    /(?:请记住|记住)[:：]?\s*(.+)/,
    /帮我记住[:：]?\s*(.+)/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const content = match?.[1]?.trim()
    if (content && content.length >= 4) return content
  }
}

function hasGlobalMemoryIntent(text: string) {
  return /global|all projects|across projects|every project|所有项目|全部项目|全局|跨项目|整个系统/i.test(text)
}

function memoryScope(input: { projectID?: AddInput["projectID"]; userContent?: string; scope?: AddInput["scope"] }) {
  if (!input.projectID) return input.scope ?? "global"
  if (input.scope === "global" && hasGlobalMemoryIntent(input.userContent ?? "")) return "global"
  if (input.scope === "session") return "session"
  return "project"
}

function memoryProjectID(projectID: AddInput["projectID"] | undefined, scope: AddInput["scope"]) {
  return scope === "global" ? undefined : projectID
}

function clampImportance(input?: number) {
  if (typeof input !== "number" || !Number.isFinite(input)) return 0.7
  return Math.min(Math.max(input, 0), 1)
}

function candidateRow(input: ReviewInput, proposal: ReviewCandidateProposal): typeof MemoryReviewCandidateTable.$inferInsert | undefined {
  const content = proposal.content.trim()
  if (content.length < 4) return
  const now = Date.now()
  const scope = memoryScope({ projectID: input.projectID, userContent: input.userContent, scope: proposal.scope })
  return {
    id: ReviewCandidateID.ascending(),
    project_id: memoryProjectID(input.projectID, scope),
    session_id: input.sessionID,
    target: proposal.target ?? "memory",
    scope,
    content,
    summary: proposal.summary?.trim() || (content.length > 120 ? `${content.slice(0, 117)}...` : undefined),
    tags: Array.from(new Set([...(proposal.tags ?? []), "review"].map((tag) => tag.trim()).filter(Boolean))),
    importance: clampImportance(proposal.importance),
    reason: proposal.reason?.trim() || "LLM 归纳出可能值得长期保留的信息",
    source_message_id: input.sourceMessageID,
    status: "pending",
    time_created: now,
    time_updated: now,
  }
}

function candidateRowsFromReview(input: ReviewInput, tags: string[] = []) {
  const explicit = explicitMemory(input.userContent)
  return [
    explicit
      ? {
          content: explicit,
          tags: ["explicit", ...tags],
          importance: 0.8,
          reason: "用户显式要求记住该内容",
        }
      : undefined,
    ...(input.candidates ?? []).map((candidate) => ({
      ...candidate,
      tags: [...(candidate.tags ?? []), ...tags],
    })),
  ]
    .filter((item) => item !== undefined)
    .map((proposal) => candidateRow(input, proposal))
    .filter((item) => item !== undefined)
    .filter((row, index, rows) => rows.findIndex((item) => item.content === row.content) === index)
}

function reviewInterval(input?: number) {
  if (typeof input !== "number" || !Number.isFinite(input)) return 1
  return Math.max(Math.floor(input), 1)
}

function targetSegments(target: string) {
  return target
    .trim()
    .replace(/\.md$/i, "")
    .split(/[\\/]+/)
    .map((item) => item.trim().replace(/[<>:"|?*\x00-\x1f]/g, "-"))
    .filter((item) => item && item !== "." && item !== "..")
}

function memoryFile(row: typeof MemoryEntryTable.$inferInsert, location: MemoryFileLocation) {
  const root = path.join(location.worktree === "/" ? location.directory : location.worktree, ".novaway", "memory")
  const segments = targetSegments(row.target)
  const file = path.join(root, row.scope, ...(segments.length ? segments : ["memory"]), `${row.id}.md`)
  if (!AppFileSystem.contains(root, file)) return path.join(root, "project", "memory", `${row.id}.md`)
  return file
}

function memoryMarkdown(row: typeof MemoryEntryTable.$inferInsert) {
  const title = row.summary || row.content.slice(0, 48)
  const tags = row.tags ?? []
  const timeCreated = typeof row.time_created === "number" ? row.time_created : Date.now()
  return [
    `# ${title}`,
    "",
    `- 记忆ID: ${row.id}`,
    `- 范围: ${row.scope}`,
    `- 目标: ${row.target}`,
    `- 来源: ${row.source}`,
    `- 重要性: ${row.importance}`,
    `- 标签: ${tags.join(", ") || "无"}`,
    `- 创建时间: ${new Date(timeCreated).toISOString()}`,
    "",
    "## 内容",
    "",
    row.content,
    "",
  ].join("\n")
}

async function writeMemoryFile(row: typeof MemoryEntryTable.$inferInsert, location: MemoryFileLocation) {
  const file = memoryFile(row, location)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, memoryMarkdown(row))
  return file
}

export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const publishReviewUpdated = (input: { projectID?: AddInput["projectID"]; sessionID?: AddInput["sessionID"] }) =>
      bus
        .publish(Event.ReviewUpdated, {
          projectID: input.projectID,
          sessionID: input.sessionID,
        })
        .pipe(Effect.catchCause(() => Effect.void))
    const list: Interface["list"] = Effect.fn("Memory.list")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryEntryTable)
            .where(and(...conditions(input)))
            .orderBy(desc(MemoryEntryTable.time_updated))
            .limit(input?.limit ?? DEFAULT_LIMIT)
            .all(),
        ),
      )
      const items = rows.map(rowToInfo)
      if (!input?.search?.trim()) return items
      return items
        .map((item) => ({ item, score: score(input.search!, item) }))
        .filter((item) => item.score >= 10)
        .toSorted((a, b) => b.score - a.score)
        .map((item) => item.item)
    })

    const getByID = Effect.fn("Memory.getByID")(function* (id: MemoryID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(MemoryEntryTable).where(eq(MemoryEntryTable.id, id)).get()),
      )
      return row ? rowToInfo(row) : undefined
    })

    const add: Interface["add"] = Effect.fn("Memory.add")(function* (input) {
      const now = Date.now()
      const scope = memoryScope({ projectID: input.projectID, scope: input.scope })
      const row: typeof MemoryEntryTable.$inferInsert = {
        id: MemoryID.ascending(),
        project_id: memoryProjectID(input.projectID, scope),
        session_id: input.sessionID,
        target: input.target ?? "memory",
        scope,
        content: input.content.trim(),
        summary: input.summary?.trim() || undefined,
        tags: input.tags ? Array.from(input.tags) : [],
        importance: input.importance ?? 0.5,
        source: input.source ?? "manual",
        origin_message_id: input.originMessageID,
        created_by: input.createdBy,
        time_created: now,
        time_updated: now,
      }
      if (input.location) yield* Effect.promise(() => writeMemoryFile(row, input.location!))
      yield* Effect.sync(() => Database.use((db) => db.insert(MemoryEntryTable).values(row).run()))
      return (yield* getByID(row.id))!
    })

    const update: Interface["update"] = Effect.fn("Memory.update")(function* (input) {
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(MemoryEntryTable)
            .set({
              ...(input.content === undefined ? {} : { content: input.content.trim() }),
              ...(input.summary === undefined ? {} : { summary: input.summary.trim() || null }),
              ...(input.tags === undefined ? {} : { tags: Array.from(input.tags) }),
              ...(input.importance === undefined ? {} : { importance: input.importance }),
              ...(input.archived === undefined ? {} : { time_archived: input.archived ? now : null }),
              time_updated: now,
            })
            .where(eq(MemoryEntryTable.id, input.id))
            .run(),
        ),
      )
      return yield* getByID(input.id)
    })

    const remove: Interface["remove"] = Effect.fn("Memory.remove")(function* (id) {
      const existing = yield* getByID(id)
      if (!existing) return false
      yield* Effect.sync(() => Database.use((db) => db.delete(MemoryEntryTable).where(eq(MemoryEntryTable.id, id)).run()))
      return true
    })

    const prefetch: Interface["prefetch"] = Effect.fn("Memory.prefetch")(function* (input) {
      const items = yield* list({
        projectID: input.projectID,
        includeGlobal: true,
        search: input.query,
        limit: Math.max(input.limit ?? PREFETCH_LIMIT, PREFETCH_LIMIT * 4),
      })
      const selected = items.slice(0, input.limit ?? PREFETCH_LIMIT)
      if (!selected.length) return ""
      return selected
        .map((item) => {
          const label = item.target === "user" ? "用户画像" : "长期记忆"
          return `- ${label}: ${item.summary || item.content}`
        })
        .join("\n")
    })

    const syncTurn: Interface["syncTurn"] = Effect.fn("Memory.syncTurn")(function* (input) {
      const content = explicitMemory(input.userContent)
      if (!content) return
      yield* add({
        projectID: input.projectID,
        sessionID: input.sessionID,
        target: "memory",
        scope: memoryScope({ projectID: input.projectID, userContent: input.userContent }),
        content,
        source: "turn",
        originMessageID: input.originMessageID,
        createdBy: input.agent,
        tags: ["explicit"],
        importance: 0.8,
      })
    })

    const status: Interface["status"] = Effect.fn("Memory.status")(function* (input) {
      const items = yield* list({
        projectID: input?.projectID,
        sessionID: input?.sessionID,
        includeArchived: true,
        limit: 10_000,
      })
      return {
        total: items.length,
        active: items.filter((item) => item.time.archived === undefined).length,
        archived: items.filter((item) => item.time.archived !== undefined).length,
        latest: items[0]?.time.updated,
      }
    })

    const listReviewCandidates: Interface["listReviewCandidates"] = Effect.fn("Memory.listReviewCandidates")(function* (
      input,
    ) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryReviewCandidateTable)
            .where(and(...reviewConditions(input)))
            .orderBy(desc(MemoryReviewCandidateTable.time_updated))
            .limit(input?.limit ?? DEFAULT_LIMIT)
            .all(),
        ),
      )
      return rows.map(rowToCandidate)
    })

    const getCandidateByID = Effect.fn("Memory.getCandidateByID")(function* (id: ReviewCandidateID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db.select().from(MemoryReviewCandidateTable).where(eq(MemoryReviewCandidateTable.id, id)).get(),
        ),
      )
      return row ? rowToCandidate(row) : undefined
    })

    const advanceReviewState = Effect.fn("Memory.advanceReviewState")(function* (input: ReviewServiceInput) {
      if (!input.sessionID) return true
      const now = Date.now()
      const interval = reviewInterval(input.reviewInterval)
      const turn = yield* Effect.sync(() =>
        Database.transaction((tx) => {
          const current = tx
            .select()
            .from(MemoryReviewStateTable)
            .where(eq(MemoryReviewStateTable.session_id, input.sessionID!))
            .get()
          const next = (current?.turn_count ?? 0) + 1
          tx.insert(MemoryReviewStateTable)
            .values({
              session_id: input.sessionID!,
              project_id: input.projectID,
              turn_count: next,
              last_reviewed_message_id: input.sourceMessageID,
              last_reviewed_at: now,
              time_created: current?.time_created ?? now,
              time_updated: now,
            })
            .onConflictDoUpdate({
              target: MemoryReviewStateTable.session_id,
              set: {
                project_id: input.projectID,
                turn_count: next,
                last_reviewed_message_id: input.sourceMessageID,
                last_reviewed_at: now,
                time_updated: now,
              },
            })
            .run()
          return next
        }),
      )
      return turn % interval === 0
    })

    const review: Interface["review"] = Effect.fn("Memory.review")(function* (input) {
      const rows = candidateRowsFromReview(input)
      if (!rows.length) {
        if (!input.dryRun && !input.skipReviewState) yield* advanceReviewState(input)
        return []
      }
      if (input.dryRun) return rows.map((row) => rowToCandidate(row as typeof MemoryReviewCandidateTable.$inferSelect))

      const due = input.skipReviewState ? true : yield* advanceReviewState(input)
      if (!due) return []

      const existing = input.sourceMessageID
        ? yield* listReviewCandidates({
            projectID: input.projectID,
            sessionID: input.sessionID,
            status: "pending",
            limit: DEFAULT_LIMIT,
          })
        : []
      const pending = rows.filter(
        (row) => !existing.some((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content),
      )
      const duplicates = rows
        .map((row) => existing.find((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content))
        .filter((item) => item !== undefined)

      if (pending.length) {
        yield* Effect.sync(() => Database.use((db) => db.insert(MemoryReviewCandidateTable).values(pending).run()))
        yield* publishReviewUpdated(input)
      }
      return [
        ...duplicates,
        ...pending.map((row) => rowToCandidate(row as typeof MemoryReviewCandidateTable.$inferSelect)),
      ]
    })

    const reviewCompaction: Interface["reviewCompaction"] = Effect.fn("Memory.reviewCompaction")(function* (input) {
      const text = input.messagesText.trim()
      if (!text) return []
      const rows = candidateRowsFromReview(
        {
          userContent: text,
          projectID: input.projectID,
          sessionID: input.sessionID,
          sourceMessageID: input.sourceMessageID,
          candidates: [],
        },
        ["compaction"],
      )
      if (!rows.length) return []

      const existing = input.sourceMessageID
        ? yield* listReviewCandidates({
            projectID: input.projectID,
            sessionID: input.sessionID,
            status: "pending",
            limit: DEFAULT_LIMIT,
          })
        : []
      const pending = rows.filter(
        (row) => !existing.some((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content),
      )
      const duplicates = rows
        .map((row) => existing.find((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content))
        .filter((item) => item !== undefined)

      if (pending.length) {
        yield* Effect.sync(() => Database.use((db) => db.insert(MemoryReviewCandidateTable).values(pending).run()))
        yield* publishReviewUpdated(input)
      }
      return [
        ...duplicates,
        ...pending.map((row) => rowToCandidate(row as typeof MemoryReviewCandidateTable.$inferSelect)),
      ]
    })

    const reviewSessionEnd: Interface["reviewSessionEnd"] = Effect.fn("Memory.reviewSessionEnd")(function* (input) {
      const text = input.messagesText.trim()
      if (!text) return []
      const rows = candidateRowsFromReview(
        {
          userContent: text,
          projectID: input.projectID,
          sessionID: input.sessionID,
          sourceMessageID: input.sourceMessageID,
          candidates: [],
        },
        ["session-end"],
      )
      if (!rows.length) return []

      const existing = input.sourceMessageID
        ? yield* listReviewCandidates({
            projectID: input.projectID,
            sessionID: input.sessionID,
            status: "pending",
            limit: DEFAULT_LIMIT,
          })
        : []
      const pending = rows.filter(
        (row) => !existing.some((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content),
      )
      const duplicates = rows
        .map((row) => existing.find((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content))
        .filter((item) => item !== undefined)

      if (pending.length) {
        yield* Effect.sync(() => Database.use((db) => db.insert(MemoryReviewCandidateTable).values(pending).run()))
        yield* publishReviewUpdated(input)
      }
      return [
        ...duplicates,
        ...pending.map((row) => rowToCandidate(row as typeof MemoryReviewCandidateTable.$inferSelect)),
      ]
    })

    const applyReviewCandidate: Interface["applyReviewCandidate"] = Effect.fn("Memory.applyReviewCandidate")(function* (id, location) {
      const candidate = yield* getCandidateByID(id)
      if (!candidate || candidate.status !== "pending") return
      const item = yield* add({
        projectID: candidate.projectID,
        sessionID: candidate.sessionID,
        target: candidate.target,
        scope: candidate.scope,
        content: candidate.content,
        summary: candidate.summary,
        tags: candidate.tags,
        importance: candidate.importance,
        source: "review",
        originMessageID: candidate.sourceMessageID,
        createdBy: "memory-review",
        ...(location ? { location } : {}),
      })
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(MemoryReviewCandidateTable)
            .set({ status: "applied", time_applied: now, time_updated: now })
            .where(eq(MemoryReviewCandidateTable.id, id))
            .run(),
        ),
      )
      yield* publishReviewUpdated({
        projectID: candidate.projectID,
        sessionID: candidate.sessionID,
      })
      return item
    })

    const dismissReviewCandidate: Interface["dismissReviewCandidate"] = Effect.fn("Memory.dismissReviewCandidate")(
      function* (id) {
        const candidate = yield* getCandidateByID(id)
        if (!candidate || candidate.status !== "pending") return
        const now = Date.now()
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(MemoryReviewCandidateTable)
              .set({ status: "dismissed", time_updated: now })
              .where(eq(MemoryReviewCandidateTable.id, id))
              .run(),
          ),
        )
        const updated = yield* getCandidateByID(id)
        yield* publishReviewUpdated({
          projectID: candidate.projectID,
          sessionID: candidate.sessionID,
        })
        return updated
      },
    )

    const reviewStatus: Interface["reviewStatus"] = Effect.fn("Memory.reviewStatus")(function* (input) {
      const items = yield* listReviewCandidates({
        projectID: input?.projectID,
        sessionID: input?.sessionID,
        limit: 10_000,
      })
      return {
        pending: items.filter((item) => item.status === "pending").length,
        applied: items.filter((item) => item.status === "applied").length,
        dismissed: items.filter((item) => item.status === "dismissed").length,
        total: items.length,
        latest: items[0]?.time.updated,
        source: reviewSourceCounts(items),
        sourceByStatus: {
          pending: reviewSourceCounts(items.filter((item) => item.status === "pending")),
          applied: reviewSourceCounts(items.filter((item) => item.status === "applied")),
          dismissed: reviewSourceCounts(items.filter((item) => item.status === "dismissed")),
        },
      }
    })

    return Service.of({
      list,
      add,
      update,
      remove,
      prefetch,
      syncTurn,
      status,
      review,
      reviewCompaction,
      reviewSessionEnd,
      reviewDue: advanceReviewState,
      listReviewCandidates,
      applyReviewCandidate,
      dismissReviewCandidate,
      reviewStatus,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.defaultLayer))

export * as Memory from "./service"
