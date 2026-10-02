import { createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useKV } from "../context/kv"

// 卡片的悬停动效(原型设计语言①:「悬停时光晕加深 + 渐变缓慢流动」)。
//
// 四张卡(助手气泡 / 用户气泡 / 工具卡 / 侧栏分区卡)各要自己维护一个 hover signal,
// 再各算一次「悬停 && animations_enabled」。这条折算在四处各抄一遍必然会漂 ——
// 漏掉 animations_enabled 的那一处,在用户关掉动画之后仍会以 12.5Hz 空转描边。所以折在这里。

/**
 * 返回一组悬停动效的接线。
 *
 * 注意用法的形状:返回的 `animated` / `boost` 是**函数**,调用点写
 * `animated={hover.animated()}` 而不是 `animated={hover.animated}` ——
 * JSX 的动态属性本身就会被 solid 编译成 effect(它会跟着属性表达式里读到的 signal 重新求值),
 * 所以这里要交出去的是「会读 signal 的表达式」,不是「signal 本身」。
 * 传一个布尔快照进去,悬停就只生效第一次,再也不会停也不会恢复。
 */
export function useCardHover() {
  const kv = useKV()
  const [hovered, setHovered] = createSignal(false)
  // 用户显式关掉动画时,悬停既不流动也不提亮 —— 留一圈不会动的亮边比什么都没有更糟。
  const on = () => hovered() && kv.get("animations_enabled", true)
  return {
    /** 原始 hover 状态,给那些自己要用它换底色的调用点(工具卡、用户气泡)。 */
    hover: hovered,
    /** 传给 `animated=`:相位推进、描边流动 + 扫光。 */
    animated: on,
    /** 传给 `boost=`:把描边朝 towards 提亮(见 ui/neon 的 HOVER_BOOST)。 */
    boost: (towards: RGBA) => (on() ? towards : undefined),
    onMouseOver: () => {
      setHovered(true)
    },
    onMouseOut: () => {
      setHovered(false)
    },
  }
}
