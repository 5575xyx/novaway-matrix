import { Slug } from "@novaway/core/util/slug"
import path from "path"
import { BackgroundJob } from "@/background/job"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Decimal } from "decimal.js"
import { type ProviderMetadata, type LanguageModelUsage } from "ai"
import { InstallationVersion } from "@novaway/core/installation/version"

import { Database } from "@/storage/db"
import { NotFoundError } from "@/storage/storage"
import { eq } from "drizzle-orm"
import { and } from "drizzle-orm"
import { gte } from "drizzle-orm"
import { isNotNull, isNull } from "drizzle-orm"
import { desc } from "drizzle-orm"
import { like } from "drizzle-orm"
import { inArray } from "drizzle-orm"
import { lt } from "drizzle-orm"
import { or } from "drizzle-orm"
import { SyncEvent } from "../sync"
import type { SQL } from "drizzle-orm"
import { PartTable, SessionTable } from "./session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "@/storage/storage"
import { AppFileSystem } from "@novaway/core/filesystem"
import * as Log from "@novaway/core/util/log"
import { MessageV2 } from "./message-v2"
import type { InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { ProjectID } from "../project/schema"
import { WorkspaceID } from "../control-plane/schema"
import { SessionID, MessageID, PartID } from "./schema"
import { ModelID, ProviderID } from "@/provider/schema"

import type { Provider } from "@/provider/provider"
import { Permission } from "@/permission"
import { Global } from "@novaway/core/global"
import { Effect, Layer, Option, Context, Schema, Types } from "effect"
import { NonNegativeInt, optionalOmitUndefined } from "@novaway/core/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Memory } from "@/memory/service"
import { Config } from "@/config/config"
import { Service as HookService } from "@/hook/service"
import { ConfigMemory } from "@/config/memory"
import { ConfigEvolution } from "@/config/evolution"
import { Evolution } from "@/evolution/service"

const log = Log.create({ service: "session" })

/**
 * `SessionStart` hooks can return `additionalContext` (loaded repo context,
 * environment notes, ...). The session is created before any prompt exists, so
 * stash it here and attach it to the first user message of the session — the
 * only place the model is guaranteed to see it.
 */
const startContext = new Map<string, string>()

export function takeStartContext(sessionID: string) {
  const value = startContext.get(sessionID)
  if (value) startContext.delete(sessionID)
  return value
}

function rememberStartContext(sessionID: string, text: string) {
  // Sessions that are created and never prompted would otherwise pin their
  // context forever; keep the map small by dropping the oldest entries.
  if (startContext.size >= 100) {
    const oldest = startContext.keys().next().value
    if (oldest) startContext.delete(oldest)
  }
  startContext.set(sessionID, text)
}

const parentTitlePrefix = "New session - "
const childTitlePrefix = "Child session - "

function createDefaultTitle(isChild = false) {
  return (isChild ? childTitlePrefix : parentTitlePrefix) + new Date().toISOString()
}

export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${parentTitlePrefix}|${childTitlePrefix})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(title)
}

type SessionRow = typeof SessionTable.$inferSelect

export function fromRow(row: SessionRow): Info {
  const summary =
    row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          additions: row.summary_additions ?? 0,
          deletions: row.summary_deletions ?? 0,
          files: row.summary_files ?? 0,
          diffs: row.summary_diffs ?? undefined,
        }
      : undefined
  const share = row.share_url ? { url: row.share_url } : undefined
  const revert = row.revert ?? undefined
  return {
    id: row.id,
    slug: row.slug,
    projectID: row.project_id,
    workspaceID: row.workspace_id ?? undefined,
    directory: row.directory,
    path: row.path ?? undefined,
    parentID: row.parent_id ?? undefined,
    title: row.title,
    agent: row.agent ?? undefined,
    model: row.model
      ? {
          id: ModelID.make(row.model.id),
          providerID: ProviderID.make(row.model.providerID),
          variant: row.model.variant,
        }
      : undefined,
    version: row.version,
    summary,
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache: {
        read: row.tokens_cache_read,
        write: row.tokens_cache_write,
      },
    },
    share,
    revert,
    permission: row.permission ?? undefined,
    permissionMode: (row.permission_mode ?? undefined) as Permission.Mode | undefined,
    teamMode: (row.team_mode ?? undefined) as Info["teamMode"],
    teamIDs: row.team_ids ?? undefined,
    employeeID: row.employee_id ?? undefined,
    runID: row.run_id ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting ?? undefined,
      archived: row.time_archived ?? undefined,
    },
  }
}

export function toRow(info: Info) {
  return {
    id: info.id,
    project_id: info.projectID,
    workspace_id: info.workspaceID,
    parent_id: info.parentID,
    slug: info.slug,
    directory: info.directory,
    path: info.path,
    title: info.title,
    agent: info.agent,
    model: info.model,
    version: info.version,
    share_url: info.share?.url,
    summary_additions: info.summary?.additions,
    summary_deletions: info.summary?.deletions,
    summary_files: info.summary?.files,
    summary_diffs: info.summary?.diffs,
    cost: info.cost ?? 0,
    tokens_input: (info.tokens ?? EmptyTokens).input,
    tokens_output: (info.tokens ?? EmptyTokens).output,
    tokens_reasoning: (info.tokens ?? EmptyTokens).reasoning,
    tokens_cache_read: (info.tokens ?? EmptyTokens).cache.read,
    tokens_cache_write: (info.tokens ?? EmptyTokens).cache.write,
    revert: info.revert ?? null,
    permission: info.permission,
    permission_mode: info.permissionMode ?? null,
    team_mode: info.teamMode ?? null,
    team_ids: info.teamIDs ?? null,
    employee_id: info.employeeID ?? null,
    run_id: info.runID ?? null,
    time_created: info.time.created,
    time_updated: info.time.updated,
    time_compacting: info.time.compacting,
    time_archived: info.time.archived,
  }
}

