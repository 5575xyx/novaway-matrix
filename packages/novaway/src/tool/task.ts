import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { SessionStatus } from "@/session/status"
import { Config } from "@/config/config"
import { TuiEvent } from "@/server/tui-event"
import { Cause, Effect, Exit, Option, Schema, Scope } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Service as TeamService } from "@/team/team"
import { Service as TeamOpLogService } from "@/team/op-log"
import { Service as HookService, defaultLayer as HookLayer } from "@/hook/service"
import { create as createWorktree } from "./worktree-helper"
import { GlobalBus } from "@/bus/global"
import { BusEvent } from "@/bus/bus-event"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
  loop(input: SessionPrompt.LoopInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "",
  "",
  [
    "Background mode: background=true launches the subagent asynchronously.",
    "Use task_status(task_id=..., wait=false) to poll, or wait=true to block until done.",
  ].join(" "),
].join("\n")

const BaseParameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  background: Schema.optional(Schema.Boolean).annotate({
    description: "When true, launch the subagent in the background and return immediately",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Addressable name for this agent, used by agent_message and the task board",
  }),
  team: Schema.optional(Schema.String).annotate({
    description: "Team id or name; defaults to the current session team",
  }),
  isolation: Schema.optional(Schema.Literals(["worktree"])).annotate({
    description: "Run the agent in an isolated git worktree",
  }),
  model: Schema.optional(Schema.String).annotate({
    description: "Model override, formatted as provider/model",
  }),
  fork: Schema.optional(Schema.Boolean).annotate({
    description:
      "Fork the current conversation into the subagent: it inherits the parent transcript and shares the prompt cache prefix",
  }),
})

/**
 * Fork marker.
 *
 * A forked child inherits the parent transcript so the API request prefix stays
 * byte-identical to the parent's and the provider prompt cache can be reused.
 * The marker is injected with the directive and re-checked on every fork
 * attempt: a fork child must never fork again.
 */
export const FORK_MARKER = "[fork-worker]"

/** Constant tool result used for the forking `task` call in every fork child. */
const FORK_PLACEHOLDER = "Fork started -- processing in background"

function forkDirective(prompt: string) {
  return [
    FORK_MARKER,
    "You are a forked worker process. You are NOT the main agent.",
    "Do not spawn sub-agents. Do not ask questions. Execute directly and report once.",
    "",
    prompt,
  ].join(String.fromCharCode(10))
}

function output(sessionID: SessionID, text: string) {
  return [
    `task_id: ${sessionID} (for resuming to continue this task if needed)`,
    "",
    "<task_result>",
    text,
    "</task_result>",
  ].join("\n")
}

function backgroundOutput(sessionID: SessionID) {
  return [
    `task_id: ${sessionID} (for polling this task with task_status)`,
    "state: running",
    "",
    "<task_result>",
    "Background task started. Continue your current work and call task_status when you need the result.",
    "</task_result>",
  ].join("\n")
}

export const AgentEvent = {
  Started: BusEvent.define(
    "agent.started",
    Schema.Struct({
      sessionID: Schema.String,
      parentSessionID: Schema.String,
      name: Schema.optional(Schema.String),
      agent: Schema.String,
      worktree: Schema.optional(Schema.String),
    }),
  ),
  Completed: BusEvent.define(
    "agent.completed",
    Schema.Struct({
      sessionID: Schema.String,
      parentSessionID: Schema.String,
      name: Schema.optional(Schema.String),
      agent: Schema.String,
      state: Schema.Literals(["completed", "error", "cancelled"]),
      tokens: Schema.optional(Schema.Number),
      durationMs: Schema.optional(Schema.Number),
      worktree: Schema.optional(Schema.String),
    }),
  ),
}

