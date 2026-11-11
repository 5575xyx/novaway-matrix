export * as PtyTicket from "./ticket"

import { WorkspaceID } from "@/control-plane/schema"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"
import { PtyID } from "@/pty/schema"
import { PositiveInt } from "@novaway/core/schema"
import { Cache, Context, Duration, Effect, Layer, Schema } from "effect"

const DEFAULT_TTL = Duration.seconds(60)
const CAPACITY = 10_000

export const ConnectToken = Schema.Struct({
  ticket: Schema.String,
  expires_in: PositiveInt,
})

export type Scope = {
  readonly ptyID: PtyID
  readonly directory?: string
  readonly workspaceID?: WorkspaceID
}

export type MediaScope = {
  readonly path: string
  readonly directory?: string
  readonly workspaceID?: WorkspaceID
}

export interface Interface {
  issue(input: Scope): Effect.Effect<typeof ConnectToken.Type>
  consume(input: Scope & { readonly ticket: string }): Effect.Effect<boolean>
  issueMedia(input: MediaScope): Effect.Effect<typeof ConnectToken.Type>
  consumeMedia(input: MediaScope & { readonly ticket: string }): Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/PtyTicket") {}

function matches(record: Scope, input: Scope) {
  return (
    record.ptyID === input.ptyID && record.directory === input.directory && record.workspaceID === input.workspaceID
  )
}

function matchesMedia(record: MediaScope, input: MediaScope) {
  return record.path === input.path && record.directory === input.directory && record.workspaceID === input.workspaceID
}

// Tickets are inserted via Cache.set and removed atomically via invalidateWhen. The lookup is
// never invoked; it dies if it ever is, which would signal a misuse of the Service interface.
const noLookup = () => Effect.die("PtyTicket cache must be used via set/invalidateWhen, never get")
const noMediaLookup = () => Effect.die("PtyTicket media cache must be used via set/get, never lookup")

// Visible for tests so the TTL can be shortened. Production uses `layer` with the default TTL.
export const make = (ttl: Duration.Input = DEFAULT_TTL) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make<string, Scope>({ capacity: CAPACITY, lookup: noLookup, timeToLive: ttl })
    const mediaCache = yield* Cache.make<string, MediaScope>({
      capacity: CAPACITY,
      lookup: noMediaLookup,
      timeToLive: ttl,
    })
    const expiresIn = Math.max(1, Math.round(Duration.toSeconds(Duration.fromInputUnsafe(ttl))))
    return Service.of({
      issue: Effect.fn("PtyTicket.issue")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(cache, ticket, input)
        return { ticket, expires_in: expiresIn }
      }),
      consume: Effect.fn("PtyTicket.consume")(function* (input) {
        return yield* Cache.invalidateWhen(cache, input.ticket, (stored) => "ptyID" in stored && matches(stored, input))
      }),
      issueMedia: Effect.fn("PtyTicket.issueMedia")(function* (input) {
        const ticket = crypto.randomUUID()
        yield* Cache.set(mediaCache, ticket, input)
        return { ticket, expires_in: expiresIn }
      }),
      consumeMedia: Effect.fn("PtyTicket.consumeMedia")(function* (input) {
        const stored = yield* Cache.get(mediaCache, input.ticket)
        return !!stored && matchesMedia(stored, input)
      }),
    })
  })

export const layer = Layer.effect(Service, make())

export const defaultLayer = layer

export const scope = Effect.gen(function* () {
  const instance = yield* InstanceRef
  const workspaceID = yield* WorkspaceRef
  return {
    directory: instance?.directory,
    workspaceID,
  }
})
