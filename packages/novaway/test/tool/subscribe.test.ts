import { describe, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { SubscribeTool } from "@/tool/subscribe"
import { Service as BackgroundService, defaultLayer as BackgroundLayer } from "@/background/job"
import { Service as MailboxService, defaultLayer as MailboxLayer } from "@/team/mailbox"
import { defaultLayer as StatusLayer, Service as StatusService } from "@/session/status"
import { defaultLayer as TruncateLayer } from "@/tool/truncate"
import { defaultLayer as AgentLayer } from "@/agent/agent"
import * as Tool from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(BackgroundLayer, MailboxLayer, StatusLayer, TruncateLayer, AgentLayer, FetchHttpClient.layer) as never,
)

const sessionID = SessionID.make("ses_subscribe")

const context = (extra?: Record<string, unknown>, asked: string[] = []): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_subscribe"),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: (input) => {
    asked.push(`${input.permission}:${(input.patterns ?? []).join(",")}`)
    return Effect.void
  },
  ...(extra ? { extra } : {}),
})

/** Local endpoint whose body is decided per request. */
const server = (respond: (hit: number) => string) => {
  let hits = 0
  const instance = Bun.serve({
    port: 0,
    fetch() {
      hits += 1
      return new Response(respond(hits), { headers: { "content-type": "text/plain" } })
    },
  })
  return { url: instance.url.toString(), stop: () => instance.stop(true) }
}

describe("subscribe tool", () => {
  it.instance("wakes on a matching pattern", () =>
    Effect.gen(function* () {
      const target = server((hit) => (hit === 1 ? "status: pending" : "status: success"))
      const subscribe = yield* (yield* SubscribeTool).init()
      const background = yield* BackgroundService
      const mailbox = yield* MailboxService
      const asked: string[] = []

      try {
        const output = yield* subscribe.execute(
          { url: target.url, match: "success", every: 1, timeout: 60 },
          context(undefined, asked),
        )
        const job = yield* background.wait({ id: output.metadata.jobID!, timeout: 30_000 })
        expect(job.info?.status).toBe("completed")

        const messages = yield* mailbox.drain(sessionID)
        expect(messages).toHaveLength(1)
        expect(messages[0]!.content).toContain("<subscription-notification")
        expect(messages[0]!.content).toContain("state: matched")
        expect(messages[0]!.content).toContain("status: success")
        expect(asked).toEqual([`webfetch:${target.url}`])
      } finally {
        target.stop()
      }
    }),
  )

  it.instance("wakes on any body change when no pattern is given", () =>
    Effect.gen(function* () {
      const target = server((hit) => (hit === 1 ? '{"open":0}' : '{"open":2}'))
      const subscribe = yield* (yield* SubscribeTool).init()
      const background = yield* BackgroundService
      const mailbox = yield* MailboxService

      try {
        const output = yield* subscribe.execute({ url: target.url, every: 1, timeout: 60 }, context())
        const job = yield* background.wait({ id: output.metadata.jobID!, timeout: 30_000 })
        expect(job.info?.status).toBe("completed")

        const messages = yield* mailbox.drain(sessionID)
        expect(messages[0]!.content).toContain("state: changed")
        expect(messages[0]!.content).toContain('"open":2')
      } finally {
        target.stop()
      }
    }),
  )

  it.instance("rejects non-http urls without starting a job", () =>
    Effect.gen(function* () {
      const subscribe = yield* (yield* SubscribeTool).init()
      const result = yield* subscribe.execute({ url: "file:///etc/passwd" }, context())
      expect(result.title).toBe("Invalid URL")
      expect(result.metadata.jobID).toBeUndefined()
    }),
  )

  it.instance("resumes an idle session only", () =>
    Effect.gen(function* () {
      const target = server((hit) => `body-${hit}`)
      const subscribe = yield* (yield* SubscribeTool).init()
      const background = yield* BackgroundService
      const status = yield* StatusService
      const calls = yield* Ref.make(0)
      const ops = { loop: () => Ref.update(calls, (value) => value + 1).pipe(Effect.asVoid) }

      try {
        const output = yield* subscribe.execute({ url: target.url, every: 1, timeout: 60 }, context({ promptOps: ops }))
        yield* background.wait({ id: output.metadata.jobID!, timeout: 30_000 })
        yield* Effect.sleep("300 millis")
        expect(yield* Ref.get(calls)).toBe(1)

        yield* status.set(sessionID, { type: "busy" })
        const second = yield* subscribe.execute({ url: target.url, every: 1, timeout: 60 }, context({ promptOps: ops }))
        yield* background.wait({ id: second.metadata.jobID!, timeout: 30_000 })
        yield* Effect.sleep("300 millis")
        expect(yield* Ref.get(calls)).toBe(1)
      } finally {
        target.stop()
      }
    }),
  )
})
