import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Service as TeamService } from "@/team/team"
import { Service as AgentTaskListService, type TaskStatus } from "@/team/task-list"
import { Service as BackgroundJobService } from "@/background/job"
import { Service as HookService } from "@/hook/service"
import { SessionUsage } from "@/session/usage"
import type { SessionID } from "@/session/schema"
import type { Interface as TeamInterface } from "@/team/team"

const TERMINAL: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"])

/**
 * Resolve the team a tool call should act on.
 *
 * `Team.resolve` scopes name lookups to a root session, which is right for a
 * lead but never matches for a worker (its id is not the root). Falling back to
 * a global lookup and then checking membership keeps "pass the team name" working
 * for every member while still refusing to reach into a team this session is not
 * part of.
 */
function teamResolver(teams: TeamInterface, ctx: Tool.Context, requested?: string) {
  return Effect.gen(function* () {
    if (requested) {
      const scoped = (yield* teams.resolve(requested, ctx.sessionID)) ?? (yield* teams.get(requested))
      if (scoped) return scoped
      const named = yield* teams.resolve(requested)
      if (named) {
        const own = yield* teams.ofSession(ctx.sessionID)
        if (own?.id === named.id) return named
      }
      return undefined
    }
    return yield* teams.ofSession(ctx.sessionID)
  })
}

export const TaskCreateParameters = Schema.Struct({
  subject: Schema.String.annotate({ description: "Short task title" }),
  description: Schema.String.annotate({ description: "What needs to be done" }),
  activeForm: Schema.optional(Schema.String).annotate({ description: "Present continuous form for spinners" }),
  team: Schema.optional(Schema.String).annotate({ description: "Team id or name; defaults to current team" }),
  blockedBy: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Task ids that must complete first",
  }),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const TaskCreateTool = Tool.define<
  typeof TaskCreateParameters,
  { taskID?: string; teamID?: string },
  TeamService | AgentTaskListService | HookService
