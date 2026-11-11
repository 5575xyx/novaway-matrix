import { createMemo, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { workingPhraseCount, workingPhraseKey, type WorkingActivity } from "./working-status"

/**
 * 带「换状态才重抽」的实时状态文案。
 *
 * 同一状态持续期间保持抽中的那套措辞不变（文案抖动比单调还烦），
 * 只有状态键变了才重新随机一次 —— 反复执行同类动作时不会永远一个样。
 * 常用状态有 6 套措辞，重进同一状态时还会避开上一次抽中的那条。
 */
export function useWorkingPhrase(activity: Accessor<WorkingActivity | undefined>): Accessor<string> {
  const language = useLanguage()
  const lastVariant = new Map<WorkingActivity["key"], number>()
  let seenKey: WorkingActivity["key"] | undefined
  let variant = 0
  return createMemo(() => {
    const current = activity()
    if (!current) return ""
    if (current.key !== seenKey) {
      seenKey = current.key
      const count = workingPhraseCount(current.key)
      const previous = lastVariant.get(current.key)
      let next = Math.floor(Math.random() * count)
      if (previous !== undefined && next === previous) next = (next + 1) % count
      lastVariant.set(current.key, next)
      variant = next
    }
    return language.t(workingPhraseKey(current.key, variant) as Parameters<typeof language.t>[0], current.params)
  })
}
