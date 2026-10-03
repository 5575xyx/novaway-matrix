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

/**
 * 叠色:alpha = k 的 color 盖在 back 上,眼睛看到的那个实色。
 *
 * 终端只有 RGB(见 fadeIn 的注释),原型的半透明描边只能这样折算 —— 而且这**就是** alpha
 * 混合在该背景上的定义式,不是近似:per_channel = color·k + back·(1−k)。
 * 于是「给描边配一个 alpha」与「给它配一个背景」是一件事的两面:back 取错,
 * 叠出来的颜色就等于叠在了别的背景上算的那一档。
 *
 * 与 brighten 的区别只在语义与参数位置:brighten 是「朝 towards 混 amount」,
 * 这里 k 是**图层自己的 alpha**,towards 是**背景** —— 读代码时这两件事很容易看反,
 * 所以不合并成一个函数。
 *
 * **这一层不做「背后不知道」的判断**,那件事归 softenOver。
 */
export function alphaOver(color: RGBA, back: RGBA, alpha: number): RGBA {
  const k = Math.min(1, Math.max(0, alpha))
  return RGBA.fromValues(
    color.r * k + back.r * (1 - k),
    color.g * k + back.g * (1 - k),
    color.b * k + back.b * (1 - k),
    color.a,
  )
}

/**
 * 描边真正用的那一层折算:`back` 是实色就按 alpha 叠,`back` 全透明就**不叠**。
 *
 * 全透明意味着「这一格背后没有实色」,而不是「背后是纯黑」。终端里这件事是真的:
 * 主题可以直接声明 `"transparent"`(lucent-orng 的 background / backgroundPanel /
 * backgroundElement 三档都是,见 theme/assets/lucent-orng.json:68-78),那时渲染器
 * 画的就是终端自己的底色 —— 浅色终端上是白,深色终端上是黑,读不到具体是哪一个。
 * 而 alphaOver 只看 back 的 RGB、不看它的 alpha(见上面那句 per_channel),于是
 * 「transparent」会被当成 RGB(0,0,0):叠出来的描边永远偏黑。**浅色终端下那一圈描边
 * 于是比原型重**,正是 borderBackdrop 这个属性要防的那件事,只是从另一头撞上来。
 *
 * 折算里的 (1−k) 那一项乘的就是「背后那个实色」。背后没有实色时,那一项没有依据 ——
 * 与其凭空捏一层黑底(在浅色终端上必然算错),不如**不折算**:描边就是原型给的那圈渐变
 * 本身。这也让这类主题的描边与它自己的 border token 同一口径(lucent-orng 的
 * `border` 是 #EC5B2B,本来就不折算)。
 *
 * 判据只认「全透明」(a === 0),不认「半透明」:半透明面板色仍带着自己的 RGB,
 * 拿它当参考是有依据的近似(叠色公式本来就不吃 back.a);真要连它一起修,得先知道
 * 终端底色,那是终端读不到的信息。
 *
 * 不折算的代价也说明白:这一档画出来的是**满强度**描边 —— 正是下面那段注释里说
 * 「压不住」的 1.0。深色终端上它读起来正常(饱和亮线压在近黑底上);近白底上会明显
 * 变淡:实测 lucent-orng 的琥珀 #ffb800 落在近白底(#f5f7fa)上只有 1.62:1,而落在
 * 纯黑上是 4.03:1。1.62:1 那一档恰恰是原型自己在浅色页面上的观感(`.card` 的
 * `--gb-main` 同样是一条不透明的浅色描边),4.03:1 那一档才是凭空加的黑底。
 * **想要更实的描边就把主题那一档背景写成实色**(一行 theme JSON),别在渲染层替它猜
 * 终端底色 —— 猜的那一档换个终端就是错的。
 *
 * 调用点只有一处:NeonBoxRenderable.renderSelf 里每一格描边(以及入场起点色)。
 * 纯函数是为了让「背后全透明就不折算」这条在单测里能钉住,而不必去挂一张真卡
 * 再从字符帧里反推颜色。
 */
