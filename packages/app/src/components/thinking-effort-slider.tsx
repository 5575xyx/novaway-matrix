import { For, Show, createSignal, type Component } from "solid-js"
import { useVariantLabel } from "@/hooks/use-variant-label"
import { effortFill, effortRatio, effortText } from "./thinking-effort-color"

/** 白圆点直径。填充宽度、档位点间距都按它对齐（与 ZCode 的 28px 一致）。 */
const THUMB = 28

/**
 * 气泡参数直接取自 ZCode（`composer-thought` 的 IJ 表）：
 * `top` 是气泡在 24px 轨道里的纵向位置，duration/delay 让它们彼此错开，
 * 看起来是「轨道里有细小的光点持续往左飘」。
 */
const BUBBLES = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3.0, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
  { top: 10, size: 2, duration: 3.5, delay: -0.2 },
  { top: 2, size: 2, duration: 2.7, delay: -1.8 },
  { top: 15, size: 3, duration: 3.3, delay: -1.2 },
  { top: 7, size: 4, duration: 3.6, delay: -3.1 },
]

/**
 * 思考强度滑块（移植自 ZCode 的 `composer-thought-slider`）。
 *
 * 结构：32px 高的容器里放三层——24px 轨道、4px 档位点、28px 白圆点，
 * 最后盖一个透明的原生 `input[type=range]` 负责交互。
 * 装饰层全部 `pointer-events-none`，所以点击/拖动/方向键都还是原生行为。
 *
 * 档位数量完全由模型决定，白圆点与档位点的位置都按 `ratio` 算。
 * 填充区里始终有横向飘过的气泡，档位越高气泡越多（2 → 12 个）；
 * 颜色也随档位从青绿（安静）爬到紫（活跃），两条线索互相印证。
 */
export const ThinkingEffortSlider: Component<{
  variants: string[]
  value: string | undefined
  onChange: (value: string | undefined) => void
  label?: string
}> = (props) => {
  const variantLabel = useVariantLabel()
  const [hovered, setHovered] = createSignal<number | null>(null)

  const stops = () => props.variants
  const index = () => {
    const found = stops().indexOf(props.value ?? "default")
    return found < 0 ? 0 : found
  }
  const current = () => stops()[index()] ?? "default"

  const ratio = (position: number) => effortRatio(position, stops().length)

  /**
   * 气泡数量跟着档位走：最低档 2 个，越高越多，到顶 12 个。
   * `slice` 切的是同一批对象，Solid 的 `<For>` 按引用复用节点，
   * 所以升档时是"多冒出几个"，已经飘着的气泡不会重新开始。
   */
  const bubbles = () => BUBBLES.slice(0, Math.round(2 + ratio(index()) * (BUBBLES.length - 2)))

  /** 填充宽度 = 圆点中心的位置（两端各留半个圆点）。 */
  const fill = () => `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${ratio(index())})`
  /** 圆点 left：0 时贴左，最高档时贴右。 */
  const thumbLeft = () => `calc((100% - ${THUMB}px) * ${ratio(index())})`

  const pick = (value: string) => props.onChange(value === "default" ? undefined : value)

  /** 指针靠近某个档位点时高亮它（距中心 10px 内），和 ZCode 的反馈一致。 */
  const trackHover = (event: PointerEvent & { currentTarget: HTMLInputElement }) => {
    const count = stops().length
    if (count < 2 || event.pointerType === "touch") {
      setHovered(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const span = rect.width - THUMB
    const nearest = Math.max(
      0,
      Math.min(count - 1, Math.round(((event.clientX - rect.left - THUMB / 2) / span) * (count - 1))),
    )
    const center = rect.left + THUMB / 2 + (span * nearest) / (count - 1)
    setHovered(Math.abs(event.clientX - center) <= 10 ? nearest : null)
  }

  return (
    <Show when={stops().length > 1}>
      <div class="flex flex-col gap-2" data-component="thinking-effort-slider">
        <div class="thinking-effort-slider relative h-8 w-full rounded-full">
          <div aria-hidden="true" class="pointer-events-none absolute inset-0">
            {/* 轨道：24px 高，内层 1px 描边让边缘更干净。 */}
            <div
              class="absolute inset-x-0 top-1 h-6 overflow-hidden rounded-full"
              style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
            >
              <div
                class="absolute inset-0 rounded-full border"
                style={{ "border-color": "color-mix(in srgb, var(--foreground) 10%, transparent)" }}
              />
              <div
                class="thinking-effort-fill absolute inset-y-0 left-0 overflow-hidden rounded-full"
                style={{ width: fill(), "background-color": effortFill(ratio(index())) }}
              >
                <div class="thinking-effort-bubbles absolute inset-0">
                  <For each={bubbles()}>
                    {(bubble) => (
                      <span
                        class="thinking-effort-bubble absolute inset-x-0"
                        style={{
                          top: `${bubble.top}px`,
                          "animation-duration": `${bubble.duration}s`,
                          "animation-delay": `${bubble.delay}s`,
                        }}
                      >
                        <span
                          class="block rounded-full bg-white"
                          style={{ width: `${bubble.size}px`, height: `${bubble.size}px` }}
                        />
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </div>
            {/* 档位点：4px 小圆点，已到达的变白、靠近时放大。 */}
            <div class="absolute inset-x-3.5 inset-y-0 flex items-center justify-between">
              <For each={stops()}>
                {(item, itemIndex) => (
                  <span
                    class="thinking-effort-stop size-1 shrink-0 rounded-full"
                    data-filled={itemIndex() <= index()}
                    data-hovered={hovered() === itemIndex()}
                  />
                )}
              </For>
            </div>
            {/* 白色圆点：位置带 120ms 缓动，点档位时是滑过去而不是瞬移。 */}
            <div
              class="thinking-effort-thumb absolute top-0.5 size-7 rounded-full shadow-sm"
              style={{ left: thumbLeft() }}
            />
          </div>
          <input
            type="range"
            class="thinking-effort-range absolute inset-0 m-0 h-8 w-full cursor-pointer appearance-none bg-transparent outline-none"
            min={0}
            max={stops().length - 1}
            step={1}
            value={index()}
            aria-label={props.label ?? "思考强度"}
            aria-valuetext={variantLabel(current())}
            onInput={(event) => pick(stops()[Number(event.currentTarget.value)] ?? "default")}
            onPointerMove={trackHover}
            onPointerLeave={() => setHovered(null)}
          />
        </div>
        <div class="flex items-center justify-between gap-0.5">
          <For each={stops()}>
            {(item, itemIndex) => {
              const active = () => itemIndex() === index()
              return (
                <button
                  type="button"
                  class="cursor-pointer rounded-md px-1 py-0.5 text-10-medium transition-all duration-200 hover:text-foreground"
                  classList={{ "scale-105": active() }}
                  style={active() ? effortText(ratio(itemIndex())) : { color: "var(--foreground-subtlest)" }}
                  onClick={() => pick(item)}
                >
                  {variantLabel(item)}
                </button>
              )
            }}
          </For>
        </div>
      </div>
    </Show>
  )
}
