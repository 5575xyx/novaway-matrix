// 流程图画布测试的共用件:一份 fixture 数据 + 一组几何不变量断言。
//
// 为什么要抽出来:flow-layout.test.ts 与 flow-canvas.test.tsx 原本各抄了一份消息/part 构造器
// 与那份「原型形状」的数据,已经出现了漂移(两边节点数都不一样)。不变量断言更需要集中 ——
// 那五条(无格压卡 / 步长为 1 / 无重复格 / 端点贴边界 / 标签位不压卡 / 矩形不重叠)是**布局的
// 全部安全性证明**,而它们与「画布多宽」「并行分支有几个成员」无关:每多一种组合就手抄一遍,
// 迟早会漏掉一种。这里写成 `flowInvariants`,新组合只需要多一行调用。
import type { AssistantMessage, Message, Part, UserMessage } from "@novaway/sdk-v2-latest/v2"
import { Locale } from "../../src/util/locale"
import { makeLabelPlacer } from "../../src/component/flow/grid"
import {
  buildFlowModel,
  corridorColumn,
  edgeRoute,
  isRightward,
  layoutNodes,
  LABEL_COLUMNS,
  MAX_ROUTE_TURNS,
  NODE_WIDTH,
  routeTurns,
  type FlowLayout,
  type FlowModel,
  type FlowOffset,
  type FlowRect,
} from "../../src/component/flow/layout"

// ---------- 几何谓词 ----------
// 这两个谓词生产代码一处也不用(不重叠靠「坐标由固定步距算出来」这条构造,不是靠事后比较),
// 所以它们住在测试这边而不是 layout.ts。

export function pointInRect(point: { x: number; y: number }, rect: FlowRect) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

export function rectsOverlap(a: FlowRect, b: FlowRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 这一格是否**贴着**某个矩形的外沿(在矩形外一格)。连线端点就该落在这里。 */
export function touchesRect(cell: { x: number; y: number }, rect: FlowRect) {
  if (pointInRect(cell, rect)) return false
  return cell.x >= rect.x - 1 && cell.x <= rect.x + rect.width && cell.y >= rect.y - 1 && cell.y <= rect.y + rect.height
}

/** 画布上被占住的矩形:每张卡片,外加展开节点的详情框。 */
export function occupiedRects(layout: FlowLayout) {
  return layout.nodes.flatMap((node) => (node.detailRect ? [node.rect, node.detailRect] : [node.rect]))
}

/** 一格的位置键。与 layout 的「x:y」写法一致(canvas 的 owner 表也用它)。 */
export function cellKey(cell: { x: number; y: number }) {
  return `${cell.x}:${cell.y}`
}

/** 每条边算出来的走线(带边的序号,canvas 与不变量断言共用同一份)。指向不存在节点的边被丢掉。 */
export function routedEdges(model: FlowModel, layout: FlowLayout) {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  return model.edges.flatMap((edge, index) => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return []
    return [{ index, edge, from, to, route: edgeRoute(from.rect, to.rect, index, from.route) }]
  })
}

/** 每格归谁:同一条边的两段共用一格时算**先画**那条边的(canvas 画的时候也是后画的赢标签)。 */
export function edgeCellOwners(model: FlowModel, layout: FlowLayout) {
  const owners = new Map<string, number>()
  for (const item of routedEdges(model, layout)) {
    for (const cell of item.route.cells) {
      const key = cellKey(cell)
      if (!owners.has(key)) owners.set(key, item.index)
    }
  }
  return owners
}

/**
 * 屏幕上真正会摆出来的那些边标签(带文本、位置、属于哪条边)。
 *
 * 为什么要在这里**重演一遍** canvas 的摆标签过程(canvas 的 grid() 里那段):「标签不许压到别的边」
 * 这条不变量只有把摆标签的结果拿出来才判得了,而判据必须与渲染走同一条路 ——
 * 同一个 makeLabelPlacer、同一份截断规则(LABEL_COLUMNS / 最宽候选段)、同一批候选段。
 */
export function placedLabels(model: FlowModel, layout: FlowLayout) {
  const routed = routedEdges(model, layout)
  const place = makeLabelPlacer(edgeCellOwners(model, layout))
  return routed.flatMap((item) => {
    const room = Math.max(...item.route.labels.map((span) => span.columns))
    const text = Locale.oneLineToWidth(item.edge.label, Math.min(room, LABEL_COLUMNS))
    const label = place(item.route.labels, text, item.index)
    return label ? [{ ...label, owner: item.index, edge: item.edge.id }] : []
  })
}

