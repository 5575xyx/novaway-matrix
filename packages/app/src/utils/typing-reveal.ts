// 「跟写打字机」的状态机：把一次整块写盘拆成"只打新写的几行"。
//
// 抽成独立原语的理由：这套逻辑之前埋在 file-tabs 的 effect 里，改一次错一次
// （整块重打、进度被重置、动画中途被打断……），也没法在浏览器里真实跑一遍验证。
// 现在它只依赖「最新全文 / 是否在跟写窗口 / 当前文件」，可以单独挂到页面上用
// e2e 驱动（见 e2e/typing-reveal.spec.ts）。

import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import { revealChunk } from "./typewriter"
import { addedCharCount, newLineIndexes, revealAdded } from "./typing-additions"

/** 一拍多久；对照视图每拍都要重建一遍 diff，比聊天流式粗一些。 */
const PACE_MS = 60

export function createTypingReveal(input: {
  /** 最新全文（磁盘内容）。 */
  source: () => string
  /** 是否处在"AI 正在写这个文件"的窗口里；不在窗口里一律直出全文。 */
  live: () => boolean
  /** 当前文件标识：切换文件时重置进度，不把上一个文件的"已显示内容"当基准。 */
  scope?: () => string | undefined
  pace?: number
}): Accessor<string> {
  const pace = input.pace ?? PACE_MS
  const [shown, setShown] = createSignal(input.source())
  /** 上一版已经完整显示过的内容：用它和最新内容比出"这一笔新写了什么"。 */
  let rendered: string | undefined = untrack(input.source)
  let scope: string | undefined = input.scope?.()

  createEffect(() => {
    const text = input.source()
    // live / scope 用 untrack 读：跟写标记会自己过期、文件切换也会触发重跑，
    // 但它们不该在动画中途把这一轮重开（重开 = 内容缩回去再长出来，看着就是闪）。
    const live = untrack(input.live)
    const nextScope = untrack(() => input.scope?.())
    if (nextScope !== scope) {
      scope = nextScope
      rendered = undefined
    }
    // 不在跟写窗口里 / 第一次看到这个文件 / 内容没变：直接显示全文。
    if (!live || rendered === undefined || rendered === text) {
      rendered = text
      setShown(text)
      return
    }
    const added = newLineIndexes(rendered, text)
    const total = addedCharCount(text, added)
    if (total === 0) {
      rendered = text
      setShown(text)
      return
    }
    let revealed = 0
    setShown(revealAdded(text, added, revealed))
    const timer = setInterval(() => {
      revealed = Math.min(total, revealed + revealChunk(total - revealed))
      setShown(revealAdded(text, added, revealed))
      if (revealed < total) return
      clearInterval(timer)
      rendered = text
    }, pace)
    onCleanup(() => clearInterval(timer))
  })

  return shown
}
