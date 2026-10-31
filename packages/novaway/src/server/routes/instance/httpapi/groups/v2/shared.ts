import { Schema } from "effect"
import { WorkspaceRoutingQueryFields } from "../../middleware/workspace-routing"

// v2 clients (TUI / future desktop shells) address routes by *location*
// (directory + optional workspace) and expect every list response to carry the
// location it was resolved against. These schemas are the wire contract shared
// by the v2 groups below; keep them in sync with `@novaway/sdk-v2-latest`'s
// generated `LocationInfo` / `AgentV2Info` / ... types.

export const LocationRef = Schema.Struct({
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
}).annotate({ identifier: "LocationRef" })

export const LocationInfo = Schema.Struct({
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
  project: Schema.Struct({
    id: Schema.String,
    directory: Schema.String,
  }),
}).annotate({ identifier: "LocationInfo" })

export const ModelRef = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  variant: Schema.optional(Schema.String),
}).annotate({ identifier: "ModelRef" })

export const PermissionRule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Schema.Literals(["allow", "deny", "ask"]),
}).annotate({ identifier: "PermissionRule" })

const NestedLocationQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
})

// Both routing styles are accepted:
// - `?directory=&workspace=` / `x-novaway-directory` (WorkspaceRoutingMiddleware)
// - `?location[directory]=&location[workspace]=` (deep-object clients)
export const V2RoutingQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  location: Schema.optional(NestedLocationQuery),
}).annotate({ identifier: "V2RoutingQuery" })