function getForkedTitle(title: string): string {
  const match = title.match(/^(.+) \(fork #(\d+)\)$/)
  if (match) {
    const base = match[1]
    const num = parseInt(match[2], 10)
    return `${base} (fork #${num + 1})`
  }
  return `${title} (fork #1)`
}

function sessionPath(worktree: string, cwd: string) {
  return path.relative(path.resolve(worktree), cwd).replaceAll("\\", "/")
}

const Summary = Schema.Struct({
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Finite,
  diffs: optionalOmitUndefined(Schema.Array(Snapshot.FileDiff)),
})

const Tokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})

const EmptyTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const Share = Schema.Struct({
  url: Schema.String,
})

// Legacy HTTP accepted negative values here. Keep archive timestamps permissive
// while excluding non-finite values that cannot round-trip through JSON.
export const ArchivedTimestamp = Schema.Finite

const Time = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  compacting: optionalOmitUndefined(NonNegativeInt),
  archived: optionalOmitUndefined(ArchivedTimestamp),
})

const Revert = Schema.Struct({
  messageID: MessageID,
  partID: optionalOmitUndefined(PartID),
  snapshot: optionalOmitUndefined(Schema.String),
  diff: optionalOmitUndefined(Schema.String),
  files: optionalOmitUndefined(Schema.Array(Snapshot.FileDiff)),
})

const Model = Schema.Struct({
  id: ModelID,
  providerID: ProviderID,
  variant: optionalOmitUndefined(Schema.String),
})

export const Info = Schema.Struct({
  id: SessionID,
  slug: Schema.String,
  projectID: ProjectID,
  workspaceID: optionalOmitUndefined(WorkspaceID),
  directory: Schema.String,
  path: optionalOmitUndefined(Schema.String),
  parentID: optionalOmitUndefined(SessionID),
  summary: optionalOmitUndefined(Summary),
  cost: optionalOmitUndefined(Schema.Finite),
  tokens: optionalOmitUndefined(Tokens),
  share: optionalOmitUndefined(Share),
  title: Schema.String,
  agent: optionalOmitUndefined(Schema.String),
  model: optionalOmitUndefined(Model),
  version: Schema.String,
  time: Time,
  permission: optionalOmitUndefined(Permission.Ruleset),
  /** Session-scoped permission mode; falls back to config when unset. */
  permissionMode: optionalOmitUndefined(Permission.Mode),
  /**
   * 团队目录注入模式（§4.2）：
   * - `off`：不注入团队目录，主智能体不会调用 `team_run`；
   * - `selected`：只注入 `teamIDs` 里的团队；
   * - `auto`：注入全部 `autoEligible` 团队，允许主智能体自行选择，但每次派发
   *   都必须先给出计划并**等用户批准**。
   */
  teamMode: optionalOmitUndefined(Schema.Literals(["off", "auto", "selected"])),
  teamIDs: optionalOmitUndefined(Schema.Array(Schema.String)),
  /**
   * 这次会话的工作记在谁名下（员工库 id）。
   *
   * 只由派发路径写入：运行派发的队长是名册里的队长，队长把活派给名册里的
   * 某个成员时该成员的会话记在那个人的名下，成员自己再派生的子代理跟着成员走。
   * 指认不出来就是空 —— 不猜。
   */
  employeeID: optionalOmitUndefined(Schema.String),
  /** 这次会话属于哪次团队运行（`team_run` id）；普通会话没有。 */
  runID: optionalOmitUndefined(Schema.String),
  revert: optionalOmitUndefined(Revert),
}).annotate({ identifier: "Session" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const ProjectInfo = Schema.Struct({
  id: ProjectID,
  name: optionalOmitUndefined(Schema.String),
  worktree: Schema.String,
}).annotate({ identifier: "ProjectSummary" })
export type ProjectInfo = Types.DeepMutable<Schema.Schema.Type<typeof ProjectInfo>>

export const GlobalInfo = Schema.Struct({
  ...Info.fields,
  project: Schema.NullOr(ProjectInfo),
}).annotate({ identifier: "GlobalSession" })
export type GlobalInfo = Types.DeepMutable<Schema.Schema.Type<typeof GlobalInfo>>

export const CreateInput = Schema.optional(
  Schema.Struct({
    parentID: Schema.optional(SessionID),
    title: Schema.optional(Schema.String),
    agent: Schema.optional(Schema.String),
    model: Schema.optional(Model),
    permission: Schema.optional(Permission.Ruleset),
    permissionMode: Schema.optional(Permission.Mode),
    /** 建会话时就带上团队选择：新会话的首条消息也能直接派发。 */
    teamMode: Schema.optional(Schema.Literals(["off", "auto", "selected"])),
    teamIDs: Schema.optional(Schema.Array(Schema.String)),
    workspaceID: Schema.optional(WorkspaceID),
  }),
)
export type CreateInput = Types.DeepMutable<Schema.Schema.Type<typeof CreateInput>>
/**
 * 建会话入参的只读形态：HTTP 层解码出来的就是它，可以直接往下传，
 * 不必为了绕过 `readonly` 数组再拷贝一遍。
 */
export type CreateParams = NonNullable<Schema.Schema.Type<typeof CreateInput>>

/**
 * 会话归属（`Info.employeeID` / `Info.runID`）。
 *
 * **只在内部派发路径上传**，故意不放进 `CreateInput`：HTTP 的建会话接口直接
 * 用它当 payload，写进去就等于任何客户端都能把工时记到别人头上。
 */
export type Attribution = {
  employeeID?: string
  runID?: string
}

export const ForkInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export const GetInput = SessionID
export const ChildrenInput = SessionID
export const RemoveInput = SessionID
export const SetTitleInput = Schema.Struct({ sessionID: SessionID, title: Schema.String })
export const SetArchivedInput = Schema.Struct({
  sessionID: SessionID,
  time: Schema.optional(ArchivedTimestamp),
})
export const SetPermissionInput = Schema.Struct({
  sessionID: SessionID,
  permission: Permission.Ruleset,
})
export const SetRevertInput = Schema.Struct({
  sessionID: SessionID,
  revert: Schema.optional(Revert),
  summary: Schema.optional(Summary),
})
export const MessagesInput = Schema.Struct({
  sessionID: SessionID,
  limit: Schema.optional(NonNegativeInt),
})
export type ListInput = {
  directory?: string
  scope?: "project"
  path?: string
  workspaceID?: WorkspaceID
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}

const CreatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: Info,
})

