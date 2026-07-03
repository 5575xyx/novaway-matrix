import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { AppRuntime } from "../../src/effect/app-runtime"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Server } from "../../src/server/server"
import { EvolutionPaths } from "../../src/server/routes/instance/httpapi/groups/evolution"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { MemoryPaths } from "../../src/server/routes/instance/httpapi/groups/memory"
import { Event as ServerEvent } from "../../src/server/event"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Schema } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, reloadTestInstance, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

const EventData = Schema.Struct({
  id: Schema.optional(Schema.String),
  type: Schema.String,
  properties: Schema.Record(Schema.String, Schema.Any),
})

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out waiting for event")), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function readFirstEvent(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  try {
    return await readEvent(reader)
  } finally {
    await reader.cancel()
  }
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await readChunk(reader)
  if (result.done || !result.value) throw new Error("event stream closed")
  return Schema.decodeUnknownSync(EventData)(JSON.parse(new TextDecoder().decode(result.value).replace(/^data: /, "")))
}

async function readStatusWithin(reader: ReadableStreamDefaultReader<Uint8Array>, delay: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read().then((result) => (result.done ? "closed" : "event")),
      new Promise<"open">((resolve) => {
        timeout = setTimeout(() => resolve("open"), delay)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function expectOk(response: Response) {
  if (response.status === 200) return
  throw new Error(`expected 200, got ${response.status}: ${await response.text()}`)
}

async function settleEventSubscription() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("event HttpApi", () => {
  test("serves event stream", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    expect(response.headers.get("x-accel-buffering")).toBe("no")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(await readFirstEvent(response)).toMatchObject({ type: "server.connected", properties: {} })
  })

  test("keeps the event stream open after the initial event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })
      expect(await readStatusWithin(reader, 250)).toBe("open")
    } finally {
      await reader.cancel()
    }
  })

  test("delivers instance bus events after the initial event", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

      const next = readEvent(reader)
      const ctx = await reloadTestInstance({ directory: tmp.path })
      await AppRuntime.runPromise(
        Bus.Service.use((svc) => svc.publish(ServerEvent.Connected, {})).pipe(Effect.provideService(InstanceRef, ctx)),
      )

      expect(await next).toMatchObject({ type: "server.connected", properties: {} })
    } finally {
      await reader.cancel()
    }
  })

  test("delivers memory review update events after review candidates are created", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

      const next = readEvent(reader)
      await settleEventSubscription()
      const review = await app().request(MemoryPaths.review, {
        method: "POST",
        headers,
        body: JSON.stringify({
          userContent: `remember that sse memory review event refresh is covered ${Date.now()}`,
        }),
      })

      await expectOk(review)
      expect(await next).toMatchObject({ type: "memory.review.updated" })
    } finally {
      await reader.cancel()
    }
  })

  test("delivers evolution update events after evolution candidates are created", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const response = await app().request(EventPaths.event, { headers: { "x-opencode-directory": tmp.path } })
    if (!response.body) throw new Error("missing response body")

    const reader = response.body.getReader()
    try {
      expect(await readEvent(reader)).toMatchObject({ type: "server.connected", properties: {} })

      const marker = Date.now()
      const next = readEvent(reader)
      await settleEventSubscription()
      const review = await app().request(EvolutionPaths.review, {
        method: "POST",
        headers,
        body: JSON.stringify({
          proposals: [
            {
              kind: "project",
              target: `sse-event-refresh-${marker}`,
              title: `cover sse event refresh ${marker}`,
              content: `candidate changes should reach the event stream ${marker}.`,
              reason: "P23 protects the desktop global event listener path.",
            },
          ],
        }),
      })

      await expectOk(review)
      expect(await next).toMatchObject({ type: "evolution.updated" })
    } finally {
      await reader.cancel()
    }
  })
})
