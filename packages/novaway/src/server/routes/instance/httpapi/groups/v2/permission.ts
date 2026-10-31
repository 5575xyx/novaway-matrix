import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../../middleware/workspace-routing"
import { V2RoutingQuery } from "./shared"

// Saved ("always allow") permission rules are stored per project. v2 clients
// list them through `?projectID=`; when omitted the current location's project
// is used.

const SavedQuery = Schema.Struct({
  ...V2RoutingQuery.fields,
  projectID: Schema.optional(Schema.String),
}).annotate({ identifier: "V2PermissionSavedQuery" })

const PermissionSavedInfo = Schema.Struct({
  id: Schema.String,
  projectID: Schema.String,
  action: Schema.String,
  resource: Schema.String,
}).annotate({ identifier: "PermissionSavedInfo" })

const PermissionSavedList = Schema.Struct({
  data: Schema.Array(PermissionSavedInfo),
}).annotate({ identifier: "V2PermissionSavedListResponse" })

export const PermissionSavedGroup = HttpApiGroup.make("v2.permission")
  .add(
    HttpApiEndpoint.get("saved", "/api/permission/saved", {
      query: SavedQuery,
      success: PermissionSavedList,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.permission.saved.list",
        summary: "List saved permission rules",
        description: "Retrieve the permission rules the user has permanently approved for a project.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 permissions",
      description: "Experimental v2 permission routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