const UpdatedShare = Schema.Struct({
  url: Schema.optional(Schema.NullOr(Schema.String)),
})

const UpdatedTime = Schema.Struct({
  created: Schema.optional(Schema.NullOr(NonNegativeInt)),
  updated: Schema.optional(Schema.NullOr(NonNegativeInt)),
  compacting: Schema.optional(Schema.NullOr(NonNegativeInt)),
  archived: Schema.optional(Schema.NullOr(ArchivedTimestamp)),
})

const UpdatedInfo = Schema.Struct({
  id: Schema.optional(Schema.NullOr(SessionID)),
  slug: Schema.optional(Schema.NullOr(Schema.String)),
  projectID: Schema.optional(Schema.NullOr(ProjectID)),
  workspaceID: Schema.optional(Schema.NullOr(WorkspaceID)),
  directory: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  parentID: Schema.optional(Schema.NullOr(SessionID)),
  summary: Schema.optional(Schema.NullOr(Summary)),
  cost: Schema.optional(Schema.Finite),
  tokens: Schema.optional(Tokens),
  share: Schema.optional(UpdatedShare),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  agent: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Model)),
  version: Schema.optional(Schema.NullOr(Schema.String)),
  time: Schema.optional(UpdatedTime),
  permission: Schema.optional(Schema.NullOr(Permission.Ruleset)),
  permissionMode: Schema.optional(Schema.NullOr(Permission.Mode)),
  revert: Schema.optional(Schema.NullOr(Revert)),
})

const UpdatedEventSchema = Schema.Struct({
  sessionID: SessionID,
  info: UpdatedInfo,
})

export const Event = {
  Created: SyncEvent.define({
    type: "session.created",
    version: 1,
    aggregate: "sessionID",
    schema: CreatedEventSchema,
  }),
  Updated: SyncEvent.define({
    type: "session.updated",
    version: 1,
    aggregate: "sessionID",
    schema: UpdatedEventSchema,
    busSchema: CreatedEventSchema,
  }),
  Deleted: SyncEvent.define({
    type: "session.deleted",
    version: 1,
    aggregate: "sessionID",
    schema: CreatedEventSchema,
  }),
  Diff: BusEvent.define(
    "session.diff",
    Schema.Struct({
      sessionID: SessionID,
      diff: Schema.Array(Snapshot.FileDiff),
    }),
  ),
  Error: BusEvent.define(
    "session.error",
    Schema.Struct({
      sessionID: Schema.optional(SessionID),
      // Reuses MessageV2.Assistant.fields.error (already Schema.optional) so
      // the derived zod keeps the same discriminated-union shape on the bus.
      error: MessageV2.Assistant.fields.error,
    }),
  ),
}

export function plan(input: { slug: string; time: { created: number } }, instance: InstanceContext) {
  const root = instance.worktree === "/" ? instance.directory : instance.worktree
  const base = path.join(root, ".novaway", "plans")
  return path.join(base, [input.time.created, input.slug].join("-") + ".md")
}

