import { and, desc, eq, isNull, or } from "@/storage/db"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ProjectID } from "@/project/schema"
import { SessionID } from "@/session/schema"
import * as Database from "@/storage/db"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { applyPatch as applyUnifiedPatch } from "diff"
import { Context, Effect, Layer, Schema } from "effect"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { EvolutionCandidateTable, EvolutionReviewStateTable } from "./evolution.sql"
import {
  EvolutionCandidateID,
  type Candidate,
  type CandidateSource,
  type CandidateDryRun,
  type CandidateFileApply,
  type CandidatePreview,
  type CandidateProposal,
  type CandidateUpdate,
  type ContentFormat,
  type ListInput,
  type ReviewInput,
  type StatusSummary,
} from "./schema"

const DEFAULT_LIMIT = 50
const DEFAULT_REVIEW_INTERVAL = 3

type ReviewSessionEndInput = {
  messagesText: string
  projectID?: ReviewInput["projectID"]
  sessionID?: ReviewInput["sessionID"]
  sourceMessageID?: ReviewInput["sourceMessageID"]
}

export const Event = {
  Updated: BusEvent.define(
    "evolution.updated",
    Schema.Struct({
      projectID: Schema.optional(ProjectID),
      sessionID: Schema.optional(SessionID),
    }),
  ),
}

export interface Interface {
  readonly review: (input: ReviewInput) => Effect.Effect<Candidate[]>
  readonly reviewSessionEnd: (input: ReviewSessionEndInput) => Effect.Effect<Candidate[]>
  readonly reviewDue: (input: {
    projectID?: ReviewInput["projectID"]
    sessionID?: ReviewInput["sessionID"]
    sourceMessageID?: ReviewInput["sourceMessageID"]
    reviewInterval?: number
  }) => Effect.Effect<boolean>
  readonly list: (input?: ListInput) => Effect.Effect<Candidate[]>
  readonly update: (id: EvolutionCandidateID, input: CandidateUpdate) => Effect.Effect<Candidate | undefined>
  readonly preview: (id: EvolutionCandidateID) => Effect.Effect<CandidatePreview | undefined>
  readonly dryRun: (
    id: EvolutionCandidateID,
    input: { directory: string; worktree: string; globalConfig?: string },
  ) => Effect.Effect<CandidateDryRun | undefined>
  readonly apply: (id: EvolutionCandidateID) => Effect.Effect<Candidate | undefined>
  readonly applyToDisk: (
    id: EvolutionCandidateID,
    input: { directory: string; worktree: string; globalConfig?: string },
  ) => Effect.Effect<CandidateFileApply | undefined>
  readonly dismiss: (id: EvolutionCandidateID) => Effect.Effect<Candidate | undefined>
  readonly status: (input?: { projectID?: ReviewInput["projectID"]; sessionID?: ReviewInput["sessionID"] }) => Effect.Effect<StatusSummary>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Evolution") {}

function rowToCandidate(row: typeof EvolutionCandidateTable.$inferSelect): Candidate {
  return {
    id: row.id,
    ...(row.project_id ? { projectID: row.project_id } : {}),
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    kind: row.kind,
    target: row.target,
    title: row.title,
    content: row.content,
    contentFormat: row.content_format,
    reason: row.reason,
    tags: row.tags,
    ...(row.source_message_id ? { sourceMessageID: row.source_message_id } : {}),
    status: row.status,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      ...(row.time_applied ? { applied: row.time_applied } : {}),
    },
  }
}

function isUnifiedDiff(content: string) {
  return /^--- .+\n\+\+\+ .+\n@@/m.test(content.trim())
}

function candidateContentFormat(content: string, format?: ContentFormat) {
  if (format) return format
  if (isUnifiedDiff(content)) return "unified_diff"
  return "content"
}

function isGlobalEvolutionProposal(proposal: CandidateProposal) {
  if (proposal.scope !== "global") return false
  if (!["skill", "workflow", "prompt", "tool"].includes(proposal.kind)) return false
  return /global|all projects|across projects|reusable|reuse|standard|通用|复用|跨项目|所有项目|标准/i.test(
    [proposal.title, proposal.content, proposal.reason, ...(proposal.tags ?? [])].join("\n"),
  )
}

function isGlobalCandidate(candidate: Candidate) {
  return candidate.tags.includes("global")
}

