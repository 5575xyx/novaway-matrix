import { ModelV2 } from "@novaway/core/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../../middleware/workspace-routing"
import { LocationQuery, locationQueryOpenApi, V2LocationMiddleware } from "./location"
import { LocationInfo } from "./shared"

const CatalogQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  location: LocationQuery.fields.location,
}).annotate({ identifier: "V2ModelListQuery" })

const ModelList = Schema.Struct({
  location: LocationInfo,
  data: Schema.Array(ModelV2.Info),
}).annotate({ identifier: "V2ModelListResponse" })

export const ModelGroup = HttpApiGroup.make("v2.model")
  .add(
    HttpApiEndpoint.get("models", "/api/model", {
      query: CatalogQuery,
      success: ModelList,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.model.list",
          summary: "List v2 models",
          description: "Retrieve available v2 models ordered by release date.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "v2 models",
      description: "Experimental v2 model routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(V2LocationMiddleware)
  .middleware(Authorization)
