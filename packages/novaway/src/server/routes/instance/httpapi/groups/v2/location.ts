import { Catalog } from "@novaway/core/catalog"
import { Location } from "@novaway/core/location"
import { LocationServiceMap } from "@novaway/core/location-layer"
import { PluginBoot } from "@novaway/core/plugin/boot"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../../middleware/authorization"
import { InstanceContextMiddleware } from "../../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../../middleware/workspace-routing"
import { LocationInfo, V2RoutingQuery } from "./shared"

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "V2LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

export class V2LocationMiddleware extends HttpApiMiddleware.Service<
  V2LocationMiddleware,
  {
    provides: Catalog.Service | PluginBoot.Service
  }
>()("@NovaWay/ExperimentalHttpApiV2Location") {}

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  return {
    directory:
      query.get("location[directory]") ||
      request.headers["x-novaway-directory"] ||
      request.headers["x-NovaWay-directory"] ||
      request.headers["x-opencode-directory"] ||
      process.cwd(),
    workspaceID:
      query.get("location[workspace]") ||
      request.headers["x-novaway-workspace"] ||
      request.headers["x-NovaWay-workspace"] ||
      request.headers["x-opencode-workspace"],
  }
}

export const layer = Layer.effect(
  V2LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return V2LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* effect.pipe(Effect.provide(locations.get(ref(request))))
      }),
    )
  }),
).pipe(Layer.provide(LocationServiceMap.layer))

// `GET /api/location` — resolve the request's directory/workspace into the
// canonical location descriptor the v2 list endpoints echo back. Clients use it
// once at startup to learn which project they are attached to.
export const LocationGroup = HttpApiGroup.make("v2.location")
  .add(
    HttpApiEndpoint.get("get", "/api/location", {
      query: V2RoutingQuery,
      success: LocationInfo,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.location.get",
        summary: "Resolve location",
        description: "Resolve the requested directory and workspace into a location descriptor.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "v2 location", description: "Experimental v2 location routes." }))
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
