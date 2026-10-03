// D3 流程图画布的**纯函数**部分:会话数据 → 节点/边模型 → 网格布局 → 直角折线路由。
//
// 这里刻意不碰渲染:画布最麻烦的三件事(哪些节点、节点摆哪、连线怎么走且不压到卡片)
// 都能脱离终端算清楚,它们一旦错了,画出来就是「线穿过卡片」或者「两节点叠在一起」。
// canvas.tsx 只负责把这些结果摆到屏幕上。
//
// fixture 与几何谓词来自 test/fixture/flow.ts(与 flow-canvas.test.tsx 共用同一份数据)。
import { expect, test } from "bun:test"
import type { Message, Part } from "@novaway/sdk-v2-latest/v2"
import {
  bandColumns,
  buildFlowModel,
  CARD_CELL_PX_HEIGHT,
  CARD_CELL_PX_WIDTH,
  corridorColumn,
  CORNER_CHARS,
  CORRIDOR_LANE,
  edgeRoute,
  FLOW_NODE_KINDS,
  isRightward,
  layoutNodes,
  COLUMN_PITCH,
  GAP_X,
  GAP_Y,
  LATEST_BADGE,
  LEFT_MARGIN,
  LABEL_COLUMNS,
  MAX_NODE_HEIGHT,
  MAX_NODE_WIDTH,
  MAX_ROUTE_TURNS,
  MIN_BAND_COLUMNS,
  MIN_BAND_VIEWPORT,
  NODE_SIZE_PX,
  nodeContentColumns,
  nodeSize,
  nodeTitleColumns,
  nodeTitleRows,
  RIGHT_MARGIN,
  routeSpanX,
  routeTurns,
  SEPARATOR_ROWS,
  snapDrag,
  type FlowAnchor,
  type FlowLayout,
  type FlowNode,
  type FlowRect,
} from "../../src/component/flow/layout"
import { Locale } from "../../src/util/locale"
import {
  assistantMessage,
  reasoningPart,
  checkFlow,
  CREATED,
  edgeCellOwners,
  flowInvariants,
  FIXTURE_MODEL,
  FIXTURE_MESSAGES,
  FIXTURE_PARTS,
  manyRoundsFixture,
  occupiedRects,
  parallelFixture,
  placedLabels,
  pointInRect,
  rectsOverlap,
  routedEdges,
  runningToolPart,
  textPart,
  toolPart,
  touchesRect,
  userMessage,
} from "../fixture/flow"

const MODEL = FIXTURE_MODEL
const MESSAGES: Message[] = FIXTURE_MESSAGES
const PARTS: Record<string, Part[]> = FIXTURE_PARTS
// 76 = 两列一行带:66 是 80 列终端扣掉内边距与滚动条之后的视口宽(74),76 留一点余量。
const LAYOUT = layoutNodes(MODEL.nodes, 76)

function rectOf(id: string): FlowRect {
  const found = LAYOUT.nodes.find((node) => node.id === id)
  if (!found) throw new Error(`布局里没有节点 ${id}`)
  return found.rect
}

// ---------- 用例自身的卫生 ----------

/**
 * 本文件没有重复声明的用例。
 *
 * 为什么值得单独一条:重复声明**不会报错**。bun 照样把两遍都跑一遍,只是总数悄悄变大 ——
 * fd733a8 就这样让 23 条用例被算成 25 条、整个 flow 套件被算成 50。凡是「总数」这种数字,
 * 只有被人盯着看才发现得了偏差,而盯着看的前提是数字本身可查。
 *
 * 做法是读自己的源码数一遍字面 `test("…")` 声明:声明数必须等于去重后的名字数。
 * 这条测试自己也算一条,所以下面那个 `toBeGreaterThan(0)` 不是废话 —— 万一将来改成
 * `test.each` 之类不再字面声明的写法,扫不到名字,这条会从「守住了」变成「空跑」,
 * 而空跑的守卫比没有守卫更坏(它让人以为这件事有人管)。
 */
