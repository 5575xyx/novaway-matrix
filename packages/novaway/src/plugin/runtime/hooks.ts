import type { Disposable, InterceptorHook, InterceptorRegistration } from "@novaway/plugin-api"
import { createRegistry, type Entry, type Source } from "../contributions/registry"

/**
 * 拦截器运行时（§10.3、§14.3 第 6 步）：隔离 / 超时 / 熔断 / 逆序释放。
 *
 * 三条不可省的原则：
 *
 * 1. **失败不冒泡**。任何插件的 hook 抛错、超时、把 output 改成非法类型，宿主拿到的都是
 *    「原值 + 一条 skip 记录」。对话链路不能因为第三方代码崩掉——这是 D7 反面的正面要求。
 * 2. **安全优先的方向性**。普通 hook 失败保留原值，但 `tool.execute.before` 失败必须
 *    **拒绝本次工具调用**：这里的默认值不是「原样放行」而是「不放行」，否则坏掉的拦截器
 *    等于悄悄卸载了权限前置检查。
 * 3. **熔断看 (插件, hook) 这一对**。某个插件的 `event` 一直超时不应该让它的
 *    `permission.ask` 也跳过；反之 `chat.params` 连挂三次就先只停 `chat.params`。
 *
 * 超时只是「不再等它」：JS 杀不掉一个已经跑起来的 promise，超时后它仍在事件循环里跑完，
 * 迟到写入收不回来。正因为兜不住，才必须有熔断——同一段代码不能一直拖下去。
 * 要真正中断得靠工具自己的 `AbortSignal`（§4.2 的 `interrupt`），不在这层职责里。
 */

export type FailurePolicy = "keep" | "kernel_default" | "refuse"

export type Budget = {
  timeoutMs: number
  /** `event` 是异步旁路：不等结果，失败直接丢（§10.3 最后一行）。 */
  async: boolean
  /** 失败时宿主怎么办（§10.3「失败策略」列）。 */
  onFailure: FailurePolicy
}

/** §10.3 的表，逐条抄在这里：改表就是改运行时行为，所以只此一份。 */
export const hookBudget: Record<InterceptorHook, Budget> = {
  "chat.message": { timeoutMs: 2_000, async: false, onFailure: "keep" },
  "chat.params": { timeoutMs: 2_000, async: false, onFailure: "keep" },
  "chat.headers": { timeoutMs: 2_000, async: false, onFailure: "keep" },
  "permission.ask": { timeoutMs: 2_000, async: false, onFailure: "kernel_default" },
  "tool.execute.before": { timeoutMs: 2_000, async: false, onFailure: "refuse" },
  "tool.execute.after": { timeoutMs: 5_000, async: false, onFailure: "keep" },
  "tool.definition": { timeoutMs: 2_000, async: false, onFailure: "keep" },
  "command.execute.before": { timeoutMs: 2_000, async: false, onFailure: "keep" },
  "shell.env": { timeoutMs: 1_000, async: false, onFailure: "keep" },
  event: { timeoutMs: 500, async: true, onFailure: "keep" },
}

export const circuitConfig = {
  /** 同一 (插件, hook) 连续失败这么多次 → 跳过 60s（§10.3）。 */
  consecutiveOpens: 3,
  openMs: 60_000,
  /** 10 分钟内失败 10 次 → 插件 `degraded`，除 `event` 外全部跳过。 */
  degradeWindowMs: 600_000,
  degradeFailures: 10,
} as const

export type SkipReason = "timeout" | "throw" | "illegal_output" | "circuit_open" | "degraded"

export type Skipped = {
  pluginID: string
  name: string
  hook: InterceptorHook
  reason: SkipReason
  message?: string
}

