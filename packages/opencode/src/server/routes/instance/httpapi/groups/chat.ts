import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/chat"

export const ChatPayload = Schema.Struct({
  message: Schema.String,
  system: Schema.optional(Schema.String),
  model: Schema.Struct({
    providerID: ProviderID,
    modelID: ModelID,
  }),
  temperature: Schema.optional(Schema.Number),
  maxOutputTokens: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
}).annotate({ identifier: "ChatPayload" })

export const ChatResponse = Schema.Struct({
  text: Schema.String,
}).annotate({ identifier: "ChatResponse" })

export const ChatApi = HttpApi.make("chat")
  .add(
    HttpApiGroup.make("chat")
      .add(
        HttpApiEndpoint.post("send", root, {
          query: WorkspaceRoutingQuery,
          payload: ChatPayload,
          success: described(ChatResponse, "Chat response"),
          error: [HttpApiError.BadRequest, HttpApiError.InternalServerError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "chat.send",
            summary: "Send a message to the model",
            description:
              "Send a text message to an AI model and receive a text response. This is a simple, stateless call that does not create or maintain any session state. Ideal for one-off queries, prompt optimization, and general-purpose Q&A.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "Chat",
          description: "Direct model chat API. No session required.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Chat",
      version: "0.0.1",
      description: "Stateless direct model chat API.",
    }),
  )