// ---------- 不变量 ----------

export type FlowInvariantOptions = {
  model: FlowModel
  layout: FlowLayout
  /** 额外钉一条:这一行带里每张卡都必须在画布宽度内。 */
  width?: number
}

/**
 * 跑一遍布局的全部几何不变量,返回**问题清单**(空数组 = 全过)。
 *
 * 返回清单而不是直接 `expect`:这样一条测试可以同时覆盖多组宽度/多组并行规模,
 * 失败时又能一次看到全部问题,而不是只报撞上第一条就停。
 *
 * 覆盖的九条:
 *   1. 任意两张卡片(或两个详情框、或详情框与卡片)矩形不重叠;
 *   2. 每条边的**每一格**都不落在任何矩形内(连线不压卡片);
 *   3. 相邻两格恰好差一格(没有斜线、没有跳格);
 *   4. 一条边里没有重复格(接缝去重失效的信号);
 *   5. 首格贴着源节点、末格贴着目标节点(端点在边界上,不在卡片内部);
 *   6. 每段标签候选占位都不落在任何矩形内;
 *   7. **形状**:每条边至多拐 MAX_ROUTE_TURNS 次 —— 一类边一种形状,不许再出现回头路
 *      (上一版的狗腿是横-竖-横-竖-横,拐 4 次,画出来是一排压扁的弹簧);
 *   8. **走廊**:同带右向的边整条都在两卡之间的走廊里,竖段只落在固定的走廊列上;
 *   9. **标签**:真正摆出来的标签不压在**别的边**的格子上(上一版会,把「本轮完成」印在另一条线上)。
 */
export function flowInvariants({ model, layout, width }: FlowInvariantOptions) {
  const problems: string[] = []
  const occupied = occupiedRects(layout)

  for (const [index, a] of layout.nodes.entries()) {
    for (const b of layout.nodes.slice(index + 1)) {
      if (rectsOverlap(a.rect, b.rect)) problems.push(`卡片重叠:${a.id} 与 ${b.id}`)
      if (a.detailRect && b.detailRect && rectsOverlap(a.detailRect, b.detailRect)) {
        problems.push(`详情框重叠:${a.id} 与 ${b.id}`)
      }
      if (a.detailRect && rectsOverlap(a.detailRect, b.rect)) problems.push(`${a.id} 的详情框压到 ${b.id}`)
      if (b.detailRect && rectsOverlap(a.rect, b.detailRect)) problems.push(`${b.id} 的详情框压到 ${a.id}`)
    }
    if (width !== undefined && a.rect.x + a.rect.width > layout.width) {
      problems.push(`${a.id} 超出画布宽度(${a.rect.x + a.rect.width} > ${layout.width},画布视口 ${width})`)
    }
  }

  for (const { edge, from, to, route } of routedEdges(model, layout)) {
    if (route.cells.length < 2) problems.push(`边太短:${edge.id} 只有 ${route.cells.length} 格`)
    const seen = new Set<string>()
    route.cells.forEach((cell, cellIndex) => {
      const key = cellKey(cell)
      if (seen.has(key)) problems.push(`重复格:${edge.id} 在 ${key}`)
      seen.add(key)
      if (occupied.some((rect) => pointInRect(cell, rect))) problems.push(`压到卡片:${edge.id} 的 ${key}`)
      if (cellIndex === 0) return
      const previous = route.cells[cellIndex - 1]!
      const step = Math.abs(cell.x - previous.x) + Math.abs(cell.y - previous.y)
      if (step !== 1) problems.push(`跳格:${edge.id} 从 (${previous.x},${previous.y}) 到 ${key} 走了 ${step} 格`)
    })
    if (!touchesRect(route.cells[0]!, from.rect)) problems.push(`起点不贴源节点:${edge.id}`)
    if (!touchesRect(route.cells[route.cells.length - 1]!, to.rect)) problems.push(`终点不贴目标节点:${edge.id}`)
    for (const span of route.labels) {
      for (let x = span.x; x < span.x + span.columns; x++) {
        if (occupied.some((rect) => pointInRect({ x, y: span.y }, rect))) {
          problems.push(`标签压到卡片:${edge.id} 的 (${x},${span.y})`)
        }
      }
    }
    // 形状:至多三段直线。两段是直线,三段是一个 S 形,四段就有回头路了。
    const turns = routeTurns(route.cells)
    if (turns > MAX_ROUTE_TURNS) problems.push(`形状太绕:${edge.id} 拐了 ${turns} 次(至多 ${MAX_ROUTE_TURNS} 次)`)
    // 走廊:同带右向的边整条都在两卡之间,竖段只落在固定那一列。
    if (isRightward(from.rect, to.rect)) {
      const column = corridorColumn(from.rect)
      const low = from.rect.x + from.rect.width
      const high = to.rect.x - 1
      if (route.cells.some((cell) => cell.x < low || cell.x > high)) {
        problems.push(`同带右向的边跑出了走廊:${edge.id}`)
      }
      if (!route.cells.some((cell) => cell.x === column)) {
        problems.push(`同带右向的边没走走廊列:${edge.id}(该在第 ${column} 列)`)
      }
      if (route.cells.some((cell) => cell.ch === "│" && cell.x !== column)) {
        problems.push(`竖段跑出了走廊列:${edge.id}`)
      }
    }
  }

  // 边指向不存在的节点(单独一遍,因为 routedEdges 把它们丢掉了)。
  const known = new Set(layout.nodes.map((node) => node.id))
  for (const edge of model.edges) {
    if (known.has(edge.from) && known.has(edge.to)) continue
    problems.push(`边指向不存在的节点:${edge.id}`)
  }

  // 标签:摆出来的那些不许压到别的边的格子上。
  const owners = edgeCellOwners(model, layout)
  for (const label of placedLabels(model, layout)) {
    for (let x = label.x; x < label.x + Locale.displayWidth(label.text); x++) {
      const owner = owners.get(`${x}:${label.y}`)
      if (owner !== undefined && owner !== label.owner) {
        problems.push(`标签压到别的边:${label.edge} 的 (${x},${label.y}) 属于第 ${owner} 条边`)
      }
    }
  }
  return problems
}

