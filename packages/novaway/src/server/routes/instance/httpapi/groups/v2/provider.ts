import { ProviderV2 } from "@novaway/core/provider"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ApiNotFoundError } from "../../errors"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../../middleware/workspace-routing"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"
import { LocationInfo } from "./shared"

// `get` stays unwrapped: the web UI reads a single provider object and there is
// no location list to page through. `list` follows the v2 envelope used by TUI.
export const ProviderGroup = HttpApiGroup.make("v2.provider")
  .add(
    HttpApiEndpoint.get("provider", "/api/provider/:providerID", {
      params: { providerID: ProviderV2.ID },
      query: LocationQuery,
      success: ProviderV2.Info,
      error: ApiNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.get",
          summary: "Get v2 provider",
          description:
            "Retrieve a single v2 AI provider so clients can inspect its availability and endpoint settings.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 providers",
      description: "Experimental v2 provider routes.",
    }),
  )
  .middleware(V2LocationMiddleware)
  .middleware(Authorization)

const ProviderListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  location: LocationQuery.fields.location,
}).annotate({ identifier: "V2ProviderListQuery" })

const ProviderList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(ProviderV2.Info),
}).annotate({ identifier: "V2ProviderListResponse" })

export const ProviderListGroup = HttpApiGroup.make("v2.provider-list")
  .add(
    HttpApiEndpoint.get("providers", "/api/provider", {
      query: ProviderListQuery,
      success: ProviderList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.provider.list",
          summary: "List v2 providers",
          description: "Retrieve active v2 AI providers so clients can show provider availability and configuration.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 provider list",
      description: "Experimental v2 provider list route.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(V2LocationMiddleware)
  .middleware(Authorization)