test("流程图布局:本文件没有重复声明的用例", async () => {
  const source = await Bun.file(import.meta.path).text()
  const names = [...source.matchAll(/\btest\(\s*"([^"]+)"/g)].map((match) => match[1]!)
  expect(names.length, "一条用例都没扫到,这条守卫就是空跑").toBeGreaterThan(0)
  expect(
    names.filter((name, index) => names.indexOf(name) !== index),
    "这些用例名被声明了不止一次",
  ).toEqual([])
})

// ---------- 几何不变量 ----------
// 几何不变量(无格压卡 / 步长为 1 / 无重复格 / 端点贴边界 / 标签位不压卡 / 矩形不重叠
// / 形状至多拐两次 / 走廊形状 / 标签不压别的边 / 尺寸按类型 / 走廊够宽 —— 共十条,
// 清单见 fixture 的 flowInvariants)
// 收在 fixture 的 flowInvariants 里,下面这些用例只负责**在哪些组合上**跑它。

/**
 * 尺寸表:逐类对照原型 card-design-v7.html 里那些行内 width/height。
 *
 * 这一条是整个「节点按类型区分尺寸」的地基 —— 表里的数字一旦被人顺手改成一个「整齐一点」
 * 的值(比如七类都 23 列),这条会立刻指出它与原型的哪一行对不上。
 */
test("流程图尺寸:每一类节点的 px 都抄自原型那一行,换算成格与行", () => {
  expect(NODE_SIZE_PX).toEqual({
    user: { width: 168, height: 74 },
    plan: { width: 176, height: 96 },
    tool: { width: 170, height: 84 },
    subagent: { width: 170, height: 92 },
    edit: { width: 168, height: 110 },
    reply: { width: 176, height: 92 },
    fend: { width: 150, height: 68 },
  })
  // 换算本身:宽 = ⌈px / 7.5⌉(7.5 = 0.6 em × 12.5px,JetBrains Mono 在 .fc-head 字号下的字宽),
  // 高 = 2 + round((px − 25) / 18.75)(18.75 = 1.5 × 12.5 = line-height,25 = 外框的
  // padding 11×2 + border 1.5×2,在终端里就是那两行边框)。
  expect(CARD_CELL_PX_WIDTH).toBe(7.5)
  expect(CARD_CELL_PX_HEIGHT).toBe(18.75)
  expect(FLOW_NODE_KINDS.map((kind) => [kind, nodeSize(kind).width, nodeSize(kind).height])).toEqual([
    ["user", 23, 5],
    ["plan", 24, 6],
    ["tool", 23, 5],
    ["subagent", 23, 6],
    ["edit", 23, 7],
    ["reply", 24, 6],
    ["fend", 20, 4],
  ])
  expect(MAX_NODE_WIDTH).toBe(24)
  expect(MAX_NODE_HEIGHT).toBe(7)
})

test("流程图尺寸:最高的确实比最矮的高,「本轮结束」确实更窄更短", () => {
  const heights = FLOW_NODE_KINDS.map((kind) => nodeSize(kind).height)
  expect(Math.max(...heights), "最高的那一类").toBeGreaterThan(Math.min(...heights))
  // 原型那 96 px 与 68 px 的差(28 px = 1.5 行)落成了 6 行与 4 行,差 2 行 —— 肉眼可见。
  expect(nodeSize("plan").height - nodeSize("fend").height).toBe(2)
  expect(nodeSize("plan").height).toBeGreaterThan(nodeSize("fend").height)
  // 最高的是「编辑文件」(原型 n5 是 110 px 那一张),最矮的是「本轮结束」(68 px)。
  expect(nodeSize("edit").height).toBe(MAX_NODE_HEIGHT)
  expect(nodeSize("fend").height).toBe(Math.min(...heights))
  // 「本轮结束」比每一类都窄、比除它以外每一类都矮。
  for (const kind of FLOW_NODE_KINDS.filter((item) => item !== "fend")) {
    expect(nodeSize("fend").width, `本轮结束(20)该比 ${kind} 窄`).toBeLessThan(nodeSize(kind).width)
    expect(nodeSize("fend").height, `本轮结束(4)该比 ${kind} 矮`).toBeLessThan(nodeSize(kind).height)
  }
  // 卡头那一行装得下:`● 类型 + 4 个 gap + meta + ▸`,最宽的一行是 19 列。
  for (const kind of FLOW_NODE_KINDS.filter((item) => item !== "fend")) {
    expect(nodeContentColumns(kind), `${kind} 的卡内列数装不下卡头`).toBeGreaterThanOrEqual(19)
  }
  expect(nodeContentColumns("fend")).toBe(17)
  // 标题行数 = 卡高 − 两行边框 − 一行卡头。
  expect(nodeTitleRows("edit")).toBe(4)
  expect(nodeTitleRows("tool")).toBe(2)
  expect(nodeTitleColumns("reply")).toBe(nodeContentColumns("reply") * 3)
})

test("流程图布局:任意两个节点矩形都不重叠(含展开详情的节点)", () => {
  const expanded = layoutNodes(MODEL.nodes, 76, { expandedId: "n:pr_3", detailRows: 5 })
  for (const list of [LAYOUT, expanded]) {
    for (const [index, a] of list.nodes.entries()) {
      for (const b of list.nodes.slice(index + 1)) {
        expect(rectsOverlap(a.rect, b.rect), `${a.id} 与 ${b.id}`).toBe(false)
        if (a.detailRect && b.detailRect)
          expect(rectsOverlap(a.detailRect, b.detailRect), `${a.id} 与 ${b.id} 的详情框`).toBe(false)
        if (a.detailRect) expect(rectsOverlap(a.detailRect, b.rect), `${a.id} 的详情框压到 ${b.id}`).toBe(false)
        if (b.detailRect) expect(rectsOverlap(a.rect, b.detailRect), `${b.id} 的详情框压到 ${a.id}`).toBe(false)
      }
    }
  }
})

/**
 * 全部十条不变量在**一整片组合**上都成立。
 *
 * 这一条是 LEFT_MARGIN 与 GAP_Y 那几段注释的兑现处。并行分支在布局里是同列上下叠放的,
 * 所以「叠放能不能成立」完全取决于列与行带的尺寸组合 —— 而组合数是列数(perRow)× 成员数 ×
 * 行带内最大叠放深度 的乘积,手写断言只可能覆盖其中两三种。这里把宽度从最窄的一档一路扫到
 * 四列那一档(≥ 146 列)、并行成员从 1 到 5、逐轮 1 到 4,加上**逐个节点展开**的那一遍,
 * 全都跑一遍 —— 节点尺寸按类型变化之后,列 x 与行带高度都是从节点集合里现算的,
 * 所以这一片组合比固定尺寸那版更容易藏住「高卡与药丸混排」的问题。
 */
test("流程图布局:十条几何不变量在所有宽度 × 并行规模 × 逐节点展开下都成立", () => {
  const widths = [MAX_NODE_WIDTH, MIN_BAND_VIEWPORT, MIN_BAND_VIEWPORT + 1, 66, 74, 76, 80, 96, 114, 146, 160]
  const problems: string[] = []
  let checks = 0
  for (const width of widths) {
    for (const members of [1, 2, 3, 4, 5]) {
      for (const rounds of [1, 2, 4]) {
        const models = [FIXTURE_MODEL, parallelFixture(members)]
        if (rounds !== 1) models.push(manyRoundsFixture(rounds))
        for (const model of models) {
          const label = `${width} 列 / 并行 ${members} / ${rounds} 轮`
          problems.push(...checkFlow(model, width).problems.map((problem) => `${label}:${problem}`))
          checks += 1
          // 逐个节点展开:展开态改的是走线方案与行带高度(见 I5),所以每个节点都要当一次主角。
          for (const node of model.nodes) {
            problems.push(...checkFlow(model, width, node.id).problems.map((p) => `${label}/展开 ${node.id}:${p}`))
            checks += 1
          }
        }
      }
    }
  }
  // 先钉住「真的跑了这么多组合」:否则将来有人把循环改坏,这条会静悄悄变成空跑。
  expect(checks).toBeGreaterThan(2000)
  expect(problems.slice(0, 12)).toEqual([])
  expect(problems.length).toBe(0)
})

test("流程图布局:所有节点都在画布宽度内,画布高度够装下最后一轮", () => {
  expect(LAYOUT.nodes.length).toBeGreaterThan(0)
  for (const node of LAYOUT.nodes) {
    expect(node.rect.x, `${node.id} 的左边界`).toBeGreaterThanOrEqual(0)
    expect(node.rect.x + node.rect.width, `${node.id} 的右边界`).toBeLessThanOrEqual(LAYOUT.width)
  }
  const lowest = Math.max(...LAYOUT.nodes.map((node) => node.rect.y + node.rect.height))
  expect(LAYOUT.height).toBeGreaterThanOrEqual(lowest)
})

// 窄到放不下两列时只能排成一列,但仍然不许重叠。
test("流程图布局:画布窄于一列 + 一条走廊时退化成单列,仍不重叠", () => {
  const twoColumns = LEFT_MARGIN + COLUMN_PITCH + MAX_NODE_WIDTH
  for (const width of [MAX_NODE_WIDTH, MIN_BAND_VIEWPORT + 1, twoColumns]) {
    const layout = layoutNodes(MODEL.nodes, width)
    for (const [index, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(index + 1)) {
        expect(rectsOverlap(a.rect, b.rect), `${width} 列:${a.id} 与 ${b.id}`).toBe(false)
        expect(b.rect.x, `${width} 列:${b.id} 超出画布`).toBeLessThan(layout.width)
      }
    }
  }
  // 走廊的账不能算错:视口宽到放得下两列时是**两列**,而再窄一列(放不下一张最宽的卡 + 一条走廊)
  // 就掉到单列 —— 中间那一档(40~65 列)仍然是两列,多出来的那截由画布的横向滚动承担。
  //
  // **数列数要按行带数,不能按不同的 rect.x 数**:列 x 是从全局列宽表推出来的,而不同行带的
  // 列数可以不同(这一档末轮只有两列),但同一序号在所有行带里落在**同一个 x** 上。
  const columns = (width: number) => layoutNodes(MODEL.nodes, width).rows[0]!.top
  const firstBandColumns = (width: number) => {
    const layout = layoutNodes(MODEL.nodes, width)
    const top = columns(width)
    return new Set(layout.nodes.filter((node) => node.bandTop === top).map((node) => node.rect.x)).size
  }
  expect(firstBandColumns(twoColumns)).toBe(2)
  expect(firstBandColumns(MIN_BAND_VIEWPORT)).toBe(2)
  expect(firstBandColumns(MIN_BAND_VIEWPORT - 1)).toBe(1)
  // 所有行带共用同一套列锚 —— 这条是锚点叉积安全的全部前提(见 layoutNodes 里那段注释)。
  for (const width of [MIN_BAND_VIEWPORT, 66, 76, 118, 146]) {
    const layout = layoutNodes(MODEL.nodes, width)
    const xs = gridLines(layout.nodes.map((node) => node.rect.x))
    for (const row of layout.rows) {
      const inRow = layout.nodes.filter((node) => node.bandTop === row.top)
      for (const x of new Set(inRow.map((node) => node.rect.x))) expect(xs, `${width} 列`).toContain(x)
    }
  }
})

// ---------- 行带容量:内容尺寸的算式 ----------
//
// 这一组把「画布按内容尺寸排布」的算式钉死。用户的原话是「布局宽度是从视口推出来的,
// 而不是从内容推出来的」,而视口在真实会话里**不是终端宽**:侧栏展开时画布盒子只有
// `终端宽 − 侧栏宽 − 4`,80 列终端 + 侧栏只剩 46 列。
test("流程图布局:行带容量至少两列,窄到放不下一张最宽的卡 + 一条走廊才退化成单列", () => {
  // 门槛就是「一张最宽的卡 + 一条走廊」:MAX_NODE_WIDTH + GAP_X = 24 + 16 = 40。
  expect(MIN_BAND_VIEWPORT).toBe(MAX_NODE_WIDTH + GAP_X)
  expect(MIN_BAND_COLUMNS).toBe(2)
  // 60 列视口:按「装得下」算只有 1 列(⌊(60 + 14) / 40⌋ = 1,而
  // LEFT_MARGIN + COLUMN_PITCH + MAX_NODE_WIDTH = 2 + 40 + 24 = 66 > 60),
  // 但一张最宽的卡加一条走廊放得下,所以仍然给两列 —— 多出来那一截靠横向滚动去够,而不是把
  // 并行分支的分叉/收束拉成一条几十行的长蛇。
  expect(bandColumns(60)).toBe(MIN_BAND_COLUMNS)
  expect(bandColumns(MIN_BAND_VIEWPORT)).toBe(MIN_BAND_COLUMNS)
  expect(bandColumns(MIN_BAND_VIEWPORT - 1)).toBe(1)
  expect(bandColumns(20)).toBe(1)
  // 视口够宽时仍然「能放几列放几列」,不被那个下限钉死。
  expect(bandColumns(66)).toBe(2)
  // 三列:⌊(视口 + 14) / 40⌋ ≥ 3 ⇒ 视口 ≥ 106(110 列终端)。内容宽
  // 2 + 2×40 + 24 + 1 = 107,所以 110 列终端能整幅放下,不必横向滚。
  expect(bandColumns(105)).toBe(2)
  expect(bandColumns(106)).toBe(3)
  expect(bandColumns(LEFT_MARGIN + 2 * COLUMN_PITCH + MAX_NODE_WIDTH)).toBe(3)
  // 四列要视口 ≥ 146(150 列终端),内容宽 2 + 3×40 + 24 + 1 = 147 —— 这是诚实的上限。
  expect(bandColumns(145)).toBe(3)
  expect(bandColumns(LEFT_MARGIN + 3 * COLUMN_PITCH + MAX_NODE_WIDTH)).toBe(4)
  // 装得下几列的下限永远至少 1(视口 1 列都放不下时也不许算出 0 列)。
  expect(bandColumns(1)).toBe(1)
})

test("流程图布局:两列行带的画布宽度 = 左侧留白 + 步距 + 最宽卡 + 右侧留白,60 列视口下会超出视口", () => {
  const twoColumnWidth = LEFT_MARGIN + COLUMN_PITCH + MAX_NODE_WIDTH + RIGHT_MARGIN
  expect(twoColumnWidth).toBe(2 + 40 + 24 + 1)
  const narrow = layoutNodes(MODEL.nodes, 60)
  // **按行带数列**,不按不同的 rect.x 数(列 x 全局共用,见上面那条用例的注释)。
  const firstBand = narrow.rows[0]!.top
  expect(new Set(narrow.nodes.filter((node) => node.bandTop === firstBand).map((node) => node.rect.x)).size).toBe(2)
  // 实际列 x 是从**每一列的数据宽度**推出来的,所以两列行带通常比「列数 × 步距」窄一截。
  expect(narrow.width).toBeLessThanOrEqual(twoColumnWidth)
  expect(narrow.width).toBeGreaterThanOrEqual(LEFT_MARGIN + COLUMN_PITCH + MIN_BAND_COLUMNS)
  // 内容比视口宽 —— 这一截就是画布横向滚动的那一段。
  expect(narrow.width).toBeGreaterThan(60)
  // 单列行带:宽度只够一张最宽的卡加两侧留白。
  const single = layoutNodes(MODEL.nodes, MIN_BAND_VIEWPORT - 1)
  expect(new Set(single.nodes.map((node) => node.rect.x)).size).toBe(1)
  expect(single.width).toBe(LEFT_MARGIN + MAX_NODE_WIDTH + RIGHT_MARGIN)
  // 空画布没有行带,宽度退到「一张最宽的卡 + 两侧留白」(canvas 那层还会再取 max(视口, 这个数))。
  const blank = layoutNodes([], 60)
  expect(blank.width).toBe(LEFT_MARGIN + MAX_NODE_WIDTH + RIGHT_MARGIN)
})

test("流程图布局:列 x 从「每一列在整幅图上最宽的那张卡」推出来,走廊至少 GAP_X", () => {
  const layout = layoutNodes(MODEL.nodes, 76)
  // columnWidths[c] = 所有行带的第 c 列里最宽的那张卡。这一档两列都摊到了 24 列
  // (第 0 列是「NovaWay」,第 1 列是「任务拆解」),所以列距是 24 + 16 = 40。
  expect(layout.columnWidths).toEqual([nodeSize("reply").width, nodeSize("reply").width])
  const firstBand = layout.rows[0]!.top
  const columns = [...new Set(layout.nodes.filter((node) => node.bandTop === firstBand).map((node) => node.rect.x))]
  expect(columns).toEqual([LEFT_MARGIN, LEFT_MARGIN + layout.columnWidths[0]! + GAP_X])
  // 走廊宽度由**列宽**决定而不是卡宽,所以「用户输入」(23 列)右边那一列比走廊多空出 1 列 ——
  // 走廊只会更宽,不会更窄。
  for (const row of layout.rows) {
    const inRow = layout.nodes.filter((node) => node.bandTop === row.top)
    const xs = [...new Set(inRow.map((node) => node.rect.x))].toSorted((a, b) => a - b)
    for (const [index, x] of xs.entries()) {
      if (index === 0) continue
      const widestBefore = Math.max(
        ...inRow.filter((node) => node.rect.x === xs[index - 1]).map((node) => node.rect.width),
      )
      expect(x - (xs[index - 1]! + widestBefore), `第 ${row.round} 轮第 ${index} 列的走廊`).toBeGreaterThanOrEqual(
        GAP_X,
      )
    }
  }
  // 第一列左边必须有 LEFT_MARGIN 留出来的那条走廊(绕行边要从那里竖着落进目标卡的顶边)。
  expect(Math.min(...layout.nodes.map((node) => node.rect.x))).toBe(LEFT_MARGIN)
})

// ---------- 节点模型 ----------

test("流程图模型:消息与 part 映射成原型那七类节点", () => {
  const kinds = MODEL.nodes.map((node) => `${node.kind}:${node.kindLabel}`)
  expect(kinds).toEqual([
    "user:用户输入",
    "plan:任务拆解",
    "tool:工具调用",
    "subagent:子代理",
    "edit:编辑文件",
    "tool:工具调用",
    "reply:NovaWay",
    "fend:本轮结束",
    "user:用户输入",
    "edit:编辑文件",
    "reply:NovaWay",
    "fend:本轮结束",
  ])
})

test("流程图模型:task 工具算子代理,write/edit/apply_patch 算编辑文件,其余算工具调用", () => {
  const kindOf = (tool: string) =>
    buildFlowModel({
      messages: [userMessage("m1"), assistantMessage("m2")],
      parts: { m1: [textPart("m1", "t1", "x")], m2: [toolPart("m2", tool, tool)] },
    }).nodes.map((node) => node.kind)
  expect(kindOf("task")).toEqual(["user", "subagent", "fend"])
  expect(kindOf("write")).toEqual(["user", "edit", "fend"])
  expect(kindOf("edit")).toEqual(["user", "edit", "fend"])
  expect(kindOf("apply_patch")).toEqual(["user", "edit", "fend"])
  expect(kindOf("bash")).toEqual(["user", "tool", "fend"])
  expect(kindOf("read")).toEqual(["user", "tool", "fend"])
})

test("流程图模型:以用户消息为界分轮,第 2 轮起才画分隔线", () => {
  expect(MODEL.rounds).toBe(2)
  expect(MODEL.nodes.map((node) => node.round)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2])
  // 第 1 轮顶上没有分隔线(它是起点),每轮之后各一个。
  expect(LAYOUT.separators.map((separator) => separator.round)).toEqual([2])
  // 分隔线画在第 2 轮第一个节点上方,且与它之间留出 SEPARATOR_ROWS。
  const separator = LAYOUT.separators[0]!
  const firstOfRound2 = LAYOUT.nodes.find((node) => node.round === 2)!
  expect(firstOfRound2.rect.y - separator.y).toBe(SEPARATOR_ROWS)
  expect(separator.y).toBeGreaterThanOrEqual(0)
})

