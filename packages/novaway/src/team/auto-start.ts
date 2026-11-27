import { Effect } from "effect"

/**
 * 后台自动派发的最小启动桥。
 *
 * `team_run` 工具运行在会话工具层，HTTP handler 运行在路由层；两者不能互相
 * 直接依赖，否则会把整套 HTTP 执行实现复制到工具里。路由层注册真正的启动器，
 * 工具层只提交一次经过授权的启动请求。
 */
export type Input = {
  runID: string
  directory?: string
  options?: {
    captain?: string
    verifier?: string
    maxRounds?: number
    maxBusinessAttempts?: number
    reserveTokens?: number
    concurrency?: number
    callTimeoutMs?: number
  }
}

type Starter = (input: Input) => Effect.Effect<void, unknown, never>

let starter: Starter | undefined

/** 注册当前 HTTP 实例的统一运行入口，并返回清理函数。 */
export const register = (next: Starter) => {
  starter = next
  return () => {
    if (starter === next) starter = undefined
  }
}

/**
 * 请求后台启动。
 *
 * 裸工具测试和非 HTTP runtime 没有启动器时保持 no-op：运行仍会留下可恢复的
 * 已批准状态；真实应用由 run handler 注册启动器，因此不会静默丢失自动派发。
 */
export const start = (input: Input): Effect.Effect<boolean, unknown, never> =>
  starter ? starter(input).pipe(Effect.as(true)) : Effect.succeed(false)
