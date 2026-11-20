import { Effect } from "effect"
import type { SuperAgentOutboxRecord } from "./store"
import { assertExternalURL, type SuperAgentSecurityPolicy } from "./security"
import type { SuperAgentEventPublisher } from "./outbox"

export type SuperAgentExternalPublisherOptions = {
  endpoint: string
  policy?: SuperAgentSecurityPolicy
  fetch?: typeof globalThis.fetch
  headers?: Readonly<Record<string, string>>
}

/**
 * Creates an HTTP boundary for a deployment-level Super-Agent outbox consumer.
 *
 * The outbox worker acknowledges an event only after this publisher receives a
 * 2xx response. The event ID is sent as both an idempotency key and a payload
 * field so an external consumer can safely deduplicate retries and replays.
 */
export function createSuperAgentExternalPublisher(
  options: SuperAgentExternalPublisherOptions,
): SuperAgentEventPublisher {
  const endpoint = assertExternalURL(options.endpoint, options.policy)
  const request = options.fetch ?? globalThis.fetch

  return (event: SuperAgentOutboxRecord) =>
    Effect.tryPromise({
      try: async () => {
        const response = await request(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": event.eventID,
            "x-novaway-event-id": event.eventID,
            ...options.headers,
          },
          body: JSON.stringify({
            eventID: event.eventID,
            runID: event.runID,
            sequence: event.sequence,
            eventType: event.type,
            payload: event.payload,
          }),
        })
        if (!response.ok) throw new Error(`external Super-Agent consumer returned HTTP ${response.status}`)
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
}
