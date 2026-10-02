import { RGBA } from "@opentui/core"
import type { Theme } from "../theme"

// 卡片/导轨的默认霓虹三端色,来自主题 token(缺省兜底见 theme/index.ts 的 resolveTheme)。
export function neonStops(theme: Theme): RGBA[] {
  return [theme.neonStart, theme.neonMid, theme.neonEnd]
}

// 沿 stops 做分段线性插值;t 越界夹紧到 [0,1];单色直接返回。
export function gradientAt(stops: readonly RGBA[], t: number): RGBA {
  if (stops.length === 0) throw new Error("gradientAt: 需要至少一个颜色")
  if (stops.length === 1) return stops[0]!
  const clamped = Math.min(1, Math.max(0, t))
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const local = scaled - index
  const from = stops[index]!
  const to = stops[index + 1]!
  return RGBA.fromValues(
    from.r + (to.r - from.r) * local,
    from.g + (to.g - from.g) * local,
    from.b + (to.b - from.b) * local,
    from.a + (to.a - from.a) * local,
  )
}

/**
 * 入场淡入:描边色从 from 插值到 to,k ∈ [0,1] 越界夹紧。
 *
 * 终端没有 opacity(真彩色 SGR 只有 RGB 三元组,alpha 到终端这一层必然被丢掉),
 * 「淡入」只能是两个实色之间插值 —— 与 CSS 的 opacity 0→1 语义上不可比,
 * 但在这条设计语言里(卡片只有一圈渐变描边)它就是描边亮起来的过程。
 */
export function fadeIn(from: RGBA, to: RGBA, k: number): RGBA {
  const clamped = Math.min(1, Math.max(0, k))
  return RGBA.fromValues(
    from.r + (to.r - from.r) * clamped,
    from.g + (to.g - from.g) * clamped,
    from.b + (to.b - from.b) * clamped,
    from.a + (to.a - from.a) * clamped,
  )
}

export type BorderCell = { x: number; y: number; ch: string; t: number }

export type NeonRole = "user" | "assistant" | "thinking" | "tool" | "error" | "tip" | "input"

// 原型设计语言③的语义映射:提示=琥珀、用户=粉紫、助手=青蓝、思考=紫青、工具=全段、错误=红、输入=全段。
export function semanticStops(theme: Theme, role: NeonRole): readonly RGBA[] {
  if (role === "assistant") return [theme.info, theme.primary]
  if (role === "user") return [theme.accent, theme.neonMid]
  if (role === "thinking") return [theme.neonMid, theme.neonEnd]
  if (role === "error") return [theme.error]
  if (role === "tip") return [theme.warning]
  return neonStops(theme)
}

// 矩形周长格子,按「上(左→右) → 右(上→下) → 下(右→左) → 左(下→上)」顺序连续一圈,
// t 是该格在整圈上的归一化进度 —— NeonBox 用它把渐变色沿边框绕一圈。
export function perimeterCells(width: number, height: number): BorderCell[] {
  if (width < 2 || height < 2) return []
  const cells: Array<{ x: number; y: number; ch: string }> = []
  for (let x = 0; x < width; x++) {
    cells.push({ x, y: 0, ch: x === 0 ? "╭" : x === width - 1 ? "╮" : "─" })
  }
  for (let y = 1; y < height - 1; y++) {
    cells.push({ x: width - 1, y, ch: "│" })
  }
  for (let x = width - 1; x >= 0; x--) {
    cells.push({ x, y: height - 1, ch: x === width - 1 ? "╯" : x === 0 ? "╰" : "─" })
  }
  for (let y = height - 2; y >= 1; y--) {
    cells.push({ x: 0, y, ch: "│" })
  }
  const last = cells.length - 1
  return cells.map((cell, index) => ({ ...cell, t: last === 0 ? 0 : index / last }))
}
