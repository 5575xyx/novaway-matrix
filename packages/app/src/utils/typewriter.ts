// 打字机节奏揭示（文件预览用）。
//
// AI 写盘是"整块替换"：每次 write/edit 完成后 watcher 报一次事件，文件内容
// 从旧全文跳到新全文。直接渲染就是"啪"一下整页替换；这里把每次整块更新
// 拆成小步追加，观感上就是内容在"打出来"。
//
// 节奏对齐聊天流式的 PacedMarkdown（@novaway/ui message-part）：步长随剩余量
// 放大、优先停在标点/空白边界，但整体更快 —— 文件预览的正文比聊天长得多。

import { createEffect, createSignal, onCleanup, untrack } from "solid-js"

const PACE_MS = 16
const SNAP = /[\s.,!?;:)\]}>）】、。！？；：“”‘’]/

/** 从 shownLength 再揭示一段，返回新的揭示长度。纯函数，便于单测。 */
export function revealStep(text: string, shownLength: number) {
  const remaining = text.length - shownLength
  if (remaining <= 0) return text.length
  const size =
    remaining <= 16 ? 2 : remaining <= 64 ? 4 : remaining <= 160 ? 8 : Math.min(32, Math.ceil(remaining / 16))
  const end = Math.min(text.length, shownLength + size)
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (SNAP.test(text[i] ?? "")) return i + 1
  }
  return end
}

/**
 * 下一帧应该显示什么（纯函数）。
 *
 * - `live` 为假（不在跟写窗口里）、内容被**重写**（非前缀，比如切了文件/整段重排）、
 *   或已经追平 → 直接返回目标全文，不播动画；
 * - 否则返回「当前 + 一个揭示步」的前缀。
 */
export function advancePaced(target: string, shown: string, live: boolean) {
  if (!live) return target
  if (!target.startsWith(shown)) return target
  if (target.length <= shown.length) return target
  return target.slice(0, revealStep(target, shown.length))
}

/**
 * 跟随 `source` 的"打字机版"内容。
 *
 * 首次取值即为当前全文（打开已有文件）原样返回，不动画。
 */
export function createPacedContent(source: () => string, live?: () => boolean) {
  const [shown, setShown] = createSignal(source())
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  const schedule = () => {
    clear()
    timer = setTimeout(() => {
      timer = undefined
      const target = untrack(source)
      const current = untrack(shown)
      const next = advancePaced(target, current, live?.() ?? true)
      if (next !== current) setShown(next)
      if (next !== target) schedule()
    }, PACE_MS)
  }

  createEffect(() => {
    const target = source()
    const current = untrack(shown)
    const next = advancePaced(target, current, live?.() ?? true)
    if (next !== current) {
      if (next === target) clear()
      setShown(next)
    }
    if (next === target) {
      clear()
      return
    }
    if (timer) return
    schedule()
  })

  onCleanup(clear)
  return shown
}
