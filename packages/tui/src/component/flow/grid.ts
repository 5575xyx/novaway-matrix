import type { RGBA } from "@opentui/core"
import { Locale } from "../../util/locale"
import type { RouteLabelSpan } from "./layout"

/**
 * 连线层的字符网格 —— 画布上所有「线」与「边标签」都从这里出。
 *
 * 单独成文件有两个理由:
 *   1. **`rowSpans` 里有一条承重规则**:一行里可能有好几段互不相邻的线,而那一行的浮层盒子
 *      贴着画布左边摆。行首空格可以跳过(靠返回的 `start` 把偏移交给盒子的 left),**行内空格
 *      必须原样补回串里** —— 跳过的话 `<text>` 会从第一个非空字符开始画,整行的线集体左移,
 *      移进左边那张卡片里。之前这条规则只能靠渲染测试间接盯着,现在可以直接单测。
 *   2. 这一层是**唯一逐帧重算**的部分(揭示动画每 60ms 一次)。它必须是纯函数、无 JSX、无
 *      theme,才能在不开终端的情况下量它的成本。
 */

/** 一格 = 一个字符 + 可选前景色。`ch` 是空格表示这一格不落笔。 */
export type EdgeCell = { ch: string; fg?: RGBA }

/**
 * **稀疏**网格:只存真正落过笔的行,`key` 是行号。
 *
 * 为什么不用稠密的二维数组:画布 50 轮 / 74 列时有近 3000 行,而非空行只占 10%(25 轮 / 120 列)
 * 到 45%(50 轮 / 74 列)。稠密矩阵既白分配又让渲染层给**每一行**都建一个盒子 —— 2895 个空盒子,
 * 而且每帧都是新数组,Solid 的 `For` 按引用对账,于是每帧全部销毁重建。稀疏之后:
 * 分配只与非空行成正比,`<For>` 的每一项用**行号**(原始值)做键,没变的行不会被重建。
 */
export type EdgeGrid = Map<number, EdgeCell[]>

/** 画布尺寸。落笔时用它挡掉越界的坐标。 */
export type GridBounds = { width: number; height: number }

/** 空网格。行是**惰性**开的:尺寸只用来判断越界,不预分配任何一行。 */
export function createGrid(): EdgeGrid {
  return new Map()
}

function row(grid: EdgeGrid, bounds: GridBounds, y: number): EdgeCell[] | undefined {
  if (y < 0 || y >= bounds.height) return undefined
  const existing = grid.get(y)
  if (existing) return existing
  if (bounds.width <= 0) return undefined
  const created = Array.from({ length: bounds.width }, () => ({ ch: " ", fg: undefined }) as EdgeCell)
  grid.set(y, created)
  return created
}

/**
 * 落一格。越界的坐标静默丢弃。
 *
 * **先判坐标再开行**:反过来(先按 y 建行、再看 x)的话,一次越界的落笔会留下一个**全空**的行 ——
 * 稀疏网格的全部意义就是「只有真正落过笔的行才占内存」,白留一行等于把它退化回稠密矩阵的一半。
 */
export function paintCell(grid: EdgeGrid, bounds: GridBounds, x: number, y: number, ch: string, fg: RGBA) {
  if (x < 0 || x >= bounds.width) return
  const cells = row(grid, bounds, y)
  if (!cells) return
  const cell = cells[x]
  if (!cell) return
  cell.ch = ch
  cell.fg = fg
}

/** 落一段横线(轮次分隔线那种):跳过 `skip` 命中的列。 */
export function paintRow(
  grid: EdgeGrid,
  bounds: GridBounds,
  y: number,
  ch: string,
  fg: RGBA,
  skip?: (x: number) => boolean,
) {
  for (let x = 0; x < bounds.width; x++) {
    if (skip?.(x)) continue
    paintCell(grid, bounds, x, y, ch, fg)
  }
}

