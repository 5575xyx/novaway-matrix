import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createSuperAgentExternalPublisher } from "../../src/super-agent/external-publisher"
import { SuperAgentOutboxHost } from "../../src/super-agent/outbox"
import { SuperAgentStore, SuperAgentStoreLayer } from "../../src/super-agent"
import type { Goal } from "../../src/super-agent/types"

const runStore = <A>(effect: Effect.Effect<A, unknown, SuperAgentStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SuperAgentStoreLayer)))

const goal: Goal = {
  text: "external consumer acceptance",
  constraints: [],
  source: "user",
  requestedBy: "test",
  acceptanceCriteria: [],
}

describe("Super-Agent external outbox consumer", () => {
  test("retries a failed HTTP consumer and acknowledges after a fresh worker replay", async () => {
    const runID = `external-consumer-${Date.now()}`
    const directory = `/tmp/${runID}`
    const received: Array<{ eventID: string; runID: string; sequence: number }> = []
    let attempts = 0
    const consumer = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method !== "POST") return new Response("not found", { status: 404 })
        attempts += 1
        const body = (await request.json()) as { eventID: string; runID: string; sequence: number }
        received.push(body)
        if (attempts === 1) return new Response("temporary failure", { status: 503 })
        return new Response(null, { status: 204 })
      },
    })
    const store = await runStore(SuperAgentStore.use((current) => Effect.succeed(current)))
    await runStore(SuperAgentStore.use((current) => current.create({ id: runID, directory, goal })))
    await runStore(
      SuperAgentStore.use((current) =>
        current.appendEvent({
          runID,
          type: "external_consumer_fixture",
          at: Date.now(),
          payload: { source: "test" },
        }),
      ),
    )

    try {
      const publisher = createSuperAgentExternalPublisher({
        endpoint: `http://127.0.0.1:${consumer.port}`,
        policy: { allowHttp: true, allowPrivateNetwork: true },
      })
      const firstWorker = new SuperAgentOutboxHost(store, publisher, { directory })
      const first = await firstWorker.drainOnce(Date.now())
      expect(first.published).toHaveLength(0)
      expect(first.failed).toHaveLength(1)
      const retryAt = first.failed[0]?.retryAt ?? Date.now()
      const pendingAfterFailure = await runStore(SuperAgentStore.use((current) => current.outbox(runID, 100, retryAt)))
      expect(pendingAfterFailure.at(0)).toMatchObject({
        attempts: 1,
        status: "pending",
      })

      const restartedWorker = new SuperAgentOutboxHost(store, publisher, { directory })
      const second = await restartedWorker.drainOnce(retryAt)
      expect(second.failed).toHaveLength(0)
      expect(second.published).toHaveLength(1)
      expect(await runStore(SuperAgentStore.use((current) => current.outbox(runID)))).toHaveLength(0)
      expect(attempts).toBe(2)
      expect(received).toHaveLength(2)
      expect(received[0]).toMatchObject({ eventID: received[1]?.eventID, runID, sequence: 1 })
    } finally {
      consumer.stop(true)
    }
  })
})
