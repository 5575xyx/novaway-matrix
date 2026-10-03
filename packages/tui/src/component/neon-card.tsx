import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"
import { semanticStops } from "../ui/neon"
import { useCardHover } from "../ui/hover"

// 霓虹卡壳:渐变描边 + 固定内边距的正文容器。
//
// **为什么叫 NeonCard 而不是 AssistantCard**:它现在同时是助手气泡卡的壳与流程图节点卡的壳
// (见 component/flow/canvas.tsx)。原型里 `.msg.assistant .bubble` 与 `.fcard` 本来就是同一套
// 卡片语言 —— 渐变描边、圆角、扫光、悬停提亮,一样都不少。名字里带「助手」会让读代码的人以为
// 流程图另写了一套卡片外观,而那正是这一层要避免的事。
//
// 只依赖 useTheme() 与 useKV()(悬停动效要读 animations_enabled),不碰 session/local context,
// 所以测试能直接挂载它来量真实几何 —— 与导出的 BlockTool / InlineToolRow 同理。手抄一份
// neonbox 到测试里的话,改这里的 padding 不会让任何测试变红,`ctx.width - 9` 那类宽度常量就会悄悄失准。
// paddingRight=1:NeonBox 不占边框格、边框画在最外列上,右留 1 格才能让正文不压到右边框。
// 四边 padding 合计 3 列 = 卡内可用宽度相对 ctx.width 的扣减。
//
// **padding 行/列就是边框行/列**:NeonBox 把边框画在自己第 0 行/列与最后一行/列,而 padding
// 各为 1,所以 padding 不额外占行。「类型行 + 标题行」的卡因此是 4 行而不是 6 行 —— 流程图的
// NODE_HEIGHT 与它对齐,写大了连线的中线会落到卡片底边框那一行(见 layout.ts 的注释)。
//
// enterFrom 用 theme.border:这张卡是透明卡(没有自己的 backgroundColor),而终端里没有半透明,
// 淡入必须从一个**实色**长出来。未通电时那条描边就该是主题里最普通的那个边框色,
// 亮起来才是渐变描边 —— 拿 theme.backgroundPanel 当起点会先糊一层灰边再变彩,反而更脏。
//
// 悬停:渐变缓慢流动 + 描边朝 theme.text 提亮(原型 `.msg.assistant .bubble:hover { animation: gbFlow }`)。
// 两个信号都由 useCardHover 折进 animated/boost,所以 animations_enabled 关闭时悬停也不动。
//
// **为什么住在 component/ 而不是 routes/session**:流程图画布挂在会话页里,会话页也要 import
// 画布 —— 壳留在 routes/session 就成了一个环。routes/session 那边仍然 re-export 它。
export function NeonCard(props: {
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
  /**
   * 卡壳的宽度。省略 = `"100%"`,即撑满父容器(气泡卡与流程图节点卡那一套)。
   *
   * `"auto"` 给「抱内容」的那一张(空会话 hero 卡):原型的 `.hero` 是 `align-self: center` +
   * `padding: 36px 56px`,即宽度由内容决定而不是撑满 —— 在终端里撑满的话,一张只有 Logo 那么点
   * 内容的卡会横跨整个消息区,和原型差得最远的就是这条边。
   *
   * maxWidth 恒为 `"100%"`:内容比容器宽时(yoga 的 auto 是 max-content)宁可让右边框贴到容器边上,
   * 也不要让描边画到消息区外面去。
   */
  width?: number | "auto" | `${number}%`
  /**
   * 描边的叠色档(见 ui/neon 的 BORDER_ALPHA_DEFAULT 与 ui/card 的 borderAlpha)。
   * 省略 = 默认那一档 0.62 —— 助手/用户气泡、思考卡、工具卡、错误卡都吃它。
   * 不吃这一档的两个:流程图节点卡要自己传 0.72(原型 `.fcard` 用的是不透明的 `--fc`,
   * 最接近本实现的面板卡那一档,而 28×4 的小卡上边框占整张卡的比重远大于面板卡,
   * 压得更淡就读不出「这是一张卡」了);提示卡传 0.75(原型 `.tip` 自己那一档,
   * 见 feature-plugins/home/tip-card 的 TIP_CARD_ALPHA)。
   */
  borderAlpha?: number
  /**
   * 常驻流动(见 ui/card 的 flow)。这张壳默认**不开** —— 原型 `.bubble`(助手/用户气泡,
   * card-design-v7.html:402-414)与 `.card`(面板/分区卡,:147-157)底态都不流,
   * `gbFlow` 只挂在 `:hover` 上;常驻流的是标题栏/侧栏那两条 1px 导轨(railFlow / railV)。
   * 于是首页提示卡(feature-plugins/home/tip-card)在自己的调用点显式打开。
   */
  flow?: boolean
}) {
  const { theme } = useTheme()
  const hover = useCardHover()
  return (
    <neonbox
      gradientStops={props.gradientStops ?? semanticStops(theme, "assistant")}
      enterFrom={theme.border}
      enterDelay={props.enterDelay}
      animated={hover.animated()}
      flow={props.flow}
      boost={hover.boost(theme.text)}
      borderAlpha={props.borderAlpha}
      // 这张壳是**透明卡**(没有自己的 backgroundColor),叠色底必须显式给。
      // 它坐在消息区里,消息区自己也没有底色 —— 一路往上就是 app 根盒子的 theme.background。
      // 不给就落到「透明黑」:深色主题下碰巧像那么回事,浅色主题下整圈描边会沉进白底里。
      // theme.background 自己就是 transparent 的主题(lucent-orng)也没关系 ——
      // 那一档按 softenOver 走「不折算」,不再被当成纯黑(见 ui/neon 的 softenOver)。
      borderBackdrop={theme.background}
      onMouseOver={hover.onMouseOver}
      onMouseOut={hover.onMouseOut}
      onMouseUp={props.onSelect}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={1}
      width={props.width ?? "100%"}
      maxWidth="100%"
      flexShrink={0}
    >
      {props.children}
    </neonbox>
  )
}
