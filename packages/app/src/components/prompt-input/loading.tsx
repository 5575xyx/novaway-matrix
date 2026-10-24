import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js"
import { useLanguage } from "@/context/language"

/**
 * 输入框的加载遮罩。
 *
 * 它**盖在真实输入框上**（`absolute inset-0`），而不是替换它。这样做的原因：
 *
 * 1. 真实输入框的圆角/边框/底色/padding/高度全部由它自己决定，遮罩不需要猜任何几何 ——
 *    之前是「一个 `min-h-40 rounded-md` 的占位盒子 ↔ 真实输入框」二选一渲染，
 *    两者的半径（6px vs 16px）、底色、高度（160 vs 182）都不同，切过去就是一次可见跳动。
 * 2. 遮罩淡出时输入框已经在原位，只是"显露出来"，不会推动布局。
 *
 * 什么时候需要它：`prompt.ready()` 之前。桌面端的持久化存储走 IPC（异步），
 * 冷启动/换会话时这段等待有几百毫秒，期间不能渲染输入框内容
 * （否则会先显示空内容、再被持久化的草稿覆盖）。
 */
export function PromptInputLoading(props: { fading?: boolean }) {
  const language = useLanguage()
  return (
    <div
      data-component="prompt-input-loading"
      data-fading={props.fading ? "true" : undefined}
      class="absolute inset-0 z-10 flex flex-col justify-between rounded-2xl border border-input-border bg-transparent p-3 pointer-events-none transition-opacity duration-200"
      classList={{ "opacity-0": !!props.fading }}
      aria-hidden="true"
    >
      <div class="flex items-center gap-2 px-1">
        <span class="h-3 w-20 rounded-[4px] bg-surface" />
      </div>
      <span class="px-1 text-14-regular text-foreground-subtlest">{language.t("prompt.loading")}</span>
      <div class="flex items-center gap-2 px-1">
        <span class="size-3.5 rounded-[4px] bg-surface" />
        <span class="size-3.5 rounded-[4px] bg-surface" />
        <span class="ml-auto size-6 rounded-md bg-surface" />
      </div>
    </div>
  )
}

/**
 * 遮罩的显隐状态。
 *
 * - 已经在就绪态挂载时**根本不显示**（避免"输入框先露脸、遮罩又盖上来一下"）。
 * - 就绪后延 `fadeMs`（= 淡出动画时长）再从 DOM 摘掉。
 */
export function createPromptVeil(ready: Accessor<boolean>, fadeMs = 200) {
  const [veiling, setVeiling] = createSignal(!ready())
  createEffect(() => {
    if (!ready()) return
    const timer = window.setTimeout(() => setVeiling(false), fadeMs)
    onCleanup(() => window.clearTimeout(timer))
  })
  return veiling
}
