import { InstanceState } from "@/effect/instance-state"
import { Database } from "@/storage/db"
import { desc, eq } from "drizzle-orm"
import { BackgroundJobTable } from "./job.sql"
import { Identifier } from "@/id/id"
import { Cause, Clock, Context, Deferred, Effect, Fiber, Layer, Scope, SynchronizedRef } from "effect"
import * as Log from "@novaway/core/util/log"

const log = Log.create({ service: "background.job" })

export type Status = "running" | "completed" | "error" | "cancelled"

export type Info = {
  id: string
  type: string
  title?: string
  status: Status
  started_at: number
  completed_at?: number
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

type Active = {
  info: Info
  done: Deferred.Deferred<Info>
  fiber?: Fiber.Fiber<void, unknown>
  /** 可选的协作式取消钩子。先让任务自己收尾（例如终止子进程），再打断 fiber。 */
  cancel?: Effect.Effect<void>
}

type State = {
  jobs: SynchronizedRef.SynchronizedRef<Map<string, Active>>
  scope: Scope.Scope
}

type FinishResult = {
  info?: Info
  done?: Deferred.Deferred<Info>
}

/**
 * run 的返回值。字符串等价于 `{ output }`，所以老的调用方不需要改。
 *
 * `failed` 非空时 job 以 error 态结束而不是 completed——被监控的命令退出码非 0、
 * 监控超时这些情况以前一律被标成"已完成"，右侧状态卡就显示一个绿色的谎话。
 */
export type RunOutcome = {
  output: string
  failed?: string
}

export type StartInput = {
  id?: string
  type: string
  title?: string
  metadata?: Record<string, unknown>
  /** 协作式取消：在中断 fiber 之前执行，用来杀掉真实进程/连接。 */
  cancel?: Effect.Effect<void>
  run: Effect.Effect<string | RunOutcome, unknown>
}

export type UpdateInput = {
  title?: string
  output?: string
  metadata?: Record<string, unknown>
}

export type WaitInput = {
  id: string
  timeout?: number
}

export type WaitResult = {
  info?: Info
  timedOut: boolean
}

export interface Interface {
  /**
   * Live jobs by default. Pass `includePersisted` to also see jobs that
   * finished in a previous process (the session panel wants that history).
   */
  readonly list: (input?: { includePersisted?: boolean; limit?: number }) => Effect.Effect<Info[]>
  /**
   * Persisted rows only, newest first. Used by restore logic that must look at
   * jobs which are no longer in memory (a previous process wrote them).
   */
  readonly history: (input?: { limit?: number }) => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly update: (id: string, input: UpdateInput) => Effect.Effect<Info | undefined>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/BackgroundJob") {}

function persist(info: Info) {
  try {
    Database.use((db) => {
      db.insert(BackgroundJobTable)
        .values({
          id: info.id,
          type: info.type,
          title: info.title ?? null,
          status: info.status,
          started_at: info.started_at,
          completed_at: info.completed_at ?? null,
          output: info.output ?? null,
          error: info.error ?? null,
          metadata: info.metadata ?? null,
        })
        .onConflictDoUpdate({
          target: BackgroundJobTable.id,
          set: {
            status: info.status,
            completed_at: info.completed_at ?? null,
            output: info.output ?? null,
            error: info.error ?? null,
            metadata: info.metadata ?? null,
            title: info.title ?? null,
          },
        })
        .run()
    })
  } catch (error) {
    // 内存里的 job 仍是权威数据，但静默失败会让 background_job 行永远停在旧状态：
    // 面板读到谎话，重启后的 resume 也会按过期的行做决定，而且根本查不出来。
    log.error("failed to persist background job", { id: info.id, status: info.status, error: String(error) })
  }
}

/** How many finished jobs stay visible after a restart. */
const LIST_LIMIT = 50

function toInfo(row: typeof BackgroundJobTable.$inferSelect): Info {
  return {
    id: row.id,
    type: row.type,
    title: row.title ?? undefined,
    status: row.status as Status,
    started_at: row.started_at,
    completed_at: row.completed_at ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    metadata: row.metadata ?? undefined,
  }
}

function snapshot(job: Active): Info {
  return {
    ...job.info,
    ...(job.info.metadata ? { metadata: { ...job.info.metadata } } : {}),
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function runOutcome(value: string | RunOutcome): RunOutcome {
  return typeof value === "string" ? { output: value } : value
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("BackgroundJob.state")(function* () {
        yield* Effect.sync(() => {
          try {
            Database.use((db) =>
              db
                .update(BackgroundJobTable)
                .set({ status: "cancelled", completed_at: Date.now(), error: "interrupted by restart" })
                .where(eq(BackgroundJobTable.status, "running"))
                .run(),
            )
          } catch (error) {
            // 清理失败时 DB 里会留下过期的 running 行：面板与 resume 都会读到谎话。
            log.error("failed to mark stale background jobs as cancelled", { error: String(error) })
          }
        })
        return {
          jobs: yield* SynchronizedRef.make(new Map()),
          scope: yield* Scope.Scope,
        }
      }),
    )

    const finish = Effect.fn("BackgroundJob.finish")(function* (
      id: string,
      status: Exclude<Status, "running">,
      data?: { output?: string; error?: string },
    ) {
      const completed_at = yield* Clock.currentTimeMillis
      const result = yield* SynchronizedRef.modify(
        (yield* InstanceState.get(state)).jobs,
        (jobs): readonly [FinishResult, Map<string, Active>] => {
          const job = jobs.get(id)
          if (!job) return [{}, jobs]
          if (job.info.status !== "running") return [{ info: snapshot(job) }, jobs]
          const next = {
            ...job,
            fiber: undefined,
            info: {
              ...job.info,
              status,
              completed_at,
              ...(data?.output !== undefined ? { output: data.output } : {}),
              ...(data?.error !== undefined ? { error: data.error } : {}),
            },
          }
          return [{ info: snapshot(next), done: job.done }, new Map(jobs).set(id, next)]
        },
      )
      if (result.info) yield* Effect.sync(() => persist(result.info!))
      if (result.info && result.done) yield* Deferred.succeed(result.done, result.info).pipe(Effect.ignore)
      return result.info
    })

    /**
     * Jobs that finished before a restart (or in another process sharing the
     * same database) only exist as rows, so the live map is merged over
     * persisted history. Newest first, capped: the panel wants recent context,
     * not the whole audit log.
     */
    const persisted = (limit: number): Info[] => {
      try {
        return Database.use((db) =>
          db.select().from(BackgroundJobTable).orderBy(desc(BackgroundJobTable.started_at)).limit(limit).all(),
        ).map(toInfo)
      } catch {
        return []
      }
    }

    const list: Interface["list"] = Effect.fn("BackgroundJob.list")(function* (input) {
      const merged = new Map<string, Info>()
      if (input?.includePersisted) {
        for (const job of persisted(input.limit ?? LIST_LIMIT)) merged.set(job.id, job)
      }
      // Live entries win: their output/metadata is fresher than the last write.
      for (const job of (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).values()) {
        merged.set(job.info.id, snapshot(job))
      }
      return [...merged.values()].toSorted((a, b) => b.started_at - a.started_at)
    })

    const get: Interface["get"] = Effect.fn("BackgroundJob.get")(function* (id) {
      const job = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).get(id)
      if (job) return snapshot(job)
      // A job that finished in a previous process is still answerable.
      return persisted(LIST_LIMIT).find((item) => item.id === id)
    })

    // 长任务（例如后台 shell）运行期间持续写回实时输出；
    // 只更新仍在运行的 job，避免完成后被迟到的进度覆盖。
    const update: Interface["update"] = Effect.fn("BackgroundJob.update")(function* (id: string, input: UpdateInput) {
      const result = yield* SynchronizedRef.modify(
        (yield* InstanceState.get(state)).jobs,
        (jobs): readonly [Info | undefined, Map<string, Active>] => {
          const job = jobs.get(id)
          if (!job || job.info.status !== "running") return [undefined, jobs]
          const next = {
            ...job,
            info: {
              ...job.info,
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.output !== undefined ? { output: input.output } : {}),
              ...(input.metadata !== undefined ? { metadata: { ...job.info.metadata, ...input.metadata } } : {}),
            },
          }
          return [snapshot(next), new Map(jobs).set(id, next)]
        },
      )
      if (result) yield* Effect.sync(() => persist(result))
      return result
    })

    const start: Interface["start"] = Effect.fn("BackgroundJob.start")(function* (input: StartInput) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          const id = input.id ?? Identifier.ascending("job")
          const started_at = yield* Clock.currentTimeMillis
          const done = yield* Deferred.make<Info>()
          const result = yield* SynchronizedRef.modifyEffect(
            s.jobs,
            Effect.fnUntraced(function* (jobs) {
              const existing = jobs.get(id)
              if (existing?.info.status === "running") return [snapshot(existing), jobs] as const
              const fiber = yield* restore(input.run).pipe(
                Effect.matchCauseEffect({
                  onSuccess: (value) => {
                    const outcome = runOutcome(value)
                    return finish(id, outcome.failed ? "error" : "completed", {
                      output: outcome.output,
                      ...(outcome.failed ? { error: outcome.failed } : {}),
                    })
                  },
                  onFailure: (cause) =>
                    finish(id, Cause.hasInterruptsOnly(cause) ? "cancelled" : "error", {
                      error: errorText(Cause.squash(cause)),
                    }),
                }),
                Effect.asVoid,
                Effect.forkIn(s.scope, { startImmediately: true }),
              )
              const job = {
                info: {
                  id,
                  type: input.type,
                  title: input.title,
                  status: "running" as const,
                  started_at,
                  metadata: input.metadata,
                },
                done,
                fiber,
                ...(input.cancel ? { cancel: input.cancel } : {}),
              }
              return [snapshot(job), new Map(jobs).set(id, job)] as const
            }),
          )
          yield* Effect.sync(() => persist(result))
          return result
        }),
      )
    })

    const wait: Interface["wait"] = Effect.fn("BackgroundJob.wait")(function* (input) {
      const job = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).get(input.id)
      if (!job) return { timedOut: false }
      if (job.info.status !== "running") return { info: snapshot(job), timedOut: false }
      if (input.timeout === undefined) return { info: yield* Deferred.await(job.done), timedOut: false }
      if (input.timeout <= 0) return { info: snapshot(job), timedOut: true }
      const info = yield* Deferred.await(job.done).pipe(Effect.timeoutOption(input.timeout))
      if (info._tag === "Some") return { info: info.value, timedOut: false }
      return { info: snapshot(job), timedOut: true }
    })

    const cancel: Interface["cancel"] = Effect.fn("BackgroundJob.cancel")(function* (id) {
      const job = (yield* SynchronizedRef.get((yield* InstanceState.get(state)).jobs)).get(id)
      if (!job) return
      if (job.info.status !== "running") return snapshot(job)
      // 先把状态钉成 cancelled：取消钩子/中断可能让 run 正常返回，
      // 若不先落状态，onSuccess 会把这次"停止"记成 completed。
      const info = yield* finish(id, "cancelled")
      // 协作式取消（杀子进程 / 中止请求），再打断 fiber。
      if (job.cancel) yield* job.cancel.pipe(Effect.ignore)
      if (job.fiber) {
        yield* Fiber.interrupt(job.fiber).pipe(Effect.ignore)
        yield* Fiber.await(job.fiber).pipe(Effect.ignore)
      }
      return info
    })

    return Service.of({
      list,
      history: (input) => Effect.sync(() => persisted(input?.limit ?? LIST_LIMIT)),
      get,
      start,
      update,
      wait,
      cancel,
    })
  }),
)

export const defaultLayer = layer

export * as BackgroundJob from "./job"