test("流程图模型:没有用户消息的会话也算第 1 轮,空会话是空模型", () => {
  const orphan = buildFlowModel({ messages: [assistantMessage("m2")], parts: { m2: [textPart("m2", "t", "hi")] } })
  expect(orphan.rounds).toBe(1)
  expect(orphan.nodes.map((node) => node.round)).toEqual([1, 1])
  const empty = buildFlowModel({ messages: [], parts: {} })
  expect(empty.nodes).toEqual([])
  expect(empty.edges).toEqual([])
  expect(empty.rounds).toBe(0)
  // 空模型布局也要给出可用的画布尺寸,而不是 NaN。
  const blank = layoutNodes(empty.nodes, 76)
  expect(blank.nodes).toEqual([])
  expect(blank.height).toBeGreaterThan(0)
  expect(blank.width).toBeGreaterThanOrEqual(MAX_NODE_WIDTH)
})

test("流程图模型:meta 是时长或时间,详情能拿到原始正文", () => {
  const byId = (id: string): FlowNode => {
    const found = MODEL.nodes.find((node) => node.id === id)
    if (!found) throw new Error(`没有节点 ${id}`)
    return found
  }
  expect(byId("n:pr_2").meta).toBe(Locale.duration(2_400))
  expect(byId("n:pr_4").meta).toBe(Locale.duration(8_400))
  expect(byId("n:msg_1").meta).toBe(Locale.time(CREATED))
  expect(byId("n:pr_3").title).toBe("bun test --timeout 30000")
  expect(byId("n:pr_6").detail).toContain("18 passed")
  expect(byId("n:pr_2").detail).toContain("定位")
  expect(byId("n:msg_3").title).toBe("再把侧栏动画也优化一下")
})