export const getUsage = (input: { model: Provider.Model; usage: LanguageModelUsage; metadata?: ProviderMetadata }) => {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, value)
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(
    input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0,
  )
  const cacheWriteInputTokens = safe(
    Number(
      input.usage.inputTokenDetails?.cacheWriteTokens ??
        input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
        // google-vertex-anthropic returns metadata under "vertex" key
        // (AnthropicMessagesLanguageModel custom provider key from 'vertex.anthropic.messages')
        input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ??
        // @ts-expect-error
        input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ??
        0,
    ),
  )

  // AI SDK v6 normalized inputTokens to include cached tokens across all providers
  // (including Anthropic/Bedrock which previously excluded them). Always subtract cache
  // tokens to get the non-cached input count for separate cost calculation.
  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  const contextTokens = inputTokens
  const costInfo =
    input.model.cost?.tiers
      ?.filter((item) => item.tier.type === "context" && contextTokens > item.tier.size)
      .sort((a, b) => b.tier.size - a.tier.size)[0] ??
    (input.model.cost?.experimentalOver200K && contextTokens > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost)
  return {
    cost: safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
        // TODO: update models.dev to have better pricing model, for now:
        // charge reasoning tokens at the same rate as output tokens
        .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
        .toNumber(),
    ),
    tokens,
  }
}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("SessionBusyError", {
  sessionID: SessionID,
}) {}

export type NotFound = NotFoundError

/** `setDirectory` rejects a path that does not exist or is not a directory. */
export class DirectoryError extends Schema.TaggedErrorClass<DirectoryError>()("SessionDirectoryError", {
  directory: Schema.String,
  reason: Schema.String,
}) {}

export interface Interface {
  readonly list: (input?: ListInput) => Effect.Effect<Info[]>
  readonly create: (
    input?: {
      parentID?: SessionID
      title?: string
      agent?: string
      model?: Schema.Schema.Type<typeof Model>
      permission?: Permission.Ruleset
      permissionMode?: Permission.Mode
      teamMode?: Info["teamMode"]
      teamIDs?: readonly string[]
      workspaceID?: WorkspaceID
      directory?: string
    },
    /** 内部派发路径专用的归属；HTTP 建会话接口没有这个参数。 */
    attribution?: Attribution,
  ) => Effect.Effect<Info>
  readonly fork: (input: {
    sessionID: SessionID
    messageID?: MessageID
    parentID?: SessionID
    title?: string
    agent?: string
    permission?: Permission.Ruleset
    permissionMode?: Permission.Mode
    /** Copy messages strictly before this id (exclusive). */
    before?: MessageID
  }) => Effect.Effect<Info, NotFound>
  readonly touch: (sessionID: SessionID) => Effect.Effect<void>
  readonly get: (id: SessionID) => Effect.Effect<Info, NotFound>
  readonly setTitle: (input: { sessionID: SessionID; title: string }) => Effect.Effect<void>
  readonly setArchived: (input: { sessionID: SessionID; time?: number }) => Effect.Effect<void>
  readonly setPermission: (input: { sessionID: SessionID; permission: Permission.Ruleset }) => Effect.Effect<void>
  readonly setPermissionMode: (input: {
    sessionID: SessionID
    mode: Permission.Mode | undefined
  }) => Effect.Effect<void>
  /**
   * 设置团队目录注入模式。
   *
   * `selected` 需要同时给出 `teamIDs`；切到 `off` / `auto` 时 ID 会被清空 ——
   * 否则下次切回 `selected` 会带回已经删掉的团队。
   */
  readonly setTeamMode: (input: {
    sessionID: SessionID
    mode: Info["teamMode"]
    teamIDs?: readonly string[]
  }) => Effect.Effect<void>
  /**
   * Change the working directory of a live session.
   *
   * Tools read `ctx.directory` from the session row, so this genuinely moves
   * subsequent tool calls; it is also the trigger point for `CwdChanged`.
   */
  readonly setDirectory: (input: {
    sessionID: SessionID
    directory: string
  }) => Effect.Effect<Info, NotFound | DirectoryError>
  readonly setRevert: (input: {
    sessionID: SessionID
    revert: Info["revert"]
    summary: Info["summary"]
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionID) => Effect.Effect<void>
  readonly setSummary: (input: { sessionID: SessionID; summary: Info["summary"] }) => Effect.Effect<void>
  readonly diff: (sessionID: SessionID) => Effect.Effect<Snapshot.FileDiff[]>
  readonly messages: (input: { sessionID: SessionID; limit?: number }) => Effect.Effect<MessageV2.WithParts[], NotFound>
  readonly children: (parentID: SessionID) => Effect.Effect<Info[]>
  readonly remove: (sessionID: SessionID) => Effect.Effect<void, NotFound>
  readonly updateMessage: <T extends MessageV2.Info>(msg: T) => Effect.Effect<T>
  readonly removeMessage: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<MessageID>
  readonly removePart: (input: { sessionID: SessionID; messageID: MessageID; partID: PartID }) => Effect.Effect<PartID>
  readonly getPart: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
  }) => Effect.Effect<MessageV2.Part | undefined>
  readonly updatePart: <T extends MessageV2.Part>(part: T) => Effect.Effect<T>
  readonly updatePartDelta: (input: {
    sessionID: SessionID
    messageID: MessageID
    partID: PartID
    field: string
    delta: string
  }) => Effect.Effect<void>
  /** Finds the first message matching the predicate, searching newest-first. */
  readonly findMessage: (
    sessionID: SessionID,
    predicate: (msg: MessageV2.WithParts) => boolean,
  ) => Effect.Effect<Option.Option<MessageV2.WithParts>, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Session") {}

export type Patch = Types.DeepMutable<SyncEvent.Event<typeof Event.Updated>["data"]["info"]>