>(
  "task_create",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const tasks = yield* AgentTaskListService
    const hooks = yield* HookService
    return {
      description:
        "Add an entry to the shared team task board (a coordination list). This does not start an agent or run anything by itself. To execute work in parallel, launch subagents with the task tool (one call per task, different subagent_type); workers then claim board tasks with task_claim.",
      parameters: TaskCreateParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof TaskCreateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const team = yield* teamResolver(teams, ctx, params.team)
          if (!team) {
            return { title: "No team", output: "Create a team first with team_create.", metadata: {} }
          }
          const task = yield* tasks.create({
            teamID: team.id,
            subject: params.subject,
            description: params.description,
            activeForm: params.activeForm,
            metadata: params.metadata,
            createdBy: ctx.sessionID,
            blockedBy: params.blockedBy,
          })
          yield* hooks
            .trigger({
              event: "TaskCreated",
              sessionID: ctx.sessionID,
              cwd: ctx.directory,
              metadata: { taskID: task.id, subject: task.subject, teamID: team.id },
            })
            .pipe(Effect.ignore)
          return {
            title: `Task ${task.id}`,
            output: `Task created on the board: ${task.id} — ${task.subject}. Nothing runs until a subagent is launched with the task tool (or an existing worker claims it).`,
            metadata: { taskID: task.id, teamID: team.id },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TaskListParameters = Schema.Struct({
  team: Schema.optional(Schema.String).annotate({ description: "Team id or name; defaults to current team" }),
  status: Schema.optional(Schema.Literals(["pending", "in_progress", "completed", "failed", "cancelled"])),
})

export const TaskListTool = Tool.define<
  typeof TaskListParameters,
  { teamID?: string },
  TeamService | AgentTaskListService
>(
  "task_list",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const tasks = yield* AgentTaskListService
    return {
      description:
        "List entries on the shared team task board. Owners are sessions that claimed work; an unowned task is not running anywhere. Prefer tasks in id order; workers claim pending, unowned, unblocked tasks.",
      parameters: TaskListParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof TaskListParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const team = yield* teamResolver(teams, ctx, params.team)
          if (!team) return { title: "No team", output: "The current session is not in a team.", metadata: {} }
          const list = yield* tasks.list(team.id)
          const filtered = params.status ? list.filter((task) => task.status === params.status) : list
          if (filtered.length === 0) return { title: "Tasks", output: "No tasks.", metadata: {} }
          const completed = new Set(list.filter((task) => task.status === "completed").map((task) => task.id))
          const output = filtered
            .map((task) => {
              const owner = task.ownerSessionID ? ` owner=${task.ownerSessionID}` : " owner=unassigned"
              const blocked = task.blockedBy.filter((dependency) => !completed.has(dependency))
              return `${task.id} [${task.status}] ${task.subject}${owner}${blocked.length ? ` blockedBy=${blocked.join(",")}` : ""}`
            })
            .join("\n")
          return { title: `Tasks (${filtered.length})`, output, metadata: { teamID: team.id } }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TaskGetParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Task id" }),
})

export const TaskGetTool = Tool.define<typeof TaskGetParameters, { task?: any }, AgentTaskListService>(
  "task_get",
  Effect.gen(function* () {
    const tasks = yield* AgentTaskListService
    return {
      description:
        "Get full details for a team board task including description and dependencies. This is not a subagent: use task_status for sessions launched with the task tool.",
      parameters: TaskGetParameters,
      capabilities: { readOnly: true, concurrencySafe: true },
      execute: (params: Schema.Schema.Type<typeof TaskGetParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const task = yield* tasks.get(params.id)
          if (!task) return { title: "Task not found", output: `No task ${params.id}`, metadata: {} }
          const output = [
            `id: ${task.id}`,
            `subject: ${task.subject}`,
            `status: ${task.status}`,
            `owner: ${task.ownerSessionID ?? "unassigned"}`,
            `blockedBy: ${task.blockedBy.join(", ") || "(none)"}`,
            `blocks: ${task.blocks.join(", ") || "(none)"}`,
            "",
            task.description,
          ].join("\n")
          return { title: `Task ${task.id}`, output, metadata: { task } }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TaskUpdateParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Task id" }),
  status: Schema.optional(Schema.Literals(["pending", "in_progress", "completed", "failed", "cancelled"])),
  subject: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  owner: Schema.optional(Schema.String).annotate({ description: "Session id or agent name to assign" }),
  addBlocks: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  addBlockedBy: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const TaskUpdateTool = Tool.define<
  typeof TaskUpdateParameters,
  { task?: any },
  TeamService | AgentTaskListService | HookService | SessionUsage.Service
>(
  "task_update",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const tasks = yield* AgentTaskListService
    const hooks = yield* HookService
    const usage = yield* SessionUsage.Service
    return {
      description:
        "Update a team board task: status, owner, description, dependencies. Assigning an owner while pending claims the task. Updating the board never launches an agent.",
      parameters: TaskUpdateParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof TaskUpdateParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const current = yield* tasks.get(params.id)
          if (!current) return { title: "Task not found", output: `No task ${params.id}`, metadata: {} }

          let owner: SessionID | null | undefined
          if (params.owner !== undefined) {
            const team = yield* teams.get(current.teamID)
            if (team) {
              const member = yield* teams.member(team.id, params.owner)
              owner = (member?.sessionID ?? params.owner) as SessionID
              if (member) {
                yield* teams.updateMember({
                  teamID: team.id,
                  sessionID: member.sessionID,
                  status: "active",
                  currentTaskID: params.id,
                })
              }
            } else {
              owner = params.owner as SessionID
            }
          }

          // Attribute spend to the task: stamp the owner's session totals when
          // work starts, and store the delta when the task reaches a terminal
          // state. Session rows already carry running totals, so this needs no
          // extra bookkeeping in the message pipeline.
          const nextOwner = owner !== undefined ? (owner ?? undefined) : current.ownerSessionID
          const starting =
            params.owner !== undefined || (params.status === "in_progress" && current.status !== "in_progress")
          const terminal = params.status !== undefined && TERMINAL.has(params.status)
          const usagePatch: Record<string, unknown> = {}
          if (nextOwner && !terminal && starting) {
            const snapshot = yield* usage.get(nextOwner)
            if (snapshot) usagePatch.usageStart = SessionUsage.mark(snapshot)
          }
          if (nextOwner && terminal && !TERMINAL.has(current.status)) {
            const snapshot = yield* usage.get(nextOwner)
            const start = SessionUsage.readMark(current.metadata.usageStart)
            if (snapshot && start) usagePatch.usage = SessionUsage.delta(snapshot, start)
          }

          const next = yield* tasks.update({
            taskID: params.id,
            subject: params.subject,
            description: params.description,
            status: params.status as TaskStatus | undefined,
            ownerSessionID: owner,
            addBlocks: params.addBlocks,
            addBlockedBy: params.addBlockedBy,
            metadata:
              params.metadata || Object.keys(usagePatch).length > 0 ? { ...params.metadata, ...usagePatch } : undefined,
          })
          if (!next) return { title: "Task not found", output: `No task ${params.id}`, metadata: {} }

          if (params.status && (params.status === "completed" || params.status === "cancelled")) {
            yield* hooks
              .trigger({
                event: "TaskCompleted",
                sessionID: ctx.sessionID,
                cwd: ctx.directory,
                metadata: { taskID: next.id, subject: next.subject, status: params.status },
              })
              .pipe(Effect.ignore)
            const team = yield* teams.get(next.teamID)
            if (team && next.ownerSessionID) {
              yield* teams.updateMember({
                teamID: team.id,
                sessionID: next.ownerSessionID,
                status: "idle",
                currentTaskID: null,
              })
              yield* hooks
                .trigger({
                  event: "TeammateIdle",
                  sessionID: next.ownerSessionID,
                  cwd: ctx.directory,
                  metadata: { taskID: next.id, subject: next.subject, status: params.status, teamID: team.id },
                })
                .pipe(Effect.ignore)
            }
          }

          const boardTeam = yield* teams.get(next.teamID)
          const leadOnly = boardTeam?.rootSessionID === ctx.sessionID
          return {
            title: `Task ${next.id}`,
            output:
              params.owner !== undefined
                ? `Task updated: ${next.id} [${next.status}] ${next.subject}. Assigned to ${params.owner}; assigning does not start that agent — use the task tool to launch it, or agent_message to resume an idle session.`
                : leadOnly && params.status === "in_progress"
                  ? `Task updated: ${next.id} [${next.status}] ${next.subject}. Marking a task in_progress only changes the board; no agent is running it. Launch the work with the task tool.`
                  : `Task updated: ${next.id} [${next.status}] ${next.subject}`,
            metadata: { task: next },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TaskClaimParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "Task id to claim" }),
})

export const TaskClaimTool = Tool.define<
  typeof TaskClaimParameters,
  { task?: any },
  TeamService | AgentTaskListService | SessionUsage.Service
>(
  "task_claim",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const tasks = yield* AgentTaskListService
    const usage = yield* SessionUsage.Service
    return {
      description:
        "Claim a pending, unowned, unblocked board task for the current session. This only marks the task in_progress for this session; it does not launch a new agent. The caller is expected to do the work itself or delegate it with the task tool.",
      parameters: TaskClaimParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof TaskClaimParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // 主代理（团队 lead）claim 任务只会把看板状态改成 in_progress，
          // 不会派生任何子代理。以前它这样“认领”完 3 个任务就以为在并行执行，
          // 右侧面板却只有 lead。让 lead 明确去用 task 派发子代理。
          const existing = yield* tasks.get(params.id)
          if (existing) {
            const owner = yield* teams.get(existing.teamID)
            if (owner && owner.rootSessionID === ctx.sessionID) {
              return {
                title: "Delegate instead",
                output:
                  "The team lead cannot claim board tasks: claiming only changes bookkeeping and starts no agent. Launch the work with the task tool (one call per subagent, use different subagent_type values for different AI employees); the worker claims its own task when it starts.",
                metadata: {},
              }
            }
          }

          const task = yield* tasks.claim({ taskID: params.id, sessionID: ctx.sessionID })
          if (!task) {
            return {
              title: "Claim failed",
              output: `Task ${params.id} is not claimable (already owned, not pending, or blocked).`,
              metadata: {},
            }
          }
          const team = yield* teams.get(task.teamID)
          if (team) {
            yield* teams.updateMember({
              teamID: team.id,
              sessionID: ctx.sessionID,
              status: "active",
              currentTaskID: task.id,
            })
          }
          // Remember where the owner's meter stood so `task_update` can report
          // the spend for this task alone rather than the whole session.
          const snapshot = yield* usage.get(ctx.sessionID)
          if (snapshot) {
            yield* tasks.update({ taskID: task.id, metadata: { usageStart: SessionUsage.mark(snapshot) } })
          }
          return {
            title: `Claimed ${task.id}`,
            output: `Claimed task ${task.id}: ${task.subject}. The task is now in_progress for this session; no new agent was launched.`,
            metadata: { task },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TaskWaitParameters = Schema.Struct({
  task: Schema.optional(Schema.String).annotate({
    description: "Task id to wait for; omit to wait for any claimable work",
  }),
  team: Schema.optional(Schema.String).annotate({ description: "Team id or name; defaults to current team" }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "Seconds to wait before returning the board as-is (default 60, clamped to 1..600)",
  }),
})
export type TaskWaitParameters = Schema.Schema.Type<typeof TaskWaitParameters>

const WAIT_DEFAULT_TIMEOUT = 60
const WAIT_MAX_TIMEOUT = 600
const WAIT_INTERVAL = "250 millis"

const clampSeconds = (value: number | undefined) =>
  Math.min(Math.max(Math.round(value ?? WAIT_DEFAULT_TIMEOUT), 1), WAIT_MAX_TIMEOUT)

/**
 * Block until the shared board changes instead of polling it by hand.
 *
 * A coordinator that has handed out all ready work needs to know when a task
 * finishes or a blocked task becomes claimable. Spinning on `task_list` burns
 * a full model round each time; this waits inside a single tool call.
 */
export const TaskWaitTool = Tool.define<
  typeof TaskWaitParameters,
  { taskID?: string; ready?: number; timedOut?: boolean },
  TeamService | AgentTaskListService
>(
  "task_wait",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const tasks = yield* AgentTaskListService
    return {
      description:
        "Wait for team board progress: a specific board task to finish, or any unowned pending task to become claimable. Returns early when the condition is already met. Waiting does not execute anything.",
      parameters: TaskWaitParameters,
      capabilities: { readOnly: true, concurrencySafe: true, interrupt: "cancel" },
      execute: (params: TaskWaitParameters, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const timeout = clampSeconds(params.timeout)
          const deadline = Date.now() + timeout * 1000

          if (params.task) {
            const initial = yield* tasks.get(params.task)
            if (!initial) return { title: "Task not found", output: `No task ${params.task}`, metadata: {} }
            let current = initial
            while (!TERMINAL.has(current.status) && Date.now() < deadline) {
              yield* Effect.sleep(WAIT_INTERVAL)
              current = (yield* tasks.get(params.task)) ?? current
            }
            // A pending, unowned task is not "running": nothing is executing it.
            // Saying "still running" here made waiters believe the board itself
            // was doing work (no subagent had ever been launched).
            const state = TERMINAL.has(current.status)
              ? current.status
              : current.status === "in_progress"
                ? "still in progress"
                : "not started"
            const usage = SessionUsage.readMark(current.metadata.usage)
            return {
              title: `Task ${current.id} ${state}`,
              output: [
                `Task ${current.id} — ${state}`,
                `subject: ${current.subject}`,
                `owner: ${current.ownerSessionID ?? "unassigned"}`,
                ...(current.ownerSessionID || TERMINAL.has(current.status)
                  ? []
                  : ["note: no session is working on this task until a subagent claims it"]),
                ...(usage ? [`spent: $${usage.cost.toFixed(4)} · ${usage.tokens.total} tokens`] : []),
              ].join("\n"),
              metadata: { taskID: current.id, timedOut: !TERMINAL.has(current.status) },
            }
          }

          const team = yield* teamResolver(teams, ctx, params.team)
          if (!team) return { title: "No team", output: "The current session is not in a team.", metadata: {} }

          let list = yield* tasks.list(team.id)
          let ready = yield* tasks.ready(team.id)
          while (ready.length === 0 && list.some((task) => !TERMINAL.has(task.status)) && Date.now() < deadline) {
            yield* Effect.sleep(WAIT_INTERVAL)
            list = yield* tasks.list(team.id)
            ready = yield* tasks.ready(team.id)
          }

          if (ready.length === 0) {
            const open = list.filter((task) => !TERMINAL.has(task.status))
            const timedOut = open.length > 0
            return {
              title: timedOut ? "No claimable work yet" : "Board is empty",
              output:
                open.length === 0
                  ? "Every task on the board is finished."
                  : [
                      `No claimable task after ${timeout}s. Still open:`,
                      ...open.map(
                        (task) =>
                          `${task.id} [${task.status}] ${task.subject}${
                            task.ownerSessionID ? ` owner=${task.ownerSessionID}` : " owner=unassigned"
                          }${task.blockedBy.length ? ` blockedBy=${task.blockedBy.join(",")}` : ""}`,
                      ),
                    ].join("\n"),
              metadata: { ready: 0, timedOut },
            }
          }

          return {
            title: `${ready.length} task(s) ready`,
            output: ready.map((task) => `${task.id} ${task.subject}`).join("\n"),
            metadata: { ready: ready.length, timedOut: false },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const TaskStopParameters = Schema.Struct({
  session: Schema.String.annotate({ description: "Subagent session id to stop" }),
})

export const TaskStopTool = Tool.define<
  typeof TaskStopParameters,
  { job?: any },
  TeamService | BackgroundJobService | HookService
>(
  "task_stop",
  Effect.gen(function* () {
    const teams = yield* TeamService
    const background = yield* BackgroundJobService
    const hooks = yield* HookService
    return {
      description: "Stop a running background subagent by its session id.",
      parameters: TaskStopParameters,
      capabilities: { concurrencySafe: false },
      execute: (params: Schema.Schema.Type<typeof TaskStopParameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const job = yield* background.cancel(params.session)
          const team = yield* teams.ofSession(ctx.sessionID)
          if (team) {
            yield* teams.updateMember({
              teamID: team.id,
              sessionID: params.session as SessionID,
              status: "idle",
              currentTaskID: null,
            })
            yield* hooks
              .trigger({
                event: "TeammateIdle",
                sessionID: params.session as SessionID,
                cwd: ctx.directory,
                metadata: { teamID: team.id, stopped: params.session },
              })
              .pipe(Effect.ignore)
          }
          if (job) {
            return { title: "Stopped", output: `Stopped ${params.session} (${job.status}).`, metadata: { job } }
          }
          return { title: "Not running", output: `${params.session} is not running in this process.`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)
