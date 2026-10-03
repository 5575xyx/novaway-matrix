import { createSignal } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useKV } from "../context/kv"

// 卡片的悬停动效(原型设计语言①:「悬停时光晕加深 + 渐变缓慢流动」)。
//
// 每张要悬停的卡(助手气泡 / 用户气泡 / 工具卡 / 侧栏分区卡,以及复用 NeonCard 壳的
// 流程图节点卡、空会话 hero 卡、提示卡)各要自己维护一个 hover signal,
// 再各算一次「悬停 && animations_enabled」。这条折算在每处各抄一遍必然会漂 ——
// 漏掉 animations_enabled 的那一处,在用户关掉动画之后仍会以 12.5Hz 空转描边。所以折在这里。
// 数「有几家在用」时别拿这份注释当依据:调用点是增删的,`useCardHover` 的定义只有这一处。
//
// **它是什么**:调用点共享的那一份「hover 与 animations_enabled 折在一起」的接线。
// 「唯一出口」这种说法**不成立**,别再往这上面加:侧栏根卡(routes/session/sidebar.tsx)
// 与标签栏导轨(component/tab-bar.tsx)都没有 hover 状态,前者自己读同一个 KV 去折 `flow`,
// 后者没有卡片也没有相位。两边读的是同一条设置,所以不会出现「有的壳关了有的壳没关」。
//
// 这里只管 `animated`(悬停/聚焦:流动 + 扫光)与 `boost`(悬停抬对比),**不管常驻流动** ——
// 原型里常驻流的是标题栏/侧栏那两条导轨(railFlow / railV,见 ui/card 的 flow),
// 面板卡与分区卡底态不流。要 `flow` 的调用点自己读 KV:多折一份 hover 在这里是错的,
// 常驻流的那几处按定义就没有 hover 状态。

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
    /** 传给 `animated=`:相位推进 + 扫光 + 悬停档的更快流速。 */
    animated: on,
    /** 传给 `boost=`:把描边朝 towards 混一档,抬它与面板底色的对比(见 ui/neon 的 HOVER_BOOST)。 */
    boost: (towards: RGBA) => (on() ? towards : undefined),
    onMouseOver: () => {
      setHovered(true)
    },
    onMouseOut: () => {
      setHovered(false)
    },
  }
}
