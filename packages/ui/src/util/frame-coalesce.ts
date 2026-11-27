/**
 * 把高频输入（`mousemove` / `pointermove` / `scroll`）合并到每帧最多一次。
 *
 * 拖拽分隔条这类交互原本是「每次 mousemove 都写一次状态」：高回报率鼠标一秒能发
 * 100–1000 次事件，而每次写入都会触发一次布局重算 + 持久化，真正需要的是「本帧
 * 用户把指针移到了哪」。合并到 rAF 后，中间值只保留最后一个，渲染次数与显示器
 * 刷新率对齐，而**最终落点完全不变**。
 */
export type FrameCoalescer<T> = {
  /** 记下最新值；同一帧内多次调用只有最后一次生效。 */
  push: (value: T) => void
  /** 立刻应用挂起的值（拖拽结束时调用，避免最后一帧丢失）。 */
  flush: () => void
  /** 丢弃挂起的值并取消调度。 */
  cancel: () => void
}

export function createFrameCoalescer<T>(apply: (value: T) => void): FrameCoalescer<T> {
  // 无 rAF 的环境（SSR / 单元测试）退化为同步应用，行为对调用方保持一致。
  const schedule: (cb: () => void) => number | undefined =
    typeof requestAnimationFrame === "function"
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => {
          cb()
          return undefined
        }
  const unschedule: (handle: number) => void =
    typeof cancelAnimationFrame === "function" ? (handle) => cancelAnimationFrame(handle) : () => undefined

  let frame: number | undefined
  let pending: T | undefined
  let hasPending = false

  const run = () => {
    frame = undefined
    if (!hasPending) return
    const value = pending as T
    pending = undefined
    hasPending = false
    apply(value)
  }

  return {
    push(value) {
      pending = value
      hasPending = true
      if (frame !== undefined) return
      const handle = schedule(run)
      if (handle !== undefined) frame = handle
    },
    flush() {
      if (frame !== undefined) {
        unschedule(frame)
        frame = undefined
      }
      run()
    },
    cancel() {
      if (frame !== undefined) {
        unschedule(frame)
        frame = undefined
      }
      pending = undefined
      hasPending = false
    },
  }
}
