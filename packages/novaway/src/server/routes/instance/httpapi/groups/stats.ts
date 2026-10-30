import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { Stats } from "@/stats/service"

const root = "/stats"

const Query = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  ...Stats.Query.fields,
}).annotate({ identifier: "StatsRequestQuery" })

/**
 * Served under the `kernel` HttpApi: it is kernel-level introspection, and
 * `InstanceHttpApi` is already at TypeScript's limit for the group-name union
 * (one more `.addHttpApi` collapses it and every handler loses its group).
 */
export const StatsGroup = HttpApiGroup.make("stats")
  .add(
    HttpApiEndpoint.get("get", root, {
      query: Query,
      success: described(Stats.Info, "Aggregated session statistics"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "stats.get",
        summary: "Session statistics",
        description:
          "Token usage, cost and tool/model breakdown aggregated over every session in the window. " +
          "Previously only reachable through `novaway stats` on the command line.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "stats",
      description: "Usage statistics routes.",
    }),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
