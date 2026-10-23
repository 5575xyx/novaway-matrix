import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/hook"

/**
 * An active hook registration, summarised for display.
 *
 * The raw command/url is deliberately not returned: hook commands frequently
 * carry credentials and the UI only needs to show "what listens to what".
 */
export const HookRegistrationView = Schema.Struct({
  event: Schema.String,
  matcher: Schema.optional(Schema.String),
  source: Schema.String,
  count: Schema.Number,
  types: Schema.Array(Schema.String),
  /** Progress labels this registration declares, in order. */
  statusMessages: Schema.Array(Schema.String),
}).annotate({ identifier: "HookRegistrationView" })

export const HookActiveView = Schema.Struct({
  id: Schema.String,
  event: Schema.String,
  source: Schema.String,
  message: Schema.String,
  sessionID: Schema.optional(Schema.String),
  startedAt: Schema.Number,
}).annotate({ identifier: "HookActiveView" })

export const HookApi = HttpApi.make("hook")
  .add(
    HttpApiGroup.make("hook")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(HookRegistrationView), "Active hooks"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "hook.list",
            summary: "List active hooks",
            description: "List the JSON/extension hooks currently registered for this workspace.",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.get("active", `${root}/active`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(HookActiveView), "Running hooks"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "hook.active",
            summary: "List running hooks",
            description: "Hooks that declared a statusMessage and are currently executing.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "hook",
          description: "Hook introspection routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay hook HttpApi",
      version: "0.0.1",
      description: "Inspect active hook registrations.",
    }),
  )
