// D3 流程图画布的**纯函数**部分:会话数据 → 节点/边模型 → 网格布局 → 直角折线路由。
//
// 这里刻意不碰渲染:画布最麻烦的三件事(哪些节点、节点摆哪、连线怎么走且不压到卡片)
// 都能脱离终端算清楚,它们一旦错了,画出来就是「线穿过卡片」或者「两节点叠在一起」。
// canvas.tsx 只负责把这些结果摆到屏幕上。
import { expect, test } from "bun:test"
import type { AssistantMessage, Message, Part, UserMessage } from "@novaway/sdk-v2-latest/v2"
import {
  buildFlowModel,
  edgeRoute,
  layoutNodes,
  pointInRect,
  rectsOverlap,
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

// ---------- 最小构造数据 ----------
// 只填类型要求的必填字段。这个会话刻意复刻原型 card-design-v7.html 的形状:
// 第 1 轮 = 用户输入 → 任务拆解 → (工具调用 ‖ 子代理 并行) → 编辑文件 → 工具调用 → NovaWay → 本轮结束;
// 第 2 轮 = 用户输入 → 编辑文件 → NovaWay → 本轮结束。
const CREATED = new Date(2026, 0, 2, 14, 32).getTime()

function user(id: string, offsetMs = 0, text = `用户文本 ${id}`): UserMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: CREATED + offsetMs },
    agent: "build",
    model: { providerID: "novaway", modelID: "claude-sonnet-4" },
  }
}

function assistant(id: string, offsetMs = 0): AssistantMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: CREATED + offsetMs, completed: CREATED + offsetMs + 9_000 },
    parentID: "msg_root",
    modelID: "claude-sonnet-4",
    providerID: "novaway",
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost: 0,
    tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
  }
}

function textPart(messageID: string, id: string, text: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "text",
    text,
    time: { start: CREATED, end: CREATED + 1_000 },
  }
}

function reasoningPart(messageID: string, id: string, text: string, ms = 2_400): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "reasoning",
    text,
    time: { start: CREATED, end: CREATED + ms },
  }
}

function toolPart(
  messageID: string,
  id: string,
  tool: string,
  options: { title?: string; output?: string; error?: string; ms?: number; start?: number; description?: string } = {},
): Part {
  const ms = options.ms ?? 3_200
  const start = options.start ?? CREATED
  const base = {
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool" as const,
    callID: `call_${id}`,
    tool,
  }
  if (options.error !== undefined) {
    return { ...base, state: { status: "error", input: {}, error: options.error, time: { start, end: start + ms } } }
  }
  return {
    ...base,
    state: {
      status: "completed",
      input: options.description === undefined ? {} : { description: options.description },
      output: options.output ?? "输出",
      title: options.title ?? tool,
      metadata: {},
      time: { start, end: start + ms },
    },
  }
}

function runningToolPart(messageID: string, id: string, tool: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "tool",
    callID: `call_${id}`,
    tool,
    state: { status: "running", input: {}, time: { start: CREATED } },
  }
}

// 原型的形状,按时间顺序铺开。
const MESSAGES: Message[] = [
  user("msg_1", 0, "你好,帮我修复失败的测试"),
  assistant("msg_2", 1_000),
  user("msg_3", 10_000, "再把侧栏动画也优化一下"),
  assistant("msg_4", 11_000),
]

const PARTS: Record<string, Part[]> = {
  msg_1: [textPart("msg_1", "pr_1", "你好,帮我修复失败的测试")],
  msg_2: [
    reasoningPart("msg_2", "pr_2", "测试 → 定位 → 修复 → 复测", 2_400),
    // 同一毫秒发起的那一批才是并行(见 layout.ts 的 parallelGroups):
    // pr_3/pr_4 是一批并发,pr_5、pr_6 是等前一批回来之后才发起的。
    toolPart("msg_2", "pr_3", "bash", { title: "bun test --timeout 30000", ms: 3_200, start: CREATED + 1_500 }),
    toolPart("msg_2", "pr_4", "task", {
      title: "Explorer · 分析失败原因",
      description: "分析失败原因",
      ms: 8_400,
      start: CREATED + 1_500,
    }),
    toolPart("msg_2", "pr_5", "edit", { title: "修 transition.test.ts L42", ms: 400, start: CREATED + 9_000 }),
    toolPart("msg_2", "pr_6", "bash", {
      title: "复测 bun test",
      output: "✓ 18 passed",
      ms: 3_100,
      start: CREATED + 10_000,
    }),
    textPart("msg_2", "pr_7", "已修复:改用 pollWithTimeout"),
  ],
  msg_3: [textPart("msg_3", "pr_8", "再把侧栏动画也优化一下")],
  msg_4: [
    toolPart("msg_4", "pr_9", "edit", { title: "edit · sidebar.tsx", ms: 800, start: CREATED + 11_500 }),
    textPart("msg_4", "pr_10", "侧栏动画已统一为 expo-out"),
  ],
}

const MODEL = buildFlowModel({ messages: MESSAGES, parts: PARTS })
const LAYOUT = layoutNodes(MODEL.nodes, 76)

function rectOf(id: string): FlowRect {
  const found = LAYOUT.nodes.find((node) => node.id === id)
  if (!found) throw new Error(`布局里没有节点 ${id}`)
  return found.rect
}

// ---------- 几何不变量 ----------

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
      messages: [user("m1"), assistant("m2")],
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
  const orphan = buildFlowModel({ messages: [assistant("m2")], parts: { m2: [textPart("m2", "t", "hi")] } })
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
    messages: [user("m1"), assistant("m2")],
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
    messages: [user("m1"), assistant("m2")],
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
    messages: [user("m1"), assistant("m2"), assistant("m3")],
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

const OCCUPIED: FlowRect[] = LAYOUT.nodes.flatMap((node) =>
  node.detailRect ? [node.rect, node.detailRect] : [node.rect],
)

function touches(cell: { x: number; y: number }, rect: FlowRect) {
  if (pointInRect(cell, rect)) return false
  const left = rect.x - 1
  const right = rect.x + rect.width
  const top = rect.y - 1
  const bottom = rect.y + rect.height
  return cell.x >= left && cell.x <= right && cell.y >= top && cell.y <= bottom
}

test("流程图连线:每条边都从源节点边界出发、落在目标节点边界上,而不是插进卡片里", () => {
  for (const edge of MODEL.edges) {
    const route = routeFor(edge.id)
    const from = rectOf(edge.from)
    const to = rectOf(edge.to)
    const head = route.cells[0]!
    const tail = route.cells[route.cells.length - 1]!
    expect(touches(head, from), `${edge.id} 的起点不贴着源节点`).toBe(true)
    expect(touches(tail, to), `${edge.id} 的终点不贴着目标节点`).toBe(true)
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