test("流程图模型:标题压平,超长标题按**这张卡一共放得下多少列**截断,徽标一起算进去", () => {
  const long = buildFlowModel({
    messages: [userMessage("m1"), assistantMessage("m2")],
    parts: {
      m1: [textPart("m1", "t1", "第一行\n第二行")],
      m2: [textPart("m2", "t2", "标".repeat(200))],
    },
  })
  const asked = long.nodes.find((node) => node.kind === "user")!
  expect(asked.title).not.toContain("\n")
  expect(Locale.displayWidth(asked.title)).toBeLessThanOrEqual(nodeTitleColumns("user"))
  const answered = long.nodes.find((node) => node.kind === "reply")!
  // 标题的预算 = 行数 × 每行列数,所以高卡的标题比窄卡的长得多(20×2 = 40 对 21×3 = 63)。
  expect(Locale.displayWidth(answered.title)).toBeLessThanOrEqual(
    nodeTitleColumns("reply") - Locale.displayWidth(LATEST_BADGE) - 1,
  )
  expect(answered.title.endsWith("…")).toBe(true)
  // 「最新」徽标只挂在**最后一条**回复卡上(原型 .fc-new,card-design-v7.html:1054),而且
  // 连徽标带标题一起也放得进卡内 —— 不重截的话标题会顶到右边框上。
  expect(answered.badge).toBe(LATEST_BADGE)
  expect(long.nodes.filter((node) => node.badge !== undefined)).toHaveLength(1)
  expect(Locale.displayWidth(answered.badge!) + 1 + Locale.displayWidth(answered.title)).toBeLessThanOrEqual(
    nodeTitleColumns("reply"),
  )
  // 更早的回复卡没有徽标。
  const twoReplies = buildFlowModel({
    messages: [userMessage("m1"), assistantMessage("m2"), assistantMessage("m3")],
    parts: {
      m1: [textPart("m1", "t1", "走起")],
      m2: [textPart("m2", "t2", "先答一次")],
      m3: [textPart("m3", "t3", "再答一次")],
    },
  })
  const replies = twoReplies.nodes.filter((node) => node.kind === "reply")
  expect(replies.map((node) => node.badge)).toEqual([undefined, LATEST_BADGE])
})

test("流程图模型:多条回复/多段推理各自并成一个节点,否则画布会炸成几十个格子", () => {
  const merged = buildFlowModel({
    messages: [userMessage("m1"), assistantMessage("m2")],
    parts: {
      m1: [textPart("m1", "t1", "走起")],
      m2: [
        reasoningPart("m2", "r1", "先想 A"),
        reasoningPart("m2", "r2", "再想 B"),
        textPart("m2", "x1", "结果一"),
        textPart("m2", "x2", "结果二"),
      ],
    },
  })
  expect(merged.nodes.map((node) => node.kind)).toEqual(["user", "plan", "reply", "fend"])
  expect(merged.nodes.find((node) => node.kind === "plan")!.detail).toContain("先想 A")
  expect(merged.nodes.find((node) => node.kind === "plan")!.detail).toContain("再想 B")
})

// ---------- 边 ----------

test("流程图边:并行组从同一节点分出两条边,收束处再各自连到下一个节点", () => {
  const edges = MODEL.edges
  const fanOut = edges.filter((edge) => edge.parallel)
  // 分叉源是并行组前面那一列(这里是「任务拆解」),不是助手消息本身 —— 助手消息不占节点。
  expect(fanOut.map((edge) => `${edge.from}→${edge.to}:${edge.label}`)).toEqual([
    "n:pr_2→n:pr_3:并行 · 工具",
    "n:pr_2→n:pr_4:并行 · 子代理",
  ])
  // 并行组的两个成员各自连到后面的节点(原型 n3→n5、n4→n5)。
  const converge = edges.filter((edge) => edge.from === "n:pr_3" || edge.from === "n:pr_4")
  expect(converge.map((edge) => `${edge.from}→${edge.to}`)).toEqual(["n:pr_3→n:pr_5", "n:pr_4→n:pr_5"])
  // 没有自环,也没有指向自己的边。
  for (const edge of edges) expect(edge.from).not.toBe(edge.to)
})

test("流程图边:非并行边的标签说的是「上一节点发生了什么」", () => {
  const label = (from: string, to: string) => MODEL.edges.find((edge) => edge.from === from && edge.to === to)?.label
  expect(label("n:msg_1", "n:pr_2")).toBe("用户请求")
  expect(label("n:pr_3", "n:pr_5")).toBe("✓ 完成")
  expect(label("n:pr_5", "n:pr_6")).toBe("已编辑")
  expect(label("n:pr_6", "n:pr_7")).toBe("✓ 完成")
  expect(label("n:pr_7", "n:fend:1")).toBe("本轮完成")
  // 上一轮结束 → 下一轮的用户消息。
  expect(label("n:fend:1", "n:msg_3")).toBe("新消息")
})

test("流程图边:工具失败与运行中的标签如实反映状态", () => {
  const model = buildFlowModel({
    messages: [userMessage("m1"), assistantMessage("m2"), assistantMessage("m3")],
    parts: {
      m1: [textPart("m1", "t1", "走起")],
      m2: [toolPart("m2", "bad", "bash", { error: "AssertionError" })],
      m3: [runningToolPart("m3", "busy", "bash")],
    },
  })
  const label = (from: string, to: string) => model.edges.find((edge) => edge.from === from && edge.to === to)?.label
  expect(label("n:bad", "n:busy")).toBe("✗ 失败")
  expect(label("n:busy", "n:fend:1")).toBe("进行中")
})

// ---------- 路由 ----------

function routeFor(id: string) {
  const index = MODEL.edges.findIndex((edge) => edge.id === id)
  if (index < 0) throw new Error(`没有边 ${id}`)
  const from = LAYOUT.nodes.find((node) => node.id === MODEL.edges[index]!.from)!
  // **必须把 from.route 传进来**,与 flowInvariants 同一口径:走线方案(通道基准、从哪一侧出去)
  // 是布局算好交给 canvas 的,不给它就等于拿一套「没有方案的裸矩形」去算,量出来的折点数
  // 跟真实画出来的不是一回事(展开的节点尤其如此)。
  return edgeRoute(from.rect, rectOf(MODEL.edges[index]!.to), index, from.route)
}

// 被占住的矩形与「端点贴着边界」的判据都取 fixture —— 它们本来就是 flowInvariants 内部用的那两份,
// 在这里再抄一遍的话,改了 fixture 那份而忘了这份,两套判据就会悄悄给出不同结论。
const OCCUPIED = occupiedRects(LAYOUT)

test("流程图连线:每条边都从源节点边界出发、落在目标节点边界上,而不是插进卡片里", () => {
  for (const edge of MODEL.edges) {
    const route = routeFor(edge.id)
    const from = rectOf(edge.from)
    const to = rectOf(edge.to)
    const head = route.cells[0]!
    const tail = route.cells[route.cells.length - 1]!
    expect(touchesRect(head, from), `${edge.id} 的起点不贴着源节点`).toBe(true)
    expect(touchesRect(tail, to), `${edge.id} 的终点不贴着目标节点`).toBe(true)
    // 端点绝不能落在任何一张卡的矩形内(连线压到卡片是最刺眼的错)。
    for (const cell of route.cells) {
      expect(
        OCCUPIED.some((rect) => pointInRect(cell, rect)),
        `${edge.id} 的 (${cell.x},${cell.y}) 压在卡片里`,
      ).toBe(false)
    }
  }
})

test("流程图连线:相邻两格必有一格之差(没有斜线、没有跳格),首尾不重复", () => {
  for (const edge of MODEL.edges) {
    const route = routeFor(edge.id)
    expect(route.cells.length).toBeGreaterThan(1)
    const keys = route.cells.map((cell) => `${cell.x}:${cell.y}`)
    expect(new Set(keys).size, `${edge.id} 有重复格`).toBe(keys.length)
    route.cells.slice(1).forEach((cell, index) => {
      const previous = route.cells[index]!
      const step = Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y)
      expect(step, `${edge.id} 在 (${previous.x},${previous.y})→(${cell.x},${cell.y}) 跳了 ${step} 格`).toBe(1)
    })
  }
})

test("流程图连线:终点是箭头字符,拐角用圆角制表符而不是直角", () => {
  // 中线不同高的那条边才有折角(中线同高的那条就是一条直线,见下面那条用例)。
  const route = routeFor("e:n:pr_4→n:pr_5")
  expect(route.cells[route.cells.length - 1]!.ch).toBe("▸")
  // 拐角用 `╭ ╮ ╰ ╯` —— 与 NeonBox 自己画卡片边框用的是同一套(见 ui/neon 的
  // perimeterCells),于是「线的折角」与「卡的圆角」读起来是同一种语言。
  // 直角那一套(┌ ┐ └ ┘)也留着以防有人换回去,但新画的折角必须是圆角的。
  const corners = route.cells.filter((cell) => CORNER_CHARS.has(cell.ch)).map((cell) => cell.ch)
  expect(corners.length).toBeGreaterThan(0)
  // 白名单:连线只许用横、竖、四种圆角、三种箭头。`▲` 是从目标卡**下边框**往上扎的箭头,
  // 只有拖拽把一张卡拖到它目标上方时才会出现(见 edgeRoute)。
  for (const ch of route.cells.map((cell) => cell.ch)) {
    expect("─│╭╮╰╯┌┐└┘├┤┬┴┼▸▼▲".includes(ch), `未知连线字符 ${ch}`).toBe(true)
  }
  // 每一条边的字符都在白名单里(上面只量了一条,这里量全图)。
  for (const edge of MODEL.edges) {
    for (const cell of routeFor(edge.id).cells) {
      expect("─│╭╮╰╯┌┐└┘├┤┬┴┼▸▼▲".includes(cell.ch), `${edge.id} 出现了 ${cell.ch}`).toBe(true)
    }
  }
})

