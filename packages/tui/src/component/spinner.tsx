import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerNovaWaySpinner } from "./register-spinner"
import { animColors, animFrames } from "../util/anim-spinner"

registerNovaWaySpinner()

// crush 式 anim spinner:7 列伪随机扰动字符 + 亮度波沿列滚动,20fps。
// 120 帧 = 6 秒一轮,循环接缝看不出来;字符是列+帧的确定性散列,重绘不闪。
const ANIM_WIDTH = 7
const ANIM_FRAME_COUNT = 120
const ANIM_FRAMES = animFrames(ANIM_WIDTH, ANIM_FRAME_COUNT)
const ANIM_INTERVAL = 50

// `novaway run` 的子代理页脚不在 TUI 组件树里(自己一套 scrollback 渲染),
// 但转场动画得和 TUI 一致,所以把帧和节奏导出去给它用。
export const SPINNER_FRAMES = ANIM_FRAMES
export const SPINNER_INTERVAL = ANIM_INTERVAL

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={ANIM_FRAMES} interval={ANIM_INTERVAL} color={animColors(color())} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
