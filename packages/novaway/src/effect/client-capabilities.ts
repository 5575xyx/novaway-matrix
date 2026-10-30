import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config, Context, Effect, Layer, Schema } from "effect"

/**
 * Things a client shell may or may not be able to do. The kernel picks its
 * tool set from these, never from the client's name: a new desktop shell only
 * has to declare what it can render.
 */
export const Name = Schema.Literals([
  /** Can render interactive question prompts (`question` tool). */
  "question",
  /** Can render plan review UI (`plan` / `plan_enter` tools). */
  "plan",
  /** Can render a terminal UI (`/tui/*` routes). */
  "tui",
])
export type Name = Schema.Schema.Type<typeof Name>

export const Names: readonly Name[] = Name.literals

/**
 * Legacy client ids that predate capability negotiation.
 *
 * The mapping is only a fallback for launchers that still set
 * `NOVAWAY_CLIENT` and nothing else. New launchers should set
 * `NOVAWAY_CLIENT_CAPABILITIES` (comma separated) and leave this alone.
 */
const LEGACY: Record<string, readonly Name[]> = {
  cli: ["question", "plan", "tui"],
  app: ["question"],
  desktop: ["question", "tui"],
  // ACP speaks the protocol, not a UI: it renders nothing itself.
  acp: [],
}

export function parse(input: string | undefined): readonly Name[] {
  if (input === undefined) return []
  const declared = input
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is Name => (Names as readonly string[]).includes(item))
  return [...new Set(declared)]
}

/** Capabilities implied by a legacy client id. Unknown ids get none. */
export function fromLegacyClient(client: string | undefined): readonly Name[] {
  return LEGACY[client ?? "cli"] ?? []
}

export class Service extends Context.Service<
  Service,
  {
    /** Client id for telemetry and `/kernel` output. Not used for gating. */
    readonly client: string
    /** Whether the active client can render this capability. */
    readonly has: (name: Name) => boolean
    /** Every known capability with its resolved value. */
    readonly list: () => ReadonlyArray<{ readonly name: Name; readonly enabled: boolean }>
  }
>()("@NovaWay/ClientCapabilities") {}

/** Capabilities declared by the launcher, or the legacy id mapping. */
export const declaredLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    const raw = yield* Config.string("NovaWay_CLIENT_CAPABILITIES").pipe(Config.withDefault(undefined))
    const capabilities = parse(raw).length > 0 ? parse(raw) : fromLegacyClient(flags.client)
    return Service.of({
      client: flags.client,
      has: (name) => capabilities.includes(name),
      list: () => Names.map((name) => ({ name, enabled: capabilities.includes(name) })),
    })
  }),
)

/** Explicit capabilities, for tests and embedders. */
export const layer = (input: { client: string; capabilities: readonly Name[] }) =>
  Layer.succeed(
    Service,
    Service.of({
      client: input.client,
      has: (name) => input.capabilities.includes(name),
      list: () => Names.map((name) => ({ name, enabled: input.capabilities.includes(name) })),
    }),
  )

export const defaultLayer = declaredLayer.pipe(Layer.provide(RuntimeFlags.defaultLayer))

export * as ClientCapabilities from "./client-capabilities"
