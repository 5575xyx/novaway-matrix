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
  buildFlowModel,
  edgeRoute,
  layoutNodes,
  COLUMN_PITCH,
  GAP_X,
  GAP_Y,
  LEFT_MARGIN,
  NODE_CONTENT_COLUMNS,
  NODE_HEIGHT,
  NODE_WIDTH,
  SEPARATOR_ROWS,
  type FlowNode,
  type FlowRect,
} from "../../src/component/flow/layout"
import { Locale } from "../../src/util/locale"
import {
  assistantMessage,
  reasoningPart,
  checkFlow,
  CREATED,
  FIXTURE_MODEL,
  FIXTURE_MESSAGES,
  FIXTURE_PARTS,
  manyRoundsFixture,
  occupiedRects,
  parallelFixture,
  pointInRect,
  rectsOverlap,
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
// 六条不变量(无格压卡 / 步长为 1 / 无重复格 / 端点贴边界 / 标签位不压卡 / 矩形不重叠)
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
 * 全部六条不变量在**一整片组合**上都成立。
 *
 * 这一条是 LEFT_MARGIN 与 GAP_Y 那几段注释的兑现处。并行分支在布局里是同列上下叠放的,
 * 所以「叠放能不能成立」完全取决于列与行带的尺寸组合 —— 而组合数是列数(perRow)× 成员数 ×
 * 行带内最大叠放深度 的乘积,手写断言只可能覆盖其中两三种。这里把宽度从 28 列一路扫到
 * 140 列、并行成员从 1 到 5、逐轮 1 到 4,加上**逐个节点展开**的那一遍,全都跑一遍。
 */
test("流程图布局:六条几何不变量在所有宽度 × 并行规模 × 逐节点展开下都成立", () => {
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
  // 走廊的账不能算错:差一列就该从并排两列掉到单列,而不是白白浪费一列。
  const columns = (width: number) => new Set(layoutNodes(MODEL.nodes, width).nodes.map((node) => node.rect.x)).size
  expect(columns(twoColumns)).toBe(2)
  expect(columns(twoColumns - 1)).toBe(1)
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
  return edgeRoute(rectOf(MODEL.edges[index]!.from), rectOf(MODEL.edges[index]!.to), index)
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

test("流程图连线:终点是箭头字符,拐角用制表符而不是直角", () => {
  const route = routeFor("e:n:msg_1→n:pr_2")
  expect(route.cells[route.cells.length - 1]!.ch).toBe("▸")
  // 拐角要么没有(直线),要么是这八个制表符之一 —— 不能拿 ─/│ 冒充拐角。
  for (const ch of route.cells.map((cell) => cell.ch)) {
    expect("─│┌┐└┘├┤┬┴┼▸▼".includes(ch), `未知连线字符 ${ch}`).toBe(true)
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
})

test("流程图连线:同一轮的相邻节点走直线,换行的边走出直角折线", () => {
  const sameRow = MODEL.edges.find((edge) => {
    const a = rectOf(edge.from)
    const b = rectOf(edge.to)
    return a.y === b.y && b.x > a.x + a.width
  })
  if (!sameRow) throw new Error("这一版布局里没有同一行的相邻节点")
  const route = routeFor(sameRow.id)
  expect(route.cells.every((cell) => cell.y === route.cells[0]!.y)).toBe(true)
  expect(route.cells.every((cell) => cell.ch === "─" || cell.ch === "▸")).toBe(true)

  // 换行边(第 1 轮结束 → 第 2 轮的用户输入)必须拐两次弯。
  const wrap = routeFor("e:n:fend:1→n:msg_3")
  const shapes = new Set(wrap.cells.map((cell) => cell.ch))
  expect(shapes.has("│")).toBe(true)
  expect(shapes.has("─")).toBe(true)
  expect(wrap.cells[wrap.cells.length - 1]!.ch).toBe("▼")
})

test("流程图连线:走廊宽度够放下原型那几个标签(否则标签全是省略号)", () => {
  // 两卡之间真正空着 GAP_X − 1 格,最后一格是箭头,标签最多占 GAP_X − 2 格。
  // 原型最长的并行标签是「并行 · 子代理」= 4 + 3 + 6 = 13 列。
  expect(Locale.displayWidth("并行 · 子代理")).toBeLessThanOrEqual(GAP_X - 2)
  expect(Locale.displayWidth("并行 · 工具")).toBeLessThanOrEqual(GAP_X - 2)
  expect(GAP_Y).toBeGreaterThanOrEqual(2)
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
  const grown =
    bandOf(expanded, target).height -
    bandOf(
      before,
      before.nodes.find((n) => n.id === "n:pr_3")!,
    ).height
  expect(grown).toBe(5)
  // 别的行带一点没动 —— 展开一张卡不该牵动整张画布的列位。
  expect(expanded.width).toBe(before.width)
  expect(expanded.rows).toHaveLength(before.rows.length)
  const lastBefore = before.nodes.at(-1)!
  const lastAfter = expanded.nodes.at(-1)!
  expect(lastAfter.rect.y - lastBefore.rect.y).toBe(5)
})