/** 有内容的行,按行号升序。给 `<For each>` 用。 */
export function gridRows(grid: EdgeGrid): number[] {
  return [...grid.keys()].toSorted((a, b) => a - b)
}

export type RowSpans = { start: number; spans: { text: string; fg: RGBA }[] }

/**
 * 把一行网格折成「同色连续段」,**并给出这一行第一个非空格所在的列**。
 *
 * 空格的处理是这一段代码的全部要点(见文件头):
 *   · 行首空格**跳过** —— 由 `start` 交给调用方摆盒子的 `left`。
 *   · 行内空格**补回串里** —— 补在后面那一段里(空格不着色也看不见),保证后面每一段仍在
 *     正确的列上。少了这一步,一行里有两段线时第二段会紧贴第一段,整体左移。
 * 颜色不同必须断段:线是青的、标签是灰的,合成一段标签就被线的颜色盖掉了。
 */
export function rowSpans(row: EdgeCell[]): RowSpans {
  const start = row.findIndex((cell) => cell.ch !== " ")
  if (start < 0) return { start: 0, spans: [] }
  const spans: { text: string; fg: RGBA }[] = []
  let blanks = 0
  for (const cell of row.slice(start)) {
    if (cell.ch === " " || !cell.fg) {
      blanks += 1
      continue
    }
    const last = spans[spans.length - 1]
    const chunk = " ".repeat(blanks) + cell.ch
    if (last && last.fg === cell.fg) last.text += chunk
    if (!last || last.fg !== cell.fg) spans.push({ text: chunk, fg: cell.fg })
    blanks = 0
  }
  return { start, spans }
}

// ---------- 边标签 ----------

/** 在 [x, x + columns) 这一段里居中放一段文字,返回它的左端列。 */
export function centered(x: number, columns: number, text: string) {
  return x + Math.max(0, Math.floor((columns - Locale.displayWidth(text)) / 2))
}

/**
 * 标签落在哪一段线上。
 *
 * 同一行上可能有好几条边都想在这摆标签:并行分支**分叉**时两条边的候选段挨着,
 * 工具做完**收束**时两条边的候选段又完全重合。所以按边的顺序依次摆,谁先摆谁占位,
 * 后来的那条在自己的候选段里找一段没被占的;两段都撞上了就**不摆这个标签** ——
 * 少一个标签只是信息少一点,两个标签叠在一起则是画布看起来坏掉了。
 *
 * `owners` 是**所有边**落过笔的格子(键 `x:y`,值是那条边的序号,canvas 建的那张表)。
 * 它挡的是另一件事,而且是用户点名的那件:标签自带底色、压住底下的线是原型 .flabel 的做法,
 * 但压住**别人的**线就会把那条线从中间截断(上一版就出现过「本轮完成」印在另一条线上的情形)。
 * 压住**自己**那条线是设计意图,所以 owner 等于自己时那一格不算撞车。
 *
 * 注意候选段必须由调用方**先全部算完**再逐条摆:第 k 条边摆标签时,序号比 k 大的边还没进表,
 * 于是「压住后面的边」这一条就漏了。所以 canvas 里的顺序是「先算全部走线 → 建 owner 表
 * → 再逐条摆标签」,而不是边画边摆。
 */
export function makeLabelPlacer(owners: ReadonlyMap<string, number> = new Map()) {
  const taken: { y: number; from: number; to: number }[] = []
  return (spans: RouteLabelSpan[], text: string, owner = 0) => {
    const width = Locale.displayWidth(text)
    for (const span of spans) {
      // 比文字还窄的段一律不摆:标签盒子会盖住底下的线,摆出去就盖到卡片边框上了。
      if (span.columns < width) continue
      const from = centered(span.x, span.columns, text)
      const to = from + width
      const clash = taken.some((item) => item.y === span.y && from < item.to && item.from < to)
      if (clash) continue
      if (hurtsEdge(owners, span, from, to, owner)) continue
      taken.push({ y: span.y, from, to })
      return { x: from, y: span.y, text }
    }
    return undefined
  }
}

