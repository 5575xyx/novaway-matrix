import {
  BoxRenderable,
  RGBA,
  type BoxOptions,
  type OptimizedBuffer,
  type Renderable,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { fadeIn, gradientAt, perimeterCells } from "./neon"

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
   * 入场淡入的延迟(毫秒)。**不传就是直接终态** —— 调用方据此表达
   * 「不要入场」,animations_enabled 关闭时也正是走这条路(见 ui/enter.ts)。
   * 0 表示立刻开始淡入,undefined 表示跳过淡入。
   */
  enterDelay?: number
  /**
   * 描边淡入的起点色。省略时退回这张卡自己的 backgroundColor(有底色的卡 ——
   * 用户气泡 / 错误卡 / 思考卡 / 工具卡 —— 淡入就是从底色长出描边)。
   * 透明卡片(助手气泡卡 / 分区卡 / 输入卡)必须显式给:终端里没有半透明,
   * 不知道背后是什么颜色时凭空挑一个起点,只会闪出一圈脏边。
   */
  enterFrom?: RGBA
}

// 相位用 0..99 的整数计数表示(0.01 的分辨率对一圈渐变足够),每 80ms 走一格 ——
// 与 NeonRail 的流动节奏一致。整圈 = 8 秒。
const PHASE_STEPS = 100
const PHASE_INTERVAL = 80

// 扫光窗口(周长归一化进度为单位):相位头后方这一小段边框被向白色提亮,
// 峰值在头部、线性衰减到窗口尾。窗口占一圈的 12%。
// 折成格数:周长 = 2×宽 + 2×(高−2)(perimeterCells 的四段循环各画一遍),
// 120 列 × 4 行的输入卡 = 2×120 + 2×2 = 244 格,12% ≈ 29 格 ——
// 视觉上是一道窄高光,不是半张脸的白。
const SWEEP_WIDTH = 0.12
// 头部最大提亮量:向白插值 55%。
const SWEEP_STRENGTH = 0.55

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
  return RGBA.fromValues(base.r + (1 - base.r) * mix, base.g + (1 - base.g) * mix, base.b + (1 - base.b) * mix, base.a)
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
  private phaseTimer: ReturnType<typeof setInterval> | undefined
  private enterMs: number | undefined
  private enterColor: RGBA | undefined
  private enteredAt = 0
  private enterTimer: ReturnType<typeof setInterval> | undefined
  private painted = false

  constructor(ctx: RenderContext, options: NeonBoxOptions = {}) {
    const { gradientStops, animated, enterDelay, enterFrom, ...rest } = options
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
    // 顺序要紧:enterFrom 必须先于 enterDelay 落定 —— 后者会在渲染时向前者要起点色。
    if (enterFrom) this.enterFrom = enterFrom
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
    if (value) {
      this.startPhaseTimer()
    } else {
      this.stopPhaseTimer()
    }
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

  // 定时器留在渲染器类里,而不是像 NeonRail 那样交给 Solid 的 createEffect:
  // animated 是 JSX 属性,setter 在组件卸载之后也可能被写(setProperty 走的是 node[name]);
  // 与类生命周期对齐的清理点是 destroySelf() —— Renderable.destroy() 一定会调它
  // (opentui Renderable.destroy 的最后一步就是 this.destroySelf()),所以卡片被卸载后
  // 表一定停。定时器本身也再判一次 isDestroyed 兜底:万一某条销毁路径没走到 destroySelf,
  // 表会在下一拍自停,不会把进程吊住。
  //
  // 「要不要动」只有一个入口:animated。调用方(而不是这里)响应式地决定它 ——
  // animations_enabled 这类用户设置折进 animated 之后,关掉是 setter 停表、
  // 打开是 setter 再起表,两边对称,不存在「只能停不能恢复」的拉式门控。
  private startPhaseTimer() {
    // 开头这一句就是「不叠表」这条不变量真正的保证:即使有人绕过相等守卫直接重复起表,
    // 旧表也会先被清掉。
    this.stopPhaseTimer()
    this.phaseTimer = setInterval(() => {
      if (this.isDestroyed) {
        this.stopPhaseTimer()
        return
      }
      this.phase = (this.phase + 1) % PHASE_STEPS
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
    const background = this.backgroundColor
    const clip = visibleClip(buffer, this)
    // phase = 0(从未动画过)时**不做环绕**:周长末格 cell.t = 1,`(1 + 0) % 1` 会把它送回
    // t = 0,那一格就渲染成起点色而不是终点色 —— 所有静止的卡(助手气泡卡 / 侧栏卡 /
    // 输入卡的失焦态)都会在接缝处偏一格。phase ≠ 0 才需要环绕,因为那里色带本来就在流动。
    // phase 只增不减:动画过后失焦会停在最后一格(而不是跳回起点),所以「逐格等于
    // gradientAt(stops, t)」这条只对从未动画过的卡片成立。
    const phase = this.phase / PHASE_STEPS
    // 入场淡入的两级门控:enterDelay 没传 → k = 1(终态,下方短路,静止卡的逐格色不受影响);
    // 传了但起点色拿不到(enterFrom 与 backgroundColor 都没有)→ 也走终态,
    // 见 enterFrom 的注释:不知道背后是什么颜色时不该凭空挑一个起点。
    const entered = this.enterMs === undefined ? 1 : this.enterProgress()
    const from = this.enterColor ?? this.backgroundColor
    const fading = entered < 1 && from
    for (const cell of cells) {
      const x = originX + cell.x
      const y = originY + cell.y
      if (x < clip.x || x >= clip.right || y < clip.y || y >= clip.bottom) continue
      const gradient = gradientAt(stops, this.phase === 0 ? cell.t : (cell.t + phase) % 1)
      // 入场淡入包在渐变外面。k = 1(不传 enterDelay,或已经淡完)时 faded 直接就是 gradient,
      // 逐格色与之前完全一致 —— 静止卡的「逐格等于 gradientAt(stops, t)」那条契约不受影响。
      const faded = fading ? fadeIn(from, gradient, entered) : gradient
      const mix = this.animating ? sweepMix(phase, cell.t) : 0
      buffer.setCell(x, y, cell.ch, mix > 0 ? sweepColor(faded, mix) : faded, background)
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    neonbox: typeof NeonBoxRenderable
  }
}

extend({ neonbox: NeonBoxRenderable })
