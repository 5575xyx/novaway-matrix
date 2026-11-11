/**
 * 从系统里打开的文档（Finder 双击、资源管理器「打开方式」、命令行带文件启动）。
 *
 * 主进程把路径推给渲染层，但渲染层不一定已经挂好监听 —— 冷启动时事件往往比
 * 应用挂载还早。所以和深链一样分两段：主进程先「排队 + 广播」，
 * 这里挂载时再把队列里没被接走的取出来。
 *
 * 应用挂载后收到的文件也不一定立刻能开：右侧文件标签属于某条任务页，
 * 没有任务页时先记在 `queued` 里，等任务页挂载后再取，即
 * 「files opened from outside wait in a queue」。
 */
import { createSignal } from "solid-js"

export const openFilesEvent = "NovaWay:open-files"

export type OpenFilesHost = {
  __NOVAWAY__?: {
    openFiles?: string[]
  }
}

/** 取走主进程在应用挂载前排下的文件（取完清空，避免重复打开）。 */
export const drainPendingOpenFiles = (target: OpenFilesHost) => {
  const pending = target.__NOVAWAY__?.openFiles ?? []
  if (pending.length === 0) return []
  if (target.__NOVAWAY__) target.__NOVAWAY__.openFiles = []
  return pending
}

const [queued, setQueued] = createSignal<string[]>([])

/** 队列本身是响应式的：任务页已经挂载时也能立刻收到新排进来的文件。 */
export const queuedOpenFiles = queued

/** 等任务页出现后再开：路径先排进队列。 */
export const queueOpenFiles = (paths: string[]) => {
  const clean = paths.filter((path) => path.length > 0)
  if (clean.length === 0) return
  setQueued((current) => [...current, ...clean])
}

/** 任务页挂载时取走队列。 */
export const drainQueuedOpenFiles = () => {
  const paths = queued()
  if (paths.length > 0) setQueued([])
  return paths
}
