import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Context, Effect, Layer, Schema } from "effect"
import { and, desc, eq, inArray, isNull, or, sql } from "@/storage/db"
import * as Database from "@/storage/db"
import { MemoryEntryTable, MemoryRelationTable, MemoryReviewCandidateTable, MemoryReviewStateTable } from "./memory.sql"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import {
  type AddInput,
  type Info,
  type ListInput,
  type ManualRelationInput,
  MemoryID,
  type PrefetchInput,
  type Relation,
  type RelationInput,
  RelationID,
  type RelationListInput,
  ReviewCandidateID,
  type ReviewCandidate,
  type ReviewCandidateListInput,
  type ReviewCandidateProposal,
  type ReviewCandidateSource,
  type ReviewInput,
  type ReviewStatus,
  type UpdateInput,
} from "./schema"
import type { MessageID } from "@/session/schema"
import { AppFileSystem } from "@novaway/core/filesystem"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import {
  buildPrefetchText,
  DEFAULT_PREFETCH_BUDGET_CHARS,
  DEFAULT_PREFETCH_LIMIT,
  scoreMemory,
  shouldPrefetch,
} from "./prefetch"
import { memoryProjectID as scopeProjectID, resolveMemoryScope, type MemoryScopeName } from "./scope"
import { domainLabel, resolveMemoryDomain, type MemoryDomain } from "./domain"
import { deriveFactKey, resolveMemoryOperation } from "./fact"
import { addMemoryMetadataTags, memoryEntitiesFromTags, memoryKindFromTags, resolveMemoryKind } from "./kind"
import { extractRelation } from "./relations"
import { ConfigMemory } from "@/config/memory"
import { embedText, parseEmbeddingJson } from "./embedder"
import { hybridScore, mergeHybridCandidates, sanitizeFtsQuery } from "./search"

const DEFAULT_LIMIT = 50

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
  readonly applyReviewCandidate: (
    id: ReviewCandidateID,
    location?: MemoryFileLocation,
    options?: { scope?: AddInput["scope"] },
  ) => Effect.Effect<Info | undefined>
  readonly dismissReviewCandidate: (id: ReviewCandidateID) => Effect.Effect<ReviewCandidate | undefined>
  readonly reviewStatus: (input?: {
    projectID?: AddInput["projectID"]
    sessionID?: AddInput["sessionID"]
  }) => Effect.Effect<ReviewStatus>
  readonly listRelations: (input?: RelationListInput) => Effect.Effect<Relation[]>
  readonly relationsForMemory: (memoryID: MemoryID) => Effect.Effect<Relation[]>
  readonly addRelation: (input: ManualRelationInput) => Effect.Effect<Relation | undefined>
  readonly removeRelation: (id: RelationID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Memory") {}

function rowToInfo(row: typeof MemoryEntryTable.$inferSelect): Info {
  return {
    id: row.id,
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    target: row.target,
    scope: row.scope,
    domain: (row.domain ?? "general") as Info["domain"],
    kind: memoryKindFromTags(row.tags),
    entities: memoryEntitiesFromTags(row.tags),
    content: row.content,
    ...(row.summary ? { summary: row.summary } : {}),
    tags: row.tags,
    importance: row.importance,
    confidence: row.confidence ?? 0.7,
    ...(row.fact_key ? { factKey: row.fact_key } : {}),
    version: row.version ?? 1,
    ...(row.supersedes_id ? { supersedesID: row.supersedes_id } : {}),
    source: row.source,
    ...(row.origin_message_id ? { originMessageID: row.origin_message_id } : {}),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_archived ? { archived: row.time_archived } : {}),
      ...(row.valid_from ? { validFrom: row.valid_from } : {}),
      ...(row.valid_to ? { validTo: row.valid_to } : {}),
      ...(row.last_confirmed_at ? { lastConfirmed: row.last_confirmed_at } : {}),
    },
    ...(() => {
      const embedding = parseEmbeddingJson(row.embedding_json)
      if (!embedding) return {}
      return {
        embedding,
        ...(row.embedding_model ? { embeddingModel: row.embedding_model } : {}),
      }
    })(),
  }
}

