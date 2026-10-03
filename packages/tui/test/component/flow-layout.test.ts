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
  corridorColumn,
  CORNER_CHARS,
  CORRIDOR_LANE,
  edgeRoute,
  isRightward,
  layoutNodes,
  COLUMN_PITCH,
  GAP_X,
  GAP_Y,
  LEFT_MARGIN,
  LABEL_COLUMNS,
  MAX_ROUTE_TURNS,
  MIN_BAND_COLUMNS,
  MIN_BAND_VIEWPORT,
  NODE_CONTENT_COLUMNS,
  NODE_HEIGHT,
  NODE_WIDTH,
  RIGHT_MARGIN,
  routeTurns,
  SEPARATOR_ROWS,
  snapDrag,
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
// 76 = 两列一行带:74 是 80 列终端扣掉内边距与滚动条之后的视口宽,76 留一点余量。
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
// / 形状至多拐两次 / 走廊形状 / 标签不压别的边 —— 共九条,清单见 fixture 的 flowInvariants)
// 收在 fixture 的 flowInvariants 里,下面这些用例只负责**在哪些组合上**跑它。

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
 * 全部九条不变量在**一整片组合**上都成立。
 *
 * 这一条是 LEFT_MARGIN 与 GAP_Y 那几段注释的兑现处。并行分支在布局里是同列上下叠放的,
 * 所以「叠放能不能成立」完全取决于列与行带的尺寸组合 —— 而组合数是列数(perRow)× 成员数 ×
 * 行带内最大叠放深度 的乘积,手写断言只可能覆盖其中两三种。这里把宽度从 28 列一路扫到
 * 140 列、并行成员从 1 到 5、逐轮 1 到 4,加上**逐个节点展开**的那一遍,全都跑一遍。
 */
test("流程图布局:九条几何不变量在所有宽度 × 并行规模 × 逐节点展开下都成立", () => {
  const widths = [NODE_WIDTH, NODE_WIDTH + GAP_X + 1, 74, 76, 80, 96, 114, 140]
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
  const twoColumns = LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH
  for (const width of [NODE_WIDTH, NODE_WIDTH + GAP_X + 1, twoColumns]) {
    const layout = layoutNodes(MODEL.nodes, width)
    for (const [index, a] of layout.nodes.entries()) {
      for (const b of layout.nodes.slice(index + 1)) {
        expect(rectsOverlap(a.rect, b.rect), `${width} 列:${a.id} 与 ${b.id}`).toBe(false)
        expect(b.rect.x, `${width} 列:${b.id} 超出画布`).toBeLessThan(layout.width)
      }
    }
  }
  // 走廊的账不能算错:视口宽到放得下两列时是**两列**,而再窄一列(放不下一张卡 + 一条走廊)
  // 就掉到单列 —— 中间那一档(44~73 列)仍然是两列,多出来的那截由画布的横向滚动承担。
  const columns = (width: number) => new Set(layoutNodes(MODEL.nodes, width).nodes.map((node) => node.rect.x)).size
  expect(columns(twoColumns)).toBe(2)
  expect(columns(MIN_BAND_VIEWPORT)).toBe(2)
  expect(columns(MIN_BAND_VIEWPORT - 1)).toBe(1)
})

// ---------- 行带容量:内容尺寸的算式 ----------
//
// 这一组把「画布按内容尺寸排布」的算式钉死。用户的原话是「布局宽度是从视口推出来的,
// 而不是从内容推出来的」,而视口在真实会话里**不是终端宽**:侧栏展开时画布盒子只有
// `终端宽 − 侧栏宽 − 4`,80 列终端 + 侧栏只剩 46 列。
test("流程图布局:行带容量至少两列,只有窄到放不下一张卡 + 一条走廊才退化成单列", () => {
  // 门槛就是「一张卡 + 一条走廊」:NODE_WIDTH + GAP_X = 28 + 16 = 44。
  expect(MIN_BAND_VIEWPORT).toBe(NODE_WIDTH + GAP_X)
  expect(MIN_BAND_COLUMNS).toBe(2)
  // 60 列视口:按「装得下」算只有 1 列(LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH = 74 > 60),
  // 但一张卡加一条走廊放得下,所以仍然给两列 —— 多出来那一截靠横向滚动去够,而不是把
  // 并行分支的分叉/收束拉成一条几十行的长蛇。
  expect(bandColumns(60)).toBe(MIN_BAND_COLUMNS)
  expect(bandColumns(MIN_BAND_VIEWPORT)).toBe(MIN_BAND_COLUMNS)
  expect(bandColumns(MIN_BAND_VIEWPORT - 1)).toBe(1)
  expect(bandColumns(20)).toBe(1)
  // 视口够宽时仍然「能放几列放几列」,不被那个下限钉死。
  expect(bandColumns(74)).toBe(2)
  expect(bandColumns(LEFT_MARGIN + 2 * COLUMN_PITCH + NODE_WIDTH)).toBe(3)
  expect(bandColumns(LEFT_MARGIN + 3 * COLUMN_PITCH + NODE_WIDTH)).toBe(4)
  // 装得下几列的下限永远至少 1(视口 1 列都放不下时也不许算出 0 列)。
  expect(bandColumns(1)).toBe(1)
})

