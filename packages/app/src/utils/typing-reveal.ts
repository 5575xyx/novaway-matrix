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
  /** 最近一次完整磁盘内容，用于识别文件级增量。 */
  let rendered: string | undefined = untrack(input.source)
  let scope: string | undefined = input.scope?.()
  let animation: { target: string; added: Set<number>; revealed: number } | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  onCleanup(stop)

  const tick = () => {
    const current = animation
    if (!current) return
    const total = addedCharCount(current.target, [...current.added])
    current.revealed = Math.min(total, current.revealed + revealChunk(total - current.revealed))
    setShown(revealAdded(current.target, [...current.added], current.revealed))
    if (current.revealed < total) return
    stop()
    rendered = current.target
    animation = undefined
  }

  createEffect(() => {
    const text = input.source()
    // live / scope 用 untrack 读：它们不应在动画中途触发重置。
    const live = untrack(input.live)
    const nextScope = untrack(() => input.scope?.())
    if (nextScope !== scope) {
      stop()
      animation = undefined
      scope = nextScope
      rendered = undefined
    }
    if (!live || rendered === undefined || rendered === text) {
      stop()
      animation = undefined
      rendered = text
      setShown(text)
      return
    }

    const previous = animation?.target ?? rendered
    const oldLines = previous.split("\n")
    const nextLines = text.split("\n")
    const added = newLineIndexes(previous, text)
    const stablePrefixLines = Math.min(oldLines.length, nextLines.length)
    const merged = new Set(animation?.added ?? [])
    for (const index of added) merged.add(index)

    if (added.length === 0 && !animation) {
      rendered = text
      setShown(text)
      return
    }
    if (!animation) animation = { target: text, added: new Set(), revealed: 0 }
    animation.target = text
    animation.added = merged

    // 累计已显示字符数只沿用旧行中尚未变化的前缀；变更中的行保留其可见前缀，
    // 后续字节版本只延长目标，不会让已显示字符倒退。
    const visibleLines = shown().split("\n")
    let revealed = 0
    for (const index of animation.added) {
      if (index >= stablePrefixLines) continue
      const oldText = oldLines[index] ?? ""
      const nextText = nextLines[index] ?? ""
      const visibleText = visibleLines[index] ?? ""
      if (oldText === nextText || nextText.startsWith(visibleText)) revealed += visibleText.length
    }
    animation.revealed = revealed
    setShown(revealAdded(animation.target, [...animation.added], animation.revealed))
    if (timer === undefined) timer = setInterval(tick, pace)
  })

  return shown
}
