/**
 * 草稿态空位：巨大的品牌水印 + 一句居中的问候。
 *
 * 一比一复刻 ZCode 的 `v4/ConversationDraftEmptyState.tsx`：
 * - 水印只做氛围，`aria-hidden` + `pointer-events-none`，不参与布局，也不吃点击；
 * - 字号不是写死的：先按 30px 量一次自然宽度，再和容器可用宽度比较，
 *   只在两者真的相撞时往下缩（20px 兜底），避免大窗口里文字两侧留白却仍被强行缩小；
 * - 办公模式和编码模式的问候语只差一句话，由 `layout.mode` 决定。
 */
import { createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Mark } from "@novaway/ui/logo"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { greetingMessageId } from "@/utils/greeting"

const MIN_FONT_SIZE_PX = 20
const MAX_FONT_SIZE_PX = 30

export function resolveGreetingFontSizePx(availableWidthPx: number, naturalTextWidthPx: number) {
  if (
    !Number.isFinite(availableWidthPx) ||
    !Number.isFinite(naturalTextWidthPx) ||
    availableWidthPx <= 0 ||
    naturalTextWidthPx <= 0 ||
    availableWidthPx >= naturalTextWidthPx
  ) {
    return MAX_FONT_SIZE_PX
  }

  return Math.max(
    MIN_FONT_SIZE_PX,
    Math.min(MAX_FONT_SIZE_PX, Math.floor(MAX_FONT_SIZE_PX * (availableWidthPx / naturalTextWidthPx))),
  )
}

export function DraftEmptyState(props: { class?: string }) {
  const language = useLanguage()
  const layout = useLayout()

  const greeting = createMemo(() =>
    layout.mode.current() === "zen" ? language.t("chat.empty.greeting.office") : language.t(greetingMessageId()),
  )

  const [fontSizePx, setFontSizePx] = createSignal(MAX_FONT_SIZE_PX)
  let container: HTMLParagraphElement | undefined
  let measurement: HTMLSpanElement | undefined

  onMount(() => {
    let frameId: number | null = null

    const measure = () => {
      frameId = null
      if (!container || !measurement) return
      const style = window.getComputedStyle(container)
      const horizontalPaddingPx = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
      const availableWidthPx = Math.max(
        0,
        container.getBoundingClientRect().width - (Number.isFinite(horizontalPaddingPx) ? horizontalPaddingPx : 0),
      )
      const naturalTextWidthPx = measurement.getBoundingClientRect().width
      const next = resolveGreetingFontSizePx(availableWidthPx, naturalTextWidthPx)
      setFontSizePx((current) => (current === next ? current : next))
    }

    const schedule = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(measure)
    }

    measure()

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", schedule)
      onCleanup(() => window.removeEventListener("resize", schedule))
    } else {
      // 同时观察容器和 30px 原始文案：只有两者真实相撞时才缩字号。
      const observer = new ResizeObserver(schedule)
      if (container) observer.observe(container)
      if (measurement) observer.observe(measurement)
      onCleanup(() => observer.disconnect())
    }

    onCleanup(() => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    })
  })

  return (
    <div
      class={`relative flex w-full max-w-2xl flex-col items-center justify-center gap-6 text-foreground ${props.class ?? ""}`}
    >
      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-1/2 top-1/2 -mt-10 aspect-[5/4] w-[min(72vw,25rem)] -translate-x-1/2 -translate-y-1/2"
      >
        <Mark
          class={`h-full w-full opacity-[0.055] [mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)] [mask-repeat:no-repeat] [mask-size:100%_100%] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]`}
        />
      </div>
      <p
        ref={(el) => (container = el)}
        data-v4-draft-greeting="true"
        class="relative z-10 w-full px-4 text-center font-medium leading-[1.2] text-foreground"
        style={{ "font-size": `${fontSizePx()}px` }}
      >
        <span
          ref={(el) => (measurement = el)}
          aria-hidden="true"
          class="pointer-events-none invisible absolute whitespace-nowrap text-[30px] leading-[1.2]"
        >
          {greeting()}
        </span>
        <span>{greeting()}</span>
      </p>
    </div>
  )
}
