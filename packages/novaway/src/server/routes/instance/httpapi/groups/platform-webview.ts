import { PlatformWebview } from "@/platform-webview"
import { WebviewRequestID } from "@/platform-webview/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/platform/webview"

const ResultPayload = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
})

/**
 * 内嵌浏览器（运营工作台）的操作通道。
 *
 * 服务端把页面操作以事件形式下发给客户端，客户端执行完从这里回传结果。
 * 只有桌面壳会回复；没有客户端在场时工具会超时并给出明确提示。
 */
export const PlatformWebviewApi = HttpApi.make("platform-webview")
  .add(
    HttpApiGroup.make("platform-webview")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(PlatformWebview.Request), "Pending webview requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "platformWebview.list",
            summary: "List pending webview requests",
            description: "Requests waiting for the desktop client to act on the embedded platform browser.",
          }),
        ),
        HttpApiEndpoint.post("resolve", `${root}/:requestID/result`, {
          params: { requestID: WebviewRequestID },
          query: WorkspaceRoutingQuery,
          payload: ResultPayload,
          success: described(Schema.Boolean, "Result accepted"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "platformWebview.resolve",
            summary: "Report a webview result",
            description: "The desktop client reports the outcome of a webview action back to the server.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "platform-webview",
          description: "Embedded platform browser routes.",
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
