import { createUniqueId, type Component } from "solid-js"
import { effortFill } from "./thinking-effort-color"

/**
 * 大脑轮廓取自 `@novaway/ui` 的 `brain` 图标（20×20 描边路径）。
 *
 * 没有直接复用 `<Icon>`，因为要在这里把「强度」画进图标本身：
 * 大脑从下往上被点亮（类似电量/水位），档位越高亮得越多，
 * 再叠一层同色辉光 —— 低档是一颗安静的灰绿大脑，高档是整颗发亮的紫脑。
 */
const BRAIN =
  "M13.332 8.7487C11.4911 8.7487 9.9987 7.25631 9.9987 5.41536M6.66536 11.2487C8.50631 11.2487 9.9987 12.7411 9.9987 14.582M9.9987 2.78209L9.9987 17.0658M16.004 15.0475C17.1255 14.5876 17.9154 13.4849 17.9154 12.1978C17.9154 11.3363 17.5615 10.5575 16.9913 9.9987C17.5615 9.43991 17.9154 8.66108 17.9154 7.79962C17.9154 6.21199 16.7136 4.90504 15.1702 4.73878C14.7858 3.21216 13.4039 2.08203 11.758 2.08203C11.1171 2.08203 10.5162 2.25337 9.9987 2.55275C9.48117 2.25337 8.88032 2.08203 8.23944 2.08203C6.59353 2.08203 5.21157 3.21216 4.82722 4.73878C3.28377 4.90504 2.08203 6.21199 2.08203 7.79962C2.08203 8.66108 2.43585 9.43991 3.00609 9.9987C2.43585 10.5575 2.08203 11.3363 2.08203 12.1978C2.08203 13.4849 2.87191 14.5876 3.99339 15.0475C4.46688 16.7033 5.9917 17.9154 7.79962 17.9154C8.61335 17.9154 9.36972 17.6698 9.9987 17.2488C10.6277 17.6698 11.384 17.9154 12.1978 17.9154C14.0057 17.9154 15.5305 16.7033 16.004 15.0475Z"

export const ThinkingEffortIcon: Component<{
  /** 0 = 最低档，1 = 最高档。 */
  ratio: number
  size?: number
  class?: string
}> = (props) => {
  const id = createUniqueId()
  // 最低档也留一小截亮着，让人看出这是"档位指示"而不是一颗灰图标。
  const lit = () => 0.22 + 0.78 * props.ratio
  const color = () => effortFill(props.ratio)

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      width={props.size ?? 16}
      height={props.size ?? 16}
      class={`thinking-effort-icon ${props.class ?? ""}`}
      aria-hidden="true"
      data-hot={props.ratio >= 0.999}
      style={{
        "--effort-glow": color(),
        "--effort-blur": `${0.3 + props.ratio * 1.5}px`,
      }}
    >
      <defs>
        <clipPath id={`${id}-lit`}>
          <rect x="0" y={20 - 20 * lit()} width="20" height={20 * lit()} />
        </clipPath>
      </defs>
      {/* 未点亮的部分：中性灰线稿，衬得下面那截颜色更亮。 */}
      <path
        d={BRAIN}
        stroke="var(--foreground-subtlest)"
        stroke-width="1.1"
        stroke-linecap="round"
        stroke-linejoin="round"
        opacity="0.55"
      />
      {/* 点亮的部分：从底部往上长，越高越粗、越艳。 */}
      <path
        d={BRAIN}
        stroke={color()}
        stroke-width={1.3 + props.ratio * 0.6}
        stroke-linecap="round"
        stroke-linejoin="round"
        clip-path={`url(#${id}-lit)`}
      />
    </svg>
  )
}
