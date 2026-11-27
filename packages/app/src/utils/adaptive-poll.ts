import { createEffect, getOwner, on, onCleanup } from "solid-js"

/**
 * 自适应兜底轮询。
 *
 * 后台面板（状态区块、侧栏子会话）用轮询兜「漏掉的实时事件」，但轮询本身也是成本：
 * 一次 tick = 一个 HTTP 请求 + JSON 解析 + store 比较，窗口不可见时照样跑，笔记本上
 * 体现为持续唤醒、发烫、风扇转。这里把三件事收成一处：
 *
 * - **窗口不可见就停表**：连定时器都不留，靠 `visibilitychange` 唤醒，后台零唤醒；
 * - **活跃/空闲两档**：会话在跑（或面板上有待处理项）走 `fast`，空闲走 `idle`；
 *   不传 `idle` 表示空闲期完全不轮询，只靠事件 `poke()` 推进；
 * - **`poke()`**：实时事件到达时立刻拉一次并把节奏重置，避免"事件刚刷新完又赶上一次定时"。
 */
export type AdaptivePollOptions = {
  /** 活跃期间隔（毫秒）。 */
  fast: number
  /** 空闲期间隔；`undefined` = 空闲期不轮询。 */
  idle?: number
  /** 当前是否处于"值得快轮询"的状态（响应式读取，翻转时自动调档）。 */
  active: () => boolean
  /** 自定义可见性；默认窗口可见性（仅可见时才轮询）。 */
  visible?: () => boolean
  /** 注册时是否立刻拉一次，默认 true。 */
  immediate?: boolean
}

export type AdaptivePoll = {
  /** 立刻拉一次，并按当前状态重排下一拍。 */
  poke: () => void
  /** 停止轮询（幂等）。 */
  stop: () => void
  /** 下一拍间隔；`undefined` 表示当前状态不排拍。仅调试/测试用。 */
  delay: () => number | undefined
}

/** 纯函数版档位计算，便于单测。 */
export function adaptiveDelay(active: boolean, options: { fast: number; idle?: number }): number | undefined {
  if (active) return Math.max(0, options.fast)
  if (options.idle === undefined) return undefined
  return Math.max(0, options.idle)
}

export function createAdaptivePoll(load: () => void, options: AdaptivePollOptions): AdaptivePoll {
  const doc = typeof document === "undefined" ? undefined : document
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const visible = () => (options.visible?.() ?? true) && (doc ? doc.visibilityState === "visible" : true)
  const delay = () => adaptiveDelay(options.active(), options)

  const clear = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    clear()
    if (stopped || !visible()) return
    const wait = delay()
    if (wait === undefined) return
    timer = setTimeout(tick, wait)
  }

  const run = () => {
    if (stopped || !visible()) return
    load()
  }

  function tick() {
    timer = undefined
    if (stopped) return
    run()
    schedule()
  }

  const poke = () => {
    if (stopped) return
    run()
    schedule()
  }

  const onVisibility = () => {
    if (stopped) return
    if (!visible()) {
      // 后台彻底停表：不可见期间一次唤醒都不留。
      clear()
      return
    }
    run()
    schedule()
  }

  const stop = () => {
    stopped = true
    clear()
    doc?.removeEventListener("visibilitychange", onVisibility)
  }

  doc?.addEventListener("visibilitychange", onVisibility)
  if (options.immediate ?? true) run()
  schedule()

  const owner = getOwner()
  if (owner) {
    // 自定义可见性（面板展开/收起）是响应式的，翻转时同样要停表/补拉。
    if (options.visible) {
      createEffect(
        on(
          () => visible(),
          (now, previous) => {
            if (stopped || now === previous) return
            if (!now) {
              clear()
              return
            }
            run()
            schedule()
          },
          { defer: true },
        ),
      )
    }
    // 活跃状态翻转时立刻调档：从空闲切到活跃（例如会话开始跑）不该等一整个 idle 周期。
    createEffect(
      on(
        () => options.active(),
        (active, previous) => {
          if (stopped || active === previous) return
          if (active) run()
          schedule()
        },
        { defer: true },
      ),
    )
    onCleanup(stop)
  }

  return { poke, stop, delay }
}