const db = <T>(fn: (d: Parameters<typeof Database.use>[0] extends (trx: infer D) => any ? D : never) => T) =>
  Effect.sync(() => Database.use(fn))

const rawLayer: Layer.Layer<
  Service,
  never,
  | BackgroundJob.Service
  | Bus.Service
  | Config.Service
  | Evolution.Service
  | Memory.Service
  | Storage.Service
  | SyncEvent.Service
  | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const bus = yield* Bus.Service
    const storage = yield* Storage.Service
    const sync = yield* SyncEvent.Service
    const flags = yield* RuntimeFlags.Service
    const memory = yield* Memory.Service
    const evolution = yield* Evolution.Service
    const config = yield* Config.Service
    const hooks = yield* Effect.serviceOption(HookService)

    const textFromParts = (parts: MessageV2.Part[]) =>
      parts
        .filter((part): part is MessageV2.TextPart => part.type === "text")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n\n")

    const sessionReviewText = (items: MessageV2.WithParts[]) =>
      items
        .map((item) => {
          const text = textFromParts(item.parts)
          if (!text) return
          return [`<${item.info.role}>`, text, `</${item.info.role}>`].join("\n")
        })
        .filter((item) => item !== undefined)
        .join("\n\n")
        .trim()

    const reviewSessionEnd = Effect.fn("Session.reviewSessionEnd")(function* (input: { session: Info }) {
      const hasInstance = yield* InstanceState.directory.pipe(
        Effect.as(true),
        Effect.catchCause(() => Effect.succeed(false)),
      )
      if (!hasInstance) return
      const cfg = yield* config.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
      const items = yield* messages({ sessionID: input.session.id }).pipe(Effect.catch(() => Effect.succeed([])))
      const text = sessionReviewText(items)
      if (!text) return
      if (cfg && ConfigMemory.resolve(cfg.memory).enabled && ConfigMemory.resolve(cfg.memory).review_enabled) {
        yield* memory
          .reviewSessionEnd({
            messagesText: text,
            projectID: input.session.projectID,
            sessionID: input.session.id,
            sourceMessageID: items.at(-1)?.info.id,
          })
          .pipe(Effect.ignore)
      }
      if (cfg && ConfigEvolution.resolve(cfg.evolution).enabled) {
        yield* evolution
          .reviewSessionEnd({
            messagesText: text,
            projectID: input.session.projectID,
            sessionID: input.session.id,
            sourceMessageID: items.at(-1)?.info.id,
          })
          .pipe(Effect.ignore)
      }
    })

    const createNext = Effect.fn("Session.createNext")(function* (input: {
      id?: SessionID
      title?: string
      agent?: string
      model?: Schema.Schema.Type<typeof Model>
      parentID?: SessionID
      workspaceID?: WorkspaceID
      directory: string
      path?: string
      permission?: Permission.Ruleset
      permissionMode?: Permission.Mode
      teamMode?: Info["teamMode"]
      teamIDs?: readonly string[]
      employeeID?: string
      runID?: string
    }) {
      const ctx = yield* InstanceState.context
      // 团队选择只在 `selected` 下有意义：其它模式一律不留 teamIDs，
      // 免得切回去时带上一批已删除的团队。
      const teamMode = input.teamMode
      const teamIDs = teamMode === "selected" ? [...(input.teamIDs ?? [])] : undefined
      const result: Info = {
        id: SessionID.descending(input.id),
        slug: Slug.create(),
        version: InstallationVersion,
        projectID: ctx.project.id,
        directory: input.directory,
        path: input.path,
        workspaceID: input.workspaceID,
        parentID: input.parentID,
        title: input.title ?? createDefaultTitle(!!input.parentID),
        agent: input.agent,
        model: input.model,
        permission: input.permission,
        permissionMode: input.permissionMode,
        teamMode,
        teamIDs,
        employeeID: input.employeeID,
        runID: input.runID,
        cost: 0,
        tokens: EmptyTokens,
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      log.info("created", result)

      yield* sync.run(Event.Created, { sessionID: result.id, info: result })
      if (hooks._tag === "Some") {
        const started = yield* hooks.value
          .trigger({ event: "SessionStart", sessionID: result.id, cwd: result.directory })
          .pipe(Effect.catchCause(() => Effect.succeed({ blocked: false, ran: false, additionalContext: undefined })))
        if (started.additionalContext) rememberStartContext(result.id, started.additionalContext)
      }

      if (!flags.experimentalWorkspaces) {
        // This only exist for backwards compatibility. We should not be
        // manually publishing this event; it is a sync event now
        yield* bus.publish(Event.Updated, {
          sessionID: result.id,
          info: result,
        })
      }

      return result
    })

    const get = Effect.fn("Session.get")(function* (id: SessionID) {
      const row = yield* db((d) => d.select().from(SessionTable).where(eq(SessionTable.id, id)).get())
      if (!row) return yield* Effect.fail(new NotFoundError({ message: `Session not found: ${id}` }))
      return fromRow(row)
    })

    const list = Effect.fn("Session.list")(function* (input?: ListInput) {
      const ctx = yield* InstanceState.context
      return Array.from(
        listByProject({ projectID: ctx.project.id, experimentalWorkspaces: flags.experimentalWorkspaces, ...input }),
      )
    })

    const children = Effect.fn("Session.children")(function* (parentID: SessionID) {
      const rows = yield* db((d) =>
        d
          .select()
          .from(SessionTable)
          .where(and(eq(SessionTable.parent_id, parentID)))
          .all(),
      )
      return rows.map(fromRow)
    })

    const remove: Interface["remove"] = Effect.fnUntraced(function* (sessionID: SessionID) {
      const session = yield* get(sessionID)
      try {
        // `remove` needs to work in all cases, such as broken sessions that
        // run cleanup without instance state.
        const hasInstance = yield* InstanceState.directory.pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        )

        if (hasInstance) yield* cancelBackgroundJobs(background, sessionID)
        yield* reviewSessionEnd({ session }).pipe(Effect.ignore)
        const kids = yield* children(sessionID)
        for (const child of kids) {
          yield* remove(child.id)
        }

        if (hooks._tag === "Some") {
          yield* hooks.value.trigger({ event: "SessionEnd", sessionID, cwd: session.directory }).pipe(Effect.ignore)
        }
        yield* sync.run(Event.Deleted, { sessionID, info: session }, { publish: hasInstance })
        yield* sync.remove(sessionID)
      } catch (e) {
        log.error(e)
      }
    })

    const updateMessage = <T extends MessageV2.Info>(msg: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* sync.run(MessageV2.Event.Updated, { sessionID: msg.sessionID, info: msg })
        return msg
      }).pipe(Effect.withSpan("Session.updateMessage"))

    const updatePart = <T extends MessageV2.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* sync.run(MessageV2.Event.PartUpdated, {
          sessionID: part.sessionID,
          part: structuredClone(part),
          time: Date.now(),
        })
        return part
      }).pipe(Effect.withSpan("Session.updatePart"))

    const getPart: Interface["getPart"] = Effect.fn("Session.getPart")(function* (input) {
      const row = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, input.sessionID),
              eq(PartTable.message_id, input.messageID),
              eq(PartTable.id, input.partID),
            ),
          )
          .get(),
      )
      if (!row) return
      return {
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      } as MessageV2.Part
    })

    const create = Effect.fn("Session.create")(function* (
      input?: {
        parentID?: SessionID
        title?: string
        agent?: string
        model?: Schema.Schema.Type<typeof Model>
        permission?: Permission.Ruleset
        permissionMode?: Permission.Mode
        teamMode?: Info["teamMode"]
        teamIDs?: readonly string[]
        workspaceID?: WorkspaceID
        directory?: string
      },
      attribution?: Attribution,
    ) {
      const ctx = yield* InstanceState.context
      const workspace = yield* InstanceState.workspaceID
      return yield* createNext({
        parentID: input?.parentID,
        directory: input?.directory ?? ctx.directory,
        path: sessionPath(ctx.worktree, ctx.directory),
        title: input?.title,
        agent: input?.agent,
        model: input?.model,
        permission: input?.permission,
        permissionMode: input?.permissionMode,
        teamMode: input?.teamMode,
        teamIDs: input?.teamIDs,
        workspaceID: input?.workspaceID ?? workspace,
        ...(attribution?.employeeID ? { employeeID: attribution.employeeID } : {}),
        ...(attribution?.runID ? { runID: attribution.runID } : {}),
      })
    })

    const fork = Effect.fn("Session.fork")(function* (input: {
      sessionID: SessionID
      messageID?: MessageID
      parentID?: SessionID
      title?: string
      agent?: string
      permission?: Permission.Ruleset
      permissionMode?: Permission.Mode
      before?: MessageID
    }) {
      const ctx = yield* InstanceState.context
      const original = yield* get(input.sessionID)
      const title = input.title ?? getForkedTitle(original.title)
      const session = yield* createNext({
        directory: ctx.directory,
        path: sessionPath(ctx.worktree, ctx.directory),
        workspaceID: original.workspaceID,
        title,
        // 分叉沿用原来的归属：这个会话仍然是那个人的那份工作，
        // 只是换了一条对话线，不该在账上变成另一个人。
        ...(original.employeeID ? { employeeID: original.employeeID } : {}),
        ...(original.runID ? { runID: original.runID } : {}),
        ...(input.parentID ? { parentID: input.parentID } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.permission ? { permission: input.permission } : {}),
        // Forks keep the parent's mode: the whole point is an identical run.
        ...((input.permissionMode ?? original.permissionMode)
          ? { permissionMode: input.permissionMode ?? original.permissionMode }
          : {}),
      })
      const msgs = yield* messages({ sessionID: input.sessionID })
      const idMap = new Map<string, MessageID>()
      const stop = input.before ?? input.messageID

      for (const msg of msgs) {
        if (stop && msg.info.id >= stop) break
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          const p: MessageV2.Part = {
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          }
          if (p.type === "compaction" && p.tail_start_id) {
            p.tail_start_id = idMap.get(p.tail_start_id)
          }
          yield* updatePart(p)
        }
      }
      return session
    })

    const patch = (sessionID: SessionID, info: Patch) => sync.run(Event.Updated, { sessionID, info })

    const touch = Effect.fn("Session.touch")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() } })
    })

    const setTitle = Effect.fn("Session.setTitle")(function* (input: { sessionID: SessionID; title: string }) {
      yield* patch(input.sessionID, { title: input.title })
    })

    const setArchived = Effect.fn("Session.setArchived")(function* (input: { sessionID: SessionID; time?: number }) {
      if (input.time !== undefined) {
        const info = yield* get(input.sessionID).pipe(Effect.option)
        if (Option.isSome(info)) yield* reviewSessionEnd({ session: info.value }).pipe(Effect.ignore)
      }
      yield* patch(input.sessionID, { time: { archived: input.time } })
    })

    const setPermission = Effect.fn("Session.setPermission")(function* (input: {
      sessionID: SessionID
      permission: Permission.Ruleset
    }) {
      yield* patch(input.sessionID, { permission: input.permission, time: { updated: Date.now() } })
    })

    const setPermissionMode = Effect.fn("Session.setPermissionMode")(function* (input: {
      sessionID: SessionID
      mode: Permission.Mode | undefined
    }) {
      yield* patch(input.sessionID, {
        permissionMode: input.mode,
        time: { updated: Date.now() },
      } as Patch)
    })

    const setTeamMode = Effect.fn("Session.setTeamMode")(function* (input: {
      sessionID: SessionID
      mode: Info["teamMode"]
      teamIDs?: readonly string[]
    }) {
      yield* patch(input.sessionID, {
        // `off` 时同时清空 ID：否则重新打开 selected 会带回已删掉的团队。
        teamMode: input.mode ?? null,
        teamIDs: input.mode === "selected" ? [...(input.teamIDs ?? [])] : null,
        time: { updated: Date.now() },
      } as Patch)
    })

    const setDirectory = Effect.fn("Session.setDirectory")(function* (input: {
      sessionID: SessionID
      directory: string
    }) {
      const next = AppFileSystem.resolve(input.directory)
      // Optional: embedders may compose a session layer without a filesystem.
      // Falling back to Node's own stat keeps `setDirectory` usable there.
      const fs = Option.getOrUndefined(yield* Effect.serviceOption(AppFileSystem.Service))
      const isDir = fs
        ? yield* fs.isDir(next)
        : yield* Effect.promise(() =>
            import("node:fs/promises")
              .then((mod) => mod.stat(next))
              .then((info) => info.isDirectory())
              .catch(() => false),
          )
      if (!isDir) return yield* new DirectoryError({ directory: next, reason: "not a directory" })
      const current = yield* get(input.sessionID)
      if (AppFileSystem.normalizePath(current.directory) === AppFileSystem.normalizePath(next)) return current

      const ctx = yield* InstanceState.context
      yield* patch(input.sessionID, {
        directory: next,
        path: sessionPath(ctx.worktree, next),
        time: { updated: Date.now() },
      } as Patch)

      if (hooks._tag === "Some") {
        yield* hooks.value
          .trigger({
            event: "CwdChanged",
            sessionID: input.sessionID,
            cwd: next,
            metadata: { from: current.directory, to: next },
          })
          .pipe(Effect.ignore)
      }

      return yield* get(input.sessionID)
    })

    const setRevert = Effect.fn("Session.setRevert")(function* (input: {
      sessionID: SessionID
      revert: Info["revert"]
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { summary: input.summary, time: { updated: Date.now() }, revert: input.revert })
    })

    const clearRevert = Effect.fn("Session.clearRevert")(function* (sessionID: SessionID) {
      yield* patch(sessionID, { time: { updated: Date.now() }, revert: null })
    })

    const setSummary = Effect.fn("Session.setSummary")(function* (input: {
      sessionID: SessionID
      summary: Info["summary"]
    }) {
      yield* patch(input.sessionID, { time: { updated: Date.now() }, summary: input.summary })
    })

    const diff = Effect.fn("Session.diff")(function* (sessionID: SessionID) {
      return yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", sessionID])
        .pipe(Effect.orElseSucceed((): Snapshot.FileDiff[] => []))
    })

    const messages: Interface["messages"] = Effect.fn("Session.messages")(function* (input) {
      if (input.limit) {
        return (yield* MessageV2.page({ sessionID: input.sessionID, limit: input.limit })).items
      }

      const size = 50
      const result = [] as MessageV2.WithParts[]
      let before: string | undefined
      while (true) {
        const page = yield* MessageV2.page({ sessionID: input.sessionID, limit: size, before })
        if (page.items.length === 0) break
        for (let i = page.items.length - 1; i >= 0; i--) {
          const item = page.items[i]
          if (item) result.push(item)
        }
        if (!page.more || !page.cursor) break
        before = page.cursor
      }
      return result.reverse()
    })

    const removeMessage = Effect.fn("Session.removeMessage")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
    }) {
      yield* sync.run(MessageV2.Event.Removed, {
        sessionID: input.sessionID,
        messageID: input.messageID,
      })
      return input.messageID
    })

    const removePart = Effect.fn("Session.removePart")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
    }) {
      yield* sync.run(MessageV2.Event.PartRemoved, {
        sessionID: input.sessionID,
        messageID: input.messageID,
        partID: input.partID,
      })
      return input.partID
    })

    const updatePartDelta = Effect.fnUntraced(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      partID: PartID
      field: string
      delta: string
    }) {
      yield* bus.publish(MessageV2.Event.PartDelta, input)
    })

    /** Finds the first message matching the predicate, searching newest-first. */
    const findMessage: Interface["findMessage"] = Effect.fn("Session.findMessage")(function* (sessionID, predicate) {
      const size = 50
      let before: string | undefined
      while (true) {
        const page = yield* MessageV2.page({ sessionID, limit: size, before })
        if (page.items.length === 0) break
        for (let i = page.items.length - 1; i >= 0; i--) {
          const item = page.items[i]
          if (item && predicate(item)) return Option.some(item)
        }
        if (!page.more || !page.cursor) break
        before = page.cursor
      }
      return Option.none<MessageV2.WithParts>()
    })

    return Service.of({
      list,
      create,
      fork,
      touch,
      get,
      setTitle,
      setArchived,
      setPermission,
      setPermissionMode,
      setTeamMode,
      setDirectory,
      setRevert,
      clearRevert,
      setSummary,
      diff,
      messages,
      children,
      remove,
      updateMessage,
      removeMessage,
      removePart,
      updatePart,
      getPart,
      updatePartDelta,
      findMessage,
    })
  }),
)

