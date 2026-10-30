import { Context, Effect, Layer, Semaphore } from "effect"

/**
 * 团队内单写者（§10.1）。
 *
 * 团队级 worktree 解决了「别的团队看不到我的半成品」，但**不能**解决同一团队内
 * 两个成员同时写：即使改的是不同文件，也可能同时动 git index、lock 文件，
 * 或让测试读到别人未完成的改动。所以写操作必须串行，只读操作不排队。
 *
 * 边界说清楚：
 * - 这是**进程内**的互斥。本项目的状态与工具执行都在同一个服务进程里，
 *   这足够挡住并发；进程重启后原来的写操作要么已结束、要么停在 `started`
 *   （由 op-log 判 `unknown`），不会带着锁复活；
 * - 锁按 `runID` 分配。P1 一次运行只有一个团队，两者等价；多团队 DAG
 *   落地时应改成按团队分配，否则会白白串行化本来可以并行的团队。
 */

export type Writer = { runID: string; actor: string }

export type Snapshot = { holder?: string; waiting: number }

export interface Interface {
  /** 排队执行一次写操作；被中断时同样释放。 */
  readonly serial: <A, E, R>(writer: Writer, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly snapshot: (runID: string) => Snapshot
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/TeamWriter") {}

export const layer = Layer.effect(
  Service,
  Effect.sync(() => {
    const locks = new Map<string, Semaphore.Semaphore>()
    const holders = new Map<string, string>()
    const pending = new Map<string, number>()

    const lock = (runID: string) => {
      const hit = locks.get(runID)
      if (hit) return hit
      const next = Semaphore.makeUnsafe(1)
      locks.set(runID, next)
      return next
    }

    const serial: Interface["serial"] = (writer, effect) =>
      Effect.suspend(() => {
        pending.set(writer.runID, (pending.get(writer.runID) ?? 0) + 1)
        // 持锁期间才标记 holder；解锁后由内层 finalizer 清掉，
        // 外层 finalizer 只负责计数 —— 中断在排队阶段也能减对。
        const guarded = Effect.gen(function* () {
          holders.set(writer.runID, writer.actor)
          return yield* effect
        }).pipe(Effect.ensuring(Effect.sync(() => holders.delete(writer.runID))))
        return lock(writer.runID)
          .withPermits(1)(guarded)
          .pipe(
            Effect.ensuring(
              Effect.sync(() => {
                const next = (pending.get(writer.runID) ?? 1) - 1
                if (next <= 0) pending.delete(writer.runID)
                else pending.set(writer.runID, next)
              }),
            ),
          )
      })

    return {
      serial,
      snapshot: (runID) => {
        const holder = holders.get(runID)
        const total = pending.get(runID) ?? 0
        return { holder, waiting: Math.max(0, total - (holder ? 1 : 0)) }
      },
    }
  }),
)

export const defaultLayer = layer
export * as TeamWriter from "./writer"