/** 这一段占位有没有压到**别的边**的格子上。 */
function hurtsEdge(owners: ReadonlyMap<string, number>, span: RouteLabelSpan, from: number, to: number, owner: number) {
  for (let x = from; x < to; x++) {
    const other = owners.get(`${x}:${span.y}`)
    if (other !== undefined && other !== owner) return true
  }
  return false
}

// ---------- 入场揭示 ----------

/** 每条边从「开始」到「画完」占几帧。原型 .fedge 的 edgeDraw 是 0.5s,这里按 60ms 一帧取 8。 */
export const EDGE_REVEAL_FRAMES = 8
/** 一帧多少毫秒。 */
export const EDGE_FRAME_MS = 60
/**
 * 入场揭示的**总预算**(帧),不含每条边自己那 8 帧。
 *
 * 20 + 8 = 28 帧 × 60ms = **1.68 秒**,与边数无关。原来是「每条边 +2 帧」,于是
 * 44 条边 5.8s、224 条边 27.4s、449 条边 54.4s —— 一张 50 轮的画布要等一分钟才画完,
 * 而原型的 CSS `animation-delay` 是有上限的、`stroke-dashoffset` 走完即静止。
 */
export const EDGE_STAGGER_FRAMES = 20

/**
 * 「全部揭示完」的哨兵帧。比任何预算都大,于是 `edgeReveal` 一律返回 1、延迟守卫一律放行。
 *
 * **用户关掉动画时走的是这一条路,不是「不揭示」** —— 与本仓库既有约定一致
 * (见 ui/card.ts 的 enterDelay 注释、component/prompt/card.tsx:23、neon-rail.tsx
 * 相位 0 仍保留完整静态渐变)。关动画的语义是「别动」,不是「别画」:
 * 停在 frame 0 会让整张画布一条线都没有,只剩孤零零的卡片 —— 那是把功能关掉了。
 */
export const REVEAL_ALL = Number.MAX_SAFE_INTEGER

/** 第 index 条边揭示到第几格(0..1)。 */
export function edgeReveal(frame: number, delay: number) {
  return Math.min(1, Math.max(0, (frame - delay) / EDGE_REVEAL_FRAMES))
}

/**
 * 第 index 条边的揭示延迟(帧)。
 *
 * 延迟**按比例**铺开而不是「每条边 +2 帧」:总时长因此恒等于
 * `EDGE_STAGGER_FRAMES + EDGE_REVEAL_FRAMES`,与边数无关。
 * 边少时每级之间隔得开、先后看得清;边多时几级挤在一起,退化成「整张图一起亮起来」——
 * 那仍然是一张完整的图,而不是一分钟的动画。
 *
 * `frame` 只增不减,而新到的边 index 更大 → 它的延迟也更大,首次出现时往往已经过完延迟,
 * 所以流式追加的新边**天生就是完整画出**的,不会被补播一遍动画。
 */
export function edgeRevealDelay(index: number, edgeCount: number) {
  if (edgeCount <= 1) return 0
  return Math.floor((index * EDGE_STAGGER_FRAMES) / (edgeCount - 1))
}

/** 相位推到这一帧就停 —— 与 NeonBox 的相位表同一个取向(画完即静止,空闲零开销)。 */
export function revealFrameBudget(edgeCount: number) {
  const lastDelay = edgeRevealDelay(Math.max(0, edgeCount - 1), edgeCount)
  return lastDelay + EDGE_REVEAL_FRAMES
}

/**
 * 相位停在哪一帧。
 *
 * `animated` 为假(用户关掉了动画)时直接给终态。**这是一个纯函数**,所以「关动画 ⇒ 线、箭头、
 * 边标签全部完整存在」可以在不开终端、不碰 KV 的情况下直接断言(见 test/component/flow-grid.test.ts)。
 */
export function revealTick(animated: boolean, frame: number) {
  return animated ? frame : REVEAL_ALL
}
