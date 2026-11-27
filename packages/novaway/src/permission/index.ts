import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ConfigPermission } from "@/config/permission"
import { Config } from "@/config/config"
import { Service as HookService } from "@/hook/service"
import { InstanceState } from "@/effect/instance-state"
import { PLAN_WRITE_TOOLS, planFile, planVerdict, planWriteDenial } from "./plan"
import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable, PermissionRequestTable, SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq, inArray, or } from "drizzle-orm"
import * as Log from "@novaway/core/util/log"
import { Wildcard } from "@/util/wildcard"
import { Deferred, Effect, Layer, Option, Schema, Context } from "effect"
import os from "os"
import { evaluate as evalRule } from "./evaluate"
import { PermissionID } from "./schema"
import { classify as classifyAuto, denialAction as autoDenialAction } from "./auto"

const log = Log.create({ service: "permission" })

export const Mode = Schema.Literals([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
  "unattended",
]).annotate({
  identifier: "PermissionMode",
})
export type Mode = Schema.Schema.Type<typeof Mode>

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionAction" })
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "PermissionRule" })
export type Rule = Schema.Schema.Type<typeof Rule>

export const Ruleset = Schema.mutable(Schema.Array(Rule)).annotate({ identifier: "PermissionRuleset" })
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

export class Request extends Schema.Class<Request>("PermissionRequest")({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}) {}

export const Reply = Schema.Literals(["once", "always", "reject"])
export type Reply = Schema.Schema.Type<typeof Reply>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
}

export const ReplyBody = Schema.Struct(reply).annotate({ identifier: "PermissionReplyBody" })
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

export class Approval extends Schema.Class<Approval>("PermissionApproval")({
  projectID: ProjectID,
  patterns: Schema.Array(Schema.String),
}) {}

export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define(
    "permission.replied",
    Schema.Struct({
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply,
    }),
  ),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
  /**
   * 可操作的解释。规则拒绝沿用下面的默认文案；计划模式改用它告诉模型唯一
   * 可写的那一个文件与下一步动作（否则模型只看到"失败"并开始瞎试）。
   */
  reason: Schema.optional(Schema.String),
}) {
  override get message() {
    if (this.reason) return this.reason
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export type Error = DeniedError | RejectedError | CorrectedError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset,
  /**
   * Session-scoped permission mode. When provided it wins over the global
   * `config.permission_mode`, so one session can run in plan mode while the
   * rest of the app stays in default mode.
   */
  mode: Schema.optional(Mode),
}).annotate({ identifier: "PermissionAskInput" })
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
}).annotate({ identifier: "PermissionReplyInput" })
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Ruleset
  /** auto 模式分类器连续拒绝次数,按会话计数。 */
  autoDenials: Map<string, number>
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return evalRule(permission, pattern, ...rulesets)
}