/** 一条折线走过的**行**(升序去重)。 */
function rowsOf(cells: readonly { y: number }[]) {
  return [...new Set(cells.map((cell) => cell.y))].toSorted((a, b) => a - b)
}

/**
 * 同带右向的边只有**一种**形状:横-竖-横,竖段固定落在走廊里那一列。
 *
 * 这一条是上一版那份「狗腿」契约的反面。上一版按 `index % 2` 让相邻的边一上一下地折返
 * (横-竖-横-竖-横,拐 4 次),满足了「必须有折点」这条字面要求,画出来是一排压扁的弹簧 ——
 * 用户原话是「流程图的连线都是有点混乱啊」。原型那边每条边都是一条贝塞尔
 * (card-design-v7.html:966-977),读起来是**一排平行的弧**,正交的等价物就是同一个形状平移。
 *
 * 三件事分开钉:
 *   1. **中线同高**就是一条直线,一个折角都没有 —— 原型 n1→n2 也是直的
 *      (`M198,73 C232,73 262,74 292,74`,card-design-v7.html:966);
 *   2. **中线不同高**(收束/分叉)才有一个竖段,而且竖段整条都在固定的走廊列上;
 *   3. 竖段的**方向只由几何决定**(目标更低就往下),与这条边是第几条无关 ——
 *      「按边序轮换」正是被删掉的那件事。
 *
 * **第 1 条用两个手工矩形验,不用 fixture**:节点卡高按类型在 4~7 行之间变之后,同一行带里
 * 任意两张卡的中线**几乎不再相等**(奇数高的卡中线偏下、偶数高的偏上),fixture 里已经凑不出
 * 一对中线同高的相邻卡了 —— 而「中线同高就是一条直线」这条形状契约仍然要有人钉着。
 */
test("流程图连线:中线同高的同带右向边就是一条直线,一个折角都没有", () => {
  // 两张卡同样高(5 行)⇒ 中线同在第 6 行;卡宽取全表最宽那一档,于是走廊正好 GAP_X。
  const width = MAX_NODE_WIDTH
  const from: FlowRect = { x: 2, y: 4, width, height: 5 }
  const to: FlowRect = { x: 2 + width + GAP_X, y: 4, width, height: 5 }
  const midY = from.y + Math.floor(from.height / 2)
  const route = edgeRoute(from, to, 0)
  expect(rowsOf(route.cells)).toEqual([midY])
  expect(route.cells.filter((cell) => CORNER_CHARS.has(cell.ch))).toEqual([])
  expect(routeTurns(route.cells)).toBe(0)
  expect(route.cells[route.cells.length - 1]!.ch).toBe("▸")
  // 整条铺满两卡之间那一条走廊。
  expect(routeSpanX(route.cells)).toBe(GAP_X)
})

test("流程图连线:同带右向的边是一条走廊走线,竖段固定在走廊列上、方向只由几何决定", () => {
  // 中线不同高(卡高按类型在变,主力 fixture 里每一对相邻卡的中线都差着至少一行):
  // 一个竖段、两个折角、拐两次;竖段整条都在走廊列上。
  const merging = routeFor("e:n:pr_4→n:pr_5")
  const from = LAYOUT.nodes.find((node) => node.id === "n:pr_4")!.rect
  const column = corridorColumn(from)
  const fromMidY = from.y + Math.floor(from.height / 2)
  const toMidY = rectOf("n:pr_5").y + Math.floor(nodeSize("edit").height / 2)
  const mergeVertical = merging.cells.filter((cell) => cell.ch === "│")
  expect(
    mergeVertical.map((cell) => cell.x),
    "竖段整条都在走廊列上",
  ).toEqual(mergeVertical.map(() => column))
  // 走廊列上从源中线到目标中线**每一行**都有格子:两端是折角(╮/╰),中间是竖线。
  const columnRows = rowsOf(merging.cells.filter((cell) => cell.x === column))
  expect(columnRows).toEqual(
    Array.from({ length: Math.abs(toMidY - fromMidY) + 1 }, (_, i) => Math.min(fromMidY, toMidY) + i),
  )
  expect(mergeVertical.length, "竖线是折角之间的那些行").toBe(Math.abs(toMidY - fromMidY) - 1)
  expect(routeTurns(merging.cells)).toBe(MAX_ROUTE_TURNS)
  expect(routeTurns(merging.cells)).toBe(2)
  // 竖段上下两端各一个圆角,方向由几何决定:往下折是 `╮` 出去、`╰` 进来。
  const dropping = toMidY > fromMidY
  expect(merging.cells.find((cell) => cell.x === column && cell.y === fromMidY)!.ch).toBe(dropping ? "╮" : "╯")
  expect(merging.cells.find((cell) => cell.x === column && cell.y === toMidY)!.ch).toBe(dropping ? "╰" : "╭")

  // 同一行带里所有同向边的竖段都在**同一个相对位置**上(相对源卡右边那一列往右 CORRIDOR_LANE 列)。
  // 「按边序轮换」那件事一去掉,这一条就是它的反面:一排同向的边读起来是平行的。
  // 竖段方向**只由几何决定**:目标更低 → 出竖那一格是 `╮`(左 + 下),更高 → `╯`(左 + 上)。
  const offsets = new Set<number>()
  let verticals = 0
  for (const [index, edge] of MODEL.edges.entries()) {
    const a = rectOf(edge.from)
    const b = rectOf(edge.to)
    if (!isRightward(a, b)) continue
    const route = edgeRoute(a, b, index, LAYOUT.nodes.find((node) => node.id === edge.from)!.route)
    const column = corridorColumn(a)
    for (const cell of route.cells) {
      if (cell.ch !== "│") continue
      offsets.add(cell.x - (a.x + a.width))
      expect(cell.x, `${edge.id} 的竖段跑出了走廊列`).toBe(column)
    }
    const source = a.y + Math.floor(a.height / 2)
    const target = b.y + Math.floor(b.height / 2)
    if (source === target) continue
    verticals += 1
    expect(route.cells.find((cell) => cell.x === column && cell.y === source)!.ch, `${edge.id} 出竖的折角`).toBe(
      target > source ? "╮" : "╯",
    )
    expect(route.cells.find((cell) => cell.x === column && cell.y === target)!.ch, `${edge.id} 落竖的折角`).toBe(
      target > source ? "╰" : "╭",
    )
  }
  expect([...offsets], "所有同向边的竖段在同一个相对位置").toEqual([CORRIDOR_LANE])
  expect(verticals, "这一版布局里一条竖段都没有,上面那条断言等于空跑").toBeGreaterThan(0)
})

/**
 * 折点数不再是契约 —— **形状**才是。
 *
 * 每条边至多拐 MAX_ROUTE_TURNS 次:三段直线,最多一个 S 形,没有回头路。
 * 狗腿是五段(拐 4 次),所以这一条一换,狗腿就不可能再回来;
 * 将来谁想「让线再弯一点」,撞红的是这条而不是某条只覆盖主力 fixture 的用例。
 */
test("流程图连线:每条边至多拐两次(没有回头路),每一档尺寸下都成立", () => {
  for (const width of [MAX_NODE_WIDTH, MIN_BAND_VIEWPORT - 1, 45, 66, 76, 118, 146]) {
    const layout = layoutNodes(MODEL.nodes, width)
    for (const { edge, route } of routedEdges(MODEL, layout)) {
      expect(routeTurns(route.cells), `${width} 列:${edge.id}`).toBeLessThanOrEqual(MAX_ROUTE_TURNS)
    }
  }
})

