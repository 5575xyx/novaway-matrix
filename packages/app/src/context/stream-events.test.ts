import { describe, expect, test } from "bun:test"
import type { Event } from "@novaway/sdk/v2/client"
import { createStreamEventQueue, createStreamHeartbeat } from "./stream-events"

const delta = (text: string, partID = "part", field = "text"): Event => ({
  id: text,
  type: "message.part.delta",
  properties: { sessionID: "session", messageID: "message", partID, field, delta: text },
})
const snapshot = (text: string): Event => ({
  id: text,
  type: "message.part.updated",
  properties: { sessionID: "session", time: 0, part: {
    sessionID: "session", messageID: "message", id: "part", type: "text", text,
  } },
})

function packetText(event: Event) {
  if (event.type === "message.part.delta") return event.properties.delta
  if (event.type === "message.part.updated" && event.properties.part.type === "text") return event.properties.part.text
  return event.type
}

describe("SSE event batching", () => {
  test("160 adjacent chunks become one ordered reducer event", () => {
    const queue = createStreamEventQueue()
    const chunks = Array.from({ length: 160 }, (_, i) => ` [${i}]`)
    const first = delta(chunks[0])
    queue.push("/repo", first)
    for (const text of chunks.slice(1)) queue.push("/repo", delta(text))
    const batch = queue.take()
    expect(batch.map((item) => packetText(item.payload))).toEqual([chunks.join("")])
    expect(packetText(first)).toBe(chunks[0])
    expect(queue.take()).toEqual([])
  })

  test("compacts snapshots only when adjacent and keeps deltas before and after a correction in order", () => {
    const queue = createStreamEventQueue()
    for (const event of [snapshot("draft"), snapshot("first"), delta(" old"), snapshot("corrected"), delta(" new"), delta(" tail")]) {
      queue.push("/repo", event)
    }
    expect(queue.take().map((item) => packetText(item.payload))).toEqual(["first", " old", "corrected", " new tail"])
  })

  test("keeps busy and idle transitions for completion notifications", () => {
    const queue = createStreamEventQueue()
    queue.push("/repo", { id: "started", type: "session.status", properties: { sessionID: "session", status: { type: "busy" } } })
    queue.push("/repo", { id: "stopped", type: "session.status", properties: { sessionID: "session", status: { type: "idle" } } })
    expect(queue.take().map(({ payload }) => payload.id)).toEqual(["started", "stopped"])
  })

  test("never merges across fields, parts, directories, or removal and batch boundaries", () => {
    const queue = createStreamEventQueue()
    queue.push("/repo", delta("a"))
    queue.push("/other", delta("b"))
    queue.push("/other", delta("c", "another-part"))
    queue.push("/other", delta("d", "another-part", "output"))
    queue.push("/other", { id: "removed", type: "message.part.removed", properties: {
      sessionID: "session", messageID: "message", partID: "another-part",
    } })
    queue.push("/other", delta("e", "another-part", "output"))
    expect(queue.take().map((item) => packetText(item.payload))).toEqual(["a", "b", "c", "d", "message.part.removed", "e"])
    queue.push("/other", delta("f", "another-part", "output"))
    expect(queue.take().map((item) => packetText(item.payload))).toEqual(["f"])
  })
})

function fakeWatchdog(timeoutMs = 100) {
  let now = 0
  let fired = 0
  const jobs: Array<{ at: number; callback: () => void; cancelled: boolean }> = []
  const heartbeat = createStreamHeartbeat({
    timeoutMs,
    now: () => now,
    onTimeout: () => { fired++ },
    schedule(callback, delay) {
      const job = { at: now + delay, callback, cancelled: false }
      jobs.push(job)
      return () => { job.cancelled = true }
    },
  })
  return {
    ...heartbeat,
    jobs,
    fired: () => fired,
    advance(to: number) {
      now = to
      for (const job of jobs) {
        if (job.cancelled || job.at > now) continue
        job.cancelled = true
        job.callback()
      }
    },
  }
}

describe("stream heartbeat", () => {
  test("keeps one timer during a burst and expires relative to the latest packet", () => {
    const clock = fakeWatchdog()
    clock.received()
    for (let i = 0; i < 80; i++) {
      clock.advance(i)
      clock.received()
    }
    expect(clock.jobs.map((job) => job.at)).toEqual([100])
    clock.advance(100)
    expect(clock.fired()).toBe(0)
    expect(clock.jobs.map((job) => job.at)).toEqual([100, 179])
    clock.advance(178)
    expect(clock.expired()).toBe(false)
    clock.advance(179)
    expect(clock.expired()).toBe(true)
    expect(clock.fired()).toBe(1)
  })

  test("stop cancels old watchdog; a new connection can arm again", () => {
    const clock = fakeWatchdog()
    clock.received()
    clock.advance(40)
    clock.stop()
    clock.received()
    clock.advance(100)
    expect(clock.fired()).toBe(0)
    clock.advance(140)
    expect(clock.fired()).toBe(1)
  })
})