function backgroundMessage(input: {
  sessionID: SessionID
  description: string
  name?: string
  state: "completed" | "error"
  text: string
  tokens?: number
  durationMs?: number
  worktree?: string
}) {
  const title =
    input.state === "completed"
      ? `Background task completed: ${input.description}`
      : `Background task failed: ${input.description}`
  return [
    "<task-notification>",
    `<task-id>${input.sessionID}</task-id>`,
    ...(input.name ? [`<name>${input.name}</name>`] : []),
    `<status>${input.state === "completed" ? "completed" : "failed"}</status>`,
    `<summary>${title}</summary>`,
    "<result>",
    input.text,
    "</result>",
    ...(input.tokens !== undefined || input.durationMs !== undefined
      ? [
          "<usage>",
          ...(input.tokens !== undefined ? [`<total_tokens>${input.tokens}</total_tokens>`] : []),
          ...(input.durationMs !== undefined ? [`<duration_ms>${input.durationMs}</duration_ms>`] : []),
          "</usage>",
        ]
      : []),
    ...(input.worktree ? [`<worktree><path>${input.worktree}</path></worktree>`] : []),
    "</task-notification>",
  ].join(String.fromCharCode(10))
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const flags = yield* RuntimeFlags.Service
    const teams = yield* TeamService
    const hooks = yield* HookService

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      // 后台并行开关:配置 experimental.background_subagents 优先(可被 /后台并行 命令切换并持久化),
      // 未设置时回退到运行时 flag(默认开)。
      const bgEnabled = cfg.experimental?.background_subagents ?? flags.experimentalBackgroundSubagents
      const runInBackground = params.background === true
      if (runInBackground && !bgEnabled) {
        return yield* Effect.fail(
          new Error("后台子代理已被禁用。用 /后台并行 命令开启,或设置 experimental.background_subagents=true。"),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const taskID = params.task_id
      const forkMode = params.fork === true && !taskID
      const parentSession = yield* sessions.get(ctx.sessionID)
      if (forkMode) {
        // Guard against recursive forking: a fork child carries the marker in
        // its inherited transcript.
        const history = yield* sessions
          .messages({ sessionID: ctx.sessionID })
          .pipe(Effect.catchCause(() => Effect.succeed([] as MessageV2.WithParts[])))
        const nested = history.some((message) =>
          message.parts.some(
            (part) => part.type === "text" && typeof part.text === "string" && part.text.includes(FORK_MARKER),
          ),
        )
        if (nested) {
          return yield* Effect.fail(new Error("This agent is already a fork and cannot fork again."))
        }
      }

      // A fork inherits the parent's agent (and therefore the parent's system
      // prompt and tool pool). Using a different agent would change the prompt
      // prefix and defeat the cache sharing that makes forks cheap.
      const agentName = forkMode ? (parentSession.agent ?? ctx.agent) : params.subagent_type
      const next = yield* agent.get(agentName)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${agentName} is not a valid agent type`))
      }

      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = parentSession
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const isolation = params.isolation ?? next.isolation
      const isolated =
        isolation === "worktree"
          ? yield* Effect.promise(() =>
              createWorktree(ctx.directory ?? parent.directory, `${next.name}-${params.description}`),
            ).pipe(Effect.catch(() => Effect.succeed(undefined)))
          : undefined

      // A fork keeps the parent's permissions (and therefore its exact tool
      // pool). Narrowing them would change the tools block in the request and
      // break the shared prefix; recursion is handled by FORK_MARKER instead.
      const forked = forkMode
        ? yield* sessions
            .fork({
              // Copy the entire transcript, including the assistant message that
              // is currently running this tool. The child then sees the same
              // prefix the parent saw, so the provider prompt cache is reused.
              sessionID: ctx.sessionID,
              parentID: ctx.sessionID,
              title: params.description + ` (@${next.name} fork)`,
              agent: next.name,
              permission: parent.permission ?? [],
              ...(parent.permissionMode ? { permissionMode: parent.permissionMode } : {}),
            })
            .pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined

      const nextSession =
        session ??
        forked ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          ...(isolated ? { directory: isolated.directory } : {}),
          // Agent declaration wins; otherwise inherit the parent's mode so a
          // plan-mode session cannot silently spawn an editing subagent.
          ...(next.permissionMode || parent.permissionMode
            ? { permissionMode: next.permissionMode ?? parent.permissionMode }
            : {}),
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      // Turn the inherited `task` tool call into a completed placeholder. Every
      // fork child therefore sends the same tool_result bytes for that call,
      // which is what keeps sibling forks on the same cached prefix.
      if (forked && ctx.callID) {
        const messages = yield* sessions
          .messages({ sessionID: forked.id })
          .pipe(Effect.catchCause(() => Effect.succeed([] as MessageV2.WithParts[])))
        const now = Date.now()
        for (const message of messages) {
          for (const part of message.parts) {
            if (part.type !== "tool" || part.tool !== id || part.callID !== ctx.callID) continue
            const input = typeof part.state.input === "object" && part.state.input ? part.state.input : {}
            yield* sessions
              .updatePart({
                ...part,
                state: {
                  status: "completed",
                  input,
                  output: FORK_PLACEHOLDER,
                  title: params.description,
                  metadata: { fork: true, childSessionID: forked.id },
                  time: {
                    start: "time" in part.state ? part.state.time.start : now,
                    end: now,
                  },
                },
              })
              .pipe(Effect.ignore)
          }
        }
      }

      // 编排策略随人走：子代理没有自己的坐标，但它是「替谁干活」才有的调用，
      // 必须继承父会话的运行坐标与策略，否则 readOnly 运行里的 task 会成为后门。
      const teamOps = Option.getOrUndefined(yield* Effect.serviceOption(TeamOpLogService))
      if (teamOps) {
        const scope = yield* teamOps.scopeOf(ctx.sessionID)
        if (scope) yield* teamOps.scope({ sessionID: nextSession.id, ...scope })
      }

      const resolvedTeam =
        (params.team ? yield* teams.resolve(params.team, ctx.sessionID) : undefined) ??
        (yield* teams.ofSession(ctx.sessionID))
      // Normal use should still surface subagent work in the team panel: when a
      // root session spawns its first worker without calling team_create, create
      // one automatically. `ensure` is atomic so parallel spawns share it.
      const team =
        resolvedTeam ??
        (!parentSession.parentID
          ? yield* teams.ensure({ rootSessionID: ctx.sessionID, name: "自动团队", agent: ctx.agent })
          : undefined)
      if (team) {
        const preferred = params.name ?? `${next.name}-${nextSession.id.slice(-4)}`
        // Names address members (agent_message); keep them unique per team.
        const clash = yield* teams.member(team.id, preferred).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        yield* teams.addMember({
          teamID: team.id,
          sessionID: nextSession.id,
          name: clash && clash.sessionID !== nextSession.id ? `${preferred} #${nextSession.id.slice(-4)}` : preferred,
          agent: next.name,
          role: "worker",
          worktreePath: isolated?.directory,
        })
      }

      const markMember = (status: "active" | "idle") =>
        team
          ? teams.updateMember({ teamID: team.id, sessionID: nextSession.id, status }).pipe(Effect.ignore)
          : Effect.void

      yield* hooks
        .trigger({
          event: "SubagentStart",
          sessionID: nextSession.id,
          cwd: nextSession.directory,
          tool: id,
          args: { agent: next.name, name: params.name, prompt: params.prompt },
        })
        .pipe(Effect.ignore)

      yield* bus
        .publish(AgentEvent.Started, {
          sessionID: nextSession.id,
          parentSessionID: ctx.sessionID,
          name: params.name,
          agent: next.name,
          worktree: isolated?.directory,
        })
        .pipe(Effect.ignore)

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(Effect.orDie)
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: nextSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(forkMode ? forkDirective(params.prompt) : params.prompt)
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          agent: next.name,
          // Forks send no overrides: the tool pool must match the parent's for
          // the request prefix (and therefore the cache) to line up.
          ...(forkMode
            ? {}
            : {
                tools: {
                  ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
                  ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
              }),
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const resumeWhenIdle: (input: { userID: MessageID; state: "completed" | "error" }) => Effect.Effect<void> =
        Effect.fn("TaskTool.resumeWhenIdle")(function* (input: { userID: MessageID; state: "completed" | "error" }) {
          const latest = yield* sessions
            .findMessage(ctx.sessionID, (item) => item.info.role === "user")
            .pipe(Effect.orDie)
          if (Option.isNone(latest)) return
          if (latest.value.info.id !== input.userID) return
          if ((yield* status.get(ctx.sessionID)).type !== "idle") {
            yield* Effect.sleep("300 millis")
            return yield* resumeWhenIdle(input)
          }
          yield* bus.publish(TuiEvent.ToastShow, {
            title: input.state === "completed" ? "Background task complete" : "Background task failed",
            message:
              input.state === "completed"
                ? `Background task "${params.description}" finished. Resuming the main thread.`
                : `Background task "${params.description}" failed. Resuming the main thread.`,
            variant: input.state === "completed" ? "success" : "error",
            duration: 5000,
          })
          yield* ops
            .loop({ sessionID: ctx.sessionID })
            .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
        })

      const continueIfIdle = Effect.fn("TaskTool.continueIfIdle")(function* (input: {
        userID: MessageID
        state: "completed" | "error"
      }) {
        yield* resumeWhenIdle(input).pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        const message = yield* ops.prompt({
          sessionID: ctx.sessionID,
          noReply: true,
          agent: currentParent.agent ?? ctx.agent,
          parts: [
            {
              type: "text",
              synthetic: true,
              text: backgroundMessage({
                sessionID: nextSession.id,
                description: params.description,
                name: params.name,
                state,
                text,
                worktree: isolated?.directory,
              }),
            },
          ],
        })
        yield* hooks
          .trigger({
            event: "SubagentStop",
            sessionID: nextSession.id,
            cwd: nextSession.directory,
            tool: id,
            result: text,
          })
          .pipe(Effect.ignore)

        yield* bus
          .publish(AgentEvent.Completed, {
            sessionID: nextSession.id,
            parentSessionID: ctx.sessionID,
            name: params.name,
            agent: next.name,
            state: state === "completed" ? "completed" : "error",
            worktree: isolated?.directory,
          })
          .pipe(Effect.ignore)
        yield* continueIfIdle({ userID: message.info.id, state })
      })

      const existing = yield* background.get(nextSession.id)
      if (existing?.status === "running") {
        return yield* Effect.fail(
          new Error(`Task ${nextSession.id} is already running. Use task_status to check progress.`),
        )
      }

      if (runInBackground) {
        const info = yield* background.start({
          id: nextSession.id,
          type: id,
          title: params.description,
          metadata,
          // 必须显式传 cancel：runTask 里的 ops.prompt 把这一轮 run fork 进
          // SessionRunState 的实例级 scope，不在本 job 的 fiber 树里。只靠
          // BackgroundJob.cancel 打断 job fiber 只会打断「等待者」，
          // 子会话自己还会继续跑、继续往会话里写消息。
          cancel: ops.cancel(nextSession.id),
          run: markMember("active").pipe(
            Effect.andThen(runTask()),
            Effect.tap((text) => inject("completed", text).pipe(Effect.ignore)),
            Effect.catchCause((cause) =>
              (Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : inject("error", errorText(Cause.squash(cause))).pipe(Effect.ignore)
              ).pipe(Effect.andThen(Effect.failCause(cause))),
            ),
            Effect.ensuring(markMember("idle")),
          ),
        })

        return {
          title: params.description,
          metadata: {
            ...metadata,
            jobId: info.id,
          },
          output: backgroundOutput(nextSession.id),
        }
      }

      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const text = yield* markMember("active").pipe(
              Effect.andThen(runTask()),
              Effect.ensuring(markMember("idle")),
            )
            return {
              title: params.description,
              metadata,
              output: output(nextSession.id, text),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents ? DESCRIPTION + BACKGROUND_DESCRIPTION : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
