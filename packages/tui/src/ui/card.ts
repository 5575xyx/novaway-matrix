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
}

// padding 允许百分比,构造期无法换算成格数只能原样透传;数字统一夹到 ≥1 格。
const minPadding = (value: number | `${number}%` | null | undefined): number | `${number}%` =>
  typeof value === "number" ? Math.max(1, value) : (value ?? 1)

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

  constructor(ctx: RenderContext, options: NeonBoxOptions = {}) {
    const { gradientStops, ...rest } = options
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
  }

  get gradientStops(): readonly RGBA[] | undefined {
    return this.stops
  }

  set gradientStops(value: readonly RGBA[] | undefined) {
    this.stops = value
    this.requestRender()
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
    for (const cell of cells) {
      const x = originX + cell.x
      const y = originY + cell.y
      if (x < clip.x || x >= clip.right || y < clip.y || y >= clip.bottom) continue
      buffer.setCell(x, y, cell.ch, gradientAt(stops, cell.t), background)
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    neonbox: typeof NeonBoxRenderable
  }
}

extend({ neonbox: NeonBoxRenderable })