test("流程图连线:标签可以摆在候选线段上,给出的每一段宽度都落在走廊里(不压任何卡片)", () => {
  for (const edge of MODEL.edges) {
    const route = routeFor(edge.id)
    expect(route.labels.length, `${edge.id} 没有可放标签的线段`).toBeGreaterThan(0)
    for (const span of route.labels) {
      expect(span.columns, `${edge.id} 的候选段宽度`).toBeGreaterThan(0)
      for (let x = span.x; x < span.x + span.columns; x++) {
        const cell = { x, y: span.y }
        expect(
          OCCUPIED.some((rect) => pointInRect(cell, rect)),
          `${edge.id} 的标签占位 (${x},${span.y}) 压在卡片里`,
        ).toBe(false)
      }
    }
    // 每条边至少给出一段放得下两字中文标签(4 列)的候选;放不下的整段不摆,而不是摆成省略号。
    expect(
      Math.max(...route.labels.map((span) => span.columns)),
      `${edge.id} 没有放得下标签的线段`,
    ).toBeGreaterThanOrEqual(4)
  }
  // 靠源那一段是 `CORRIDOR_LANE + 1 = 14` 列,必须放得下原型最长的并行标签
  // (「并行 · 子代理」13 列)—— 走廊列之所以取 GAP_X − 3 而不是取中间,就是为了这个算式。
  const widestOf = (edge: string) => Math.max(...routeFor(edge).labels.map((span) => span.columns))
  const corridorEdges = MODEL.edges.filter((edge) => isRightward(rectOf(edge.from), rectOf(edge.to)))
  const widest = Math.max(...corridorEdges.map((edge) => widestOf(edge.id)))
  expect(Locale.displayWidth("并行 · 子代理")).toBeLessThanOrEqual(widest)
  expect(widest).toBe(CORRIDOR_LANE + 1)
})

test("流程图连线:同带右向走走廊,绕行走出竖-横-竖", () => {
  const sameRow = MODEL.edges.find((edge) => {
    const a = rectOf(edge.from)
    const b = rectOf(edge.to)
    return a.y === b.y && b.x > a.x + a.width
  })
  if (!sameRow) throw new Error("这一版布局里没有同一行的相邻节点")
  const route = routeFor(sameRow.id)
  // 同带右向:整条都在两卡之间的走廊里,横向正好铺满那一段走廊
  // (宽度 = `to.x − from.x − from.width`,走廊由**列宽**定,卡比列窄时反而更宽)。
  const sameFrom = rectOf(sameRow.from)
  const sameTo = rectOf(sameRow.to)
  expect(routeSpanX(route.cells)).toBe(sameTo.x - sameFrom.x - sameFrom.width)
  expect(routeSpanX(route.cells)).toBeGreaterThanOrEqual(GAP_X)
  // 至多两次拐弯 —— 卡高按类型在变之后同一行带的相邻卡中线不再相等,于是这一档通常是
  // 「横-竖-横」那个 S 形而不是一条直线(直线那一档由上面那条用例单独钉着)。
  expect(routeTurns(route.cells)).toBeLessThanOrEqual(MAX_ROUTE_TURNS)

  // 绕行边(第 1 轮结束 → 第 2 轮的用户输入)必须走出「横 + 竖」的折线,而且横段整条都在同一条通道行上。
  // 拐弯次数是「至多两次」而不是「正好两次」:出口那一竖有时长度是 0(卡片下沿就贴着通道行),
  // 那时整条边就是「一条横 + 一条竖」,也就是一次拐弯。
  const wrap = routeFor("e:n:fend:1→n:msg_3")
  const shapes = new Set(wrap.cells.map((cell) => cell.ch))
  expect(shapes.has("│")).toBe(true)
  expect(shapes.has("─")).toBe(true)
  expect(routeTurns(wrap.cells)).toBeLessThanOrEqual(MAX_ROUTE_TURNS)
  expect(wrap.cells[wrap.cells.length - 1]!.ch).toBe("▼")
  const channelRows = rowsOf(wrap.cells.filter((cell) => cell.ch === "─"))
  expect(channelRows.length, "横段只落在一行通道上").toBe(1)
  // 横段那一行在整幅宽度上都没有卡片(行带之间的空行)。
  expect(
    OCCUPIED.some((rect) => channelRows[0]! >= rect.y && channelRows[0]! < rect.y + rect.height),
    "横段压到了卡片",
  ).toBe(false)
  // 展开的卡不能往下出(正下方是它自己的详情面板),于是改从左边那条走廊进。
  // 用「任务拆解」而不是别的卡:它在第一行带的**第二列**,出边是绕行边(下一组在下一条行带的第一列)。
  const expanded = layoutNodes(MODEL.nodes, 76, { expandedId: "n:pr_2" })
  const grownFrom = expanded.nodes.find((node) => node.id === "n:pr_2")!
  expect(grownFrom.route.downFree, "展开的那张卡不能往下出").toBe(false)
  const grown = edgeRoute(grownFrom.rect, expanded.nodes.find((node) => node.id === "n:pr_3")!.rect, 0, grownFrom.route)
  expect(grown.cells[0]!.x, "出口那一竖改走在卡片左边的走廊列上").toBe(grownFrom.rect.x - 1)
  // 没展开时同一张卡是往下出的(出口在它自己那一列),两条路径都不压卡片。
  const plain = LAYOUT.nodes.find((node) => node.id === "n:pr_2")!
  expect(plain.route.downFree).toBe(true)
  const plainRoute = edgeRoute(plain.rect, rectOf("n:pr_3"), 0, plain.route)
  expect(plainRoute.cells[0]!.x).toBe(plain.rect.x + plain.rect.width - 2)
})

test("流程图连线:走廊宽度够放下原型那几个标签(否则标签全是省略号)", () => {
  // 两卡之间真正空着 GAP_X − 1 格,最后一格是箭头,标签最多占 GAP_X − 2 格。
  // 原型最长的并行标签是「并行 · 子代理」= 4 + 3 + 6 = 13 列。
  expect(Locale.displayWidth("并行 · 子代理")).toBeLessThanOrEqual(GAP_X - 2)
  expect(Locale.displayWidth("并行 · 工具")).toBeLessThanOrEqual(GAP_X - 2)
  expect(LABEL_COLUMNS).toBe(GAP_X - 2)
  expect(GAP_Y).toBeGreaterThanOrEqual(2)
  // 走廊列 = GAP_X − 3:靠源那 14 列放得下 13 列的并行标签,靠目标那 3 列留给收尾横段与箭头。
  expect(CORRIDOR_LANE).toBe(GAP_X - 3)
  expect(CORRIDOR_LANE + 1).toBeGreaterThanOrEqual(Locale.displayWidth("并行 · 子代理"))
  expect(GAP_X - CORRIDOR_LANE).toBe(3)
})

// ---------- 布局与轮次带 ----------

test("流程图布局:同一轮的节点整体在分隔线之下,轮次带自上而下不交叠", () => {
  for (const row of LAYOUT.rows) {
    const inRow = LAYOUT.nodes.filter((node) => node.rect.y >= row.top && node.rect.y < row.top + row.height)
    expect(inRow.length, `第 ${row.round} 轮的行带里没有节点`).toBeGreaterThan(0)
    for (const node of inRow) expect(node.round).toBe(row.round)
  }
  for (const [index, a] of LAYOUT.rows.entries()) {
    for (const b of LAYOUT.rows.slice(index + 1)) {
      expect(a.top + a.height, `第 ${a.round} 轮压到第 ${b.round} 轮`).toBeLessThanOrEqual(b.top)
    }
  }
})

test("流程图布局:并行的两个成员同列上下叠放(原型 n3/n4 就是这样),不是并排挤成两列", () => {
  const parallel = LAYOUT.nodes.filter((node) => node.id === "n:pr_3" || node.id === "n:pr_4")
  expect(parallel).toHaveLength(2)
  expect(parallel[0]!.rect.x).toBe(parallel[1]!.rect.x)
  expect(parallel[0]!.rect.y).not.toBe(parallel[1]!.rect.y)
  expect(parallel[0]!.slot).toBe(0)
  expect(parallel[1]!.slot).toBe(1)
})

test("流程图布局:详情框挂在选中卡正下方,行带同步长高,后面的行整体下移", () => {
  const before = layoutNodes(MODEL.nodes, 76)
  const expanded = layoutNodes(MODEL.nodes, 76, { expandedId: "n:pr_3", detailRows: 5 })
  const target = expanded.nodes.find((node) => node.id === "n:pr_3")!
  if (!target.detailRect) throw new Error("选中的节点没有详情框")
  expect(target.detailRect.x).toBe(target.rect.x)
  // 详情框挂在**这张卡自己的下沿**之下 —— 卡高按类型在 4~7 行之间变,写死成某个常数
  // 的话高卡上详情会盖住正文那一行。
  expect(target.detailRect.y).toBe(target.rect.y + target.rect.height)
  expect(target.rect.height).toBe(nodeSize("tool").height)
  // 长高的是**它所在的那条行带**(pr_3 在第 1 轮的第二条行带里)。
  const bandOf = (layout: typeof before, node: (typeof before)["nodes"][number]) =>
    layout.rows.find((row) => row.top === node.bandTop)!
  const grown = bandOf(expanded, target).height - bandOf(before, before.nodes.find((n) => n.id === "n:pr_3")!).height
  expect(grown).toBe(5)
  // 别的行带一点没动 —— 展开一张卡不该牵动整张画布的列位。
  expect(expanded.width).toBe(before.width)
  expect(expanded.rows).toHaveLength(before.rows.length)
  const lastBefore = before.nodes.at(-1)!
  const lastAfter = expanded.nodes.at(-1)!
  expect(lastAfter.rect.y - lastBefore.rect.y).toBe(5)
})