export function softenOver(color: RGBA, back: RGBA, alpha: number): RGBA {
  if (back.a === 0) return color
  return alphaOver(color, back, alpha)
}

/**
 * 描边「提亮」的固定目标色 = 纯白。
 *
 * 终端里没有 box-shadow、没有外发光,「亮一点」只能落在描边色本身。纯白是唯一不带
 * 语义的选择:带主题色的目标会把它读成「换了个颜色」而不是「被点亮了」。
 * 浅色主题下这一档会把描边往白底里推(见 HOVER_BOOST 的注释),但纯白至少不会替它编一个色相。
 */
export const NEON_WHITE = RGBA.fromValues(1, 1, 1, 1)

/**
 * 描边的默认「叠色档」(NeonBoxRenderable 的 borderAlpha 默认值)。
 *
 * 原型 card-design-v7.html 的描边是一律的半透明渐变,逐个抄回来的 alpha:
 *   `.msg.assistant .bubble`  rgba(79,209,224,.8) → rgba(74,158,255,.55)   均值 .675
 *   `.thinking .bubble`       rgba(167,139,250,.8) → rgba(79,209,224,.55) 均值 .675
 *   `.msg.user .bubble`       rgba(255,92,158,.9) → rgba(167,139,250,.7)  均值 .80
 *   `.prompt`                 rgba(79,209,224,.5) → rgba(74,158,255,.4)  均值 .45
 *   `.tip`                    rgba(245,184,61,.85) → rgba(245,140,61,.65) 均值 .75
 *   `.seg`                    两端都是 .55                              均值 .55
 * 助手 / 用户气泡 / 思考卡 / 工具卡 / 错误卡这一族共用 **0.62**:
 * 落在 .55~.90 这个区间里,略低于助手与思考两档的均值 —— 终端的 1 格描边比
 * 浏览器的 1.5px 粗得多,同一个 alpha 画出来更重,取偏低端才压得住。
 * `.prompt` / `.tip` 各有各的档,不在这条族里(理由与取值见 component/prompt/card 的
 * INPUT_CARD_ALPHA 与 feature-plugins/home/tip-card 的 TIP_CARD_ALPHA)。
 *
 * 原型里**不透明**的三处 —— 面板卡 `.card`(:151-153)、与它同一个元素同一个 token 的
 * hero 卡 `.hero`(:342-344,HTML :895 是 `class="card hero"`,描边同样是不透明的
 * `--gb-main`,不是半透明)、流程图节点 `.fcard` 的 `--fc`(:701)—— 没法照抄 1.0,
 * 那正是「描边太重」的来源。`.card` 与 `.fcard` 各自压到 0.70 / 0.72 在调用点显式传
 * (见 component/sidebar-card 的 PANEL_CARD_ALPHA 与 component/flow/canvas 的
 * FLOW_NODE_ALPHA)。`.hero` 不另开一档:那张卡在本实现里是抱内容的 NeonCard
 * (component/empty-session-hero),吃的就是 0.62 —— 比 0.70 还淡一档,因为整张卡
 * 只有一枚 Logo,描边更淡才读得出「这是内容,不是容器」。
 */
export const BORDER_ALPHA_DEFAULT = 0.62

