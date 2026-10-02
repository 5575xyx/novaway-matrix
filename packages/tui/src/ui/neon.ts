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

/**
 * 把 color 朝 towards 混合 amount(0..1,越界夹紧)。alpha 原样保留 ——
 * 提亮改的是「亮不亮」,不是「透不透明」;卡片的 alpha 是「这只卡有没有底色」的事。
 */
export function brighten(color: RGBA, amount: number, towards: RGBA): RGBA {
  const k = Math.min(1, Math.max(0, amount))
  return RGBA.fromValues(
    color.r + (towards.r - color.r) * k,
    color.g + (towards.g - color.g) * k,
    color.b + (towards.b - color.b) * k,
    color.a,
  )
}

// 悬停「光晕加深」的等效实现:终端里没有 box-shadow 也没有半透明,描边色只能朝某个方向混一点。
//
// 目标色由调用点给(四张卡都传 theme.text),所以这一档的效果是分两种的:
//   深色主题:theme.text 是近白 → 描边**变亮**;
//   浅色主题:theme.text 是近黑 → 描边**变暗**。
// 两种都在做同一件事:拉开描边与面板底色的对比度 —— 这才是悬停该给的反馈,
// 「变亮」只是它在深色主题下的一个特例,写成「提亮」会让人以为浅色下也在变亮。
//
// 目标不取纯白:浅色主题下把描边往白里推等于让它往白底上靠,悬停时整圈描边会淡进背景里,
// 与原型 .card:hover「阴影加深 = 卡片浮起来」正好相反。
//
// 12% 的来历:原型 .card:hover 把外发光从 rgba(79,209,224,.05)/14px 抬到 rgba(255,92,158,.14)/26px
// —— 强度约 2.8 倍、半径约 1.9 倍。终端只有「边框色 vs 底色」这一个维度,没有半径,
// 2.8 倍直接照搬会把描边推成另一种颜色(不再是原来的语义色),所以只取一半左右、
// 取一个在 8bit 量化下仍然看得见(≥ 4/255 ≈ 1.6%)又不会盖掉渐变本身的一档:12%。
// ui/hover.ts 的调用点用它。
export const HOVER_BOOST = 0.12

export type BorderCell = { x: number; y: number; ch: string; t: number }

export type NeonRole = "user" | "assistant" | "thinking" | "tool" | "error" | "tip" | "input"

// 逐通道精确相等 —— RGBA 走 8bit 量化,两个不同的 hex 解析出来要么四个通道全等,
// 要么至少差一档。「肉眼分辨不出的两档差异」对渐变没有意义:与其画一条几乎不存在的坡,
// 不如换一个确实不同的端色。所以这里不做容差。
function sameColor(a: RGBA, b: RGBA) {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}

// 两段色板 + 平色兜底。
//
// 兜底是给「某个主题把两端配成了同一个色」准备的。真实踩过的例子:novaway 的
// defs.darkCyan 与 defs.darkStep9 都是 #00e5ff,助手卡那一圈描边在默认深色主题下
// 退化成平色,原型的青蓝坡完全看不见(只有扫光还在动,看起来像在「流动」)。
// 兜底端色取 accent、再退到 neonEnd —— 两者按语义都离第一段足够远,顺序固定,
// 所以同一个主题每次解析出的色板完全一样,不会引入随机或顺序依赖。
// 若连这两个都等于第一端,说明该主题把所有霓虹 token 都设成了同一个色,
// 这时 tool/input 的三段霓虹同样是平的,已经不是这一层能救的情况,原样退回。
function ramp(theme: Theme, first: RGBA, second: RGBA): readonly RGBA[] {
  if (!sameColor(first, second)) return [first, second]
  const fallback = sameColor(theme.accent, first) ? theme.neonEnd : theme.accent
  return sameColor(fallback, first) ? [first, second] : [first, fallback]
}

/**
 * 角色 → 描边色板的语义映射(原型设计语言③)。
 *
 * 多段(必须有坡,画出来才看得出是渐变而不是一个色块):
 * - `assistant` 助手气泡卡:青蓝两段 —— `primary` 青 → `secondary` 蓝,
 *   novaway 深色是 #00e5ff → #4d7cff。UI 里最显眼的一圈描边,曾经写成
 *   `[info, primary]`,而默认深色主题里这两个 token 同为 #00e5ff,直接退化成平色。
 * - `user` 用户气泡卡:粉紫两段 —— `accent` 粉 → `neonMid` 紫(#ff2d7b → #4d7cff)。
 * - `thinking` 思考卡:`neonMid` → `neonEnd` 两段(#4d7cff 蓝 → #ff2d7b 品红)。
 *   原型文案写的是「紫青」,实配这两端在默认主题里是蓝→品红:方向对(都离开主色),
 *   文案与实际不完全一致,见 1b 的汇报,这里只保证它**不**平。
 * - `tool` / `input` 工具卡与输入卡:全段霓虹三端(#00e5ff → #4d7cff → #ff2d7b)。
 *
 * 单段(故意如此):`error` 红 / `tip` 琥珀。这两种语义靠「整圈都是那个红 / 那个琥珀」
 * 传达,加渐变会被读成装饰(报的错也可能只是一半红一半粉,读不出严重性),
 * 原型也是纯红框 / 纯琥珀框。单段 role 不参与平色兜底 —— 那里本来就只有一个色。
 */
export function semanticStops(theme: Theme, role: NeonRole): readonly RGBA[] {
  if (role === "assistant") return ramp(theme, theme.primary, theme.secondary)
  if (role === "user") return ramp(theme, theme.accent, theme.neonMid)
  if (role === "thinking") return ramp(theme, theme.neonMid, theme.neonEnd)
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