/**
 * 一次跑完「建模 → 布局 → 不变量」,返回问题清单。
 *
 * `overrides` 是拖拽留下的落点(见 layout 的 snapDrag):不变量对**被拖过的卡**一样要成立,
 * 所以拖拽那条用例把落点喂进来跑的是同一个检查。
 */
export function checkFlow(
  model: FlowModel,
  canvasWidth: number,
  expandedId?: string,
  overrides?: Record<string, FlowOffset>,
) {
  const layout = layoutNodes(model.nodes, canvasWidth, { expandedId, overrides })
  return { layout, problems: flowInvariants({ model, layout, width: canvasWidth }) }
}

/** 每条边的箭头落在哪一格(去重)。渲染测试拿它和帧里的箭头数对账。 */
export function arrowCells(model: FlowModel, layout: FlowLayout) {
  const cells = new Set<string>()
  for (const { route } of routedEdges(model, layout)) {
    cells.add(cellKey(route.cells[route.cells.length - 1]!))
  }
  return cells
}

/**
 * 帧里**卡片**所在的列(按显示列索引,升序去重)。
 *
 * 判据不能只是「这一格是 `╭`」:连线折角用的是**同一套**圆角(见 layout 的 CORNER_CHARS),
 * 而走廊那条竖段拐弯时正好在目标卡的中线上画出一个 `╰`/`╯`(见 edgeRoute)。所以这里数的是
 * **卡头行**:`│ ● <类型文字>` —— 每张卡只有一行长这样,底部图例那一行前面没有 `│`。
 * 卡头在 `rect.x + 2`(卡内 paddingLeft = 2)。
 */
export function cardColumns(lines: readonly string[]): number[] {
  const columns = new Set<number>()
  for (const line of lines) {
    const cells = lineColumns(line)
    for (let x = 0; x < cells.length; x++) {
      if (cells[x] !== "●") continue
      // 往左跳过空白,落在卡内 padding 与圆角边框之间;找到的 `│` 就是这张卡的左边界。
      let border = x - 1
      while (border >= 0 && cells[border] === " ") border -= 1
      if (border < 0 || cells[border] !== "│") continue
      columns.add(border)
    }
  }
  return [...columns].toSorted((a, b) => a - b)
}

/** 一帧里数得出来的卡片列数。一行里可能并排两张卡,所以每一行都要看。 */
export function distinctCardColumns(lines: readonly string[]) {
  return cardColumns(lines).length
}

/**
 * 帧里**完整可见**的卡片顶边框那一列 —— `╭` + NODE_WIDTH − 2 个 `─` + `╮`。
 *
 * 与 cardColumns 的区别:它要求整条顶边框都在画面内,所以右侧被裁掉的卡不算。用来断言
 * 「卡片本身有没有被裁掉」,数列数请用 cardColumns。
 */
