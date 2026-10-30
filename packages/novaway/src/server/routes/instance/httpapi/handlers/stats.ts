import { Stats } from "@/stats/service"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const statsHandlers = HttpApiBuilder.group(InstanceHttpApi, "stats", (handlers) =>
  Effect.gen(function* () {
    const stats = yield* Stats.Service
    return handlers.handle("get", (ctx: { query: { days?: number; project?: string } }) =>
      stats.aggregate({ days: ctx.query.days, project: ctx.query.project }),
    )
  }),
)
