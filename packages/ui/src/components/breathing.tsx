import type { ComponentProps } from "solid-js"

/**
 * 统一的「呼吸灯」指示器。
 *
 * 产品里表示「正在进行」的地方（重试、子代理调用、工具执行）应该长得一样：
 * 一颗缓慢起伏的圆点，而不是各处的点阵 Spinner / animate-pulse。动画定义在
 * `breathing.css`，颜色继承 `currentColor`，用在哪就染成哪里的强调色。
 */
export function Breathing(props: { class?: string; style?: ComponentProps<"span">["style"] }) {
  return (
    <span
      data-component="breathing-indicator"
      aria-hidden="true"
      class={props.class}
      style={props.style}
    >
      <span data-slot="breathing-core" />
    </span>
  )
}
