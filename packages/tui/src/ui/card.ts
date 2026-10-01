import { BoxRenderable, RGBA, type BoxOptions, type OptimizedBuffer, type RenderContext } from "@opentui/core"
import { extend } from "@opentui/solid"
import { gradientAt, perimeterCells } from "./neon"

export type NeonBoxOptions = BoxOptions<NeonBoxRenderable> & {
  gradientStops?: readonly RGBA[]
}

// padding 允许百分比,构造期无法换算成格数只能原样透传;数字统一夹到 ≥1 格。
const minPadding = (value: number | `${number}%` | undefined): number | `${number}%` =>
  typeof value === "number" ? Math.max(1, value) : (value ?? 1)

// 霓虹玻璃卡片:不走 <box border> 的单色边框,而是在 renderSelf 之后
// 按周长格子逐格重绘圆角边框字符 + 渐变色,对齐 mockup 的渐变描边。
// 约定:四边 padding ≥ 1(构造时强制),否则内容首行/首列会被边框字符盖住。
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

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    super.renderSelf(buffer)
    const stops = this.stops
    if (!stops?.length) return
    const cells = perimeterCells(this.width, this.height)
    if (cells.length === 0) return
    const originX = this.screenX
    const originY = this.screenY
    const background = this.backgroundColor
    for (const cell of cells) {
      buffer.setCell(originX + cell.x, originY + cell.y, cell.ch, gradientAt(stops, cell.t), background)
    }
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    neonbox: typeof NeonBoxRenderable
  }
}

extend({ neonbox: NeonBoxRenderable })