function conditions(input?: ListInput) {
  return [
    input?.projectID
      ? input.includeGlobal
        ? or(eq(EvolutionCandidateTable.project_id, input.projectID), isNull(EvolutionCandidateTable.project_id))
        : eq(EvolutionCandidateTable.project_id, input.projectID)
      : undefined,
    input?.sessionID ? eq(EvolutionCandidateTable.session_id, input.sessionID) : undefined,
    input?.kind ? eq(EvolutionCandidateTable.kind, input.kind) : undefined,
    input?.status ? eq(EvolutionCandidateTable.status, input.status) : undefined,
  ].filter((item) => item !== undefined)
}

function candidateSource(item: Candidate): CandidateSource {
  if (item.tags.includes("session-end")) return "session-end"
  return "background"
}

function emptySourceCounts(): StatusSummary["source"] {
  return {
    all: 0,
    background: 0,
    "session-end": 0,
  }
}

function sourceCounts(items: Candidate[]): StatusSummary["source"] {
  return items.reduce((counts, item) => {
    const source = candidateSource(item)
    return {
      ...counts,
      all: counts.all + 1,
      [source]: counts[source] + 1,
    }
  }, emptySourceCounts())
}

function normalizeProposal(input: ReviewInput, proposal: CandidateProposal): typeof EvolutionCandidateTable.$inferInsert | undefined {
  const title = proposal.title.trim()
  const content = proposal.content.trim()
  const target = proposal.target.trim()
  const reason = proposal.reason.trim()
  if (!title || !content || !target || !reason) return
  const now = Date.now()
  const global = isGlobalEvolutionProposal(proposal)
  const projectID = input.projectID && !global ? input.projectID : undefined
  return {
    id: EvolutionCandidateID.ascending(),
    project_id: projectID,
    session_id: input.sessionID,
    kind: proposal.kind,
    target,
    title,
    content,
    content_format: candidateContentFormat(content, proposal.contentFormat),
    reason,
    tags: Array.from(new Set([...(proposal.tags ?? []), "evolution", ...(global ? ["global"] : [])].map((tag) => tag.trim()).filter(Boolean))),
    source_message_id: input.sourceMessageID,
    status: "pending",
    time_created: now,
    time_updated: now,
  }
}

function explicitSessionEndProposal(text: string): CandidateProposal | undefined {
  const patterns = [
    /(?:please\s+)?(?:improve|evolve|self[-\s]?evolve)(?:\s+that)?\s+(.+)/i,
    /(?:remember\s+to\s+improve|next\s+time\s+improve)\s+(.+)/i,
    /(?:改进|优化|进化|下次应该|以后应该)[:：]?\s*(.+)/,
  ]
  const content = patterns
    .map((pattern) => text.match(pattern)?.[1]?.trim())
    .find((item) => item && item.length >= 8)
  if (!content) return
  const kind = /\b(skill|skills)\b/i.test(content) ? "skill" : /\b(agent|agents)\b/i.test(content) ? "agent" : "project"
  return {
    kind,
    target: kind === "project" ? "session-end-review" : "session-end-improvement",
    title: "Session-end improvement candidate",
    content,
    reason: "Session-end review found an explicit durable self-evolution request.",
    tags: ["session-end"],
  }
}

function normalizeTags(input: readonly string[] | undefined) {
  if (!input) return
  return Array.from(new Set([...input, "evolution"].map((tag) => tag.trim()).filter(Boolean)))
}

function buildPreview(candidate: Candidate): CandidatePreview {
  const body = [
    `title: ${candidate.title}`,
    `kind: ${candidate.kind}`,
    `target: ${candidate.target}`,
    "",
    candidate.content,
    "",
    `contentFormat: ${candidate.contentFormat}`,
    "",
    `reason: ${candidate.reason}`,
    `tags: ${candidate.tags.join(", ")}`,
  ]
  return {
    id: candidate.id,
    kind: candidate.kind,
    target: candidate.target,
    title: candidate.title,
    diff: [
      `--- current/${candidate.kind}/${candidate.target}`,
      `+++ proposed/${candidate.kind}/${candidate.target}`,
      "@@",
      ...body.map((line) => `+${line}`),
    ].join("\n"),
    note: "当前阶段只预览候选内容，不会自动改写技能、Agent、工作流、提示词、工具或项目文件。",
  }
}