export type Outcome<T> = {
  /** 失败策略生效后的 output：抛错 / 非法返回的条目不会留下改动（超时的限制见文件头）。 */
  output: T
  /** `tool.execute.before` 失败：调用方必须拒绝本次工具调用（§10.3 安全优先）。 */
  refused?: { pluginID: string; name: string; message: string }
  /** `permission.ask` 失败：调用方按内核默认判定走，不要采用插件的结论（§10.3）。 */
  defaulted?: { pluginID: string; name: string; message: string }
  skipped: Skipped[]
}

export type Metric = {
  calls: number
  failures: number
  totalMs: number
  maxMs: number
  /** 连续失败计数；达到阈值即清零并打开熔断。 */
  consecutive: number
  /** 熔断打开到什么时候（毫秒时间戳）；不大于当前时间表示没打开。 */
  openUntil: number
  /** 失败时间戳：「10 分钟内 10 次」要的是窗口，不是一路累加到永远。 */
  failedAt: number[]
}

/** `metric` 对外只暴露这份；`hook` 名字与 `pluginID` 存在条目里，诊断页不必反解组合键。 */
type State = { pluginID: string; hook: InterceptorHook; metric: Metric }

export type Input = {
  /** 时间源与等待函数都注进来：熔断窗口（60s / 10min）不能用真实时间测。 */
  now?: () => number
  wait?: (ms: number) => Promise<void>
  /** 降级要通知 Host 改状态（§10.1 的 `degraded`）；Host 接线在第 9 步。 */
  onDegrade?: (pluginID: string, hook: InterceptorHook) => void
}

export type InterceptorRuntime = {
  register(source: Source, item: InterceptorRegistration): Disposable
  /** 停用 / 卸载：按 pluginID 批量摘掉拦截器，并清掉它的熔断与降级状态。 */
  release(pluginID: string, ownerID?: string): void
  /** §5.2 的 `ctx.interceptors` 按 `Registry` 形状读；注册表归运行时所有，这三个只转发。 */
  resolve(name: string): Entry<InterceptorRegistration> | undefined
  list(): readonly Entry<InterceptorRegistration>[]
  onDidChange(fn: () => void): Disposable
  trigger<T>(hook: InterceptorHook, input: unknown, output: T): Promise<Outcome<T>>
  /** 该 hook 当前会按什么顺序跑哪些插件（诊断页与 §15.6 conformance 用）。 */
  chain(hook: InterceptorHook): Array<{ pluginID: string; name: string }>
  metric(pluginID: string, hook: InterceptorHook): Metric | undefined
  metrics(): Array<{ pluginID: string; hook: InterceptorHook; metric: Metric }>
  degraded(): string[]
  /** 测试与诊断用：手动打开某个 (插件, hook) 的熔断。 */
  trip(pluginID: string, hook: InterceptorHook, ms?: number): void
}