// ---------- 拖拽:网格对齐 ----------

/** 锚点表里那些列/行(升序去重)。 */
function gridLines(values: number[]) {
  return [...new Set(values)].toSorted((a, b) => a - b)
}

/**
 * 某个节点所在行带里、它右边那一列的列锚。
 *
 * **为什么不能写死**:节点尺寸按类型在变之后,列 x 是**逐列累加**的
 * (`x[c+1] = x[c] + 本列最宽卡 + GAP_X`,见 layoutNodes),而「本列最宽卡」每条行带都可能不同 ——
 * 76 列这一档里同一张图就有 41(23 宽的卡起头)与 42(24 宽的卡起头)两个第二列。
 * 原型那边也是这么画的(n1→n2 差 266 px、n2→n3 差 260 px、n3→n5 差 240 px)。
 */
function nextColumnX(layout: FlowLayout, id: string) {
  const node = layout.nodes.find((item) => item.id === id)!
  const columns = gridLines(layout.nodes.filter((item) => item.bandTop === node.bandTop).map((item) => item.rect.x))
  const next = columns.find((x) => x > node.rect.x)
  if (next === undefined) throw new Error(`${id} 所在行带里没有右边那一列`)
  return next
}

/**
 * 某个节点右侧那一列上、离它最近的**合法**落点。
 *
 * 「合法」= snapDrag 会给的那一种(见 layout 的 snapDrag 那五条):不压别人、卡整个关在行带里、
 * 那一列装得下这张卡。节点尺寸按类型在变之后这三条都要按**那张卡自己的宽高**判 ——
 * 20 列的药丸与 24 列的卡在旁边,空不空、装不装得下是两回事。
 */
function nearestEmptyAnchor(layout: FlowLayout, id: string) {
  const card = layout.nodes.find((item) => item.id === id)!
  const others = occupiedRects(layout).filter((rect) => !(rect.x === card.rect.x && rect.y === card.rect.y))
  const x = nextColumnX(layout, id)
  const fits = (anchor: FlowAnchor) =>
    anchor.y + card.rect.height <= anchor.bandBottom &&
    !others.some((rect) => rectsOverlap({ ...anchor, width: card.rect.width, height: card.rect.height }, rect))
  const found = layout.anchors
    .filter((anchor) => anchor.x === x && anchor.y !== card.rect.y && fits(anchor))
    .toSorted((a, b) => Math.abs(a.y - card.rect.y) - Math.abs(b.y - card.rect.y))
    .at(0)
  if (!found) throw new Error(`${id} 右边那一列上没有合法落点`)
  return { x: found.x, y: found.y }
}

test("流程图拖拽:锚点是「列锚 × 行首」的叉积,所以拖过去必然与其它卡对齐", () => {
  const layout = layoutNodes(MODEL.nodes, 76)
  const columns = gridLines(layout.nodes.map((node) => node.rect.x))
  const rows = gridLines(layout.nodes.map((node) => node.rect.y))
  // 每个锚点的 x 都是某一列的列锚,y 都是某张卡的顶边 —— 这两条就是「对齐」的全部含义。
  for (const anchor of layout.anchors) {
    expect(columns, `锚点 x=${anchor.x} 不在列锚上`).toContain(anchor.x)
    expect(rows, `锚点 y=${anchor.y} 不是任何一张卡的顶边`).toContain(anchor.y)
    // 列锚全部落在 LEFT_MARGIN 右边(左边得留出走廊,见 LEFT_MARGIN 的注释)。
    expect(anchor.x).toBeGreaterThanOrEqual(LEFT_MARGIN)
  }
  // 叉积:列锚 × 行锚,一个不多一个不少。
  expect(layout.anchors.length).toBe(columns.length * rows.length)
  // 行带信息跟着行走:每个锚点都说得出自己属于哪条行带,而且卡整个待在那条行带里 ——
  // 判据用**最矮**的那种卡(4 行),任何一种节点都装得下,于是这条对全部七类都成立。
  for (const anchor of layout.anchors) {
    expect(anchor.y).toBeGreaterThanOrEqual(anchor.bandTop)
    expect(anchor.y + nodeSize("fend").height).toBeLessThanOrEqual(anchor.bandBottom)
    expect(layout.rows.some((row) => row.top === anchor.bandTop && row.top + row.height === anchor.bandBottom)).toBe(
      true,
    )
  }
  // 拖动不改变锚点表 —— 一张卡被拖走之后,它原来的格子仍然是可停靠的(否则再也拖不回去)。
  const target = nearestEmptyAnchor(layout, "n:pr_3")
  const dragged = layoutNodes(MODEL.nodes, 76, { overrides: { "n:pr_3": target } })
  expect(dragged.anchors).toEqual(layout.anchors)
})

test("流程图拖拽:落点吸附到最近的空锚点,并夹在画布内容范围内", () => {
  const layout = layoutNodes(MODEL.nodes, 76)
  const card = layout.nodes.find((node) => node.id === "n:pr_3")!
  const others = occupiedRects(layout).filter((rect) => !(rect.x === card.rect.x && rect.y === card.rect.y))
  // **size 用这张卡自己的尺寸**(23 × 5,「工具调用」),不是全表最宽那一档。
  const context = {
    anchors: layout.anchors,
    blocked: others,
    columnWidths: layout.columnWidths,
    bounds: { width: layout.width, height: layout.height },
    size: { width: card.rect.width, height: card.rect.height },
  }
  const target = nearestEmptyAnchor(layout, "n:pr_3")
  expect(snapDrag(target, context)).toEqual(target)
  // 位移不足一步时不动:往右挪一格仍然落在原来的列锚上。
  expect(snapDrag({ x: card.rect.x + 1, y: card.rect.y }, context)).toEqual({ x: card.rect.x, y: card.rect.y })
  // 原型那两句 `Math.max(0, Math.min(canvas - card, ox + dx))`:不许拖出画布。
  // 这一档把 blocked 清空,于是判的纯粹是「夹进范围 + 吸到最近锚点」。
  const loose = { ...context, blocked: [] }
  expect(snapDrag({ x: -30, y: -30 }, loose)).toEqual({ x: LEFT_MARGIN, y: 0 })
  const far = snapDrag({ x: 9999, y: 9999 }, loose)!
  expect(far.x).toBeLessThanOrEqual(layout.width - card.rect.width)
  expect(far.y).toBeLessThanOrEqual(layout.height - card.rect.height)
  // 落点压到别人的卡就退到旁边那个空锚点,而不是叠上去。这一档只要 snapDrag **不给**非法的
  // 落点就算过(四周全占满时正确答案是 undefined = 原地不动,见下面那一档)。
  /** 一个落点对这张卡合不合法:卡整个关在行带里,且不压任何别人。 */
  const legal = (anchor: { x: number; y: number; bandBottom: number }) =>
    anchor.y + card.rect.height <= anchor.bandBottom &&
    !others.some((rect) => rectsOverlap({ ...anchor, width: card.rect.width, height: card.rect.height }, rect))
  const illegalAnchors = layout.anchors.filter((anchor) => !legal(anchor))
  expect(illegalAnchors.length, "这一版布局里一个非法落点都没有,这一段等于空跑").toBeGreaterThan(0)
  for (const anchor of illegalAnchors) {
    const moved = snapDrag({ x: anchor.x, y: anchor.y }, context)
    if (!moved) continue
    expect([moved.x, moved.y], `(${anchor.x},${anchor.y}) 非法,却落了回去`).not.toEqual([anchor.x, anchor.y])
    const landed = layout.anchors.find((item) => item.x === moved.x && item.y === moved.y)
    expect(landed, "落点不在锚点表里").toBeDefined()
    expect(legal(landed!), `(${moved.x},${moved.y}) 也不合法`).toBe(true)
  }
  // **那一列装不下这张卡时,落点一律不算** —— 列 x 是从 columnWidths 推出来的,一张比那一列
  // 还宽的卡放进去就会顶进右边那条走廊,把 GAP_X 挤掉几列(见 layout 的 snapDrag)。
  // 这一档手工造一张表:两列分别是 20 与 24,而手上这张卡 24 列宽。
  const narrow = snapDrag(
    { x: 0, y: 0 },
    {
      anchors: [
        { x: 0, y: 0, bandTop: 0, bandBottom: 10 },
        { x: 36, y: 0, bandTop: 0, bandBottom: 10 },
      ],
      blocked: [],
      columnWidths: [20, 24],
      bounds: { width: 80, height: 20 },
      size: { width: 24, height: 4 },
    },
  )
  expect(narrow, "20 列的那一列放不下 24 列的卡").not.toEqual({ x: 0, y: 0 })
  expect(narrow).toEqual({ x: 36, y: 0 })
  // **卡探出那条行带时同样不算** —— 行带下沿是绕行边的通道基准,探出去出边那一竖就落在卡自己身上。
  // 每一行锚只属于一条行带(构造如此),所以这里给两行锚各配一条行带,再拿那条只有 4 行高的。
  const sticking = snapDrag(
    { x: 0, y: 20 },
    {
      anchors: [
        { x: 0, y: 0, bandTop: 0, bandBottom: 10 },
        { x: 44, y: 0, bandTop: 0, bandBottom: 10 },
        { x: 0, y: 20, bandTop: 20, bandBottom: 24 },
        { x: 44, y: 20, bandTop: 20, bandBottom: 24 },
      ],
      blocked: [],
      columnWidths: [24, 24],
      bounds: { width: 120, height: 40 },
      size: { width: 24, height: 5 },
    },
  )
  expect(sticking?.y, "4 行高的行带放不下 5 行高的卡").not.toBe(20)
  expect(sticking).toEqual({ x: 0, y: 0 })
  // 四周都被占满时退回**自己原来的位置**(它自己不在 blocked 里):宁可原地不动,也不叠上去。
  const ring = [-1, 0, 1].flatMap((dy) =>
    [-1, 0, 1].map((dx) => ({
      x: card.rect.x + dx * COLUMN_PITCH,
      y: card.rect.y + dy * (card.rect.height + GAP_Y),
      width: MAX_NODE_WIDTH,
      height: MAX_NODE_HEIGHT,
    })),
  )
  const surrounded = snapDrag(
    { x: card.rect.x + COLUMN_PITCH, y: card.rect.y + card.rect.height + GAP_Y },
    {
      ...context,
      blocked: others.concat(ring.filter((rect) => rect.x !== card.rect.x || rect.y !== card.rect.y)),
    },
  )
  expect([surrounded?.x, surrounded?.y], "旁边没空格时退回自己原来的位置").toEqual([card.rect.x, card.rect.y])
  // 一个空锚点都没有时返回 undefined,调用方保持原位(宁可不动,也不要放到画布外面去)。
  expect(
    snapDrag({ x: 0, y: 0 }, { ...context, bounds: { width: 4, height: 4 } }),
    "画布装不下一张卡时没有合法落点",
  ).toBeUndefined()
})

