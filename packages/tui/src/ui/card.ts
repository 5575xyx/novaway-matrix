import {
  BoxRenderable,
  RGBA,
  type BoxOptions,
  type OptimizedBuffer,
  type Renderable,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import {
  BORDER_ALPHA_DEFAULT,
  brighten,
  fadeIn,
  gradientAt,
  HOVER_BOOST,
  NEON_WHITE,
  perimeterCells,
  softenOver,
} from "./neon"

export type NeonBoxOptions = BoxOptions<NeonBoxRenderable> & {
  gradientStops?: readonly RGBA[]
  /**
   * 描边流动 + 扫光。相位由本类自己推进(见 animated 的 setter)。
   *
   * 这是唯一的开关 —— 「要不要动」完全由调用方决定,类自己不读任何全局设置。
   * animations_enabled 这类用户设置请在调用方响应式地折进 animated
   * (PromptCard 就是这么做的:`focused && visible && kv.get("animations_enabled", true)`),
   * 这样关掉→打开能自动恢复;类里再挂一个只能停、不能恢复的拉式门控只会是个坑。
   */
  animated?: boolean
  /**
   * 常驻流动:相位自己走,**不带扫光**。对应原型里**永不间歇**的那两条 1px 导轨 ——
   * 标题栏 `.titlebar::after { animation: railFlow 7s linear infinite }`
   * (card-design-v7.html:85-91)与侧栏右缘 `.sidebar::after { animation: railV 9s linear infinite }`
   * (:109-115)。终端里前者就是标签栏底下那条 NeonRail,后者是侧栏根卡的右边框
   * (原型侧栏自己不带描边,那一列的轮廓就是这根轨)。
   *
   * **面板卡 / 分区卡不在这一档**:原型 `.card` 底态既没有 `animation`,也没有
   * `background-size: 200% 200%`(那个只有 `.bubble` 才有,:410);`gbFlow 2.6s` 挂在
   * `.card:hover` 上(:159-163)。所以这一族走 `animated`(悬停/聚焦:流动 + 扫光 +
   * 更快一档),底态冻结 —— 与原型一致,分界线就写在 component/sidebar-card 那张卡的
   * animated= 上(底态与悬停之间只隔这一个开关)。
   *
   * 两个档的分工仍是「谁在什么时候动」:
   *   · `flow`     = 不用等鼠标就在呼吸(导轨那一族;另有首页提示卡那一处自选的常驻流,
   *     理由写在 feature-plugins/home/tip-card 的 TIP_CARD_ALPHA 注释里)。
   *   · `animated` = 此刻有人在看它/在用它。
   * 两者独立且可以叠加:同一张卡两者皆真时相位照走、扫光照画。
   *
   * **扫光只归 animated**:扫光是「注意力」的信号,常驻的话整圈描边永远有一道白亮在爬,
   * 面板卡一多就成噪声(侧栏同屏七八张)。色带流动才是「活着」的信号,那个可以常驻。
   *
   * 「要不要动」完全由调用方决定:animations_enabled 这类用户设置同样由调用方折进来
   * (侧栏根卡与标签栏导轨直接读 KV,见 ui/hover 开头那段)。
   */
  flow?: boolean
  /**
   * 描边淡入的起点色。省略时退回这张卡自己的 backgroundColor(有底色的卡 ——
   * 用户气泡 / 错误卡 / 思考卡 / 工具卡 —— 淡入就是从底色长出描边)。
   * 透明卡片(助手气泡卡 / 分区卡 / 输入卡)必须显式给:终端里没有半透明,
   * 不知道背后是什么颜色时凭空挑一个起点,只会闪出一圈脏边。
   */
  enterFrom?: RGBA
  /**
   * 描边淡入的延迟(毫秒)。**不传就是直接终态** —— 调用方据此表达
   * 「不要入场」,animations_enabled 关闭时也正是走这条路(见 ui/enter.ts)。
   * 0 表示立刻开始淡入,undefined 表示跳过淡入。
   */
  enterDelay?: number
  /**
   * 悬停时抬对比度:把描边朝这个色混 HOVER_BOOST(见 ui/neon)。传入即开、undefined 即关,
   * 与 animated 独立 —— 抬对比度不需要流动,也不需要扫光。
   */
  boost?: RGBA
  /**
   * 描边折算出来的「叠色档」:把渐变描边当成这个 alpha 盖在背后那层实色上,画出叠出来的那个色。
   *
   * 省略 = `BORDER_ALPHA_DEFAULT`(0.62,原型 `.bubble` 一族的 alpha)。
   * 1 = 不折算,描边就是纯渐变色(它本来就有的样子)。
   */
  borderAlpha?: number
  /**
   * 描边背后的实色:它既是 alphaOver 折算的参考色,**也是逐格写进边框格的 bg**
   * (边框画在最外行/列上,那一格除了描边之外露出来的正是这一层,见 borderCellBackdrop)。
   * 省略时依次退回这张卡自己的 `backgroundColor` → 最近的祖先底色 → 旧行为。
   *
   * 省略 = `backgroundColor` 对**有底色**的卡(用户气泡 / 工具卡 / 思考卡 / 错误卡 /
   * 侧栏根卡)就是正确的参考:那一格不画描边时露出来的正是卡自己的底色。
   *
   * 透明卡自己给不出答案:它背后的可能是面板底色,也可能是纯黑,终端里读不到。
   * 那种卡必须显式传(见 component/neon-card、sidebar-card、prompt/card),否则那一档会朝
   * 默认黑收敛 —— 深色主题下碰巧像那么回事,浅色主题下整圈描边会沉进白底里。
   *
   * **显式传的也可能仍是全透明**:主题自己声明 `"transparent"` 的那一档
   * (lucent-orng 的 background / backgroundPanel / backgroundElement)解析出来就是
   * RGBA(0,0,0,0)。那一档按 softenOver 走「不折算」,所以这里的全透明读作
   * 「背后是终端自己的底色,不猜」,不是「背后是黑」。
   */
  borderBackdrop?: RGBA
}

// 相位用 0..99 的整数计数表示(0.01 的分辨率对一圈渐变足够),每 80ms 走一格 ——
// 与 NeonRail 的流动节奏一致。整圈 = 8 秒。
const PHASE_STEPS = 100
const PHASE_INTERVAL = 80

// 悬停/聚焦时每拍多走一格:整圈从 8 秒缩到 4 秒。
//
// 原型那边是三条不同的量:常驻的侧栏右缘导轨 `railV 9s linear infinite`、
// 标签选中态 `.tab.active { animation: gbFlow 3s }`、悬停 `.bubble:hover { gbFlow 2.6s }`。
// 4 秒落在后两者之间,而 9s 与 8 秒在本实现里差的那 1 秒肉眼读不出来(共用同一张
// 相位表的 100 格 × 80ms 是 NeonRail 也在用的节奏,动它会牵动全 App)。
//
// **为什么是「每拍多走一格」而不是「换一张更快的表」**:表的拍长是全 App 共用的,
// 缩短它会让**正被悬停的那张卡**(同一时刻通常只有一张)的 requestRender 频率翻倍,
// 观感收益是 4 秒 vs 8 秒,代价是一份常驻的额外唤醒。每拍多走一格拿到同一个观感。
const HOVER_PHASE_STEP = 2

/**
 * 每拍相位走几格。1 = 常驻流动那一档,2 = 悬停/聚焦那一档。
 *
 * 抽成纯函数是为了让「悬停更快」这条在单测里能钉住整圈时长 —— 渲染层量它得看两帧
 * 之间的色带位移,而那会同时被扫光与 8bit 量化搅浑。
 */
export function phaseStep(animated: boolean) {
  return animated ? HOVER_PHASE_STEP : 1
}

// 扫光窗口(周长归一化进度为单位):相位头后方这一小段边框被向白色提亮,
// 峰值在头部、线性衰减到窗口尾。窗口占一圈的 **5%**。
//
// 折成格数:周长 = 2×宽 + 2×(高−2)(perimeterCells 的四段循环各画一遍),
// 120 列 × 4 行的输入卡 = 2×120 + 2×2 = 244 格,5% ≈ 12 格 ——
// 一道窄高光,不是半张脸的白。**5% 不是 12%**:用户反馈「聚焦时那道白带像探照灯」,
// 12% 在输入卡上是约 29 格、在会话页那张 120 列的气泡卡上是几十格,横着扫过去时
// 整条边会亮一整段。与峰值那一档一起收窄(见 SWEEP_STRENGTH),效果是「亮一下」。
// 亮一下,不是一道白光扫过整圈。这两条断言把量级钉住。
export const SWEEP_WIDTH = 0.05

// 头部最大提亮量:向白插值 **30%**。
//
// 原型那边最接近的是 `.card:hover` 的外发光 `0 0 26px rgba(255,92,158,.14)` —— 14%。
// 终端没有 box-shadow、没有外发光,「亮一点」只能落在描边色自己身上(见 ui/neon 的 NEON_WHITE),
// 所以取 30%:比原型那一档强一档还多,肉眼明确看得出「这里被点亮了」,又不再是一道白光。
// 收窄之前的 55% 是照着「亮得很清楚」调的,叠色之后(0.62 的 alpha)基准亮度只有约 1.24,
// 55% 一插把三通道之和从 1.24 顶到 2.21 —— **越过了色板自身的亮度上沿**,于是那一道
// 读起来像「比这条边本身更亮的别的东西」,而不是「这条边被照了一下」。
export const SWEEP_STRENGTH = 0.3

/**
 * 相位推进期间的「色带漂移窗口」。色板只在这中间一段(1 − FLOW_TRAVEL 那一档之外)来回走,
 * 不再把整条色板扫一遍。
 *
 * 为什么需要它:色相跨度是「这条边上一共出现了多少种颜色」的直接度量,而本仓库最宽的一条
 * 色板是 `tool` / `input` 用的全段霓虹 —— 默认深色主题下 #00e5ff → #4d7cff → #ff2d7b,
 * 色相 186° → 338°(跨度 152°)。悬停时整圈描边把这一整条走一遍,于是**七种节点语义之外
 * 又多了一层「它现在是第几种颜色」的噪声**,而这层噪声不携带任何信息。
 *
 * 收窄成 0.6 之后,最宽的那条色板在流动时只露出约 **91°**(152° × 0.6),最窄的
 * (用户粉紫 114°)露出约 68° —— 都落在「同色系里漂移」的量级。
 *
 * **只在相位推进期间生效**(`animated` 或 `flow` 为真)。`phase === 0` 的静止卡走的仍是
 * `gradientAt(stops, cell.t)`,逐格铺满整条色板 —— test/ui/card.test.ts 的静止态回归与
 * card-flow 的亮度区间断言都靠这一条。
 */
export const FLOW_TRAVEL = 0.6

/** 把色板进度压进「中间那一段」:`0.5 + (t − 0.5) × travel`。`travel = 1` 是恒等。 */
export function travelAt(t: number, travel = FLOW_TRAVEL) {
  return 0.5 + (t - 0.5) * travel
}

/**
 * 顶部光晕:上边框那一行额外朝一个方向推 TOP_EDGE_GLOW。
 *
 * 对应原型两处:
 *   · `.card` 的 `inset 0 1px 0 rgba(255,255,255,.05)` —— 卡片顶部那条内高光,
 *     让玻璃面读起来「上边被环境光照到」而不是一圈均匀的轮廓线;
 *   · 侧栏右缘流光 `linear-gradient(180deg, transparent, rgba(79,209,224,.55) 30%,
 *     rgba(255,92,158,.45) 70%, transparent)`(原型 :111)—— 那一段最亮的带子就在靠上 30%。
 *
 * 取 6% 而不是照抄 5%:描边已经先按 alpha 折算过一轮(亮度掉到纯渐变的 ~65%),
 * 同样的百分比叠在更暗的底上视觉增益更大。6% 折成 8bit 仍是 15 档以上,肉眼可辨;
 * 再高一档就会读成「第二圈亮边」而不是「边被点亮了」。
 *
 * **方向由叠色底的明暗极性决定**(见 topEdgeTarget),这是这一层唯一一处必须看主题的判断:
 * 那一档若无条件朝白推,在浅色底上描边本来就比底色暗,朝白推等于把它往底色上靠 ——
 * 顶边那一圈的对比度反而**降**一档(实测 #87b6e5 → #8ebae6,每通道 +7/255)。
 * 深色底上朝白推是「上边被环境光照到」,浅色底上同一个动作读起来是「描边被洗淡了」;
 * 浅色底上该给的是反方向的推 —— 与 HOVER_BOOST 那条「浅色主题下变成压暗」的判断同源,
 * 那条是因为目标色 theme.text 在浅色下是近黑,这里是因为底色在浅色下已经接近白。
 *
 * 只作用于 y = 0 那一行 —— 角格 `╭ ╮` 在那一行上,于是跟着亮;`╰ ╯` 在最后一行,不亮。
 * 侧边中段一律不带光晕(见 test/ui/card-border-alpha 的「左右边框中段不跟着亮」)。
 */
export const TOP_EDGE_GLOW = 0.06

/** 光晕的另一个目标色:叠色底是浅的那一档朝它推(见 topEdgeTarget)。 */
export const TOP_EDGE_INK = RGBA.fromValues(0, 0, 0, 1)

/**
 * 顶部光晕这一档往哪个方向推 —— 由叠色底的明暗极性决定,不看主题本身。
 *
 * 卡片类拿不到主题 context,但**叠色底就是那张卡背后真正的实色**,它已经能回答
 * 「这个界面是浅底还是深底」:渲染器里不需要再引一次 theme。判据用 0.299/0.587/0.114
 * 的相对亮度与 0.5 分界 —— 与 theme/index.ts 里 terminalMode / selectedForeground
 * 判定终端明暗是同一条线,同一个颜色在两处得到的答案一致。
 *
 * 叠色底全透明(见 softenOver:主题声明 transparent,或调用点忘了给 borderBackdrop)
 * 时无从判断极性,这一档维持朝白 —— 也就是这一层引入之前的行为,记在这里免得以后
 * 把它当成「浅色底也朝白推」的证据。那种底上现在画的是不折算的纯渐变(见 softenOver),
 * 光晕的 6% 落在满强度色上,量级已经小到读不出来。
 */
export function topEdgeTarget(backdrop: RGBA) {
  return 0.299 * backdrop.r + 0.587 * backdrop.g + 0.114 * backdrop.b > 0.5 ? TOP_EDGE_INK : NEON_WHITE
}

// padding 允许百分比,构造期无法换算成格数只能原样透传;数字统一夹到 ≥1 格。
const minPadding = (value: number | `${number}%` | null | undefined): number | `${number}%` =>
  typeof value === "number" ? Math.max(1, value) : (value ?? 1)

// 入场淡入:延迟等完之后,在 ENTER_FADE_MS 内把描边从起点色插到渐变终色。
// 150ms 的来历:它是 ENTER_STAGGER_STEP(40ms)的 3~4 倍,既跨过好几个阶梯步长让先后关系
// 看得出来,又短到「消息刚到就亮」——淡入不是过场动画,用户是在等回复。
const ENTER_FADE_MS = 150
// 淡入期间的刷新步长。150 / 30 = 5 帧,足够 8bit 量化下走出平滑的明暗梯度;
// 再密只是多烧几帧,再疏就会出现跳变。
const ENTER_FRAME_MS = 30

/**
 * 相位头已经越过该格多远(0..1 的环形距离)。
 *
 * 用 mod-1 而不是直接相减:phase 从 0.99 绕回 0.00 时窗口仍然连续,不会在周长接缝处断开。
 * `t = 0` 与 `t = 1` 算出同一个值(都算「头部」),因为 perimeterCells 给末格 t = 1、
 * 给首格 t = 0,两者是周长上的同一个接缝位置。
 */
export function sweepBehind(phase: number, t: number) {
  return (phase - t + 1) % 1
}

/** 该格该提亮多少(0..SWEEP_STRENGTH)。窗口内线性衰减,窗口外为 0。 */
export function sweepMix(phase: number, t: number) {
  const behind = sweepBehind(phase, t)
  if (behind > SWEEP_WIDTH) return 0
  return SWEEP_STRENGTH * (1 - behind / SWEEP_WIDTH)
}

// mix 的调用点已经保证 > 0,这里不再兜一遍。
function sweepColor(base: RGBA, mix: number) {
  return brighten(base, mix, NEON_WHITE)
}

/** 「这一格背后确实有一个实色」:终端只有 RGB,alpha = 0 的颜色叠不出任何东西(见 softenOver)。 */
function opaque(color: RGBA | undefined): color is RGBA {
  return color !== undefined && color.a > 0
}

/**
 * 边框格背后那一层实色的最后一档兜底:沿父链找最近一个不透明底色。
 *
 * 为什么需要它:透明卡的 borderBackdrop 得由调用点显式声明(见 borderBackdrop 的注释),
 * 而"忘了声明"是迟早会发生的事 —— 那一刻的后果不是"描边淡了一点",是**每张这样的卡外面
 * 套一圈黑框**(见 borderCellBackdrop)。往上一找通常就有答案:分区卡坐在有底色的侧栏根卡里
 * (routes/session/sidebar.tsx),别的位置则一路走到没有 backgroundColor 的根盒子。
 *
 * **找不到就是找不到**:根盒子(RootRenderable)压根没有 backgroundColor 这个属性,
 * 整屏底色是渲染器自己填的,渲染树里读不到。这一档返回 undefined,
 * 由调用方退回旧行为 —— 与 softenOver「背后不知道就不猜」同一条纪律。
 */
function ancestorBackdrop(start: Renderable): RGBA | undefined {
  // 非 Box 的渲染物(TextRenderable / RootRenderable)没有 backgroundColor,
  // 所以判一下类型而不是读一个不存在的属性。
  for (let node = start.parent; node; node = node.parent) {
    if (node instanceof BoxRenderable && opaque(node.backgroundColor)) return node.backgroundColor
  }
  return undefined
}

/**
 * 边框格背后那一层实色 —— **叠色折算的参考色,也是 setCell 写进格子里的 bg**,同一个值。
 *
 * 解析顺序(每一档都是"这一格底下真正画着的是什么颜色"):
 *   1. 自己的 backgroundColor —— 不透明时盒子的 fill 就画在这一格上(见 BoxRenderable.renderSelf
 *      的 hasVisibleFill),背后确实是它。有底色的卡(用户气泡 / 工具卡 / 思考卡 / 错误卡 /
 *      侧栏根卡)今天就是这样,这一档不许变。
 *   2. borderBackdrop —— 透明卡自己给不出答案,由调用点声明(见 borderBackdrop 的注释)。
 *      给出来的仍可能是全透明(主题自己声明 transparent,见 softenOver),那一档跳过。
 *   3. 最近的祖先底色 —— 忘了声明时的兜底,见 ancestorBackdrop。
 *   4. 什么都没有 → 退回自己的 backgroundColor(通常就是全透明)。**这是旧行为**:
 *      setCell 不做 alpha 合成也不「沿用原有底色」,RGBA(0,0,0,0) 落进格子就是 RGB(0,0,0),
 *      深色主题下读起来「就是边框」,浅色主题下是一圈黑框。找不到依据时宁可维持旧样,
 *      也不凭空替终端猜一个底色 —— 猜的那一档换个终端就是错的。
 *
 * **两层必须是同一个色**:叠色公式 `color·k + back·(1−k)` 里的 back 与写进格子的 bg 一致,
 * 描边才读得出"半透明地盖在那层底上"。两者分家时,前景是按 A 叠出来的、格子底却是 B,
 * 于是那一圈描边带着一圈对不上的暗边 —— 比单纯的"叠错色"更难看出问题。
 */
function borderCellBackdrop(own: RGBA, declared: RGBA | undefined, start: Renderable): RGBA {
  if (opaque(own)) return own
  if (opaque(declared)) return declared
  return ancestorBackdrop(start) ?? own
}

// 原生 buffer.setCell 会把超出当前 scissor 的坐标夹到裁剪边缘(不是丢弃),卡片滚出
// 滚动视口时边框会被糊在视口边线上。这里预先与所有会裁剪的祖先矩形求交,越界格直接跳过。
function visibleClip(
  buffer: OptimizedBuffer,
  start: Renderable,
): { x: number; y: number; right: number; bottom: number } {
  let x = 0
  let y = 0
  let right = buffer.width
  let bottom = buffer.height
  for (let node = start.parent; node; node = node.parent) {
    if (node.overflow === "visible") continue
    x = Math.max(x, node.screenX)
    y = Math.max(y, node.screenY)
    right = Math.min(right, node.screenX + node.width)
    bottom = Math.min(bottom, node.screenY + node.height)
  }
  return { x, y, right, bottom }
}

// 霓虹玻璃卡片:不走 <box border> 的单色边框,而是在 renderSelf 之后
// 按周长格子逐格重绘圆角边框字符 + 渐变色,对齐 mockup 的渐变描边。
// 约定:四边 padding ≥ 1 —— 数字经构造函数与 padding/paddingX/paddingY/paddingTop/Bottom/Left/Right
// 的 setter 统一夹紧(简写 setter 覆盖 JSX 直写路径);
// 子内容在边框之后绘制,padding 解析为 0 时是内容盖掉边框字符(边框缺格),不是反过来。
// 百分比 padding(含简写)构造期无法换算成格数、夹不了,解析为 0 格由调用方兜底。
// 边框绘制只在可见裁剪区内落笔,滚出视口的格子会被跳过,不产生边界残影。
export class NeonBoxRenderable extends BoxRenderable {
  private stops: readonly RGBA[] | undefined
  private phase = 0
  private animating = false
  private flowing = false
  private phaseTimer: ReturnType<typeof setInterval> | undefined
  private enterMs: number | undefined
  private enterColor: RGBA | undefined
  private enteredAt = 0
  private enterTimer: ReturnType<typeof setInterval> | undefined
  private painted = false
  private boostColor: RGBA | undefined
  private alpha: number = BORDER_ALPHA_DEFAULT
  private backdrop: RGBA | undefined

  constructor(ctx: RenderContext, options: NeonBoxOptions = {}) {
    const { gradientStops, animated, flow, enterDelay, enterFrom, boost, borderAlpha, borderBackdrop, ...rest } =
      options
    // rest 带 renderBefore 等 this: NeonBoxRenderable 回调,基类要求 this: BoxRenderable,
    // 二者仅 this 参数不同,向下收敛为 BoxOptions 交给 super。
    super(ctx, {
      ...(rest as BoxOptions),
      paddingTop: minPadding(options.paddingTop),
      paddingBottom: minPadding(options.paddingBottom),
      paddingLeft: minPadding(options.paddingLeft),
      paddingRight: minPadding(options.paddingRight),
    })
    this.stops = gradientStops
    if (animated) this.animated = true
    if (flow) this.flow = true
    // 顺序要紧:enterFrom 必须先于 enterDelay 落定 —— 后者会在渲染时向前者要起点色。
    if (enterFrom) this.enterFrom = enterFrom
    if (boost) this.boost = boost
    if (borderAlpha !== undefined) this.borderAlpha = borderAlpha
    if (borderBackdrop) this.borderBackdrop = borderBackdrop
    if (enterDelay !== undefined) this.enterDelay = enterDelay
  }

  get gradientStops(): readonly RGBA[] | undefined {
    return this.stops
  }

  set gradientStops(value: readonly RGBA[] | undefined) {
    this.stops = value
    this.requestRender()
  }

  get animated(): boolean {
    return this.animating
  }

  set animated(value: boolean) {
    if (value === this.animating) return
    this.animating = value
    this.syncPhaseTimer()
    this.requestRender()
  }

  get flow(): boolean {
    return this.flowing
  }

  set flow(value: boolean) {
    if (value === this.flowing) return
    this.flowing = value
    this.syncPhaseTimer()
    this.requestRender()
  }

  get enterDelay(): number | undefined {
    return this.enterMs
  }

  set enterDelay(value: number | undefined) {
    // 入场只播一次。enterDelay 是 JSX 属性,solid 每次重渲染都会重写它 —— 会话已经打开、
    // 用户这时才把 animations_enabled 打开的话,那个响应式表达式会从 undefined 变成一个
    // 数字,于是每一张历史卡都会被补播一次淡入(「打开动画」变成「整屏闪一次」)。
    // 卡片画过第一帧之后再来的延迟就已经不是入场了,是重播:直接忽略。
    if (value !== undefined && this.painted) return
    if (value === this.enterMs) return
    this.enterMs = value
    this.enteredAt = Date.now()
    if (value === undefined) {
      this.stopEnterTimer()
    } else {
      this.startEnterTimer()
    }
    this.requestRender()
  }

  get enterFrom(): RGBA | undefined {
    return this.enterColor
  }

  set enterFrom(value: RGBA | undefined) {
    if (value === this.enterColor) return
    this.enterColor = value
    this.requestRender()
  }

  get boost(): RGBA | undefined {
    return this.boostColor
  }

  set boost(value: RGBA | undefined) {
    if (value === this.boostColor) return
    this.boostColor = value
    this.requestRender()
  }

  get borderAlpha(): number {
    return this.alpha
  }

  set borderAlpha(value: number) {
    const clamped = Math.min(1, Math.max(0, value))
    if (clamped === this.alpha) return
    this.alpha = clamped
    this.requestRender()
  }

  get borderBackdrop(): RGBA | undefined {
    return this.backdrop
  }

  set borderBackdrop(value: RGBA | undefined) {
    if (value === this.backdrop) return
    this.backdrop = value
    this.requestRender()
  }

  // 定时器留在渲染器类里,而不是像 NeonRail 那样交给 Solid 的 createEffect:
  // animated 是 JSX 属性,setter 在组件卸载之后也可能被写(setProperty 走的是 node[name]);
  // 与类生命周期对齐的清理点是 destroySelf() —— Renderable.destroy() 一定会调它
  // (opentui Renderable.destroy 的最后一步就是 this.destroySelf()),所以卡片被卸载后
  // 表一定停。定时器本身也再判一次 isDestroyed 兜底:万一某条销毁路径没走到 destroySelf,
  // 表会在下一拍自停,不会把进程吊住。
  //
  // 「要不要动」只有两个入口:animated(悬停/聚焦:流动 + 扫光 + 更快)与
  // flow(常驻:只流动)。调用方(而不是这里)响应式地决定它们 ——
  // animations_enabled 这类用户设置折进来之后,关掉是 setter 停表、
  // 打开是 setter 再起表,两边对称,不存在「只能停不能恢复」的拉式门控。
  //
  // 表只有一个,起停条件是「两者任一为真」:分开起两张表会让同一张卡同时被两张表推进相位,
  // 而 animated 与 flow 可以任意组合(含同时为真),一张表 + 一个合并判据是唯一自洽的形状。
  private syncPhaseTimer() {
    if (this.animating || this.flowing) {
      this.startPhaseTimer()
    } else {
      this.stopPhaseTimer()
    }
  }

  private startPhaseTimer() {
    // 开头这一句就是「不叠表」这条不变量真正的保证:即使有人绕过相等守卫直接重复起表,
    // 旧表也会先被清掉。
    this.stopPhaseTimer()
    this.phaseTimer = setInterval(() => {
      if (this.isDestroyed) {
        this.stopPhaseTimer()
        return
      }
      this.phase = (this.phase + phaseStep(this.animating)) % PHASE_STEPS
      this.requestRender()
    }, PHASE_INTERVAL)
  }

  private stopPhaseTimer() {
    if (!this.phaseTimer) return
    clearInterval(this.phaseTimer)
    this.phaseTimer = undefined
  }

  /**
   * 入场淡入的短表。与相位表分开:相位表在 `animated` 期间常驻,入场表只活到淡入走完 ——
   * 消息列表窗口化会把卡片反复建/销,入场表如果像相位表那样常驻,每张卡漏一张就再也停不下来。
   * 因此每拍都重新判一次进度:淡入结束(或卡片已销毁)就当场自停,不依赖谁来清。
   */
  private startEnterTimer() {
    this.stopEnterTimer()
    this.enterTimer = setInterval(() => {
      if (this.isDestroyed || this.enterProgress() >= 1) {
        this.stopEnterTimer()
        if (this.isDestroyed) return
      }
      this.requestRender()
    }, ENTER_FRAME_MS)
  }

  private stopEnterTimer() {
    if (!this.enterTimer) return
    clearInterval(this.enterTimer)
    this.enterTimer = undefined
  }

  /** 入场进度 k ∈ [0,1]。没传 enterDelay 直接是 1(调用方要的就是终态)。 */
  private enterProgress() {
    if (this.enterMs === undefined) return 1
    const elapsed = Date.now() - this.enteredAt - this.enterMs
    if (elapsed <= 0) return 0
    return Math.min(1, elapsed / ENTER_FADE_MS)
  }

  protected override destroySelf(): void {
    this.stopPhaseTimer()
    this.stopEnterTimer()
    super.destroySelf()
  }

  // JSX 属性经 solid setProperty 直写 node[name],会绕过构造函数的 padding 夹紧,
  // 所以各 setter(含 padding/paddingX/paddingY 简写)同样夹到 ≥1 格;
  // 百分比原样透传(构造期换算不了格数)。简写经 yoga 的 All/Horizontal/Vertical 生效。
  override set padding(value: number | `${number}%` | null | undefined) {
    super.padding = minPadding(value)
  }

  override set paddingX(value: number | `${number}%` | null | undefined) {
    super.paddingX = minPadding(value)
  }

  override set paddingY(value: number | `${number}%` | null | undefined) {
    super.paddingY = minPadding(value)
  }

  override set paddingTop(value: number | `${number}%` | null | undefined) {
    super.paddingTop = minPadding(value)
  }

  override set paddingBottom(value: number | `${number}%` | null | undefined) {
    super.paddingBottom = minPadding(value)
  }

  override set paddingLeft(value: number | `${number}%` | null | undefined) {
    super.paddingLeft = minPadding(value)
  }

  override set paddingRight(value: number | `${number}%` | null | undefined) {
    super.paddingRight = minPadding(value)
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    super.renderSelf(buffer)
    const stops = this.stops
    if (!stops?.length) return
    const cells = perimeterCells(this.width, this.height)
    if (cells.length === 0) return
    // 描边确实要画了 —— 从这一刻起,再来的 enterDelay 不算入场(见 enterDelay 的 setter)。
    this.painted = true
    const originX = this.screenX
    const originY = this.screenY
    // 边框格背后那一层实色。有底色的卡拿自己的 backgroundColor 就是正确参考;
    // 透明卡给不出答案(它背后是面板底色还是纯黑,终端里读不到),调用点必须显式给
    // borderBackdrop,忘了才往父链上找(解析顺序与最后一档的旧行为见 borderCellBackdrop)。
    //
    // **这一个值同时是两样东西**:alphaOver 折算里的 back,以及 setCell 写进格子的 bg。
    // setCell 不做 alpha 合成、也没有「沿用原有底色」这种语义(见 test/ui/card-border-bg),
    // 所以直接把卡片自己的 backgroundColor 递进去,透明卡那一档就是把 RGB(0,0,0) 写进了
    // 每个边框格 —— 浅色主题下读出来就是每张卡外面一圈黑框。两者必须同色,理由见那个函数。
    const backdrop = borderCellBackdrop(this.backgroundColor, this.backdrop, this)
    // 光晕方向也是从这一档读的(浅底朝黑推,深底朝白推),逐格不变,提到循环外算一次。
    const glow = topEdgeTarget(backdrop)
    const clip = visibleClip(buffer, this)
    // phase = 0(从未动画过)时**不做环绕**:周长末格 cell.t = 1,`(1 + 0) % 1` 会把它送回
    // t = 0,那一格就渲染成起点色而不是终点色 —— 所有静止的卡(助手气泡卡 / 侧栏卡 /
    // 输入卡的失焦态)都会在接缝处偏一格。phase ≠ 0 才需要环绕,因为那里色带本来就在流动。
    // phase 只增不减:动画过后失焦会停在最后一格(而不是跳回起点),所以「逐格等于
    // gradientAt(stops, t)」这条只对从未动画过的卡片成立。
    const phase = this.phase / PHASE_STEPS
    // 相位推进期间的色带漂移窗口。静止卡(phase 从未离开过 0)走的是上面那个 `cell.t` 分支,
    // 完全不受这一档影响 —— 见 FLOW_TRAVEL 的注释。
    const travel = this.animating || this.flowing ? FLOW_TRAVEL : 1
    // 入场淡入的门控只有一级:enterDelay 没传 → k = 1(终态,下方短路,静止卡的逐格色不受影响)。
    // **没有第二道「起点色拿不到」的判据** —— from 在这里永远是个 RGBA,拿不到的情况不存在:
    // opentui 的 Renderable 默认 backgroundColor 就是 "transparent"
    // (node_modules/@opentui/core 的 chunk 里 `_defaultOptions.backgroundColor`),
    // 解析出来是 RGBA(0,0,0,0) 而不是 undefined。于是 `enterColor ?? backgroundColor`
    // 恒有值,fromTone 无条件算得出。下面那句注释记的是「早先这里还有一道 && from 的门控,
    // 8a25a5f 删掉了」,免得以后照着旧注释去找一个不存在的分支。
    const entered = this.enterMs === undefined ? 1 : this.enterProgress()
    // 入场起点与终态走**同一套**折算:起点色是 theme.border 那样的普通边框色,不给它叠一遍的话,
    // 淡入的第 0 帧会比终态亮一整档 —— k = 0 那一帧闪一下。叠完之后起点仍然明显暗于
    // 渐变终色(theme.border 是灰的,渐变是彩的),阶梯感不受影响。
    // 叠色底全透明时 softenOver 不折算(见它的注释),起点与终态于是都取原色,仍然对齐。
    const from = this.enterColor ?? this.backgroundColor
    // 与终态同一套折算(见循环里那一段的注释)。逐格不变,所以提到循环外算一次。
    const fromTone = softenOver(from, backdrop, this.alpha)
    const fading = entered < 1
    const boost = this.boostColor
    // 祖先压下来的 opacity(视图入场那一档,见 routes/session/view-entrance)。
    // **必须自己折算**:描边走的是 `buffer.setCell`,而那条路径不吃渲染器的 opacity 栈
    // (只有 setCellWithAlphaBlending 才吃,那是文字那条路)。不折算的话视图淡入时正文在变暗、
    // 卡片却满亮 —— 一眼假。getCurrentOpacity() 在没有祖先压 opacity 时恒为 1,
    // 于是静止卡的逐格色一字不变(下面这层乘法在 k = 1 时是恒等)。
    //
    // 乘的是「朝黑色收敛」,而不是 alpha 混合的 `src·k + dst·(1−k)`:这一层拿不到背后是什么颜色
    // (透明卡片背后可能是面板底色,也可能是纯黑),凭空挑一个只会闪出一圈脏边 —— 与 enterFrom
    // 的注释同一条纪律。深色主题下背景近黑,两种算法看不出差别;浅色主题下描边会略暗于
    // 「朝背景收敛」应有的样子,这是已知的近似,记在这里免得以后当成 bug 查。
    const ambient = buffer.getCurrentOpacity()
    for (const cell of cells) {
      const x = originX + cell.x
      const y = originY + cell.y
      if (x < clip.x || x >= clip.right || y < clip.y || y >= clip.bottom) continue
      const gradient = gradientAt(stops, this.phase === 0 ? cell.t : travelAt((cell.t + phase) % 1, travel))
      // 顺序是「渐变 → 叠色柔边 → 顶部光晕 → 悬停抬对比 → 入场淡入 → 扫光 → 祖先 opacity」:
      //   叠色紧跟渐变,因为它改的是**描边本身**:原型那一圈描边本来就是半透明的,
      //     后面几层(悬停光晕、扫光、入场)都加在「已经折算过的那一圈」上,不是加在纯渐变上;
      //   顶部光晕跟着叠色走 —— 原型那条内高光也在半透明描边之上,顺序反了它会浮成第二圈亮边;
      //     方向由 glow 给(浅底朝黑、深底朝白,见 topEdgeTarget),叠色底全透明时维持朝白;
      //   抬对比要在入场之前,这样淡入的终点就是「悬停时的高对比描边」(k = 1 时两者等价,顺序不打架);
      //   扫光放最后,它提亮的是**当前这一帧画出来的颜色**,入场与悬停叠加时高光跟着一起淡入;
      //   祖先 opacity 在最外层 —— 它是整棵子树的透明度,得作用在这一帧**最终**的颜色上,
      //     放在它前面会让提亮/扫光绕过祖先那层压暗。
      const softened = softenOver(gradient, backdrop, this.alpha)
      const lit = cell.y === 0 ? brighten(softened, TOP_EDGE_GLOW, glow) : softened
      const lifted = boost ? brighten(lit, HOVER_BOOST, boost) : lit
      const faded = fading ? fadeIn(fromTone, lifted, entered) : lifted
      const mix = this.animating ? sweepMix(phase, cell.t) : 0
      const painted = mix > 0 ? sweepColor(faded, mix) : faded
      buffer.setCell(x, y, cell.ch, ambient === 1 ? painted : dim(painted, ambient), backdrop)
    }
  }
}

// 祖先 opacity 的折算:逐通道乘 k,alpha 原样保留(透明度是「压暗多少」,不是「这张卡有没有底色」)。
function dim(color: RGBA, k: number) {
  return RGBA.fromValues(color.r * k, color.g * k, color.b * k, color.a)
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    neonbox: typeof NeonBoxRenderable
  }
}

extend({ neonbox: NeonBoxRenderable })