export function createInterceptorRuntime(input?: Input): InterceptorRuntime {
  const now = input?.now ?? Date.now
  const wait =
    input?.wait ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)?.unref?.()
      }))
  // 拦截器是累加型（§4.8）：hook 链上少跑一个插件是行为变化，不是冲突解决。
  const registry = createRegistry<InterceptorRegistration>({ kind: "interceptor", policy: "accumulate" })
  const states = new Map<string, State>()
  const downgraded = new Set<string>()

  function state(pluginID: string, hook: InterceptorHook) {
    const key = `${pluginID}|${hook}`
    const hit = states.get(key)
    if (hit !== undefined) return hit.metric
    const fresh: State = {
      pluginID,
      hook,
      metric: { calls: 0, failures: 0, totalMs: 0, maxMs: 0, consecutive: 0, openUntil: 0, failedAt: [] },
    }
    states.set(key, fresh)
    return fresh.metric
  }

  /** 记账 + 状态迁移：连续失败开熔断，窗口内累计失败开降级。 */
  function fail(item: { pluginID: string; name: string }, hook: InterceptorHook, message: string): Skipped {
    const metric = state(item.pluginID, hook)
    const stamp = now()
    metric.failures += 1
    metric.consecutive += 1
    metric.failedAt.push(stamp)
    if (metric.consecutive >= circuitConfig.consecutiveOpens) {
      metric.consecutive = 0
      metric.openUntil = stamp + circuitConfig.openMs
    }
    metric.failedAt = metric.failedAt.filter((at) => stamp - at <= circuitConfig.degradeWindowMs)
    if (metric.failedAt.length >= circuitConfig.degradeFailures && !downgraded.has(item.pluginID)) {
      downgraded.add(item.pluginID)
      input?.onDegrade?.(item.pluginID, hook)
    }
    return { pluginID: item.pluginID, name: item.name, hook, reason: "throw", message }
  }

  async function trigger<T>(hook: InterceptorHook, callInput: unknown, output: T): Promise<Outcome<T>> {
    const budget = hookBudget[hook]
    const skipped: Skipped[] = []
    const result: Outcome<T> = { output, skipped }
    const chain = registry.list()
    // 本轮走的是组装时的链快照：§4.11——在途轮次不受中途停用影响，下一轮才生效。
    for (const entry of chain) {
      const item = entry.item
      if (item.hook !== hook) continue
      if (!matches(item, callInput)) continue
      const who = { pluginID: entry.pluginID, name: entry.name }
      const metric = state(entry.pluginID, hook)
      if (downgraded.has(entry.pluginID) && hook !== "event") {
        skipped.push({
          ...who,
          hook,
          reason: "degraded",
          message: "窗口内失败 10 次：除 event 外全部跳过（§10.3）",
        })
        continue
      }
      if (metric.openUntil > now()) {
        skipped.push({ ...who, hook, reason: "circuit_open", message: "连续失败 3 次：熔断 60s（§10.3）" })
        continue
      }
      metric.calls += 1
      const started = now()
      const before = snapshot(output)
      const run = guard(() => item.handler(callInput, output))
      if (budget.async) {
        // `event` 是旁路：不 await、失败丢弃，也不参与回滚——它本来就不该改 output。
        void run.catch((error: unknown) => {
          fail(who, hook, display(error))
        })
        continue
      }
      const settled = await race(run, budget.timeoutMs, wait)
      const took = now() - started
      metric.totalMs += took
      metric.maxMs = Math.max(metric.maxMs, took)
      if (settled.status === "ok") {
        const broken = rollback(output, before)
        if (broken.length === 0) {
          metric.consecutive = 0
          continue
        }
        skipped.push({
          ...fail(who, hook, `把 ${broken.join("、")} 改成了非法类型，已回滚`),
          reason: "illegal_output",
        })
        applyFailure(result, who, budget, `把 ${broken.join("、")} 改成了非法类型`)
        continue
      }
      if (settled.status === "timeout") {
        revert(output, before)
        skipped.push({ ...fail(who, hook, "超时"), reason: "timeout", message: `超过 ${budget.timeoutMs}ms 未返回` })
        applyFailure(result, who, budget, `拦截器 ${hook} 超时`)
        continue
      }
      revert(output, before)
      skipped.push(fail(who, hook, settled.message))
      applyFailure(result, who, budget, settled.message)
    }
    return result
  }

  return {
    register(source, item) {
      return registry.register(source, item)
    },
    release(pluginID, ownerID = pluginID) {
      registry.release(ownerID)
      if (ownerID === pluginID) {
        for (const [key, hit] of states) {
          if (key.startsWith(`${pluginID}|`) || hit.pluginID === pluginID) states.delete(key)
        }
        downgraded.delete(pluginID)
      }
    },
    resolve(name) {
      return registry.resolve(name)
    },
    list() {
      return registry.list()
    },
    onDidChange(fn) {
      return registry.onDidChange(fn)
    },
    trigger,
    chain(hook) {
      return registry
        .list()
        .filter((entry) => entry.item.hook === hook)
        .map((entry) => ({ pluginID: entry.pluginID, name: entry.name }))
    },
    metric(pluginID, hook) {
      return states.get(`${pluginID}|${hook}`)?.metric
    },
    metrics() {
      return [...states.values()].map((hit) => ({ pluginID: hit.pluginID, hook: hit.hook, metric: hit.metric }))
    },
    degraded() {
      return [...downgraded]
    },
    trip(pluginID, hook, ms) {
      state(pluginID, hook).openUntil = now() + (ms ?? circuitConfig.openMs)
    },
  }
}