export const layer: Layer.Layer<
  Service,
  never,
  BackgroundJob.Service | Bus.Service | Storage.Service | SyncEvent.Service | RuntimeFlags.Service
> = rawLayer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(Evolution.layer), Layer.provide(Memory.layer))

export const defaultLayer = layer.pipe(
  Layer.provide(BackgroundJob.defaultLayer),
  Layer.provide(Bus.layer),
  Layer.provide(Storage.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

const cancelBackgroundJobs = Effect.fn("Session.cancelBackgroundJobs")(function* (
  background: BackgroundJob.Interface,
  sessionID: SessionID,
) {
  const jobs = yield* background.list()
  yield* Effect.forEach(
    jobs.filter((job) => {
      if (job.status !== "running") return false
      if (job.id === sessionID) return true
      if (job.metadata?.sessionId === sessionID) return true
      return job.metadata?.parentSessionId === sessionID
    }),
    (job) => background.cancel(job.id),
    { concurrency: "unbounded", discard: true },
  )
})

function* listByProject(
  input: ListInput & {
    projectID: ProjectID
    experimentalWorkspaces: boolean
  },
) {
  const conditions = [eq(SessionTable.project_id, input.projectID)]

  if (input.workspaceID) {
    conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  }
  if (input.path !== undefined) {
    if (input.path) {
      const conds = [eq(SessionTable.path, input.path), like(SessionTable.path, `${input.path}/%`)]

      conditions.push(
        input.directory
          ? or(...conds, and(isNull(SessionTable.path), eq(SessionTable.directory, input.directory))!)!
          : or(...conds)!,
      )
    }
  } else if (input.scope !== "project" && !input.experimentalWorkspaces) {
    if (input.directory) {
      conditions.push(eq(SessionTable.directory, input.directory))
    }
  }
  if (input.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }

  const limit = input.limit ?? 100

  const rows = Database.use((db) =>
    db
      .select()
      .from(SessionTable)
      .where(and(...conditions))
      .orderBy(desc(SessionTable.time_updated))
      .limit(limit)
      .all(),
  )
  for (const row of rows) {
    yield fromRow(row)
  }
}

export function* listGlobal(input?: {
  directory?: string
  roots?: boolean
  start?: number
  cursor?: number
  search?: string
  limit?: number
  archived?: boolean
}) {
  const conditions: SQL[] = []

  if (input?.directory) {
    conditions.push(eq(SessionTable.directory, input.directory))
  }
  if (input?.roots) {
    conditions.push(isNull(SessionTable.parent_id))
  }
  if (input?.start) {
    conditions.push(gte(SessionTable.time_updated, input.start))
  }
  if (input?.cursor) {
    conditions.push(lt(SessionTable.time_updated, input.cursor))
  }
  if (input?.search) {
    conditions.push(like(SessionTable.title, `%${input.search}%`))
  }
  if (input?.archived === true) {
    // archived=true 语义是「只要已归档」。过去只是不再排除已归档，
    // 返回的是新旧混排的全量列表——归档很旧时根本落不进前 N 条，客户端按
    // time.archived 过滤后就是一张空表。
    conditions.push(isNotNull(SessionTable.time_archived))
  } else {
    conditions.push(isNull(SessionTable.time_archived))
  }

  const limit = input?.limit ?? 100

  const rows = Database.use((db) => {
    const query =
      conditions.length > 0
        ? db
            .select()
            .from(SessionTable)
            .where(and(...conditions))
        : db.select().from(SessionTable)
    return query.orderBy(desc(SessionTable.time_updated), desc(SessionTable.id)).limit(limit).all()
  })

  const ids = [...new Set(rows.map((row) => row.project_id))]
  const projects = new Map<string, ProjectInfo>()

  if (ids.length > 0) {
    const items = Database.use((db) =>
      db
        .select({ id: ProjectTable.id, name: ProjectTable.name, worktree: ProjectTable.worktree })
        .from(ProjectTable)
        .where(inArray(ProjectTable.id, ids))
        .all(),
    )
    for (const item of items) {
      projects.set(item.id, {
        id: item.id,
        name: item.name ?? undefined,
        worktree: item.worktree,
      })
    }
  }

  for (const row of rows) {
    const project = projects.get(row.project_id) ?? null
    yield { ...fromRow(row), project }
  }
}

export * as Session from "./session"
