import { PlatformWebview } from "@/platform-webview"
import { WebviewRequestID } from "@/platform-webview/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const platformWebviewHandlers = HttpApiBuilder.group(InstanceHttpApi, "platform-webview", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* PlatformWebview.Service

    const list = Effect.fn("PlatformWebviewHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const resolve = Effect.fn("PlatformWebviewHttpApi.resolve")(function* (ctx: {
      params: { requestID: WebviewRequestID }
      payload: { ok: boolean; data?: unknown; error?: string }
    }) {
      yield* svc.resolve({
        requestID: ctx.params.requestID,
        ok: ctx.payload.ok,
        ...(ctx.payload.data === undefined ? {} : { data: ctx.payload.data }),
        ...(ctx.payload.error === undefined ? {} : { error: ctx.payload.error }),
      })
      return true
    })

    return handlers.handle("list", list).handle("resolve", resolve)
  }),
)