function applyFailure<T>(result: Outcome<T>, who: { pluginID: string; name: string }, budget: Budget, message: string) {
  if (budget.onFailure === "refuse") {
    result.refused = { ...who, message: `${who.name} ${message}：本次工具调用被拒绝（§10.3 安全优先）` }
    return
  }
  if (budget.onFailure === "kernel_default") {
    result.defaulted = { ...who, message: `${who.name} ${message}：按内核默认判定继续` }
  }
}

function matches(item: InterceptorRegistration, input: unknown) {
  const filter = item.filter
  if (filter === undefined) return true
  if (!isObject(input)) return true
  if (filter.tool !== undefined && !includes(filter.tool, input.tool)) return false
  return filter.agent === undefined || includes(filter.agent, input.agent)
}

function includes(list: string[] | undefined, value: unknown) {
  if (list === undefined) return true
  return typeof value === "string" && list.includes(value)
}

/**
 * 非法返回的判定口径只守一条：**顶层键的类型层级不许变**。
 *
 * 字段级 schema 校验是各调用点的活（M1 接线时按 hook 各自的结构做）。在这一层猜 schema 的方向性
 * 错误是「把合法改动当非法回滚掉」，比放过一次非法改动更贵。
 */
function snapshot(output: unknown): Map<string, unknown> | undefined {
  if (!isObject(output)) return undefined
  const out = new Map<string, unknown>()
  for (const key of Object.keys(output)) out.set(key, output[key])
  return out
}

/** 把被改坏的顶层键改回快照值，返回改坏的键名（失败不留痕，§10.3「保留原值」）。 */
function rollback(output: unknown, before: Map<string, unknown> | undefined) {
  if (before === undefined || !isObject(output)) return []
  const broken: string[] = []
  for (const [key, value] of before) {
    if (kindOf(output[key]) === kindOf(value)) continue
    broken.push(key)
    output[key] = value
  }
  return broken
}

/**
 * 抛错 / 超时用的是完整版回滚：顶层键集合也要一起复原。
 *
 * 「非法返回」只回滚改坏的键，那是**合法改动要留下**；抛错则一条都不能留，否则插件在
 * 异常前写下的半个字段会一路带到模型请求里。管不到的是嵌套对象——快照只存引用，
 * 深层改动收不回来，这也是 §10.3 只把 hook 定位成「改顶层字段」的原因。
 */
function revert(output: unknown, before: Map<string, unknown> | undefined) {
  if (before === undefined || !isObject(output)) return
  for (const key of Object.keys(output)) {
    if (!before.has(key)) delete output[key]
  }
  for (const [key, value] of before) output[key] = value
}

function kindOf(value: unknown) {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

type Settled = { status: "ok" } | { status: "timeout" } | { status: "error"; message: string }

/** 超时用哨兵区分：插件自己抛的错不能算超时，两者的失败策略与日志都不一样。 */
const timeoutSignal = Symbol("plugin.hook.timeout")

/** 同步抛错也要变成 rejected promise——否则 `trigger` 的隔离覆盖不到 handler 那一行。 */
async function guard(run: () => void | Promise<void>) {
  await run()
}

async function race(run: Promise<void>, timeoutMs: number, wait: (ms: number) => Promise<void>): Promise<Settled> {
  try {
    await Promise.race([run, wait(timeoutMs).then(() => Promise.reject(timeoutSignal))])
    return { status: "ok" }
  } catch (error) {
    if (error === timeoutSignal) return { status: "timeout" }
    return { status: "error", message: display(error) }
  }
}

function display(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
