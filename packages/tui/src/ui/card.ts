import {
  BoxRenderable,
  RGBA,
  type BoxOptions,
  type OptimizedBuffer,
  type Renderable,
  type RenderContext,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { gradientAt, perimeterCells } from "./neon"

export type NeonBoxOptions = BoxOptions<NeonBoxRenderable> & {
  gradientStops?: readonly RGBA[]
  /** 描边流动 + 扫光。相位由本类自己推进,见 animated 的 setter。 */
  animated?: boolean
  /**
   * 相位推进的开关(对应 KV 的 animations_enabled)。渲染器类没有 KV 上下文,
   * 由调用方注入 `() => kv.get("animations_enabled", true)`;不传则恒为真。
   */
  animationsEnabled?: () => boolean
}

// 相位用 0..99 的整数计数表示(0.01 的分辨率对一圈渐变足够),每 80ms 走一格 ——
// 与 NeonRail 的流动节奏一致。整圈 = 8 秒。
const PHASE_STEPS = 100
const PHASE_INTERVAL = 80

// 扫光窗口(周长归一化进度为单位):相位头后方这一小段边框被向白色提亮,
// 峰值在头部、线性衰减到窗口尾。窗口占一圈的 12% —— 120 列的输入卡约 55 格,
// 视觉上是一道窄高光而不是半张脸的白。
const SWEEP_WIDTH = 0.12
// 头部最大提亮量:向白插值 55%。
const SWEEP_STRENGTH = 0.55

// padding 允许百分比,构造期无法换算成格数只能原样透传;数字统一夹到 ≥1 格。
const minPadding = (value: number | `${number}%` | null | undefined): number | `${number}%` =>
  typeof value === "number" ? Math.max(1, value) : (value ?? 1)

// 相位头已经越过该格多远(0..1 的环形距离)。用 mod-1 而不是直接相减:
// phase 从 0.99 绕回 0.00 时窗口仍然连续,不会在周长接缝处断开。
function sweepBehind(phase: number, t: number) {
  return (phase - t + 1) % 1
}

// 该格该提亮多少(0..SWEEP_STRENGTH)。窗口内线性衰减,窗口外为 0。
function sweepMix(phase: number, t: number) {
  const behind = sweepBehind(phase, t)
  if (behind > SWEEP_WIDTH) return 0
  return SWEEP_STRENGTH * (1 - behind / SWEEP_WIDTH)
}

function sweepColor(base: RGBA, mix: number) {
  if (mix <= 0) return base
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
  private readonly animationsEnabled: () => boolean

  constructor(ctx: RenderContext, options: NeonBoxOptions = {}) {
    const { gradientStops, animated, animationsEnabled, ...rest } = options
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
    this.animationsEnabled = animationsEnabled ?? (() => true)
    if (animated) this.animated = true
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

  // 定时器留在渲染器类里,而不是像 NeonRail 那样交给 Solid 的 createEffect:
  // animated 是 JSX 属性,setter 在组件卸载之后也可能被写(setProperty 走的是 node[name]);
  // 与类生命周期对齐的清理点是 destroySelf() —— Renderable.destroy() 一定会调它
  // (opentui Renderable.destroy 的最后一步就是 this.destroySelf()),所以卡片被卸载后
  // 表一定停。定时器本身也再判一次 isDestroyed 兜底:万一某条销毁路径没走到 destroySelf,
  // 表会在下一拍自停,不会把进程吊住。
  private startPhaseTimer() {
    this.stopPhaseTimer()
    this.phaseTimer = setInterval(() => {
      if (this.isDestroyed) {
        this.stopPhaseTimer()
        return
      }
      if (!this.animationsEnabled()) return
      this.phase = (this.phase + 1) % PHASE_STEPS
      this.requestRender()
    }, PHASE_INTERVAL)
  }

  private stopPhaseTimer() {
    if (!this.phaseTimer) return
    clearInterval(this.phaseTimer)
    this.phaseTimer = undefined
  }

  protected override destroySelf(): void {
    this.stopPhaseTimer()
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
    const originX = this.screenX
    const originY = this.screenY
    const background = this.backgroundColor
    const clip = visibleClip(buffer, this)
    const phase = this.phase / PHASE_STEPS
    for (const cell of cells) {
      const x = originX + cell.x
      const y = originY + cell.y
      if (x < clip.x || x >= clip.right || y < clip.y || y >= clip.bottom) continue
      const base = gradientAt(stops, (cell.t + phase) % 1)
      // 扫光只在流动中生效:相位恒 0 时周长末格(cell.t=1)的环形距离恰好是 0,
      // 会凭空多出一个白点。关掉动画必须逐格与改造前完全同色。
      const mix = this.animating ? sweepMix(phase, cell.t) : 0
      buffer.setCell(x, y, cell.ch, mix > 0 ? sweepColor(base, mix) : base, background)
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    neonbox: typeof NeonBoxRenderable
  }
}

extend({ neonbox: NeonBoxRenderable })