function rowToCandidate(row: typeof MemoryReviewCandidateTable.$inferSelect): ReviewCandidate {
  return {
    id: row.id,
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    target: row.target,
    scope: row.scope,
    domain: (row.domain ?? "general") as ReviewCandidate["domain"],
    kind: memoryKindFromTags(row.tags),
    entities: memoryEntitiesFromTags(row.tags),
    content: row.content,
    ...(row.summary ? { summary: row.summary } : {}),
    tags: row.tags,
    importance: row.importance,
    confidence: row.confidence ?? 0.7,
    ...(row.fact_key ? { factKey: row.fact_key } : {}),
    operation: resolveMemoryOperation(row.operation),
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

function rowToRelation(row: typeof MemoryRelationTable.$inferSelect): Relation {
  return {
    id: row.id,
    memoryID: row.memory_id!,
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    source: row.source,
    ...(row.source_type ? { sourceType: row.source_type } : {}),
    relation: row.relation,
    target: row.target,
    ...(row.target_type ? { targetType: row.target_type } : {}),
    confidence: row.confidence ?? 0.7,
    ...(row.valid_from ? { validFrom: row.valid_from } : {}),
    ...(row.valid_to ? { validTo: row.valid_to } : {}),
    ...(row.last_confirmed_at ? { lastConfirmed: row.last_confirmed_at } : {}),
    ...(row.origin_message_id ? { originMessageID: row.origin_message_id } : {}),
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function relationRowsForMemory(
  row: typeof MemoryEntryTable.$inferInsert,
  originMessageID?: MessageID,
): Array<typeof MemoryRelationTable.$inferInsert> {
  if (memoryKindFromTags(row.tags ?? []) !== "relationship") return []
  const entities = memoryEntitiesFromTags(row.tags ?? [])
  if (entities.length < 2) return []
  const now = Date.now()
  return [
    {
      id: RelationID.ascending(),
      memory_id: row.id,
      project_id: row.project_id,
      session_id: row.session_id,
      source: entities[0]!.name,
      source_type: entities[0]!.type,
      relation: extractRelation(row.content, entities[0]!.name, entities[1]!.name),
      target: entities[1]!.name,
      target_type: entities[1]!.type,
      confidence: row.confidence ?? 0.7,
      valid_from: row.valid_from ?? row.time_created ?? now,
      valid_to: row.valid_to,
      last_confirmed_at: row.last_confirmed_at,
      origin_message_id: originMessageID,
      time_created: now,
      time_updated: now,
    },
  ]
}

function conditions(input?: ListInput) {
  const now = Date.now()
  const includeExpired = input?.includeExpired || input?.includeArchived
  return [
    input?.includeArchived ? undefined : isNull(MemoryEntryTable.time_archived),
    includeExpired ? undefined : or(isNull(MemoryEntryTable.valid_to), sql`${MemoryEntryTable.valid_to} >= ${now}`),
    input?.projectID
      ? input.includeGlobal
        ? or(eq(MemoryEntryTable.project_id, input.projectID), isNull(MemoryEntryTable.project_id))
        : eq(MemoryEntryTable.project_id, input.projectID)
      : undefined,
    input?.sessionID ? eq(MemoryEntryTable.session_id, input.sessionID) : undefined,
    input?.target ? eq(MemoryEntryTable.target, input.target) : undefined,
    input?.scope ? eq(MemoryEntryTable.scope, input.scope) : undefined,
    input?.domain ? eq(MemoryEntryTable.domain, input.domain) : undefined,
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

function explicitMemory(text: string) {
  const patterns = [
    /(?:please\s+)?remember(?:\s+that)?\s+(.+)/i,
    /(?:\u8bf7\u8bb0\u4f4f|\u8bb0\u4f4f)[:\uff1a]?\s*(.+)/,
    /\u5e2e\u6211\u8bb0\u4f4f[:\uff1a]?\s*(.+)/,
    /\u4ee5\u540e\u90fd(?:\u8981|\u7528|\u6309|\u8bb0\u4f4f)\s*(.+)/,
    /\u6211(?:\u7684)?\u504f\u597d(?:\u662f|\uff1a|:)\s*(.+)/,
    /\u4ece\u73b0\u5728\u8d77\s*(.+)/,
    /\u52a1\u5fc5\u8bb0\u4f4f\s*(.+)/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    const content = match?.[1]?.trim()
    if (content && content.length >= 4) return content
  }
}

function memoryScope(input: {
  projectID?: AddInput["projectID"]
  userContent?: string
  content?: string
  scope?: AddInput["scope"]
}) {
  return resolveMemoryScope({
    projectID: input.projectID,
    userContent: input.userContent,
    content: input.content,
    scope: input.scope as MemoryScopeName | undefined,
  })
}

function memoryProjectID(projectID: AddInput["projectID"] | undefined, scope: AddInput["scope"]) {
  return scopeProjectID(projectID, scope as MemoryScopeName)
}

function clampUnit(input: number | undefined, fallback: number) {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback
  return Math.min(Math.max(input, 0), 1)
}

function candidateRow(
  input: ReviewInput,
  proposal: ReviewCandidateProposal,
): typeof MemoryReviewCandidateTable.$inferInsert | undefined {
  const content = proposal.content.trim()
  if (content.length < 4) return
  const now = Date.now()
  const scope = memoryScope({
    projectID: input.projectID,
    userContent: input.userContent,
    content,
    scope: proposal.scope,
  })
  const baseTags = Array.from(new Set([...(proposal.tags ?? []), "review"].map((tag) => tag.trim()).filter(Boolean)))
  const kind = resolveMemoryKind({ kind: proposal.kind, content, tags: baseTags })
  const tags = addMemoryMetadataTags(baseTags, kind, proposal.entities)
  const domain = resolveMemoryDomain({
    domain: proposal.domain as MemoryDomain | undefined,
    content,
    userContent: input.userContent,
    tags,
  })
  return {
    id: ReviewCandidateID.ascending(),
    project_id: memoryProjectID(input.projectID, scope),
    session_id: input.sessionID,
    target: proposal.target ?? "memory",
    scope,
    domain,
    content,
    summary: proposal.summary?.trim() || (content.length > 120 ? `${content.slice(0, 117)}...` : undefined),
    tags,
    importance: clampUnit(proposal.importance, 0.7),
    confidence: clampUnit(proposal.confidence, 0.7),
    fact_key: deriveFactKey(content, proposal.factKey),
    operation: resolveMemoryOperation(proposal.operation),
    reason: proposal.reason?.trim() || "LLM-extracted durable memory",
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
          confidence: 0.9,
          operation: "add" as const,
          reason: "User explicitly requested to remember this content",
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
    `- memoryId: ${row.id}`,
    `- scope: ${row.scope}`,
    `- domain: ${domainLabel((row.domain ?? "general") as MemoryDomain)}`,
    `- target: ${row.target}`,
    `- source: ${row.source}`,
    `- importance: ${row.importance}`,
    `- confidence: ${row.confidence ?? 0.7}`,
    `- factKey: ${row.fact_key || "none"}`,
    `- version: ${row.version ?? 1}`,
    `- tags: ${tags.join(", ") || "none"}`,
    `- createdAt: ${new Date(timeCreated).toISOString()}`,
    "",
    "## content",
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

function searchFtsIds(query: string, limit: number) {
  const match = sanitizeFtsQuery(query)
  if (!match) return [] as string[]
  try {
    return Database.use((db) => {
      const raw = db as { $client?: unknown }
      const client = (raw.$client ?? db) as {
        query: (sqlText: string) => { all: (...args: unknown[]) => Array<{ id: string }> }
      }
      const safe = match.replace(/'/g, "''")
      return client
        .query(
          `select id from memory_entry_fts where memory_entry_fts match '${safe}' order by bm25(memory_entry_fts) limit ${Math.max(1, Math.min(limit, 200))}`,
        )
        .all()
        .map((row) => row.id)
    })
  } catch {
    return [] as string[]
  }
}

async function maybeEmbedMemory(
  content: string,
  summary?: string,
  metadata?: { kind?: string; entities?: readonly { name: string; type?: string }[] },
  memoryCfg?: ConfigMemory.Info,
) {
  try {
    const cfg = ConfigMemory.resolve(memoryCfg)
    const text = [
      content,
      summary ?? "",
      metadata?.kind ?? "",
      ...(metadata?.entities ?? []).flatMap((entity) => [entity.name, entity.type ?? ""]),
    ]
      .join("\n")
      .trim()
    const embedded = await embedText(cfg, text)
    if (!embedded) return {} as { embedding_json?: string; embedding_model?: string; embedding_dims?: number }
    return {
      embedding_json: JSON.stringify(embedded.vector),
      embedding_model: embedded.modelId,
      embedding_dims: embedded.vector.length,
    }
  } catch {
    return {} as { embedding_json?: string; embedding_model?: string; embedding_dims?: number }
  }
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
      const search = input?.search?.trim()
      const poolLimit = search ? Math.max(input?.limit ?? DEFAULT_LIMIT, 200) : (input?.limit ?? DEFAULT_LIMIT)
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryEntryTable)
            .where(and(...conditions(input)))
            .orderBy(desc(MemoryEntryTable.time_updated))
            .limit(poolLimit)
            .all(),
        ),
      )
      const items = rows.map(rowToInfo)
      const filtered = items.filter((item) => {
        if (input?.kind && item.kind !== input.kind) return false
        if (input?.entities?.length) {
          const names = new Set((item.entities ?? []).map((entity) => entity.name.toLowerCase()))
          if (!input.entities.some((entity) => names.has(entity.name.toLowerCase()))) return false
        }
        return true
      })
      if (!search) return filtered.slice(0, input?.limit ?? DEFAULT_LIMIT)

      const ftsIds = searchFtsIds(search, input?.limit ?? DEFAULT_LIMIT)
      if (!ftsIds.length) {
        const dense = yield* Effect.promise(() => embedText(ConfigMemory.resolve(), search)).pipe(
          Effect.catch(() => Effect.succeed(null)),
        )
        return filtered
          .map((item) => ({
            item,
            score: hybridScore(search, item, {
              queryEmbedding: dense?.vector,
              queryEmbeddingModel: dense?.modelId,
            }),
          }))
          .filter((item) => item.score >= 8)
          .toSorted((a, b) => b.score - a.score)
          .map((item) => item.item)
      }

      const extra = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryEntryTable)
            .where(and(...conditions(input), inArray(MemoryEntryTable.id, ftsIds as any)))
            .all(),
        ),
      )
      const byId = new Map([...filtered, ...extra.map(rowToInfo)].map((item) => [item.id, item]))
      const dense = yield* Effect.promise(() => embedText(ConfigMemory.resolve(), search)).pipe(
        Effect.catch(() => Effect.succeed(null)),
      )
      return mergeHybridCandidates({
        query: search,
        keywordItems: items,
        ftsIds,
        byId,
        limit: input?.limit ?? DEFAULT_LIMIT,
        queryEmbedding: dense?.vector,
        queryEmbeddingModel: dense?.modelId,
        semantic: dense ? "on" : "on",
      })
    })

    const getByID = Effect.fn("Memory.getByID")(function* (id: MemoryID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(MemoryEntryTable).where(eq(MemoryEntryTable.id, id)).get()),
      )
      return row ? rowToInfo(row) : undefined
    })

    const findActiveByFactKey = Effect.fn("Memory.findActiveByFactKey")(function* (input: {
      factKey?: string
      projectID?: AddInput["projectID"]
      scope: AddInput["scope"]
      target: AddInput["target"]
    }) {
      if (!input.factKey) return undefined as Info | undefined
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryEntryTable)
            .where(
              and(
                isNull(MemoryEntryTable.time_archived),
                eq(MemoryEntryTable.fact_key, input.factKey!),
                eq(MemoryEntryTable.scope, input.scope ?? "project"),
                eq(MemoryEntryTable.target, input.target ?? "memory"),
                input.scope === "global"
                  ? isNull(MemoryEntryTable.project_id)
                  : input.projectID
                    ? eq(MemoryEntryTable.project_id, input.projectID)
                    : undefined,
              ),
            )
            .orderBy(desc(MemoryEntryTable.version), desc(MemoryEntryTable.time_updated))
            .limit(1)
            .all(),
        ),
      )
      return rows[0] ? rowToInfo(rows[0]) : undefined
    })

    const archiveByID = Effect.fn("Memory.archiveByID")(function* (id: MemoryID, validTo?: number) {
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(MemoryEntryTable)
            .set({
              time_archived: now,
              valid_to: validTo ?? now,
              time_updated: now,
            })
            .where(eq(MemoryEntryTable.id, id))
            .run(),
        ),
      )
    })

    const replaceRelationsForMemory = Effect.fn("Memory.replaceRelationsForMemory")(function* (
      memoryID: MemoryID,
      originMessageID?: MessageID,
    ) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(MemoryEntryTable).where(eq(MemoryEntryTable.id, memoryID)).get()),
      )
      if (!row) return
      const rows = relationRowsForMemory(row, originMessageID)
      yield* Effect.sync(() =>
        Database.use((db) => db.delete(MemoryRelationTable).where(eq(MemoryRelationTable.memory_id, memoryID)).run()),
      )
      if (rows.length) {
        yield* Effect.sync(() => Database.use((db) => db.insert(MemoryRelationTable).values(rows).run()))
      }
    })

    const add: Interface["add"] = Effect.fn("Memory.add")(function* (input) {
      const now = Date.now()
      const scope = memoryScope({
        projectID: input.projectID,
        content: input.content,
        userContent: input.content,
        scope: input.scope,
      })
      const baseTags = input.tags ? Array.from(input.tags) : []
      const kind = resolveMemoryKind({ kind: input.kind, content: input.content, tags: baseTags })
      const tags = addMemoryMetadataTags(baseTags, kind, input.entities)
      const domain = resolveMemoryDomain({
        domain: input.domain as MemoryDomain | undefined,
        content: input.content,
        tags,
      })
      const factKey = deriveFactKey(input.content, input.factKey)
      const operation = resolveMemoryOperation(input.operation)
      const existing = yield* findActiveByFactKey({
        factKey,
        projectID: memoryProjectID(input.projectID, scope),
        scope,
        target: input.target ?? "memory",
      })

      if (existing && operation === "confirm") {
        const conf = Math.max(existing.confidence, clampUnit(input.confidence, existing.confidence))
        yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .update(MemoryEntryTable)
              .set({
                confidence: conf,
                last_confirmed_at: now,
                time_updated: now,
              })
              .where(eq(MemoryEntryTable.id, existing.id))
              .run(),
          ),
        )
        return (yield* getByID(existing.id))!
      }

      if (existing && operation === "archive") {
        yield* archiveByID(existing.id, input.validTo ?? now)
        return (yield* getByID(existing.id))!
      }

      if (existing && (operation === "update" || operation === "add")) {
        yield* archiveByID(existing.id, now)
        const row: typeof MemoryEntryTable.$inferInsert = {
          id: MemoryID.ascending(),
          project_id: memoryProjectID(input.projectID, scope),
          session_id: input.sessionID,
          target: input.target ?? existing.target,
          scope,
          domain,
          content: input.content.trim(),
          summary: input.summary?.trim() || undefined,
          tags,
          importance: input.importance ?? existing.importance,
          confidence: clampUnit(input.confidence, Math.max(existing.confidence, 0.7)),
          fact_key: factKey,
          version: (existing.version ?? 1) + 1,
          supersedes_id: existing.id,
          source: input.source ?? "manual",
          origin_message_id: input.originMessageID,
          created_by: input.createdBy,
          time_created: now,
          time_updated: now,
          valid_from: input.validFrom ?? now,
          valid_to: input.validTo,
          last_confirmed_at: now,
        }
        const embedded = yield* Effect.promise(() =>
          maybeEmbedMemory(row.content, row.summary ?? undefined, { kind, entities: input.entities }),
        )
        const rowWithEmbed = { ...row, ...embedded }
        if (input.location) yield* Effect.promise(() => writeMemoryFile(rowWithEmbed, input.location!))
        yield* Effect.sync(() => Database.use((db) => db.insert(MemoryEntryTable).values(rowWithEmbed).run()))
        yield* replaceRelationsForMemory(row.id, input.originMessageID)
        return (yield* getByID(row.id))!
      }

      const row: typeof MemoryEntryTable.$inferInsert = {
        id: MemoryID.ascending(),
        project_id: memoryProjectID(input.projectID, scope),
        session_id: input.sessionID,
        target: input.target ?? "memory",
        scope,
        domain,
        content: input.content.trim(),
        summary: input.summary?.trim() || undefined,
        tags,
        importance: input.importance ?? 0.5,
        confidence: clampUnit(input.confidence, 0.7),
        fact_key: factKey,
        version: 1,
        source: input.source ?? "manual",
        origin_message_id: input.originMessageID,
        created_by: input.createdBy,
        time_created: now,
        time_updated: now,
        valid_from: input.validFrom ?? now,
        valid_to: input.validTo,
        last_confirmed_at: now,
      }
      const embedded = yield* Effect.promise(() =>
        maybeEmbedMemory(row.content, row.summary ?? undefined, { kind, entities: input.entities }),
      )
      const rowWithEmbed = { ...row, ...embedded }
      if (input.location) yield* Effect.promise(() => writeMemoryFile(rowWithEmbed, input.location!))
      yield* Effect.sync(() => Database.use((db) => db.insert(MemoryEntryTable).values(rowWithEmbed).run()))
      yield* replaceRelationsForMemory(row.id, input.originMessageID)
      return (yield* getByID(row.id))!
    })

    const update: Interface["update"] = Effect.fn("Memory.update")(function* (input) {
      const now = Date.now()
      const existing = yield* getByID(input.id)
      if (!existing) return
      const nextScope =
        input.scope === undefined
          ? existing.scope
          : memoryScope({
              projectID: existing.projectID,
              content: input.content ?? existing.content,
              scope: input.scope,
            })
      const nextProjectID = nextScope === "global" ? null : (existing.projectID ?? null)
      const nextDomain =
        input.domain ??
        resolveMemoryDomain({
          content: input.content ?? existing.content,
          tags: input.tags ?? existing.tags,
        })
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(MemoryEntryTable)
            .set({
              ...(input.content === undefined ? {} : { content: input.content.trim() }),
              ...(input.summary === undefined ? {} : { summary: input.summary.trim() || null }),
              ...(input.tags === undefined && input.kind === undefined && input.entities === undefined
                ? {}
                : {
                    tags: addMemoryMetadataTags(
                      input.tags ?? existing.tags,
                      resolveMemoryKind({
                        kind: input.kind,
                        content: input.content ?? existing.content,
                        tags: input.tags ?? existing.tags,
                      }),
                      input.entities ?? existing.entities,
                    ),
                  }),
              ...(input.importance === undefined ? {} : { importance: input.importance }),
              ...(input.confidence === undefined
                ? {}
                : { confidence: clampUnit(input.confidence, existing.confidence) }),
              ...(input.factKey === undefined
                ? {}
                : { fact_key: deriveFactKey(input.content ?? existing.content, input.factKey) }),
              ...(input.domain === undefined && input.content === undefined && input.tags === undefined
                ? {}
                : { domain: nextDomain }),
              ...(input.scope === undefined ? {} : { scope: nextScope, project_id: nextProjectID }),
              ...(input.archived === undefined ? {} : { time_archived: input.archived ? now : null }),
              ...(input.validFrom === undefined ? {} : { valid_from: input.validFrom }),
              ...(input.validTo === undefined ? {} : { valid_to: input.validTo }),
              ...(input.confirm ? { last_confirmed_at: now, confidence: Math.min(1, existing.confidence + 0.05) } : {}),
              time_updated: now,
            })
            .where(eq(MemoryEntryTable.id, input.id))
            .run(),
        ),
      )
      yield* replaceRelationsForMemory(input.id, existing.originMessageID)
      return yield* getByID(input.id)
    })

    const remove: Interface["remove"] = Effect.fn("Memory.remove")(function* (id) {
      const existing = yield* getByID(id)
      if (!existing) return false
      yield* Effect.sync(() =>
        Database.use((db) => db.delete(MemoryEntryTable).where(eq(MemoryEntryTable.id, id)).run()),
      )
      return true
    })

    const prefetch: Interface["prefetch"] = Effect.fn("Memory.prefetch")(function* (input) {
      if (!shouldPrefetch(input.query)) return ""
      const pool = yield* list({
        projectID: input.projectID,
        includeGlobal: true,
        search: input.query,
        limit: 200,
      })
      const relations = yield* listRelations({
        projectID: input.projectID,
        limit: 200,
      })
      return buildPrefetchText(input.query, pool, {
        limit: input.limit ?? DEFAULT_PREFETCH_LIMIT,
        maxChars: input.maxChars ?? DEFAULT_PREFETCH_BUDGET_CHARS,
        relations,
      })
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
        confidence: 0.9,
        operation: "add",
      })
    })

    const status: Interface["status"] = Effect.fn("Memory.status")(function* (input) {
      const items = yield* list({
        projectID: input?.projectID,
        sessionID: input?.sessionID,
        includeArchived: true,
        includeExpired: true,
        limit: 10_000,
      })
      return {
        total: items.length,
        active: items.filter((item) => item.time.archived === undefined).length,
        archived: items.filter((item) => item.time.archived !== undefined).length,
        latest: items[0]?.time.updated,
      }
    })

    const listReviewCandidates: Interface["listReviewCandidates"] = Effect.fn("Memory.listReviewCandidates")(
      function* (input) {
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
      },
    )

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

    const reviewDue: Interface["reviewDue"] = Effect.fn("Memory.reviewDue")(function* (input) {
      return yield* advanceReviewState(input)
    })

    const persistCandidates = Effect.fn("Memory.persistCandidates")(function* (
      input: ReviewInput,
      rows: Array<typeof MemoryReviewCandidateTable.$inferInsert>,
    ) {
      if (!rows.length) return [] as ReviewCandidate[]
      if (input.dryRun) return rows.map((row) => rowToCandidate(row as typeof MemoryReviewCandidateTable.$inferSelect))

      const existing = input.sourceMessageID
        ? yield* listReviewCandidates({
            projectID: input.projectID,
            sessionID: input.sessionID,
            status: "pending",
            limit: DEFAULT_LIMIT,
          })
        : []
      const pending = rows.filter(
        (row) =>
          !existing.some((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content),
      )
      const duplicates = rows
        .map((row) =>
          existing.find((item) => item.sourceMessageID === input.sourceMessageID && item.content === row.content),
        )
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

    const review: Interface["review"] = Effect.fn("Memory.review")(function* (input) {
      if (!input.skipReviewState && input.sessionID) {
        const due = yield* advanceReviewState(input)
        if (!due) return []
      }
      const rows = candidateRowsFromReview(input)
      return yield* persistCandidates(input, rows)
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
      return yield* persistCandidates(
        {
          userContent: text,
          projectID: input.projectID,
          sessionID: input.sessionID,
          sourceMessageID: input.sourceMessageID,
        },
        rows,
      )
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
      return yield* persistCandidates(
        {
          userContent: text,
          projectID: input.projectID,
          sessionID: input.sessionID,
          sourceMessageID: input.sourceMessageID,
        },
        rows,
      )
    })

    const applyReviewCandidate: Interface["applyReviewCandidate"] = Effect.fn("Memory.applyReviewCandidate")(
      function* (id, location, options) {
        const candidate = yield* getCandidateByID(id)
        if (!candidate || candidate.status !== "pending") return
        const scope = memoryScope({
          projectID: candidate.projectID,
          content: candidate.content,
          scope: options?.scope ?? candidate.scope,
        })
        const item = yield* add({
          projectID: scope === "global" ? undefined : candidate.projectID,
          sessionID: candidate.sessionID,
          target: candidate.target,
          scope,
          domain: candidate.domain,
          content: candidate.content,
          summary: candidate.summary,
          tags: candidate.tags,
          importance: candidate.importance,
          confidence: candidate.confidence,
          factKey: candidate.factKey,
          operation: candidate.operation,
          kind: candidate.kind,
          entities: candidate.entities,
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
      },
    )

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

    const listRelations: Interface["listRelations"] = Effect.fn("Memory.listRelations")(function* (input) {
      const now = Date.now()
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryRelationTable)
            .where(
              and(
                input?.projectID
                  ? or(eq(MemoryRelationTable.project_id, input.projectID), isNull(MemoryRelationTable.project_id))
                  : undefined,
                input?.sessionID ? eq(MemoryRelationTable.session_id, input.sessionID) : undefined,
                input?.entity
                  ? or(eq(MemoryRelationTable.source, input.entity), eq(MemoryRelationTable.target, input.entity))
                  : undefined,
                input?.relation ? eq(MemoryRelationTable.relation, input.relation) : undefined,
                input?.includeArchived
                  ? undefined
                  : or(isNull(MemoryRelationTable.valid_to), sql`${MemoryRelationTable.valid_to} >= ${now}`),
              ),
            )
            .orderBy(desc(MemoryRelationTable.time_updated))
            .limit(input?.limit ?? DEFAULT_LIMIT)
            .all(),
        ),
      )
      return rows.map(rowToRelation)
    })

    const relationsForMemory: Interface["relationsForMemory"] = Effect.fn("Memory.relationsForMemory")(
      function* (memoryID) {
        const rows = yield* Effect.sync(() =>
          Database.use((db) =>
            db
              .select()
              .from(MemoryRelationTable)
              .where(eq(MemoryRelationTable.memory_id, memoryID))
              .orderBy(desc(MemoryRelationTable.time_updated))
              .all(),
          ),
        )
        return rows.map(rowToRelation)
      },
    )

    const addRelation: Interface["addRelation"] = Effect.fn("Memory.addRelation")(function* (input) {
      const source = input.source.trim()
      const relation = input.relation.trim()
      const target = input.target.trim()
      if (!source || !relation || !target) return
      const memory = yield* getByID(input.memoryID)
      if (!memory) return
      const existing = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(MemoryRelationTable)
            .where(
              and(
                eq(MemoryRelationTable.memory_id, input.memoryID),
                eq(MemoryRelationTable.source, source),
                eq(MemoryRelationTable.relation, relation),
                eq(MemoryRelationTable.target, target),
              ),
            )
            .get(),
        ),
      )
      if (existing) return rowToRelation(existing)
      const now = Date.now()
      const row: typeof MemoryRelationTable.$inferInsert = {
        id: RelationID.ascending(),
        memory_id: input.memoryID,
        project_id: memory.projectID,
        session_id: memory.sessionID,
        source,
        source_type: input.sourceType,
        relation,
        target,
        target_type: input.targetType,
        confidence: clampUnit(input.confidence, 0.7),
        valid_from: input.validFrom ?? now,
        valid_to: input.validTo,
        last_confirmed_at: now,
        time_created: now,
        time_updated: now,
      }
      yield* Effect.sync(() => Database.use((db) => db.insert(MemoryRelationTable).values(row).run()))
      const created = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(MemoryRelationTable).where(eq(MemoryRelationTable.id, row.id)).get()),
      )
      return created ? rowToRelation(created) : undefined
    })

    const removeRelation: Interface["removeRelation"] = Effect.fn("Memory.removeRelation")(function* (id) {
      yield* Effect.sync(() =>
        Database.use((db) => db.delete(MemoryRelationTable).where(eq(MemoryRelationTable.id, id)).run()),
      )
      return true
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
      reviewDue,
      listReviewCandidates,
      applyReviewCandidate,
      dismissReviewCandidate,
      reviewStatus,
      listRelations,
      relationsForMemory,
      addRelation,
      removeRelation,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.defaultLayer))

export * as Memory from "./service"
