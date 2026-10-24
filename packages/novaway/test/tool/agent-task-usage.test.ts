import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { Service as TaskListService, defaultLayer as TaskListLayer } from "@/team/task-list"
import { defaultLayer as HookLayer } from "@/hook/service"
import { defaultLayer as TruncateLayer } from "@/tool/truncate"
import { defaultLayer as AgentLayer } from "@/agent/agent"
import { SessionUsage } from "@/session/usage"
import { TaskClaimTool, TaskUpdateTool, TaskWaitTool } from "@/tool/agent_task"
import * as Tool from "@/tool/tool"
import { SessionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { MessageID, SessionID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(TeamLayer, TaskListLayer, HookLayer, SessionUsage.defaultLayer, TruncateLayer, AgentLayer) as never,
)

const makeSession = (id: SessionID, parentID?: SessionID) =>
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    yield* Effect.sync(() =>
      Database.use((db) => {
        db.delete(SessionTable).where(eq(SessionTable.id, id)).run()
        db.insert(SessionTable)
          .values({
            id,
            parent_id: parentID ?? null,
            project_id: ctx.project.id,
            slug: id.toLowerCase(),
            directory: ctx.directory,
            title: id,
            version: "1.0.0",
            agent: "build",
          })
          .run()
      }),
    )
  })

const spend = (id: SessionID, cost: number, input: number, output: number) =>
  Effect.sync(() =>
    Database.use((db) =>
      db
        .update(SessionTable)
        .set({ cost, tokens_input: input, tokens_output: output })
        .where(eq(SessionTable.id, id))
        .run(),
    ),
  )

const context = (sessionID: SessionID, directory: string): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_agent_task"),
  agent: "build",
  directory,
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("task cost attribution", () => {
  it.instance("claim stamps a baseline and completion records the delta", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const root = SessionID.make("ses_task_root_1")
      const worker = SessionID.make("ses_task_worker_1")
      yield* makeSession(root)
      yield* makeSession(worker)

      const team = yield* teams.create({ name: "usage", rootSessionID: root })
      yield* teams.addMember({ teamID: team.id, sessionID: worker, name: "worker", agent: "build" })
      const created = yield* tasks.create({ teamID: team.id, subject: "work", description: "do it" })

      const claim = yield* (yield* TaskClaimTool).init()
      yield* claim.execute({ id: created.id }, context(worker, ctx.directory))

      const claimed = yield* tasks.get(created.id)
      expect(claimed?.status).toBe("in_progress")
      expect(claimed?.ownerSessionID).toBe(worker)
      const start = SessionUsage.readMark(claimed?.metadata.usageStart)
      expect(start?.cost).toBe(0)
      expect(start?.tokens.total).toBe(0)

      // The worker chews through tokens while the task is in flight.
      yield* spend(worker, 0.5, 100, 10)
      const update = yield* (yield* TaskUpdateTool).init()
      yield* update.execute({ id: created.id, status: "completed" }, context(worker, ctx.directory))

      const done = yield* tasks.get(created.id)
      const usage = SessionUsage.readMark(done?.metadata.usage)
      expect(usage?.cost).toBeCloseTo(0.5)
      expect(usage?.tokens.total).toBe(110)
      // Terminal work releases the member back to the pool.
      const member = yield* teams.member(team.id, "worker")
      expect(member?.status).toBe("idle")
      expect(member?.currentTaskID).toBeUndefined()
    }),
  )

  it.instance("tasks without a baseline are not guessed", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const root = SessionID.make("ses_task_root_2")
      const worker = SessionID.make("ses_task_worker_2")
      yield* makeSession(root)
      yield* makeSession(worker)
      const team = yield* teams.create({ name: "usage-2", rootSessionID: root })
      const created = yield* tasks.create({ teamID: team.id, subject: "legacy", description: "no baseline" })
      yield* tasks.update({ taskID: created.id, status: "in_progress", ownerSessionID: worker })
      yield* spend(worker, 2, 500, 50)

      const update = yield* (yield* TaskUpdateTool).init()
      yield* update.execute({ id: created.id, status: "completed" }, context(worker, ctx.directory))

      const done = yield* tasks.get(created.id)
      expect(SessionUsage.readMark(done?.metadata.usage)).toBeUndefined()
    }),
  )
})