function targetSegments(target: string) {
  return target
    .trim()
    .replace(/\.md$/i, "")
    .split(/[\\/]+/)
    .map((item) => item.trim().replace(/[<>:"|?*\x00-\x1f]/g, "-"))
    .filter((item) => item && item !== "." && item !== "..")
}

function targetFile(candidate: Candidate, input: { directory: string; worktree: string; globalConfig?: string }) {
  const root = isGlobalCandidate(candidate)
    ? (input.globalConfig ?? Global.Path.config)
    : path.join(input.worktree === "/" ? input.directory : input.worktree, ".novaway")
  const name = targetSegments(candidate.target)
  const segments = name.length ? name : ["untitled"]
  const file = (() => {
    if (candidate.kind === "skill") return path.join(root, "skills", ...segments, "SKILL.md")
    if (candidate.kind === "agent") return path.join(root, "agents", `${segments.join(path.sep)}.md`)
    if (candidate.kind === "workflow") return path.join(root, "workflows", `${segments.join(path.sep)}.md`)
    if (candidate.kind === "prompt") return path.join(root, "prompts", `${segments.join(path.sep)}.md`)
    if (candidate.kind === "tool") return path.join(root, "tools", `${segments.join(path.sep)}.md`)
    return path.join(root, "evolution", `${segments.join(path.sep)}.md`)
  })()
  if (!AppFileSystem.contains(root, file)) return path.join(root, "evolution", "untitled.md")
  return file
}

function normalizeContent(content: string) {
  return `${content.trim()}\n`
}

function contentAfter(candidate: Candidate, before: string) {
  if (candidate.contentFormat !== "unified_diff") return normalizeContent(candidate.content)
  const patched = applyUnifiedPatch(before, candidate.content.trim())
  if (patched === false) throw new Error("自我进化候选 patch 无法应用：目标文件内容与候选上下文不匹配。")
  return patched
}

function lines(text: string) {
  return text.replace(/\r\n/g, "\n").split("\n")
}

function buildUnifiedDiff(file: string, before: string, after: string) {
  const beforeLines = lines(before)
  const afterLines = lines(after)
  if (before === after) return [`--- a/${file}`, `+++ b/${file}`, "@@", " 文件内容无变化"].join("\n")

  const prefix = (() => {
    const length = Math.min(beforeLines.length, afterLines.length)
    const index = beforeLines.findIndex((line, i) => line !== afterLines[i])
    return index === -1 ? length : index
  })()
  const suffix = (() => {
    const max = Math.min(beforeLines.length - prefix, afterLines.length - prefix)
    const index = Array.from({ length: max }).findIndex(
      (_, i) => beforeLines[beforeLines.length - 1 - i] !== afterLines[afterLines.length - 1 - i],
    )
    return index === -1 ? max : index
  })()
  const beforeChanged = beforeLines.slice(prefix, beforeLines.length - suffix)
  const afterChanged = afterLines.slice(prefix, afterLines.length - suffix)
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${prefix + 1},${beforeChanged.length} +${prefix + 1},${afterChanged.length} @@`,
    ...beforeLines.slice(Math.max(prefix - 3, 0), prefix).map((line) => ` ${line}`),
    ...beforeChanged.map((line) => `-${line}`),
    ...afterChanged.map((line) => `+${line}`),
    ...beforeLines.slice(beforeLines.length - suffix, Math.min(beforeLines.length - suffix + 3, beforeLines.length)).map((line) => ` ${line}`),
  ].join("\n")
}

async function buildDryRun(candidate: Candidate, input: { directory: string; worktree: string; globalConfig?: string }): Promise<CandidateDryRun> {
  const file = targetFile(candidate, input)
  const exists = await Bun.file(file).exists()
  const before = exists ? await Bun.file(file).text() : ""
  const after = contentAfter(candidate, before)
  const root = input.worktree === "/" ? input.directory : input.worktree
  const relative = path.relative(isGlobalCandidate(candidate) ? (input.globalConfig ?? root) : root, file)
  return {
    id: candidate.id,
    kind: candidate.kind,
    target: candidate.target,
    title: candidate.title,
    files: [
      {
        path: relative,
        exists,
        before,
        after,
        diff: buildUnifiedDiff(relative, before, after),
      },
    ],
    note: "真实预览按整文件替换展示差异；当前不会写入磁盘，应用候选仍只更新候选状态。",
  }
}

async function writeDryRun(dryRun: CandidateDryRun, input: { directory: string; worktree: string }) {
  const root = input.worktree === "/" ? input.directory : input.worktree
  for (const file of dryRun.files) {
    const absolute = path.join(root, file.path)
    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, file.after)
  }
}

function reviewInterval(input: number | undefined) {
  return Math.max(Math.floor(input ?? DEFAULT_REVIEW_INTERVAL), 1)
}

export const layer: Layer.Layer<Service, never, Bus.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const publishUpdated = (input: { projectID?: ReviewInput["projectID"]; sessionID?: ReviewInput["sessionID"] }) =>
      bus
        .publish(Event.Updated, {
          projectID: input.projectID,
          sessionID: input.sessionID,
        })
        .pipe(Effect.catchCause(() => Effect.void))
    const list: Interface["list"] = Effect.fn("Evolution.list")(function* (input) {
      const rows = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select()
            .from(EvolutionCandidateTable)
            .where(and(...conditions(input)))
            .orderBy(desc(EvolutionCandidateTable.time_updated))
            .limit(input?.limit ?? DEFAULT_LIMIT)
            .all(),
        ),
      )
      return rows.map(rowToCandidate)
    })

    const getByID = Effect.fn("Evolution.getByID")(function* (id: EvolutionCandidateID) {
      const row = yield* Effect.sync(() =>
        Database.use((db) => db.select().from(EvolutionCandidateTable).where(eq(EvolutionCandidateTable.id, id)).get()),
      )
      return row ? rowToCandidate(row) : undefined
    })

    const reviewDue: Interface["reviewDue"] = Effect.fn("Evolution.reviewDue")(function* (input) {
      if (!input.sessionID) return true
      const now = Date.now()
      const interval = reviewInterval(input.reviewInterval)
      const turn = yield* Effect.sync(() =>
        Database.transaction((tx) => {
          const current = tx
            .select()
            .from(EvolutionReviewStateTable)
            .where(eq(EvolutionReviewStateTable.session_id, input.sessionID!))
            .get()
          const next = (current?.turn_count ?? 0) + 1
          tx.insert(EvolutionReviewStateTable)
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
              target: EvolutionReviewStateTable.session_id,
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

    const review: Interface["review"] = Effect.fn("Evolution.review")(function* (input) {
      const rows = input.proposals
        .map((proposal) => normalizeProposal(input, proposal))
        .filter((item) => item !== undefined)
        .filter(
          (row, index, rows) =>
            rows.findIndex((item) => item.kind === row.kind && item.target === row.target && item.content === row.content) === index,
        )
      if (!rows.length) return []
      const existing = yield* list({
        projectID: input.projectID,
        includeGlobal: true,
        sessionID: input.sessionID,
        status: "pending",
        limit: DEFAULT_LIMIT,
      })
      const pending = rows.filter(
        (row) =>
          !existing.some(
            (item) =>
              item.kind === row.kind &&
              item.target === row.target &&
              item.content === row.content &&
              item.sourceMessageID === input.sourceMessageID,
          ),
      )
      const duplicates = rows
        .map((row) =>
          existing.find(
            (item) =>
              item.kind === row.kind &&
              item.target === row.target &&
              item.content === row.content &&
              item.sourceMessageID === input.sourceMessageID,
          ),
        )
        .filter((item) => item !== undefined)
      if (pending.length) {
        yield* Effect.sync(() => Database.use((db) => db.insert(EvolutionCandidateTable).values(pending).run()))
        yield* publishUpdated(input)
      }
      return [
        ...duplicates,
        ...pending.map((row) => rowToCandidate(row as typeof EvolutionCandidateTable.$inferSelect)),
      ]
    })

    const reviewSessionEnd: Interface["reviewSessionEnd"] = Effect.fn("Evolution.reviewSessionEnd")(function* (input) {
      const proposal = explicitSessionEndProposal(input.messagesText)
      if (!proposal) return []
      return yield* review({
        projectID: input.projectID,
        sessionID: input.sessionID,
        sourceMessageID: input.sourceMessageID,
        proposals: [proposal],
      })
    })

    const update: Interface["update"] = Effect.fn("Evolution.update")(function* (id, input) {
      const candidate = yield* getByID(id)
      if (!candidate || candidate.status !== "pending") return
      const next = {
        ...(input.kind ? { kind: input.kind } : {}),
        ...(input.target?.trim() ? { target: input.target.trim() } : {}),
        ...(input.title?.trim() ? { title: input.title.trim() } : {}),
        ...(input.content?.trim() ? { content: input.content.trim() } : {}),
        ...(input.contentFormat ? { content_format: input.contentFormat } : {}),
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        ...(input.tags ? { tags: normalizeTags(input.tags) ?? [] } : {}),
      }
      if (!Object.keys(next).length) return candidate
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(EvolutionCandidateTable)
            .set({ ...next, time_updated: Date.now() })
            .where(eq(EvolutionCandidateTable.id, id))
            .run(),
        ),
      )
      yield* publishUpdated({
        projectID: candidate.projectID,
        sessionID: candidate.sessionID,
      })
      return yield* getByID(id)
    })

    const preview: Interface["preview"] = Effect.fn("Evolution.preview")(function* (id) {
      const candidate = yield* getByID(id)
      if (!candidate) return
      return buildPreview(candidate)
    })

    const dryRun: Interface["dryRun"] = Effect.fn("Evolution.dryRun")(function* (id, input) {
      const candidate = yield* getByID(id)
      if (!candidate) return
      return yield* Effect.promise(() => buildDryRun(candidate, input))
    })

    const apply: Interface["apply"] = Effect.fn("Evolution.apply")(function* (id) {
      const candidate = yield* getByID(id)
      if (!candidate || candidate.status !== "pending") return
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(EvolutionCandidateTable)
            .set({ status: "applied", time_applied: now, time_updated: now })
            .where(eq(EvolutionCandidateTable.id, id))
            .run(),
        ),
      )
      yield* publishUpdated({
        projectID: candidate.projectID,
        sessionID: candidate.sessionID,
      })
      return yield* getByID(id)
    })

    const applyToDisk: Interface["applyToDisk"] = Effect.fn("Evolution.applyToDisk")(function* (id, input) {
      const candidate = yield* getByID(id)
      if (!candidate || candidate.status !== "pending") return
      const dryRun = yield* Effect.promise(() => buildDryRun(candidate, input))
      yield* Effect.promise(() =>
        writeDryRun(dryRun, isGlobalCandidate(candidate) ? { ...input, worktree: input.globalConfig ?? Global.Path.config } : input),
      )
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(EvolutionCandidateTable)
            .set({ status: "applied", time_applied: now, time_updated: now })
            .where(eq(EvolutionCandidateTable.id, id))
            .run(),
        ),
      )
      const applied = yield* getByID(id)
      if (!applied) return
      yield* publishUpdated({
        projectID: candidate.projectID,
        sessionID: candidate.sessionID,
      })
      return { candidate: applied, dryRun }
    })

    const dismiss: Interface["dismiss"] = Effect.fn("Evolution.dismiss")(function* (id) {
      const candidate = yield* getByID(id)
      if (!candidate || candidate.status !== "pending") return
      const now = Date.now()
      yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .update(EvolutionCandidateTable)
            .set({ status: "dismissed", time_updated: now })
            .where(eq(EvolutionCandidateTable.id, id))
            .run(),
        ),
      )
      yield* publishUpdated({
        projectID: candidate.projectID,
        sessionID: candidate.sessionID,
      })
      return yield* getByID(id)
    })

    const status: Interface["status"] = Effect.fn("Evolution.status")(function* (input) {
      const items = yield* list({ projectID: input?.projectID, sessionID: input?.sessionID, limit: 10_000 })
      return {
        pending: items.filter((item) => item.status === "pending").length,
        applied: items.filter((item) => item.status === "applied").length,
        dismissed: items.filter((item) => item.status === "dismissed").length,
        total: items.length,
        latest: items[0]?.time.updated,
        source: sourceCounts(items),
        sourceByStatus: {
          pending: sourceCounts(items.filter((item) => item.status === "pending")),
          applied: sourceCounts(items.filter((item) => item.status === "applied")),
          dismissed: sourceCounts(items.filter((item) => item.status === "dismissed")),
        },
      }
    })

    return Service.of({ review, reviewSessionEnd, reviewDue, list, update, preview, dryRun, apply, applyToDisk, dismiss, status })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.defaultLayer))

export * as Evolution from "./service"