export function cardBorderColumns(lines: readonly string[], width = NODE_WIDTH): number[] {
  const columns = new Set<number>()
  for (const line of lines) {
    const cells = lineColumns(line)
    for (let x = 0; x + width - 1 < cells.length; x++) {
      if (cells[x] !== "╭" || cells[x + width - 1] !== "╮") continue
      if (cells.slice(x + 1, x + width - 1).every((cell) => cell === "─")) columns.add(x)
    }
  }
  return [...columns].toSorted((a, b) => a - b)
}

/**
 * 把一行摊成「按**显示列**索引」的数组。
 *
 * 为什么不能直接 `line[x]`:CJK 与 emoji 在 UTF-16 里是**一个码元**、在终端里是**两列**,
 * 所以码元下标与显示列从第一个汉字起就分岔了。要按列去帧里取值(「那个箭头的位置有没有东西」),
 * 就必须先把行摊成列。
 */
export function lineColumns(line: string) {
  const columns: string[] = []
  for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)) {
    const width = Bun.stringWidth(part.segment)
    columns.push(part.segment)
    // 宽字符占住的第 2..width 列是「延续格」,不属于任何字符 —— 记空串,
    // 这样「那一列上有没有东西」对宽字符的两列都给出同一个答案。
    for (let i = 1; i < width; i++) columns.push("")
  }
  return columns
}

/**
 * 取帧里 (y, x) 那一格的字符。x 是显示列,y 是行下标。越界返回 undefined。
 *
 * 连线层的格子坐标是**画布坐标**(画布从第 0 列、第 0 行开始),而帧的第 0 行被 ThemeReady
 * 哨兵占着,所以画布 y 要 +1 才是帧的行下标。`canvasOffsetY` 就是那个偏移。
 */
export const CANVAS_OFFSET_Y = 1

export function frameCell(lines: readonly string[], y: number, x: number) {
  return lineColumns(lines[y] ?? "")[x]
}

// ---------- fixture ----------

export const CREATED = new Date(2026, 0, 2, 14, 32).getTime()

export function userMessage(id: string, offsetMs = 0): UserMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "user",
    time: { created: CREATED + offsetMs },
    agent: "build",
    model: { providerID: "novaway", modelID: "claude-sonnet-4" },
  }
}

export function assistantMessage(id: string, offsetMs = 0): AssistantMessage {
  return {
    id,
    sessionID: "ses_1",
    role: "assistant",
    time: { created: CREATED + offsetMs, completed: CREATED + offsetMs + 19_000 },
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

export function textPart(messageID: string, id: string, body: string): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "text",
    text: body,
    time: { start: CREATED, end: CREATED + 1_000 },
  }
}

export function reasoningPart(messageID: string, id: string, body: string, ms = 2_400): Part {
  return {
    id,
    sessionID: "ses_1",
    messageID,
    type: "reasoning",
    text: body,
    time: { start: CREATED, end: CREATED + ms },
  }
}

/**
 * 工具 part。`start` 决定它属于哪一批并行:同一条助手消息里**同一毫秒**发起的算同一批
 * (判据见 layout.ts 的 parallelGroups)。
 */
