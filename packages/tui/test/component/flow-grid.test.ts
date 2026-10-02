// 连线层(grid.ts)的单测。
//
// 这一层是画布上**唯一逐帧重算**的部分,也是「关掉动画」这条分支唯一走得通的地方,所以它必须是
// 纯函数、无 JSX、无 theme —— 于是「关动画 ⇒ 线/箭头/标签全部完整」可以直接在这里断言,
// 不必开终端、也不必碰那个共享的 state/kv.json(见 test/component/prompt-card.test.tsx:319
// 记着 KVProvider 写的是共享文件,拨一下会脏掉别的用例)。
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  centered,
  createGrid,
  edgeReveal,
  edgeRevealDelay,
  EDGE_FRAME_MS,
  EDGE_REVEAL_FRAMES,
  EDGE_STAGGER_FRAMES,
  gridRows,
  makeLabelPlacer,
  paintCell,
  paintRow,
  REVEAL_ALL,
  revealFrameBudget,
  revealTick,
  rowSpans,
  type EdgeCell,
} from "../../src/component/flow/grid"

const CYAN = RGBA.fromHex("#4fd1e0")
const AMBER = RGBA.fromHex("#f5b83d")
const GREY = RGBA.fromHex("#8fa3b8")

const BOUNDS = { width: 20, height: 20 }

function cells(chars: string, fg = CYAN): EdgeCell[] {
  return [...chars].map((ch) => (ch === " " ? { ch: " " } : { ch, fg }))
}

// ---------- rowSpans:行首跳过、行内补回 ----------

test("连线层 rowSpans:行首空格被跳过,偏移交给 start", () => {
  expect(rowSpans(cells("   ───"))).toEqual({ start: 3, spans: [{ text: "───", fg: CYAN }] })
})

// 这是这一段代码存在的全部理由。行内空格一旦被跳过,一行里有两段线时第二段会紧贴第一段,
// 整行的线集体左移 —— 移进左边那张卡片里,画出来就是「线从卡片左边穿出去」。
test("连线层 rowSpans:行内空格原样补回,两段线各在自己的列上", () => {
  // 3 列行首空格 → 两格线 → 两个行内空格 → 一格线。
  const { start, spans } = rowSpans(cells("   ──  ─"))
  expect(start).toBe(3)
  expect(spans).toEqual([{ text: "──  ─", fg: CYAN }])
  // 串的长度必须等于「从第一个非空列到行尾」的宽度 —— 这正是列对齐的前提。
  expect(spans[0]!.text.length).toBe(8 - start)
})

test("连线层 rowSpans:颜色不同必须断段,行内空格归到**后面**那一段", () => {
  const row: EdgeCell[] = [
    { ch: " " },
    { ch: "─", fg: CYAN },
    { ch: "─", fg: CYAN },
    { ch: " ", fg: CYAN },
    { ch: "并", fg: GREY },
    { ch: "行", fg: GREY },
  ]
  // 空格补在它**后面**那一段里(见 rowSpans 的注释):颜色归谁无所谓,空格不着色也看不见,
  // 但它必须待在串里,否则第二段的位置就错了。
  expect(rowSpans(row).spans).toEqual([
    { text: "──", fg: CYAN },
    { text: " 并行", fg: GREY },
  ])
})

test("连线层 rowSpans:整行空白时 start 为 0 且没有段", () => {
  expect(rowSpans(cells("     "))).toEqual({ start: 0, spans: [] })
})

// ---------- 稀疏网格 ----------

test("连线层网格:只存落过笔的行(稀疏),gridRows 按行号升序", () => {
  const grid = createGrid()
  paintCell(grid, BOUNDS, 3, 7, "─", CYAN)
  paintCell(grid, BOUNDS, 9, 1, "│", CYAN)
  paintCell(grid, BOUNDS, 3, 11, "▸", AMBER)
  expect([...grid.keys()]).toEqual([7, 1, 11])
  expect(gridRows(grid)).toEqual([1, 7, 11])
  // 行是惰性开的:只碰过 3 行,内存里就只有 3 行 × 20 格,而不是 20 × 20。
  expect(grid.size).toBe(3)
  expect(grid.get(7)!.length).toBe(BOUNDS.width)
})