test("流程图布局:两列行带的画布宽度 = 左侧留白 + 步距 + 卡宽 + 右侧留白,60 列视口下会超出 14 列", () => {
  const twoColumnWidth = LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH + RIGHT_MARGIN
  expect(twoColumnWidth).toBe(2 + 44 + 28 + 1)
  const narrow = layoutNodes(MODEL.nodes, 60)
  expect(new Set(narrow.nodes.map((node) => node.rect.x)).size).toBe(2)
  expect(narrow.width).toBe(twoColumnWidth)
  // 内容比视口宽 —— 这一截就是画布横向滚动的那一段(超出的量 = 75 − 60 = 15 列)。
  expect(narrow.width - 60).toBe(15)
  // 单列行带:宽度只够一张卡加两侧留白。
  const single = layoutNodes(MODEL.nodes, MIN_BAND_VIEWPORT - 1)
  expect(new Set(single.nodes.map((node) => node.rect.x)).size).toBe(1)
  expect(single.width).toBe(LEFT_MARGIN + NODE_WIDTH + RIGHT_MARGIN)
  // 空画布没有行带,宽度退到「一张卡 + 两侧留白」(canvas 那层还会再取 max(视口, 这个数))。
  const blank = layoutNodes([], 60)
  expect(blank.width).toBe(LEFT_MARGIN + NODE_WIDTH + RIGHT_MARGIN)
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
  expect(blank.width).toBeGreaterThanOrEqual(NODE_WIDTH)
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

test("流程图模型:标题压成一行,超长标题按卡内可用宽度截断", () => {
  const long = buildFlowModel({
    messages: [userMessage("m1"), assistantMessage("m2")],
    parts: {
      m1: [textPart("m1", "t1", "第一行\n第二行")],
      m2: [textPart("m2", "t2", "标".repeat(200))],
    },
  })
  const asked = long.nodes.find((node) => node.kind === "user")!
  expect(asked.title).not.toContain("\n")
  expect(Locale.displayWidth(asked.title)).toBeLessThanOrEqual(NODE_CONTENT_COLUMNS)
  const answered = long.nodes.find((node) => node.kind === "reply")!
  expect(Locale.displayWidth(answered.title)).toBe(NODE_CONTENT_COLUMNS)
  expect(answered.title.endsWith("…")).toBe(true)
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
 *   1. **中线同高**(最常见的一类)就是一条直线,一个折角都没有 —— 原型 n1→n2 也是直的
 *      (`M198,73 C232,73 262,74 292,74`,card-design-v7.html:966);
 *   2. **中线不同高**(收束/分叉)才有一个竖段,而且竖段整条都在固定的走廊列上;
 *   3. 竖段的**方向只由几何决定**(目标更低就往下),与这条边是第几条无关 ——
 *      「按边序轮换」正是被删掉的那件事。
 */
test("流程图连线:同带右向的边是一条走廊走线,竖段固定在走廊列上、方向只由几何决定", () => {
  const straight = routeFor("e:n:msg_1→n:pr_2")
  const source = rectOf("n:msg_1")
  const midY = source.y + Math.floor(source.height / 2)
  // 中线同高:一条直线。折点数为 0,拐弯次数也是 0。
  expect(rowsOf(straight.cells)).toEqual([midY])
  expect(straight.cells.filter((cell) => CORNER_CHARS.has(cell.ch))).toEqual([])
  expect(routeTurns(straight.cells)).toBe(0)
  expect(straight.cells[straight.cells.length - 1]!.ch).toBe("▸")

  // 中线不同高:一个竖段、两个折角、拐两次;竖段整条都在走廊列上。
  const merging = routeFor("e:n:pr_4→n:pr_5")
  const from = LAYOUT.nodes.find((node) => node.id === "n:pr_4")!.rect
  const column = corridorColumn(from)
  const fromMidY = from.y + Math.floor(from.height / 2)
  const toMidY = rectOf("n:pr_5").y + Math.floor(NODE_HEIGHT / 2)
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
  for (const width of [NODE_WIDTH, MIN_BAND_VIEWPORT - 1, 45, 74, 76, 118, 140]) {
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
  // 同带右向:整条都在两卡之间的走廊里,横向正好铺开一条走廊(GAP_X 列)。
  expect(Math.max(...route.cells.map((cell) => cell.x)) - Math.min(...route.cells.map((cell) => cell.x))).toBe(
    GAP_X - 1,
  )
  expect(routeTurns(route.cells)).toBe(0)

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
  expect(target.detailRect.y).toBe(target.rect.y + NODE_HEIGHT)
  expect(target.rect.height).toBe(NODE_HEIGHT)
  // 长高的是**它所在的那条行带**(pr_3 在第 1 轮的第二条行带里)。
  const bandOf = (layout: typeof before, node: (typeof before)["nodes"][number]) =>
    layout.rows.find((row) => row.top === node.rect.y)!
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

test("流程图拖拽:锚点是「列锚 × 行首」的叉积,所以拖过去必然与其它卡对齐", () => {
  const layout = layoutNodes(MODEL.nodes, 76)
  const columns = gridLines(layout.nodes.map((node) => node.rect.x))
  const rows = gridLines(layout.nodes.map((node) => node.rect.y))
  // 每个锚点的 x 都是某一列的列锚,y 都是某张卡的顶边 —— 这两条就是「对齐」的全部含义。
  for (const anchor of layout.anchors) {
    expect(columns, `锚点 x=${anchor.x} 不在列锚上`).toContain(anchor.x)
    expect(rows, `锚点 y=${anchor.y} 不是任何一张卡的顶边`).toContain(anchor.y)
    expect((anchor.x - LEFT_MARGIN) % COLUMN_PITCH).toBe(0)
  }
  // 叉积:列锚 × 行锚,一个不多一个不少。
  expect(layout.anchors.length).toBe(columns.length * rows.length)
  // 行带信息跟着行走:每个锚点都说得出自己属于哪条行带,而且卡整个待在那条行带里。
  for (const anchor of layout.anchors) {
    expect(anchor.y).toBeGreaterThanOrEqual(anchor.bandTop)
    expect(anchor.y + NODE_HEIGHT).toBeLessThanOrEqual(anchor.bandBottom)
    expect(layout.rows.some((row) => row.top === anchor.bandTop && row.top + row.height === anchor.bandBottom)).toBe(
      true,
    )
  }
  // 拖动不改变锚点表 —— 一张卡被拖走之后,它原来的格子仍然是可停靠的(否则再也拖不回去)。
  const dragged = layoutNodes(MODEL.nodes, 76, { overrides: { "n:pr_3": { x: 46, y: 14 } } })
  expect(dragged.anchors).toEqual(layout.anchors)
})

test("流程图拖拽:落点吸附到最近的空锚点,并夹在画布内容范围内", () => {
  const layout = layoutNodes(MODEL.nodes, 76)
  const card = layout.nodes.find((node) => node.id === "n:pr_3")!
  const others = occupiedRects(layout).filter((rect) => !(rect.x === card.rect.x && rect.y === card.rect.y))
  const context = {
    anchors: layout.anchors,
    blocked: others,
    bounds: { width: layout.width, height: layout.height },
    size: { width: NODE_WIDTH, height: NODE_HEIGHT },
  }
  // 落到 (46, 14):x 是列锚(2 → 46,步距 44),y 是行锚,那一格空着。
  expect(snapDrag({ x: 46, y: 14 }, context)).toEqual({ x: 46, y: 14 })
  // 位移不足一步时不动:往右挪一格仍然落在原来的列锚上。
  expect(snapDrag({ x: card.rect.x + 1, y: card.rect.y }, context)).toEqual({ x: 2, y: 7 })
  // 原型那两句 `Math.max(0, Math.min(canvas - card, ox + dx))`:不许拖出画布。
  // 这一档把 blocked 清空,于是判的纯粹是「夹进范围 + 吸到最近锚点」。
  const loose = { ...context, blocked: [] }
  expect(snapDrag({ x: -30, y: -30 }, loose)).toEqual({ x: LEFT_MARGIN, y: 0 })
  const far = snapDrag({ x: 9999, y: 9999 }, loose)!
  expect(far.x).toBeLessThanOrEqual(layout.width - NODE_WIDTH)
  expect(far.y).toBeLessThanOrEqual(layout.height - NODE_HEIGHT)
  // 落点压到别人的卡就退到旁边那个空锚点,而不是叠上去。
  const onTop = snapDrag({ x: 46, y: 7 }, context)
  expect(onTop, "(46,7) 那一格被「编辑文件」占着").not.toEqual({ x: 46, y: 7 })
  expect(layout.anchors.some((anchor) => anchor.x === onTop!.x && anchor.y === onTop!.y)).toBe(true)
  // 四周都被占满时退回**自己原来的位置**(它自己不在 blocked 里):宁可原地不动,也不叠上去。
  const surrounded = snapDrag(
    { x: 46, y: 14 },
    {
      ...context,
      blocked: others.concat([
        { x: 46, y: 7, width: NODE_WIDTH, height: NODE_HEIGHT },
        { x: 46, y: 14, width: NODE_WIDTH, height: NODE_HEIGHT },
        { x: 46, y: 21, width: NODE_WIDTH, height: NODE_HEIGHT },
        { x: 46, y: 28, width: NODE_WIDTH, height: NODE_HEIGHT },
        { x: 46, y: 33, width: NODE_WIDTH, height: NODE_HEIGHT },
      ]),
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
  // 把「工具调用」挪到 (46, 14):同一轮、同一行带的第二列,那一格空着。
  const target = { x: 46, y: 14 }
  const before = layoutNodes(MODEL.nodes, 76)
  const moved = "n:pr_3"
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
  const band = after.rows.find((row) => dragged.rect.y >= row.top && dragged.rect.y < row.top + row.height)!
  expect(dragged.bandTop).toBe(band.top)
  expect(dragged.bandBottom).toBe(band.top + band.height)
  // 走线真的变了:那条卡出发与到达的两条边都换了格子。
  const cellsOf = (layout: typeof after, id: string) =>
    routedEdges(FIXTURE_MODEL, layout)
      .find((item) => item.edge.id === id)!
      .route.cells.map((cell) => `${cell.x}:${cell.y}`)
  expect(cellsOf(after, `e:${moved}→n:pr_5`)).not.toEqual(cellsOf(before, `e:${moved}→n:pr_5`))
  expect(cellsOf(after, `e:n:pr_2→${moved}`)).not.toEqual(cellsOf(before, `e:n:pr_2→${moved}`))
  // 九条不变量对被拖过的图一样成立(不压卡、步长为 1、形状至多拐两次、走廊、标签不压别的边…)。
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
  // 只试**空**锚点:叠在别人身上的落点 snapDrag 根本不会给(见 layout 的 snapDrag)。
  // 扫两档宽度:76 列是主力 fixture 的两列布局,140 列是三列(叉积里的格子更多,组合更密)。
  const problems: string[] = []
  let checks = 0
  for (const width of [76, 140]) {
    const layout = layoutNodes(MODEL.nodes, width)
    const occupied = occupiedRects(layout)
    for (const node of layout.nodes) {
      const others = occupied.filter((rect) => !(rect.x === node.rect.x && rect.y === node.rect.y))
      for (const anchor of layout.anchors) {
        if (anchor.x === node.rect.x && anchor.y === node.rect.y) continue
        const shape = { x: anchor.x, y: anchor.y, width: NODE_WIDTH, height: NODE_HEIGHT }
        if (others.some((rect) => rectsOverlap(shape, rect))) continue
        const overrides = { [node.id]: { x: anchor.x, y: anchor.y } }
        problems.push(
          ...checkFlow(MODEL, width, undefined, overrides).problems.map(
            (p) => `${width} 列 ${node.id}→${anchor.x},${anchor.y}:${p}`,
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
    [76, undefined],
    [76, "n:msg_1"],
    [90, undefined],
    [140, "n:pr_3"],
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
