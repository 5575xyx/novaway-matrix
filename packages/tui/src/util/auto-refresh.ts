// 侧栏面板通用的"挂载即加载 + 定时轮询":分区折叠/切走标签页时面板卸载,轮询自动停。
//
// load() 里抛出的异常一律吞掉:面板是侧栏的装饰性信息,某个接口抽风不应该
// 产生 unhandled rejection 把整个 TUI 会话炸掉(崩溃屏就是这么来的)。
// 面板内部想给用户看错误,自己在 load 里 catch 后 set 错误信号。
import { onCleanup, onMount } from "solid-js"

export const SIDEBAR_REFRESH_INTERVAL = 5000

export function useAutoRefresh(load: () => Promise<void> | void, ms = SIDEBAR_REFRESH_INTERVAL) {
  onMount(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => {})
  })
  const timer = setInterval(() => {
    void Promise.resolve()
      .then(load)
      .catch(() => {})
  }, ms)
  onCleanup(() => clearInterval(timer))
}
