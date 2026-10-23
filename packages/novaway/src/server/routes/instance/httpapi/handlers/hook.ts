import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { Service as HookService } from "@/hook/service"

export const hookHandlers = HttpApiBuilder.group(InstanceHttpApi, "hook", (handlers) =>
  Effect.gen(function* () {
    const hooks = yield* HookService

    return handlers
      .handle("active", () => hooks.active().pipe(Effect.map((list) => list.map((item) => ({ ...item })))))
      .handle("list", () =>
        Effect.gen(function* () {
          const list = yield* hooks.list()
          return list.map((item) => ({
            event: item.event,
            matcher: item.matcher,
            source: item.source,
            count: item.hooks.length,
            types: [...new Set(item.hooks.map((hook) => hook.type))],
            statusMessages: item.hooks.flatMap((hook) => (hook.statusMessage ? [hook.statusMessage] : [])),
          }))
        }),
      )
  }),
)
