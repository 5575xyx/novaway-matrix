import { Context, Effect } from "effect"
import type { PluginError } from "@novaway/plugin-api"
import type { Instance as DiscoveredPlugin } from "../host"
import type { Host } from "./host"

export interface Interface {
  readonly get: Effect.Effect<Host>
  readonly invalidate: Effect.Effect<void>
  readonly setEnabled: (instance: DiscoveredPlugin, enabled: boolean) => Effect.Effect<void, PluginError>
  readonly activateBuiltin: (instance: DiscoveredPlugin) => Effect.Effect<void, PluginError>
  readonly activateOnDemand: (instance: DiscoveredPlugin) => Effect.Effect<void, PluginError>
}

/** Lightweight tag: hot-path consumers must not import the Runtime Host activation graph. */
export class Service extends Context.Service<Service, Interface>()("@novaway/PluginRuntimeHost") {}