// 悬停「光晕加深」的等效实现:终端里没有 box-shadow 也没有半透明,描边色只能朝某个方向混一点。
//
// 目标色由调用点给(每张卡都传 theme.text),所以这一档的效果是分两种的:
//   深色主题:theme.text 是近白 → 描边**变亮**;
//   浅色主题:theme.text 是近黑 → 描边**变暗**。
// 两种都在做同一件事:拉开描边与面板底色的对比度 —— 这才是悬停该给的反馈,
// 「变亮」只是它在深色主题下的一个特例,写成「提亮」会让人以为浅色下也在变亮。
//
// 目标不取纯白:浅色主题下把描边往白里推等于让它往白底上靠,悬停时整圈描边会淡进背景里,
// 与原型 .card:hover「阴影加深 = 卡片浮起来」正好相反。
//
// 12% 的来历与它为什么已经不够了:
//   原型 .card:hover 把外发光从 rgba(79,209,224,.05)/14px 抬到 rgba(255,92,158,.14)/26px
//   —— 强度约 2.8 倍、半径约 1.9 倍。终端只有「边框色 vs 底色」这一个维度,没有半径,
//   2.8 倍直接照搬会把描边推成另一种颜色(不再是原来的语义色),所以只取一半左右。
//   **但那一半是在「满饱和描边」上量的**:12% × (theme.text − 纯渐变色) 是一个很大的
//   RGB 距离。描边按 BORDER_ALPHA_DEFAULT(0.62)折算成柔边之后,它与 theme.text 的距离
//   只剩原来的 62% 左右,同样的 12% 视觉增益于是只剩六成 —— 悬停几乎看不出来。
//   按 1/0.62 ≈ 1.6 倍上调取 **20%**:三通道加起来抬约 0.29(柔边后基准亮度约 1.24,
//   即 +23%),8bit 量化下每通道 15~40 档,肉眼明确可见;抬完不到原来的 1.6 倍,
//   色相只挪 1° 上下,读起来是「被点亮」而不是「换了颜色」。ui/hover.ts 的调用点用它。
export const HOVER_BOOST = 0.2

export type BorderCell = { x: number; y: number; ch: string; t: number }

export type NeonRole = "user" | "assistant" | "thinking" | "tool" | "error" | "tip" | "input" | "success"

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
 * - `user` 「用户」语义:粉紫两段 —— `accent` 粉 → `neonMid` 紫(#ff2d7b → #4d7cff)。
 *   **唯一的消费者是流程图的「用户输入」节点卡**(component/flow/canvas.tsx 的 roleOf)。
 *   聊天气泡卡不走这一套 —— 它用 neonStops(theme) 的三端霓虹(见 routes/session 的
 *   UserMessage),那圈描边的首端是 theme.primary 青、粉色在末端。所以「把气泡卡切成 user
 *   粉紫」不是给下面这张表换个 role 就了事的事:气泡卡连同它的 padding/底色/悬停是一整套
 *   已经定过的视觉,改它要先改那份视觉计划。
 * - `thinking` 思考卡:`neonMid` → `neonEnd` 两段(#4d7cff 蓝 → #ff2d7b 品红)。
 *   原型文案写的是「紫青」,实配这两端在默认主题里是蓝→品红:方向对(都离开主色),
 *   文案与实际不完全一致,见 1b 的汇报,这里只保证它**不**平。
 * - `tool` / `input` 工具卡与输入卡:全段霓虹三端(#00e5ff → #4d7cff → #ff2d7b)。
 *
 * 单段(故意如此):`error` 红 / `tip` 琥珀。这两种语义靠「整圈都是那个红 / 那个琥珀」
 * 传达,加渐变会被读成装饰(报的错也可能只是一半红一半粉,读不出严重性),
 * 原型也是纯红框 / 纯琥珀框。单段 role 不参与平色兜底 —— 那里本来就只有一个色。
 *
 * `success` 绿→青两段:流程图节点的「回复」与「本轮结束」用它(原型 card-design-v7.html 的
 * `.fcard[data-kind="reply"]` 是 `#4ade80 → #4fd1e0`)。它不像 `error`/`tip` 那样走单段 ——
 * 回复是这张画布里出现频率最高的语义,整圈一个绿会和「本轮结束」这个事件混成一回事;
 * 保留一段可辨的坡(绿=语义 → 青=主题自带的 info,两个色相都离得开)才分得清谁是谁。
 */
export function semanticStops(theme: Theme, role: NeonRole): readonly RGBA[] {
  if (role === "assistant") return ramp(theme, theme.primary, theme.secondary)
  if (role === "user") return ramp(theme, theme.accent, theme.neonMid)
  if (role === "thinking") return ramp(theme, theme.neonMid, theme.neonEnd)
  if (role === "success") return ramp(theme, theme.success, theme.info)
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
