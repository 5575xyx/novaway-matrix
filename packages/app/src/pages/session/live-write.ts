import { createSignal } from "solid-js"

// 「AI 正在写这个文件」的短暂标记（模块级单例：同一时刻只有一个文件在被跟）。
//
// 会话页在 file.watcher.updated（且会话运行中）时打点；文件预览据此决定
// 是否用打字机节奏揭示内容 —— 没有标记就直出最新全文（用户自己打开文件
// 不该看到慢悠悠的逐字揭示）。
//
// 用超时自动清标记而不是存截止时间：超时本身触发信号变化，依赖方
// （createMemo/createEffect）能在"跟写窗口结束"时重新求值。
//
// 另外维护一个自增 tick：连续写**同一个文件**时路径不变，光看路径的依赖方
// （比如 office 预览的「重取字节」）收不到通知，会漏掉后续几次刷新。

const [path, setPath] = createSignal<string | undefined>()
const [tick, setTick] = createSignal(0)
let timer: ReturnType<typeof setTimeout> | undefined

export function markLiveWrite(input: string, holdMs = 3000) {
  setPath(input)
  setTick((value) => value + 1)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => setPath(undefined), holdMs)
}

export const liveWritePath = path
/** 每次写盘自增：同一文件被连写多次时也能驱动依赖方刷新。 */
export const liveWriteTick = tick
