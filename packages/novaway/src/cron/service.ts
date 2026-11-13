// 会话级定时任务的调度器。
//
// 对齐 CC 的 CronCreate / CronDelete / CronList 三个工具：任务按标准 5 字段
// cron 在本地时区触发，触发时把 prompt 作为新的用户消息投进原会话。
//
// 与 CC 的差异（有意保留）：
// - 不加 jitter：我们不在同一个后端集群上跑成千上万个会话，抖动只会让用户
//   看到「说好的 9:00 变成 9:03」。
// - 只在会话空闲时投递：会话正在跑的时候插一条用户消息会打断当前回合，
//   所以这一轮跳过、下一轮再试。
//
// 循环任务触发 7 天后自动过期（再触发最后一次后删除），避免会话变成永动机。

import { Context, Effect, Layer, Option } from "effect"
import * as Log from "@novaway/core/util/log"
import type { SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import * as Cron from "./cron"
import * as Tasks from "./tasks"

const log = Log.create({ service: "cron" })

/** 调度器的最小精度。cron 只到分钟，15 秒一轮足够且不会明显空转。 */
const TICK_MS = 15_000

export interface Interface {
  readonly create: (input: {
    sessionID: string
    directory: string
    cron: string
    prompt: string
    recurring?: boolean
    durable?: boolean
  }) => Effect.Effect<Tasks.Task, Error>
  readonly remove: (input: { id: string; directory: string }) => Effect.Effect<boolean>
  readonly list: (input: { sessionID?: string; directory: string }) => Effect.Effect<Tasks.Task[]>
  /** 跑一轮调度；返回本轮真正投递出去的任务。 */
  readonly tick: (input?: { now?: number; directory?: string }) => Effect.Effect<Tasks.Task[]>
  /** 启动后台调度循环（重复调用无副作用）。 */
  readonly start: (input: { directory: string }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@novaway/Cron") {}

type PromptService = {
  prompt: (input: { sessionID: SessionID; parts: { type: "text"; text: string }[] }) => Effect.Effect<unknown, unknown>
}

/**
 * SessionPrompt 在 tool → registry → session/prompt 之间构成环，静态导入会让
 * 模块初始化炸掉；这里按需动态取服务实例（token 由模块对象保证同一性）。
 */
const promptService = Effect.gen(function* () {
  const mod = yield* Effect.promise(() => import("@/session/prompt")).pipe(Effect.orDie)
  return Option.getOrUndefined(yield* Effect.serviceOption(mod.Service))
}) as Effect.Effect<PromptService | undefined>

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let loop: { running: boolean } = { running: false }

    /**
     * Hand the prompt to the session and return immediately. The turn itself can
     * run for minutes; awaiting it here would stall every other scheduled job.
     */
    const deliver = (task: Tasks.Task, prompt: PromptService) =>
      Effect.gen(function* () {
        yield* prompt
          .prompt({
            sessionID: task.sessionID as SessionID,
            parts: [{ type: "text", text: task.prompt }],
          })
          .pipe(Effect.ignore)
      })

    /**
     * 技能生命周期巡检：复用常驻的 tick，不额外起进程或会话。
     *
     * 只在 `evolution.curator_enabled` 打开且有技能服务时工作；每周最多一次，
     * 判定与归档都是「标记/移动」，失败只记日志，不影响定时任务投递。
     */
    const curatorTick = Effect.fn("Cron.curator")(function* (input: { directory: string; now: number }) {
      const configModules = yield* Effect.promise(() =>
        Promise.all([import("@/config/config"), import("@/config/evolution")]),
      ).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!configModules) return
      const [configModule, evolutionModule] = configModules
      const config = Option.getOrUndefined(yield* Effect.serviceOption(configModule.Config.Service))
      if (!config) return
      const cfg = evolutionModule.ConfigEvolution.resolve(
        (yield* config.get().pipe(Effect.catch(() => Effect.succeed({} as { evolution?: never })))).evolution,
      )
      // 默认关闭：未启用时连技能服务都不必加载。
      if (!cfg.curator_enabled) return
      const modules = yield* Effect.promise(() =>
        Promise.all([import("@/skill"), import("@/skill/curator"), import("@/skill/usage")]),
      ).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!modules) return
      const [skillModule, curatorModule, usageModule] = modules
      const skill = Option.getOrUndefined(yield* Effect.serviceOption(skillModule.Skill.Service))
      if (!skill) return
      if (!(yield* Effect.promise(() => curatorModule.due(input.directory, input.now)))) return
      const available = yield* skill.all()
      const ledger = yield* Effect.promise(() => usageModule.read(input.directory))
      const decisions = yield* Effect.promise(() =>
        curatorModule.run({
          directory: input.directory,
          skills: available.map((item) => ({
            name: item.name,
            location: item.location,
            builtIn: item.builtIn,
            lastActivity: 0,
          })),
          ledger,
          now: input.now,
          staleDays: cfg.curator_stale_days,
          archiveDays: cfg.curator_archive_days,
        }),
      )
      if (decisions.length) log.info("skill curator finished", { directory: input.directory, decisions })
      // 归档/标记后让运行时技能列表立刻反映变化。
      if (decisions.some((item) => item.action === "archive")) yield* skill.reload().pipe(Effect.ignore)
    })

    const tick = Effect.fn("Cron.tick")(function* (input?: { now?: number; directory?: string }) {
      const now = input?.now ?? Date.now()
      const status = Option.getOrUndefined(yield* Effect.serviceOption(SessionStatus.Service))
      const prompt = yield* promptService
      const fired: Tasks.Task[] = []

      if (input?.directory) yield* curatorTick({ directory: input.directory, now }).pipe(Effect.ignore)

      for (const task of Tasks.all()) {
        if (Tasks.expired(task, now)) {
          Tasks.remove(task.id)
          if (task.durable) yield* Effect.promise(() => Tasks.persist(task.directory)).pipe(Effect.ignore)
          continue
        }

        const dueAt = Tasks.due(task, now)
        if (dueAt === undefined) continue

        // No runtime to run prompts (embedders, unit tests): leave the job queued.
        if (!prompt) break

        // Busy sessions would have this message interleaved with a running turn;
        // skip and retry on the next tick instead.
        const state = status
          ? yield* status
              .get(task.sessionID as SessionID)
              .pipe(Effect.catch(() => Effect.succeed({ type: "busy" as const })))
          : { type: "idle" as const }
        if (state.type !== "idle") continue

        // Mark before delivering: the prompt may take minutes, and a duplicate
        // delivery is worse than a missed retry.
        Tasks.markFired(task.id, dueAt)
        if (!task.recurring) Tasks.remove(task.id)
        if (task.durable) yield* Effect.promise(() => Tasks.persist(task.directory)).pipe(Effect.ignore)
        fired.push(task)
        yield* deliver(task, prompt).pipe(Effect.forkDetach)
      }

      return fired
    })

    const start = Effect.fn("Cron.start")(function* (input: { directory: string }) {
      yield* Effect.promise(() => Tasks.load(input.directory)).pipe(Effect.ignore)
      if (loop.running) return
      loop.running = true
      yield* Effect.sleep(`${TICK_MS} millis`).pipe(
        Effect.andThen(tick({ directory: input.directory })),
        Effect.ignore,
        Effect.forever,
        Effect.forkDetach,
      )
    })

    const create = Effect.fn("Cron.create")(function* (input: {
      sessionID: string
      directory: string
      cron: string
      prompt: string
      recurring?: boolean
      durable?: boolean
    }) {
      const invalid = Cron.validate(input.cron)
      if (invalid) return yield* Effect.fail(new Error(invalid))

      yield* Effect.promise(() => Tasks.load(input.directory)).pipe(Effect.ignore)
      const recurring = input.recurring !== false
      const now = Date.now()
      const task: Tasks.Task = {
        id: Tasks.id(),
        cron: input.cron.trim(),
        prompt: input.prompt,
        createdAt: now,
        recurring,
        durable: input.durable === true,
        sessionID: input.sessionID,
        directory: input.directory,
        ...(recurring ? { expiresAt: now + Tasks.RECURRING_MAX_AGE_MS } : {}),
      }
      Tasks.add(task)
      if (task.durable) yield* Effect.promise(() => Tasks.persist(input.directory)).pipe(Effect.ignore)
      return task
    })

    const remove = Effect.fn("Cron.remove")(function* (input: { id: string; directory: string }) {
      const task = Tasks.get(input.id)
      if (!task) return false
      const removed = Tasks.remove(input.id)
      if (task.durable) yield* Effect.promise(() => Tasks.persist(task.directory)).pipe(Effect.ignore)
      return removed
    })

    const list = Effect.fn("Cron.list")(function* (input: { sessionID?: string; directory: string }) {
      yield* Effect.promise(() => Tasks.load(input.directory)).pipe(Effect.ignore)
      if (!input.sessionID) return Tasks.all()
      return Tasks.forSession(input.sessionID)
    })

    return Service.of({ create, remove, list, tick, start })
  }),
)

export const defaultLayer = layer

export * as Cron from "."
