import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceState } from "@/effect/instance-state"
import * as registry from "@/dynamic-workflow/runtime/registry"
import { listRuns, readActors, readEvents, readNodes, readRun, summarizeRun } from "@/dynamic-workflow/journal/read"
import { InstanceHttpApi } from "../api"
import { notFound } from "../errors"

/**
 * 动态工作流的只读接口。
 *
 * 三条纪律：
 *   - **不加载全表**：节点、事件都按 limit 取，`summarizeRun` 让数据库数数；
 *   - **进程内优先**：登记表里有这次 run，说明它此刻在跑，`live` / `resumable` 要据此回答；
 *   - **stop 只作用于在跑的**：已经结算的 run 返回 `requested: false`，不编造一个新状态。
 */

const clamp = (value: number | undefined, fallback: number, max: number) =>
  Math.max(1, Math.min(Math.floor(value ?? fallback), max))

export const dynamicWorkflowHandlers = HttpApiBuilder.group(InstanceHttpApi, "dynamic-workflow", (handlers) =>
  Effect.gen(function* () {
    /** 一次 run 的详情。两处要用（get 与 stop 的 404 判定），所以提出来。 */
    const detail = (runId: string) =>
      Effect.gen(function* () {
        const header = yield* Effect.sync(() => readRun(runId))
        if (!header) return undefined
        const progress = yield* Effect.sync(() => summarizeRun(runId))
        const entry = registry.get(runId)
        return {
          ...header,
          resumable: header.status === "stopped",
          live: entry !== undefined && entry.settlement === undefined,
          progress,
        }
      })

    return handlers
      .handle("listRuns", (ctx) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const limit = clamp(ctx.query.limit, 10, 100)
          // 在跑的 run 也在库里（`startRun` 在引擎构造函数里同步写），所以这一个查询就把
          // 两种情形都覆盖了；排序键是 `time_updated`，引擎每写一条记录都会推进它。
          return yield* Effect.sync(() => listRuns(ctx.query.all ? { limit } : { cwd: directory, limit }))
        }),
      )
      .handle("getRun", (ctx) =>
        Effect.gen(function* () {
          const found = yield* detail(ctx.params.runId)
          if (!found) return yield* notFound(`没有 run ${ctx.params.runId}`)
          return found
        }),
      )
      .handle("listNodes", (ctx) =>
        Effect.gen(function* () {
          const header = yield* Effect.sync(() => readRun(ctx.params.runId))
          if (!header) return yield* notFound(`没有 run ${ctx.params.runId}`)
          const kinds = ctx.query.kinds
            ?.split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "")
          return yield* Effect.sync(() =>
            readNodes(ctx.params.runId, {
              ...(kinds && kinds.length > 0 ? { kinds } : {}),
              limit: clamp(ctx.query.limit, 200, 2_000),
              withResult: ctx.query.withResult === true,
            }),
          )
        }),
      )
      .handle("listActors", (ctx) =>
        Effect.gen(function* () {
          const header = yield* Effect.sync(() => readRun(ctx.params.runId))
          if (!header) return yield* notFound(`没有 run ${ctx.params.runId}`)
          return (yield* Effect.sync(() => readActors(ctx.params.runId))).map((row) => ({
            siteId: row.actor.siteId,
            ordinal: row.actor.ordinal,
            ...(row.name ? { name: row.name } : {}),
            ...(row.sessionID ? { sessionID: row.sessionID } : {}),
          }))
        }),
      )
      .handle("listEvents", (ctx) =>
        Effect.gen(function* () {
          const header = yield* Effect.sync(() => readRun(ctx.params.runId))
          if (!header) return yield* notFound(`没有 run ${ctx.params.runId}`)
          const options = {
            ...(ctx.query.after !== undefined ? { after: ctx.query.after } : {}),
            limit: clamp(ctx.query.limit, 64, 500),
          }
          return yield* Effect.sync(() => readEvents(ctx.params.runId, options))
        }),
      )
      .handle("stopRun", (ctx) =>
        Effect.gen(function* () {
          const header = yield* Effect.sync(() => readRun(ctx.params.runId))
          if (!header) return yield* notFound(`没有 run ${ctx.params.runId}`)
          const entry = registry.get(ctx.params.runId)
          if (!entry?.stop) return { requested: false }
          entry.stop("user")
          return { requested: true }
        }),
      )
  }),
)
