import { Elicitation } from "@/mcp/elicitation"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const elicitationHandlers = HttpApiBuilder.group(InstanceHttpApi, "elicitation", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Elicitation.Service

    const list = Effect.fn("ElicitationHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("ElicitationHttpApi.reply")(function* (ctx: {
      params: { requestID: string }
      payload: { action: Elicitation.Action; content?: Record<string, unknown> }
    }) {
      yield* svc.reply({
        requestID: ctx.params.requestID,
        action: ctx.payload.action,
        ...(ctx.payload.content ? { content: ctx.payload.content } : {}),
      })
      return true
    })

    const reject = Effect.fn("ElicitationHttpApi.reject")(function* (ctx: { params: { requestID: string } }) {
      yield* svc.reject(ctx.params.requestID)
      return true
    })

    return handlers.handle("list", list).handle("reply", reply).handle("reject", reject)
  }),
)
