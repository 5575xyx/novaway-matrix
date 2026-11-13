import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import type { ContributionKind, PluginStatus } from "@novaway/plugin-api"
import { contributionKinds } from "@novaway/plugin-api"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

const root = "/plugin"
const statuses = [
  "discovered",
  "invalid",
  "blocked",
  "installed",
  "activating",
  "active",
  "failed",
  "degraded",
  "disabled",
  "uninstalled",
  "overridden",
] as const satisfies readonly PluginStatus[]
const kinds = contributionKinds satisfies readonly ContributionKind[]

export const PluginIssue = Schema.Struct({
  level: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
  field: Schema.optional(Schema.String),
})

export const PluginInfo = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(statuses),
  runtimeStatus: Schema.optional(Schema.Literals(["installed", "activating", "active", "failed", "disabled"])),
  scope: Schema.Literals(["builtin", "global", "project", "session"]),
  origin: Schema.Literals(["extension", "config-plugin", "tui"]),
  adapter: Schema.Literals(["v2", "legacy-extension", "legacy-config-plugin", "legacy-tui"]),
  version: Schema.optional(Schema.String),
  source: Schema.String,
  root: Schema.optional(Schema.String),
  installOrder: Schema.optional(Schema.Number),
  overriddenBy: Schema.optional(Schema.String),
  contributions: Schema.Number,
  issues: Schema.Array(PluginIssue),
})

export const PluginList = Schema.Struct({
  generation: Schema.Number,
  instances: Schema.Array(PluginInfo),
  cycles: Schema.Array(Schema.Array(Schema.String)),
  skipped: Schema.optional(Schema.String),
})

export const PluginContribution = Schema.Struct({
  pluginID: Schema.String,
  kind: Schema.Literals(kinds),
  name: Schema.String,
  localName: Schema.String,
  scope: Schema.Literals(["builtin", "global", "project", "session"]),
  origin: Schema.Literals(["extension", "config-plugin", "tui"]),
  adapter: Schema.Literals(["v2", "legacy-extension", "legacy-config-plugin", "legacy-tui"]),
  status: Schema.Literals(statuses),
  path: Schema.optional(Schema.String),
  slot: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  extensions: Schema.optional(Schema.Array(Schema.String)),
  hosts: Schema.optional(Schema.Array(Schema.String)),
  supports: Schema.optional(Schema.Array(Schema.String)),
  urls: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  account: Schema.optional(Schema.Unknown),
  ui: Schema.optional(Schema.Unknown),
  action: Schema.optional(Schema.Unknown),
  view: Schema.optional(Schema.Unknown),
  match: Schema.optional(
    Schema.Struct({
      tool: Schema.optional(Schema.String),
      partType: Schema.optional(Schema.String),
      extension: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      format: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
      mime: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    }),
  ),
  renderer: Schema.optional(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("builtin"), id: Schema.String }),
      Schema.Struct({ type: Schema.Literal("iframe"), url: Schema.String }),
    ]),
  ),
  viewId: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.Number),
  readOnly: Schema.optional(Schema.Boolean),
})

export const PluginDiagnostic = Schema.Struct({
  pluginID: Schema.String,
  scope: Schema.Literals(["builtin", "global", "project", "session"]),
  severity: Schema.Literals(["error", "warning", "info"]),
  code: Schema.String,
  message: Schema.String,
  field: Schema.optional(Schema.String),
  capability: Schema.optional(Schema.String),
  contribution: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(kinds),
      name: Schema.String,
      localName: Schema.String,
      status: Schema.Literals(statuses),
    }),
  ),
})

export class PluginTransitionError extends Schema.ErrorClass<PluginTransitionError>("PluginTransitionError")(
  { pluginID: Schema.String, code: Schema.String, message: Schema.String },
  { httpApiStatus: 409 },
) {}

export const PluginToggle = Schema.Struct({
  enabled: Schema.Boolean,
  scope: Schema.optional(Schema.Literals(["builtin", "global", "project", "session"])),
})
export const PluginToggleResult = Schema.Struct({
  pluginID: Schema.String,
  enabled: Schema.Boolean,
  generation: Schema.Number,
})

const PublishKind = Schema.Literals(["video", "image_text", "article"])
const PublishAccount = Schema.Struct({
  id: Schema.String,
  driverID: Schema.String,
  label: Schema.String,
  profile: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: Schema.Number,
})
const PublishAccountInput = Schema.Struct({
  driverID: Schema.String,
  profile: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
const PublishExecutionInput = Schema.Struct({
  driverID: Schema.String,
  accountID: Schema.String,
  kind: PublishKind,
  payload: Schema.Record(Schema.String, Schema.Unknown),
})

export const PluginApi = HttpApi.make("plugin")
  .add(
    HttpApiGroup.make("plugin")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(PluginList, "Discovered plugins, their states and diagnostics"),
        }).annotateMerge(OpenApi.annotations({ identifier: "plugin.list", summary: "List plugins" })),
        HttpApiEndpoint.get("contributions", `${root}/contributions`, {
          query: Schema.Struct({
            directory: Schema.optional(Schema.String),
            workspace: Schema.optional(Schema.String),
            kind: Schema.optional(Schema.Literals(kinds)),
            slot: Schema.optional(Schema.String),
          }),
          success: described(Schema.Array(PluginContribution), "Declared plugin contributions"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "plugin.contributions", summary: "List plugin contributions" }),
        ),
        HttpApiEndpoint.get("publishAccounts", `${root}/publish/accounts`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(PublishAccount), "Instance-scoped publish accounts"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "plugin.publish.accounts", summary: "List publish accounts" }),
        ),
        HttpApiEndpoint.post("publishAccount", `${root}/publish/accounts`, {
          query: WorkspaceRoutingQuery,
          payload: PublishAccountInput,
          success: described(PublishAccount, "Stored publish account"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "plugin.publish.account", summary: "Add a publish account" }),
        ),
        HttpApiEndpoint.delete("deletePublishAccount", `${root}/publish/accounts/:driverID/:accountID`, {
          params: { driverID: Schema.String, accountID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Account removed"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "plugin.publish.account.delete", summary: "Remove a publish account" }),
        ),
        HttpApiEndpoint.post("publishExecute", `${root}/publish/execute`, {
          query: WorkspaceRoutingQuery,
          payload: PublishExecutionInput,
          success: described(Schema.Record(Schema.String, Schema.Unknown), "Publish driver result"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({ identifier: "plugin.publish.execute", summary: "Execute a publish driver" }),
        ),
        HttpApiEndpoint.get("diagnostics", `${root}/diagnostics`, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(PluginDiagnostic), "Plugin diagnostics"),
        }).annotateMerge(OpenApi.annotations({ identifier: "plugin.diagnostics", summary: "List plugin diagnostics" })),
        HttpApiEndpoint.patch("toggle", `${root}/:id`, {
          params: { id: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: PluginToggle,
          success: described(PluginToggleResult, "Plugin enabled state"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound, PluginTransitionError],
        }).annotateMerge(OpenApi.annotations({ identifier: "plugin.toggle", summary: "Enable or disable a plugin" })),
        HttpApiEndpoint.get("events", `${root}/events`, {
          query: WorkspaceRoutingQuery,
          success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
        }).annotateMerge(OpenApi.annotations({ identifier: "plugin.events", summary: "Subscribe to plugin changes" })),
      )
      .annotateMerge(
        OpenApi.annotations({ title: "plugin", description: "Plugin host, contribution and diagnostic routes." }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "NovaWay plugin HttpApi", version: "0.0.1" }))
