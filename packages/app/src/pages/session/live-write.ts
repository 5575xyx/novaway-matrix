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

/**
 * 观察窗口默认 6 秒。
 *
 * 3 秒不够用：写盘事件之后还要等 250ms 的跟随防抖、面板宽度动画、文件读取，
 * 大文档读到浏览器里就可能超过 3 秒 —— 窗口一旦在预览挂载前过期，打字机就
 * 永远不会开始（用户看到的就是"面板一弹出来内容就已经全在了"）。
 */
export function markLiveWrite(input: string, holdMs = 6000) {
  setPath(input)
  setTick((value) => value + 1)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => setPath(undefined), holdMs)
}

export const liveWritePath = path
/** 每次写盘自增：同一文件被连写多次时也能驱动依赖方刷新。 */
export const liveWriteTick = tick
