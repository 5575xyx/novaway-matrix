import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AgentMessageTool } from "../../src/tool/agent_message"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { Service as MailboxService, defaultLayer as MailboxLayer } from "@/team/mailbox"
import { Service as BackgroundJobService, defaultLayer as BackgroundLayer } from "@/background/job"
import { SessionID, MessageID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { defaultLayer as PlanApprovalLayer, Service as PlanApprovalService } from "@/session/plan-approval"
import { Agent } from "@/agent/agent"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    TeamLayer,
    MailboxLayer,
    BackgroundLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    PlanApprovalLayer,
  ),
)

const sender = SessionID.make("ses_sender")
const target = SessionID.make("ses_target")

const ctx = (): any => ({
  sessionID: sender,
  messageID: MessageID.make("msg_test"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("agent_message tool", () => {
  it.instance("queues a message for a running agent without cancelling it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJobService
      const mailbox = yield* MailboxService
      const gate = yield* Deferred.make<void>()
      yield* jobs.start({
        id: target,
        type: "task",
        title: "running worker",
        run: Deferred.await(gate).pipe(Effect.as("done")),
      })

      const tool = yield* AgentMessageTool
      const def = yield* tool.init()
      const result = yield* def.execute({ to: target, message: "check the build" }, ctx())

      expect(result.metadata.state).toBe("queued")
      const pending = yield* mailbox.list(target)
      expect(pending.map((item) => item.content)).toContain("check the build")

      const job = yield* jobs.get(target)
      expect(job?.status).toBe("running")

      yield* Deferred.succeed(gate, undefined)
      yield* jobs.wait({ id: target })
    }),
  )

  it.instance("interrupt mode cancels the running agent", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJobService
      const gate = yield* Deferred.make<void>()
      yield* jobs.start({
        id: target,
        type: "task",
        title: "running worker",
        run: Deferred.await(gate).pipe(Effect.as("done")),
      })

      const tool = yield* AgentMessageTool
      const def = yield* tool.init()
      yield* def.execute({ to: target, message: "stop and retry", mode: "interrupt" }, ctx())

      const job = yield* jobs.get(target)
      expect(job?.status).toBe("cancelled")
      yield* Deferred.succeed(gate, undefined)
    }),
  )

  it.instance("plan_approval_response resolves a pending request", () =>
    Effect.gen(function* () {
      const approval = yield* PlanApprovalService
      const fiber = yield* approval
        .request({ sessionID: target, parentID: sender, plan: "docs/plan.md" })
        .pipe(Effect.forkChild)
      yield* Effect.sleep("20 millis")
      const [pending] = yield* approval.list()

      const tool = yield* AgentMessageTool
      const def = yield* tool.init()
      const result = yield* def.execute(
        {
          to: sender,
          message: JSON.stringify({ type: "plan_approval_response", request_id: pending!.id, approve: true }),
        },
        ctx(),
      )
      expect(result.metadata.resolved).toBe(true)
      const decision = yield* Fiber.join(fiber)
      expect(decision.approved).toBe(true)
    }),
  )

  it.instance("plan_approval_response with unknown id is reported, not thrown", () =>
    Effect.gen(function* () {
      const tool = yield* AgentMessageTool
      const def = yield* tool.init()
      const result = yield* def.execute(
        { to: sender, message: JSON.stringify({ type: "plan_approval_response", request_id: "plan_nope" }) },
        ctx(),
      )
      expect(result.metadata.resolved).toBe(false)
    }),
  )

  it.instance("broadcast requires a team", () =>
    Effect.gen(function* () {
      const teams = yield* TeamService
      const team = yield* teams.create({ name: "team-a", rootSessionID: sender })
      yield* teams.addMember({ teamID: team.id, sessionID: target, name: "worker", agent: "general" })

      const mailbox = yield* MailboxService
      const tool = yield* AgentMessageTool
      const def = yield* tool.init()
      const result = yield* def.execute({ to: "*", message: "hello team" }, ctx())
      expect(result.output).toContain("worker")

      const messages = yield* mailbox.list(target)
      expect(messages.map((item) => item.content)).toContain("hello team")
    }),
  )
})
