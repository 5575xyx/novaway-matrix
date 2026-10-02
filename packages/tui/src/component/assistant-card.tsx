import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { semanticStops } from "../ui/neon"
import { useCardHover } from "../ui/hover"

// 助手气泡卡壳:霓虹描边 + 固定内边距的正文容器。
// 只依赖 useTheme() 与 useKV()(悬停动效要读 animations_enabled),不碰 session/local context,
// 所以测试能直接挂载它来量真实几何 —— 与导出的 BlockTool / InlineToolRow 同理。手抄一份
// neonbox 到测试里的话,改这里的 padding 不会让任何测试变红,`ctx.width - 9` 那类宽度常量就会悄悄失准。
// paddingRight=1:NeonBox 不占边框格、边框画在最外列上,右留 1 格才能让正文不压到右边框。
// 四边 padding 合计 3 列 = 卡内可用宽度相对 ctx.width 的扣减。
//
// enterFrom 用 theme.border:这张卡是透明卡(没有自己的 backgroundColor),而终端里没有半透明,
// 淡入必须从一个**实色**长出来。未通电时那条描边就该是主题里最普通的那个边框色,
// 亮起来才是渐变描边 —— 拿 theme.backgroundPanel 当起点会先糊一层灰边再变彩,反而更脏。
//
// 悬停:渐变缓慢流动 + 描边朝 theme.text 提亮(原型 `.msg.assistant .bubble:hover { animation: gbFlow }`)。
// 两个信号都由 useCardHover 折进 animated/boost,所以 animations_enabled 关闭时悬停也不动。
//
// **为什么住在 component/ 而不是 routes/session**:流程图画布(见 component/flow/canvas.tsx)
// 要拿同一张壳来画节点卡 —— 原型的节点卡与气泡卡是同一套卡片语言(渐变描边、圆角、扫光、
// 悬停提亮),另写一套就等于把这个仓库里「四张卡共用一套外观」的规矩破掉。而画布要挂在
// 会话页里,会话页也要 import 画布:壳留在 routes/session 就成了一个环。routes/session 那边
// 仍然 re-export 它,既有 import 路径与测试都不用改。
export function AssistantCard(props: {
  children: JSX.Element
  enterDelay?: number
  /**
   * 描边色板,省略就是助手气泡卡那一套(`semanticStops(theme, "assistant")`)。
   *
   * 流程图的七种节点语义各自要一圈自己的颜色(用户粉紫 / 工具青 / 编辑琥珀 / 回复绿),
   * 而这张壳的渐变描边、扫光、入场淡入是节点卡与气泡卡**唯一**共用的视觉语言 ——
   * 所以这里换的是「喂什么色板」,不是「怎么画」。见 ui/neon 的 semanticStops。
   */
  gradientStops?: readonly RGBA[]
  /** 点击回调(协议同 neonbox 的 onMouseUp:鼠标抬起才算点中,拖动滚动不该误触)。 */
  onSelect?: () => void
}) {
  const { theme } = useTheme()
  const hover = useCardHover()
  return (
    <neonbox
      gradientStops={props.gradientStops ?? semanticStops(theme, "assistant")}
      enterFrom={theme.border}
      enterDelay={props.enterDelay}
      animated={hover.animated()}
      boost={hover.boost(theme.text)}
      onMouseOver={hover.onMouseOver}
      onMouseOut={hover.onMouseOut}
      onMouseUp={props.onSelect}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={1}
      width="100%"
      flexShrink={0}
    >
      {props.children}
    </neonbox>
  )
}
