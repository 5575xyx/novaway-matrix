import { Elicitation } from "@/mcp/elicitation"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/elicitation"
const ReplyPayload = Schema.Struct({
  action: Elicitation.Action,
  content: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})

export const ElicitationApi = HttpApi.make("elicitation")
  .add(
    HttpApiGroup.make("elicitation")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Elicitation.Request), "Pending elicitation requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "elicitation.list",
            summary: "List pending MCP elicitation requests",
            description:
              "Requests from MCP servers that need user input before a tool call can continue. HTTP is transport-neutral: the payload never contains the server's full URL query, only what the dialog needs.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: ReplyPayload,
          success: described(Schema.Boolean, "Answer recorded"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "elicitation.reply",
            summary: "Answer an elicitation request",
            description: "Accept (with form content), decline, or cancel a pending MCP elicitation request.",
          }),
        ),
        HttpApiEndpoint.post("reject", `${root}/:requestID/reject`, {
          params: { requestID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Request cancelled"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "elicitation.reject",
            summary: "Cancel an elicitation request",
            description: "Dismiss a pending request without answering; the server receives `cancel`.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "elicitation",
          description: "MCP elicitation routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay HttpApi",
      version: "0.0.1",
      description: "Effect HttpApi surface for instance routes.",
    }),
  )