test("流程图拖拽:一张卡被拖走后,连线跟着重画,而且不变量一条都不破", () => {
  const before = layoutNodes(MODEL.nodes, 76)
  const moved = "n:pr_3"
  // 把「工具调用」挪到它右边那一列上离它最近的一个空锚点(列 x 逐列累加,所以从布局里读)。
  const target = nearestEmptyAnchor(before, moved)
  expect(before.anchors.some((anchor) => anchor.x === target.x && anchor.y === target.y)).toBe(true)
  const overrides = { [moved]: target }
  const after = layoutNodes(MODEL.nodes, 76, { overrides })
  const dragged = after.nodes.find((node) => node.id === moved)!
  expect(dragged.rect.x).toBe(target.x)
  expect(dragged.rect.y).toBe(target.y)
  // 别的卡一步没动(拖动只搬那一张)。
  for (const node of after.nodes) {
    if (node.id === moved) continue
    const was = before.nodes.find((item) => item.id === node.id)!
    expect(node.rect, `${node.id} 不该动`).toEqual(was.rect)
  }
  // 行带信息跟着锚点走:被拖到那一行之后,它的绕行边从**那条行带的下沿**出去。
  const band = after.rows.find((row) => row.top === dragged.bandTop)!
  expect(dragged.bandTop).toBe(band.top)
  expect(dragged.bandBottom).toBe(band.top + band.height)
  // 走线真的变了:那条卡出发与到达的两条边都换了格子。
  const cellsOf = (layout: typeof after, id: string) =>
    routedEdges(FIXTURE_MODEL, layout)
      .find((item) => item.edge.id === id)!
      .route.cells.map((cell) => `${cell.x}:${cell.y}`)
  expect(cellsOf(after, `e:${moved}→n:pr_5`)).not.toEqual(cellsOf(before, `e:${moved}→n:pr_5`))
  expect(cellsOf(after, `e:n:pr_2→${moved}`)).not.toEqual(cellsOf(before, `e:n:pr_2→${moved}`))
  // 十条不变量对被拖过的图一样成立(不压卡、步长为 1、形状至多拐两次、走廊、标签不压别的边…)。
  expect(flowInvariants({ model: MODEL, layout: after, width: 76 })).toEqual([])
  // 画布尺寸不受影响:列锚与行首都没变,所以既不用重排也不改滚动范围。
  expect(after.width).toBe(before.width)
  expect(after.height).toBe(before.height)
  // 认不出的落点(不在锚点表里)当这次拖拽没发生 —— 别的调用点塞进来的坐标不许生效。
  const bogus = layoutNodes(MODEL.nodes, 76, { overrides: { [moved]: { x: 5, y: 6 } } })
  expect(bogus.nodes.find((node) => node.id === moved)!.rect).toEqual(
    before.nodes.find((node) => node.id === moved)!.rect,
  )
})

test("流程图拖拽:任意一张卡拖到任意一个**空**锚点上,不变量都不破", () => {
  // 这一条是上面那条的推广版:拖拽能造出的边形态(目标在左边、在上边、在下一行带、
  // 甚至同一条行带里往回走)全靠它兜住 —— 那些形态自动布局永远造不出来。
  // 只试**合法**落点:snapDrag 会给的就那一种(见 layout 的 snapDrag 那五条守卫)——
  // 叠在别人身上的、卡探出行带的、以及「那一列装不下这张卡」的,复现同三个条件,
  // 否则这一条测的是几条生产代码永远走不到的路径。
  // 扫三档宽度:66/76 列是主力 fixture 的两列布局,146 列是四列(叉积里的格子最多,组合最密)。
  const problems: string[] = []
  let checks = 0
  for (const width of [66, 76, 146]) {
    const layout = layoutNodes(MODEL.nodes, width)
    const occupied = occupiedRects(layout)
    const columns = [...new Set(layout.anchors.map((anchor) => anchor.x))].toSorted((a, b) => a - b)
    for (const node of layout.nodes) {
      const others = occupied.filter((rect) => !(rect.x === node.rect.x && rect.y === node.rect.y))
      for (const anchor of layout.anchors) {
        if (anchor.x === node.rect.x && anchor.y === node.rect.y) continue
        if (node.rect.width > layout.columnWidths[columns.indexOf(anchor.x)]) continue
        if (anchor.y + node.rect.height > anchor.bandBottom) continue
        const shape = { x: anchor.x, y: anchor.y, width: node.rect.width, height: node.rect.height }
        if (others.some((rect) => rectsOverlap(shape, rect))) continue
        const overrides = { [node.id]: { x: anchor.x, y: anchor.y } }
        problems.push(
          ...checkFlow(MODEL, width, undefined, overrides).problems.map(
            (p) => `${width} 列 ${node.id}(${node.rect.width}×${node.rect.height})→${anchor.x},${anchor.y}:${p}`,
          ),
        )
        const landed = layoutNodes(MODEL.nodes, width, { overrides }).nodes.find((item) => item.id === node.id)!
        expect([landed.rect.x, landed.rect.y], `${node.id} 落在了锚点上`).toEqual([anchor.x, anchor.y])
        checks += 1
      }
    }
  }
  expect(checks, "这条用例没跑到几个组合,等于空跑").toBeGreaterThan(40)
  expect(problems.slice(0, 12)).toEqual([])
  expect(problems.length).toBe(0)
})

test("流程图连线:屏幕上真正摆出来的标签都摆在两卡之间的走廊里,没有压在别的边上", () => {
  // 这条钉的是用户点名的那一处:上一版把「本轮完成」印在另一条线上。
  // 判据是**屏幕上会出现的那些标签**(fixture 重演一遍 canvas 的摆标签过程),不是候选段。
  for (const [width, expandedId] of [
    [66, undefined],
    [76, undefined],
    [76, "n:msg_1"],
    [90, undefined],
    [118, "n:pr_3"],
    [146, undefined],
  ] as const) {
    const layout = layoutNodes(MODEL.nodes, width, { expandedId })
    const labels = placedLabels(MODEL, layout)
    expect(labels.length, `${width} 列一张标签都没摆上`).toBeGreaterThan(4)
    const owners = edgeCellOwners(MODEL, layout)
    for (const label of labels) {
      for (let x = label.x; x < label.x + Locale.displayWidth(label.text); x++) {
        const owner = owners.get(`${x}:${label.y}`)
        // owner 为 undefined = 那一格本来就没有线(纯空白),随便摆。
        if (owner === undefined) continue
        expect(owner, `${label.edge} 的标签 (${x},${label.y}) 压到了第 ${owner} 条边`).toBe(label.owner)
      }
    }
  }
})
