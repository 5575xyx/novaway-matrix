import { createHmac, timingSafeEqual } from "node:crypto"

export type IntegrationKind = "commit" | "pull_request" | "check"
export type IntegrationEvent = { kind: IntegrationKind; payload: Record<string, unknown> }

/**
 * Return the stable delivery identifier carried by a persisted integration event.
 * GitHub retries the same delivery with the same `X-GitHub-Delivery` value; that
 * identifier is therefore the idempotency key, not the event timestamp or SHA.
 */
export function deliveryID(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Verify GitHub's X-Hub-Signature-256 against the exact raw request body.
 * GitHub signs bytes, not the parsed/re-serialized JSON representation.
 */
export function verifyGithubSignature(input: {
  rawBody: string | Uint8Array
  signature: unknown
  secret: string
}): boolean {
  if (!input.secret) return false
  if (typeof input.signature !== "string" || !/^sha256=[0-9a-f]{64}$/i.test(input.signature.trim())) return false
  const expected = Buffer.from(
    `sha256=${createHmac("sha256", input.secret).update(input.rawBody).digest("hex")}`,
    "ascii",
  )
  const received = Buffer.from(input.signature.trim(), "ascii")
  return expected.length === received.length && timingSafeEqual(expected, received)
}

/**
 * Test whether a workflow event stream already contains a GitHub delivery.
 * The event payload is intentionally treated as untrusted data and checked
 * structurally rather than relying on a JSON string search.
 */
export function hasGithubDelivery(
  events: readonly { type?: unknown; payload?: unknown }[],
  id: string | undefined,
): boolean {
  if (!id) return false
  return events.some((event) => {
    if (typeof event.type !== "string" || !event.type.startsWith("integration.")) return false
    const payload = event.payload
    return (
      !!payload && typeof payload === "object" && deliveryID((payload as Record<string, unknown>).deliveryID) === id
    )
  })
}

/** Normalize GitHub webhook/Actions payloads into the durable workflow event contract. */
export function githubEvent(input: {
  event: string
  deliveryID?: string
  payload: Record<string, unknown>
}): IntegrationEvent {
  const payload = input.payload
  const id = deliveryID(input.deliveryID)
  if (input.event === "pull_request" || input.event.startsWith("pull_request."))
    return {
      kind: "pull_request",
      payload: {
        provider: "github",
        event: input.event,
        ...(id ? { deliveryID: id } : {}),
        number: payload.number,
        action: payload.action,
        sha: (payload.pull_request as any)?.head?.sha,
        url: (payload.pull_request as any)?.html_url,
      },
    }
  if (input.event === "push")
    return {
      kind: "commit",
      payload: {
        provider: "github",
        event: input.event,
        ...(id ? { deliveryID: id } : {}),
        ref: payload.ref,
        sha: payload.after,
        repository: (payload.repository as any)?.full_name,
      },
    }
  return {
    kind: "check",
    payload: {
      provider: "github",
      event: input.event,
      ...(id ? { deliveryID: id } : {}),
      name: (payload.check_run as any)?.name ?? (payload.workflow_run as any)?.name,
      sha: (payload.check_run as any)?.head_sha ?? (payload.workflow_run as any)?.head_sha,
      conclusion: (payload.check_run as any)?.conclusion ?? (payload.workflow_run as any)?.conclusion,
      url: (payload.check_run as any)?.html_url,
    },
  }
}