describe("task_wait", () => {
  it.instance("returns immediately when a task is already finished", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const root = SessionID.make("ses_wait_root_1")
      const worker = SessionID.make("ses_wait_worker_1")
      yield* makeSession(root)
      yield* makeSession(worker)
      const team = yield* teams.create({ name: "wait-1", rootSessionID: root })
      const task = yield* tasks.create({ teamID: team.id, subject: "done already", description: "" })
      yield* tasks.update({ taskID: task.id, status: "completed" })

      const wait = yield* (yield* TaskWaitTool).init()
      const result = yield* wait.execute({ task: task.id, timeout: 5 }, context(worker, ctx.directory))
      expect(result.title).toContain("completed")
      expect(result.metadata.timedOut).toBe(false)
    }),
  )

  it.instance("wakes when a blocked task becomes claimable", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const root = SessionID.make("ses_wait_root_2")
      const worker = SessionID.make("ses_wait_worker_2")
      yield* makeSession(root)
      yield* makeSession(worker)
      const team = yield* teams.create({ name: "wait-2", rootSessionID: root })
      yield* teams.addMember({ teamID: team.id, sessionID: worker, name: "worker", agent: "build" })
      const first = yield* tasks.create({ teamID: team.id, subject: "first", description: "" })
      yield* tasks.create({ teamID: team.id, subject: "second", description: "", blockedBy: [first.id] })
      yield* tasks.update({ taskID: first.id, status: "in_progress" })

      const wait = yield* (yield* TaskWaitTool).init()
      const waiting = yield* Effect.forkChild(
        wait.execute({ team: "wait-2", timeout: 10 }, context(worker, ctx.directory)),
      )
      yield* Effect.sleep("400 millis")
      yield* tasks.update({ taskID: first.id, status: "completed" })

      const result = yield* Fiber.join(waiting)
      expect(result.title).toBe("1 task(s) ready")
      expect(result.output).toContain("second")
    }),
  )

  it.instance("times out with a board summary instead of hanging", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const root = SessionID.make("ses_wait_root_3")
      const worker = SessionID.make("ses_wait_worker_3")
      yield* makeSession(root)
      yield* makeSession(worker)
      const team = yield* teams.create({ name: "wait-3", rootSessionID: root })
      yield* teams.addMember({ teamID: team.id, sessionID: worker, name: "worker", agent: "build" })
      const task = yield* tasks.create({ teamID: team.id, subject: "stuck", description: "" })
      yield* tasks.update({ taskID: task.id, status: "in_progress", ownerSessionID: worker })

      const wait = yield* (yield* TaskWaitTool).init()
      const result = yield* wait.execute({ team: "wait-3", timeout: 1 }, context(worker, ctx.directory))
      expect(result.title).toBe("No claimable work yet")
      expect(result.metadata.timedOut).toBe(true)
      expect(result.output).toContain("in_progress")
    }),
  )
})

// 回归：lead 用 task_claim 把看板任务标成 in_progress 后，会误以为任务真的在
// 并行执行（右侧面板却只有 lead）。claim 必须把 lead 引导回 task 工具。
describe("board guardrails", () => {
  it.instance("the team lead cannot claim a board task", () =>
    Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const root = SessionID.make("ses_guard_root")
      yield* makeSession(root)
      const team = yield* teams.create({ name: "guard", rootSessionID: root })
      const task = yield* tasks.create({ teamID: team.id, subject: "parallel work", description: "" })

      const claim = yield* (yield* TaskClaimTool).init()
      const result = yield* claim.execute({ id: task.id }, context(root, ctx.directory))

      expect(result.title).toBe("Delegate instead")
      expect(result.output).toContain("task tool")
      expect(result.output).toContain("starts no agent")
      const untouched = yield* tasks.get(task.id)
      expect(untouched?.status).toBe("pending")
      expect(untouched?.ownerSessionID).toBeUndefined()
    }),
  )
})
