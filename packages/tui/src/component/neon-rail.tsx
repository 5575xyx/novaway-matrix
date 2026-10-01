import { createEffect, createMemo, createSignal, For, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { BoxRenderable, RGBA } from "@opentui/core"
import { useKV } from "../context/kv"
import { gradientAt } from "../ui/neon"

// 霓虹导轨:一行(或一列)全宽的渐变色条,替代原 TabBar 下边框/侧栏分隔线。
// 格子数按导轨自身盒子测量(onSizeChange),不是终端全宽 —— 按终端宽度取色再被容器
// overflow 裁掉的话,渐变尾部(终点色)永远看不见;首帧尚未测量时回退终端尺寸,
// 那时还没有画面,不会出现可见的裁切。
// animated 时相位每 80ms 滚动一格,整条渐变像水流一样沿轨道移动;
// animated 切换时定时器由 createEffect 随之启停;animations_enabled 关闭时相位停止,静态渐变保留。
export function NeonRail(props: { stops: readonly RGBA[]; vertical?: boolean; animated?: boolean }) {
  const dimensions = useTerminalDimensions()
  const kv = useKV()
  const [phase, setPhase] = createSignal(0)
  const [measured, setMeasured] = createSignal(0)

  createEffect(() => {
    if (!props.animated) return
    const timer = setInterval(() => {
      if (!kv.get("animations_enabled", true)) return
      setPhase((value) => (value + 1) % 100)
    }, 80)
    onCleanup(() => clearInterval(timer))
  })

  const count = createMemo(() => {
    const size = measured()
    if (size > 0) return size
    return props.vertical ? dimensions().height : dimensions().width
  })
  const spans = createMemo(() => {
    const total = count()
    const ch = props.vertical ? "┃" : "━"
    return Array.from({ length: total }, (_, index) => {
      const base = total <= 1 ? 0 : index / (total - 1)
      const t = props.animated ? (base + phase() / 100) % 1 : base
      return { ch, fg: gradientAt(props.stops, t) }
    })
  })

  return (
    <box
      ref={(element: BoxRenderable) => {
        element.onSizeChange = () => setMeasured(props.vertical ? element.height : element.width)
      }}
      width={props.vertical ? 1 : "100%"}
      height={props.vertical ? "100%" : 1}
      flexShrink={0}
      overflow="hidden"
    >
      <text wrapMode="none">
        <For each={spans()}>{(span) => <span style={{ fg: span.fg }}>{span.ch}</span>}</For>
      </text>
    </box>
  )
}
