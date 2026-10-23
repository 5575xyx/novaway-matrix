import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/kernel"

export const KernelFeature = Schema.Struct({
  id: Schema.String,
  enabled: Schema.Boolean,
  /** Human-readable current value, e.g. `plan`, `60000`, `3`. */
  detail: Schema.optional(Schema.String),
}).annotate({ identifier: "KernelFeature" })

/**
 * Capability summary for the UI.
 *
 * Answers "is this build actually wired up?" without opening config files:
 * counts come from the live services, flags from the resolved config. Nothing
 * here is secret — hook commands and tool schemas are deliberately excluded.
 */
export const KernelCapabilities = Schema.Struct({
  version: Schema.String,
  tools: Schema.Struct({
    total: Schema.Number,
    deferred: Schema.Number,
    readOnly: Schema.Number,
  }),
  skills: Schema.Number,
  hooks: Schema.Struct({
    registrations: Schema.Number,
    events: Schema.Number,
  }),
  extensions: Schema.Struct({
    total: Schema.Number,
    enabled: Schema.Number,
    contributions: Schema.Number,
  }),
  features: Schema.Array(KernelFeature),
}).annotate({ identifier: "KernelCapabilities" })

export const KernelApi = HttpApi.make("kernel")
  .add(
    HttpApiGroup.make("kernel")
      .add(
        HttpApiEndpoint.get("capabilities", root, {
          query: WorkspaceRoutingQuery,
          success: described(KernelCapabilities, "Kernel capabilities"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "kernel.capabilities",
            summary: "Kernel capability summary",
            description: "Counts of loaded tools, skills, hooks and extensions plus resolved feature flags.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "kernel",
          description: "Kernel introspection routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay kernel HttpApi",
      version: "0.0.1",
      description: "Kernel capability summary.",
    }),
  )