test("连线层网格:越界坐标静默丢弃,而且**不留空行**(否则稀疏就白做了)", () => {
  const grid = createGrid()
  paintCell(grid, BOUNDS, -1, 0, "─", CYAN)
  paintCell(grid, BOUNDS, 99, 0, "─", CYAN)
  paintCell(grid, BOUNDS, 0, -3, "─", CYAN)
  paintCell(grid, BOUNDS, 0, 9999, "─", CYAN)
  // 上面四次全都越界,一次行都不该开出来。
  expect(grid.size).toBe(0)
  paintRow(grid, BOUNDS, 2, "─", GREY, (x) => x === 4)
  expect(grid.size).toBe(1)
  const row = grid.get(2)!
  expect(row[3]!.ch).toBe("─")
  expect(row[4]!.ch).toBe(" ")
  expect(row[5]!.ch).toBe("─")
})

// ---------- 标签 ----------

test("连线层 centered:在给定宽度里居中,放不下就贴左", () => {
  expect(centered(10, 10, "ab")).toBe(14)
  expect(centered(10, 4, "abcdefgh")).toBe(10)
})

test("连线层标签:同一行上两条边抢同一段时,后来者退到第二段候选", () => {
  const place = makeLabelPlacer()
  const spans = [
    { x: 31, y: 10, columns: 14 },
    { x: 31, y: 12, columns: 16 },
  ]
  // 「✓ 完成」= ✓(1) + 空格(1) + 完成(4) = 6 列,在 14 列里居中 → 31 + 4 = 35。
  expect(place(spans, "✓ 完成")).toEqual({ x: 35, y: 10, text: "✓ 完成" })
  // 同一段(y 相同、列区间重叠)撞车 → 退到 y = 12 那一段。
  expect(place(spans, "✓ 完成")).toEqual({ x: 36, y: 12, text: "✓ 完成" })
})

test("连线层标签:两段都撞上就不摆这个标签(少一个标签好过两个叠在一起)", () => {
  const place = makeLabelPlacer()
  const narrow = [{ x: 31, y: 10, columns: 4 }]
  expect(place(narrow, "✓ 完成")).toBeUndefined()
})

// ---------- 入场揭示 ----------

test("连线层揭示:关掉动画 = 终态,线与标签都在(不是「不揭示」)", () => {
  // 动画开着、还停在第 0 帧:一条线都没画 —— 这正是关动画时**不能**停的地方。
  expect(edgeReveal(0, 0)).toBe(0)
  // 关动画 → revealTick 给终态哨兵,于是每一条边的揭示比例都是 1。
  const tick = revealTick(false, 0)
  expect(tick).toBe(REVEAL_ALL)
  for (const index of [0, 7, 40, 448]) {
    const delay = edgeRevealDelay(index, 449)
    expect(edgeReveal(tick, delay)).toBe(1)
    // canvas 的标签守卫是 `tick <= delay 才跳过`,所以终态必须严格大于任何延迟。
    expect(tick > delay).toBe(true)
  }
})

test("连线层揭示:动画开着时相位照常推进", () => {
  expect(revealTick(true, 0)).toBe(0)
  expect(revealTick(true, 12)).toBe(12)
})

// 原来每条边 +2 帧:449 条边要 54 秒才画完。现在延迟按比例铺开,总时长与边数无关。
test("连线层揭示:总时长封顶在 1.7 秒,与边数无关", () => {
  const ms = (edges: number) => revealFrameBudget(edges) * EDGE_FRAME_MS
  for (const edges of [2, 9, 44, 89, 224, 449]) {
    expect(ms(edges), `${edges} 条边`).toBe((EDGE_STAGGER_FRAMES + EDGE_REVEAL_FRAMES) * EDGE_FRAME_MS)
    expect(ms(edges)).toBeLessThanOrEqual(2_000)
  }
  // 边少时延迟之间隔得开,先后看得清。
  expect(edgeRevealDelay(0, 9)).toBe(0)
  expect(edgeRevealDelay(8, 9)).toBe(EDGE_STAGGER_FRAMES)
  expect(edgeRevealDelay(1, 9)).toBeGreaterThan(edgeRevealDelay(0, 9))
  // 只有一条边时没有「先后」可言,不必为它空等一个阶梯预算。
  expect(edgeRevealDelay(0, 1)).toBe(0)
  expect(revealFrameBudget(1)).toBe(EDGE_REVEAL_FRAMES)
  expect(ms(1)).toBe(EDGE_REVEAL_FRAMES * EDGE_FRAME_MS)
})

test("连线层揭示:最后一条边的延迟 + 自己的帧数就是预算,走完即静止", () => {
  const edges = 12
  const budget = revealFrameBudget(edges)
  const last = edgeRevealDelay(edges - 1, edges)
  expect(last + EDGE_REVEAL_FRAMES).toBe(budget)
  // 预算那一帧上,最后一条边恰好画完(而不是还差半格)。
  expect(edgeReveal(budget, last)).toBe(1)
})
