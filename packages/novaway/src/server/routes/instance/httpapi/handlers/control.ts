import { Auth } from "@/auth"
import { ProviderID } from "@/provider/schema"
import * as Log from "@novaway/core/util/log"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authList = Effect.fn("ControlHttpApi.authList")(function* (ctx: { params: { providerID: ProviderID } }) {
      const entries = yield* auth.getEntries(ctx.params.providerID).pipe(Effect.orDie)
      return entries
    })

    const authAddEntry = Effect.fn("ControlHttpApi.authAddEntry")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      yield* auth.addEntry(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: { params: { providerID: ProviderID } }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      return true
    })

    const authRemoveEntry = Effect.fn("ControlHttpApi.authRemoveEntry")(function* (ctx: {
      params: { providerID: ProviderID; entryIndex: string }
    }) {
      const index = Number(ctx.params.entryIndex)
      if (!Number.isInteger(index) || index < 0) return false
      yield* auth.removeEntry(ctx.params.providerID, index).pipe(Effect.orDie)
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const logger = Log.create({ service: ctx.payload.service })
      logger[ctx.payload.level](ctx.payload.message, ctx.payload.extra)
      return true
    })

    return handlers
      .handle("authSet", authSet)
      .handle("authList", authList)
      .handle("authAddEntry", authAddEntry)
      .handle("authRemove", authRemove)
      .handle("authRemoveEntry", authRemoveEntry)
      .handle("log", log)
  }),
)
