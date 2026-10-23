import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Service as TeamService, defaultLayer as TeamLayer } from "@/team/team"
import { Service as TaskListService, defaultLayer as TaskListLayer } from "@/team/task-list"
import { Service as MailboxService, defaultLayer as MailboxLayer } from "@/team/mailbox"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(TeamLayer, TaskListLayer, MailboxLayer))

const lead = SessionID.make("ses_lead")
const worker = SessionID.make("ses_worker")

describe("team", () => {
  it.effect("creates a team and registers members", () =>
    Effect.gen(function* () {
      const teams = yield* TeamService
      const team = yield* teams.create({ name: "alpha", rootSessionID: lead })
      yield* teams.addMember({ teamID: team.id, sessionID: worker, name: "researcher", agent: "explore" })
      const members = yield* teams.members(team.id)
      expect(members.map((item) => item.name).sort()).toEqual(["researcher"])
      const found = yield* teams.member(team.id, "researcher")
      expect(found?.sessionID).toBe(worker)
      const bySession = yield* teams.ofSession(worker)
      expect(bySession?.id).toBe(team.id)
    }),
  )

  it.effect("claims tasks atomically and respects dependencies", () =>
    Effect.gen(function* () {
      const teams = yield* TeamService
      const tasks = yield* TaskListService
      const team = yield* teams.create({ name: "beta", rootSessionID: lead })
      const first = yield* tasks.create({ teamID: team.id, subject: "one", description: "first" })
      const second = yield* tasks.create({
        teamID: team.id,
        subject: "two",
        description: "second",
        blockedBy: [first.id],
      })

      const blocked = yield* tasks.claim({ taskID: second.id, sessionID: worker })
      expect(blocked).toBeUndefined()

      const claimed = yield* tasks.claim({ taskID: first.id, sessionID: worker })
      expect(claimed?.status).toBe("in_progress")
      expect(claimed?.ownerSessionID).toBe(worker)

      const again = yield* tasks.claim({ taskID: first.id, sessionID: lead })
      expect(again).toBeUndefined()

      yield* tasks.update({ taskID: first.id, status: "completed" })
      const ready = yield* tasks.ready(team.id)
      expect(ready.map((item) => item.id)).toEqual([second.id])
    }),
  )

  it.effect("delivers mailbox messages once and excludes the sender", () =>
    Effect.gen(function* () {
      const mailbox = yield* MailboxService
      yield* mailbox.send({
        teamID: "t",
        fromSessionID: lead,
        toSessionID: worker,
        content: "hello",
        summary: "greeting",
      })
      yield* mailbox.send({ teamID: "t", fromSessionID: worker, toSessionID: worker, content: "self" })

      const first = yield* mailbox.drain(worker)
      expect(first.map((item) => item.content)).toEqual(["hello"])
      const second = yield* mailbox.drain(worker)
      expect(second).toEqual([])
    }),
  )
})