export class Service extends Context.Service<Service, Interface>()("@novaway/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    // Optional: minimal layer stacks (tests, embedders) run without hooks.
    const hooks = Option.getOrUndefined(yield* Effect.serviceOption(HookService))
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
        )
        const durable = Database.use((db) => {
          const sessionIDs = db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(eq(SessionTable.directory, ctx.directory))
            .all()
            .map((session) => session.id)
          return db
            .select()
            .from(PermissionRequestTable)
            .where(
              sessionIDs.length > 0
                ? or(
                    eq(PermissionRequestTable.project_id, ctx.project.id),
                    inArray(PermissionRequestTable.session_id, sessionIDs),
                  )
                : eq(PermissionRequestTable.project_id, ctx.project.id),
            )
            .all()
        })
        const state: State = {
          pending: new Map<PermissionID, PendingEntry>(),
          approved: row?.data ?? [],
          autoDenials: new Map<string, number>(),
        }

        for (const item of durable.filter((item) => item.status === "pending")) {
          const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
          const restored = {
            id: PermissionID.make(item.id),
            sessionID: item.session_id as SessionID,
            permission: item.permission,
            patterns: item.patterns,
            metadata: item.metadata,
            always: item.always,
            ...(item.tool ? { tool: item.tool } : {}),
          }
          const info = Schema.decodeUnknownSync(Request)(restored)
          state.pending.set(PermissionID.make(item.id), {
            info,
            deferred,
          })
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    /**
     * 本次会话计划文件的绝对路径。
     *
     * 只用于拒绝文案：查询失败（旧库、会话尚未落库）就退化成 `undefined`，
     * 由文案回退到"计划目录里的 *.md"—— 拒绝说明不该因为一次查询失败而消失。
     */
    const sessionPlanPath = Effect.fn("Permission.sessionPlanPath")(function* (
      sessionID: SessionID,
      ctx: { directory: string; worktree: string },
    ) {
      const row = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({ slug: SessionTable.slug, created: SessionTable.time_created })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID))
            .get(),
        ),
      ).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!row) return undefined
      return planFile({ slug: row.slug, created: row.created }, ctx)
    })

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending, autoDenials } = yield* InstanceState.get(state)
      const ctx = yield* InstanceState.context
      const { ruleset, mode: requested, ...request } = input

      const cfg = yield* Effect.serviceOption(Config.Service)
      const mode: Mode =
        requested ?? (cfg._tag === "Some" ? ((yield* cfg.value.get()).permission_mode ?? "default") : "default")
      const writeTool = PLAN_WRITE_TOOLS.has(request.permission) || request.permission === "shell"
      // 无人值守：完全不问人（权限这一层和 bypassPermissions 一样直接放行）。
      // 与 bypassPermissions 的差别在"要不要用户拿主意"那一层 —— 提问/评审
      // 由 question / plan_exit / review_document 自己按档位处理。
      if (mode === "unattended") return
      if (mode === "bypassPermissions") return
      if (mode === "acceptEdits" && writeTool) return
      if (request.id) {
        const durable = Database.use((db) =>
          db
            .select()
            .from(PermissionRequestTable)
            .where(eq(PermissionRequestTable.id, String(request.id)))
            .get(),
        )
        if (durable?.status === "approved") return
        if (durable?.status === "rejected") return yield* new RejectedError()
        const existing = pending.get(request.id)
        if (existing) return yield* Deferred.await(existing.deferred)
      }
      if (mode === "plan") {
        // 计划模式是"只读"的**权威裁决者**，必须在规则集之前做出判断。
        //
        // 为什么不能靠规则集：agent 的默认配置文件就是 `"*": "allow"`，只要把判定
        // 交给规则集，计划模式下 `rm -rf src` 会静默执行 —— 这正是线上事故的形态。
        //
        // 判定优先用工具给的绝对路径（`metadata.filepath`）：`patterns` 是相对
        // 「会话目录」算出来的，会话跑在 worktree / 子目录时基准和计划目录
        // （相对 worktree）不一致。已落库的会话还要把写入锁定到**本会话自己的**
        // 计划文件，避免计划模式借机改掉其它会话的计划。
        const sessionPlan = yield* sessionPlanPath(request.sessionID, ctx)
        const verdict = planVerdict({
          permission: request.permission,
          patterns: request.patterns,
          metadata: request.metadata,
          instance: ctx,
          ...(sessionPlan ? { planPath: sessionPlan } : {}),
        })
        if (!verdict.allowed) {
          // 笼统的「失败」会让模型开始瞎试（edit → office_document_edit → bash）。
          // 拒绝时必须说清唯一可写的那一个文件，以及写完要调 plan_exit。
          const reason =
            verdict.kind === "write"
              ? planWriteDenial({
                  planPath: sessionPlan,
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                })
              : verdict.reason
          return yield* new DeniedError({ ruleset, reason })
        }
      }
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          if (hooks) {
            yield* hooks
              .trigger({
                event: "PermissionDenied",
                sessionID: request.sessionID,
                tool: request.permission,
                args: request.metadata,
                error: "denied by rule",
              })
              .pipe(Effect.ignore)
          }
          return yield* new DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      // 自主审批（acceptEdits）开启分类器后,让安全分类器先判断,把「明显安全」从询问里摘掉。
      // 旧档位 "auto" 保留同义行为,供仍写着它的历史会话/配置使用。
      // 分类器不可用/解析失败一律退回询问用户 —— 绝不因为调用失败而放行。
      if (mode === "auto" || mode === "acceptEdits") {
        const auto = cfg._tag === "Some" ? ((yield* cfg.value.get()).permission_auto ?? {}) : {}
        if (auto.classifier) {
          const limit = auto.denial_limit ?? 3
          const previous = autoDenials.get(request.sessionID) ?? 0
          // 连续拒绝达到上限后不再自动拒绝,把决定交回用户,避免分类器把会话锁死。
          if (previous < limit) {
            const ctx = yield* InstanceState.context
            const decision = yield* classifyAuto({
              permission: request.permission,
              patterns: request.patterns,
              metadata: request.metadata,
              cwd: ctx.directory,
            })
            const action = autoDenialAction({ previous, limit, decision })
            if (action === "allow") {
              autoDenials.delete(request.sessionID)
              return
            }
            if (action === "deny" || (action === "ask" && decision?.action === "deny")) {
              const next = previous + 1
              autoDenials.set(request.sessionID, next)
              log.info("auto classifier denied", { sessionID: request.sessionID, count: next, limit })
              if (decision?.action === "deny" && hooks) {
                yield* hooks
                  .trigger({
                    event: "PermissionDenied",
                    sessionID: request.sessionID,
                    tool: request.permission,
                    args: request.metadata,
                    error: `denied by auto classifier: ${decision.reason}`,
                  })
                  .pipe(Effect.ignore)
              }
              if (next < limit && decision?.action === "deny") {
                return yield* Effect.fail(
                  new CorrectedError({
                    feedback: `自动安全分类器拒绝了这次调用:${decision.reason || "未说明原因"}。请改用更安全的方式,或请用户手动确认。`,
                  }),
                )
              }
              log.warn("auto classifier denial limit reached; falling back to user", { limit })
            }
          }
        }
      }

      if (hooks) {
        yield* hooks
          .trigger({
            event: "PermissionRequest",
            sessionID: request.sessionID,
            tool: request.permission,
            args: request.metadata,
          })
          .pipe(Effect.ignore)
        // The agent is now blocked on a human: surface it as a notification so
        // desktop/automation hooks can raise a toast or a push.
        yield* hooks
          .trigger({
            event: "Notification",
            sessionID: request.sessionID,
            tool: request.permission,
            args: request.metadata,
            metadata: { kind: "permission", patterns: request.patterns, mode },
          })
          .pipe(Effect.ignore)
      }

      const id = request.id ?? PermissionID.ascending()
      const info = Schema.decodeUnknownSync(Request)({
        id,
        ...request,
      })
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      Database.use((db) =>
        db
          .insert(PermissionRequestTable)
          .values([
            {
              id: String(id),
              project_id: ctx.project.id,
              session_id: info.sessionID,
              permission: info.permission,
              patterns: [...info.patterns],
              metadata: { ...info.metadata },
              always: [...info.always],
              ...(info.tool ? { tool: info.tool } : {}),
              status: "pending",
              time_created: Date.now(),
              time_updated: Date.now(),
            },
          ])
          .onConflictDoNothing()
          .run(),
      )
      pending.set(id, { info, deferred })
      yield* bus.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return

      pending.delete(input.requestID)
      Database.use((db) =>
        db
          .update(PermissionRequestTable)
          .set({
            status: input.reply === "reject" ? "rejected" : "approved",
            reply: input.reply,
            message: input.message,
            time_updated: Date.now(),
          })
          .where(eq(PermissionRequestTable.id, String(input.requestID)))
          .run(),
      )
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          Database.use((db) =>
            db
              .update(PermissionRequestTable)
              .set({ status: "rejected", reply: "reject", time_updated: Date.now() })
              .where(eq(PermissionRequestTable.id, String(id)))
              .run(),
          )
          yield* bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* bus.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: Ruleset = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

const EDIT_TOOLS = ["edit", "write", "apply_patch"]

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const result = new Set<string>()
  for (const tool of tools) {
    const permission = EDIT_TOOLS.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
    if (!rule) continue
    if (rule.pattern === "*" && rule.action === "deny") result.add(tool)
  }
  return result
}

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Permission from "."