export function toolPart(
  messageID: string,
  id: string,
  tool: string,
  options: { start?: number; ms?: number; title?: string; output?: string; error?: string; description?: string } = {},
): Part {
  const ms = options.ms ?? 3_200
  const start = options.start ?? 0
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

export function runningToolPart(messageID: string, id: string, tool: string): Part {
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

/**
 * 主力 fixture:复刻原型 card-design-v7.html 的形状。
 *
 *   第 1 轮 用户输入 → 任务拆解 → (工具调用 ‖ 子代理 并行) → 编辑文件 → 工具调用 → NovaWay → 本轮结束
 *   第 2 轮 用户输入 → 编辑文件 → NovaWay → 本轮结束
 *
 * 12 个节点、11 条边。并行那一批是**两个**成员(原型 n3/n4);三个成员的那一组由
 * `parallelFixture` 单独造 —— 主力 fixture 要保持能被逐条断言节点顺序与边标签。
 */
export const FIXTURE_MESSAGES: Message[] = [
  userMessage("msg_1", 0),
  assistantMessage("msg_2", 1_000),
  userMessage("msg_3", 30_000),
  assistantMessage("msg_4", 31_000),
]

export const FIXTURE_PARTS: Record<string, Part[]> = {
  msg_1: [textPart("msg_1", "pr_1", "你好,帮我修复失败的测试")],
  msg_2: [
    reasoningPart("msg_2", "pr_2", "测试 → 定位 → 修复 → 复测"),
    toolPart("msg_2", "pr_3", "bash", {
      start: 1_500,
      ms: 3_200,
      title: "bun test --timeout 30000",
      // 详情正文刻意给一段长的:详情框折不折行是渲染测试要盯的东西,
      // 内容只有两个字的话,折行与不折行看起来一模一样,那条断言就废了。
      output:
        "bun test --timeout 30000:18 个用例里 17 个通过,transition.test.ts L42 的 AssertionError 仍在。" +
        "原因是那一条用了固定的 Effect.sleep(50) 等轮询结果,慢机器上 50ms 不够。",
    }),
    toolPart("msg_2", "pr_4", "task", {
      start: 1_500,
      ms: 8_400,
      title: "Explorer · 分析失败原因",
      description: "分析失败原因",
      output:
        "读了 test/AGENTS.md 与 36 个测试文件。定位到 transition.test.ts L42:" +
        "断言轮询结果的等待写成了固定 sleep,机器一慢就抢跑。输出修复建议 2 条。",
    }),
    toolPart("msg_2", "pr_5", "edit", { start: 12_000, ms: 400, title: "修 transition.test.ts L42", output: "+1 −1" }),
    toolPart("msg_2", "pr_6", "bash", {
      start: 14_000,
      ms: 3_100,
      title: "复测 bun test",
      output: "✓ 18 passed",
    }),
    textPart("msg_2", "pr_7", "已修复:改用 pollWithTimeout"),
  ],
  msg_3: [textPart("msg_3", "pr_8", "再把侧栏动画也优化一下")],
  msg_4: [
    toolPart("msg_4", "pr_9", "edit", { start: 32_000, ms: 800, title: "edit · sidebar.tsx", output: "+3 −2" }),
    textPart("msg_4", "pr_10", "侧栏动画已统一为 expo-out"),
  ],
}

export const FIXTURE_MODEL = buildFlowModel({ messages: FIXTURE_MESSAGES, parts: FIXTURE_PARTS })

/**
 * 一个 `members` 成员的单轮会话:用户输入 → 任务拆解 → (members 个工具同时发起) → NovaWay → 本轮结束。
 *
 * 存在的理由:并行分支的每一格在布局里是**同列上下叠放**的,而叠放只有在行带放得下时才成立。
 * 三成员意味着某一列要 3 格(4 + 3 + 4 + 3 + 4 = 18 行),那一条列会把整条行带撑到 18 行 ——
 * 于是别的列里的换行边必须在这 18 行里找到一条**不压卡片**的通道行。这条路径只在
 * 「成员数 ≥ 3」或「perRow = 1」时才走到,单靠主力 fixture(两成员、perRow = 2)永远碰不到。
 */
export function parallelFixture(members: number) {
  const messages: Message[] = [userMessage("u1"), assistantMessage("a1")]
  const parts: Record<string, Part[]> = { u1: [textPart("u1", "p_u1", "一起跑这几件事")] }
  const batch = Array.from({ length: members }, (_, index) =>
    toolPart("a1", `p_t${index}`, index === members - 1 ? "task" : "bash", {
      // 同一毫秒 ⇒ 同一批并行(判据见 layout.ts 的 parallelGroups)
      start: 1_500,
      ms: 1_000 + index,
      title: `并行工具 ${index + 1}`,
    }),
  )
  parts.a1 = [reasoningPart("a1", "p_r", "先想清楚"), ...batch, textPart("a1", "p_x", "都跑完了")]
  return buildFlowModel({ messages, parts })
}

/** n 轮普通会话(每轮:用户输入 → 一个工具 → 一条回复)。给「边数很多」的场景用。 */
export function manyRoundsFixture(rounds: number) {
  const messages: Message[] = []
  const parts: Record<string, Part[]> = {}
  for (let round = 1; round <= rounds; round++) {
    const user = `u${round}`
    const agent = `a${round}`
    messages.push(userMessage(user, round * 1_000), assistantMessage(agent, round * 1_000 + 100))
    parts[user] = [textPart(user, `${user}_t`, `第 ${round} 轮的问题`)]
    parts[agent] = [
      toolPart(agent, `${agent}_tool`, "bash", { start: round * 1_000 + 200, title: `第 ${round} 轮的工具` }),
      textPart(agent, `${agent}_x`, `第 ${round} 轮的回答`),
    ]
  }
  return buildFlowModel({ messages, parts })
}
