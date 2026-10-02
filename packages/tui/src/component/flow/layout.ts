import type { Message, Part, ToolPart } from "@novaway/sdk-v2-latest/v2"
import { Locale } from "../../util/locale"

/**
 * 流程图画布的**纯函数**部分(原型 card-design-v7.html 的 `.fcanvas`)。
 *
 * 画布最要紧的三件事都能脱离终端算清楚:
 *   1. 会话数据里哪些东西算节点、哪些算边(会话可能往返多次,原型只有一次);
 *   2. 节点摆在网格的哪一格;
 *   3. 连线怎么走 —— 而且**不压到任何一张卡上**。
 * 这三件事一旦错了,画出来就是「线穿过卡片」或者「两张卡叠在一起」,而且很难一眼看出
 * 是哪一步错了。所以它们住在没有 JSX、没有 context、没有渲染器的 layout.ts 里,
 * 由 test/component/flow-layout.test.ts 逐条钉住;canvas.tsx 只负责把结果摆到屏幕上。
 */

/** 原型 `.fcard[data-kind]` 的七种语义。 */
export type FlowNodeKind = "user" | "plan" | "tool" | "subagent" | "edit" | "reply" | "fend"

/** 节点的语义状态。只有工具类节点有 —— 边标签要靠它说「这一步成了还是炸了」。 */
export type FlowNodeStatus = "completed" | "error" | "running"

export type FlowNode = {
  id: string
  kind: FlowNodeKind
  /** 卡内首行的类型文字(原型的 `.fc-kind`)。 */
  kindLabel: string
  /** 卡内首行右侧的 meta:时长 / 步数 / 时间。 */
  meta: string
  /** 卡内次行的标题。已压成一行并按卡内可用列数截断。 */
  title: string
  /** 展开后的详情正文(原型的 `.fc-pop`)。 */
  detail: string
  /** 第几轮,从 1 起。 */
  round: number
  /**
   * 列组号。同一列里上下叠放的节点共享一个号(原型的并行分支 n3/n4),
   * 其余节点各自一个。布局与连线都靠它分组,不引入第二套「哪些算并行」的判断。
   */
  group: number
  status?: FlowNodeStatus
  time?: number
}

export type FlowEdge = {
  id: string
  from: string
  to: string
  /** 线上标签(原型的 `.flabel`)。 */
  label: string
  /** 从上一节点分叉进一个并行组的那条边。 */
  parallel: boolean
}

export type FlowModel = {
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** 轮次数。空会话是 0。 */
  rounds: number
}

export type FlowRect = { x: number; y: number; width: number; height: number }

export type PlacedNode = FlowNode & {
  rect: FlowRect
  /**
   * 详情框的矩形。只在选中展开时存在,挂在卡片正下方、行带之内。
   * 叫 detailRect 而不是 detail:FlowNode.detail 已经是详情**正文**了,同名会撞成
   * `string & FlowRect` 这种交集类型。
   */
  detailRect?: FlowRect
  /** 本节点是所在列里的第几格(并行分支从上往下数)。 */
  slot: number
}

export type FlowRow = { round: number; top: number; height: number }

export type FlowLayout = {
  nodes: PlacedNode[]
  /** 画布用掉的总宽(不小于一张卡)。 */
  width: number
  /** 画布总高。 */
  height: number
  /** 轮次分隔线,画在 `y` 那一行。第 1 轮是起点,没有分隔线。 */
  separators: { round: number; y: number }[]
  /** 行带(每一条就是一行卡片)。 */
  rows: FlowRow[]
}

// ---------- 尺寸 ----------

/**
 * 节点卡宽度(列)。28 的来历:卡内可用列数 = 卡宽 − AssistantCard 的 padding(左 2 + 右 1)= 25,
 * 够放下「● 工具调用」+ 时长 + `▸`。
 */
export const NODE_WIDTH = 28
/**
 * 节点卡高度(行)。**4**,不是 6。
 *
 * NeonBox 把边框画在自己第 0 行与最后一行,而 AssistantCard 的 paddingTop/paddingBottom 各是 1 ——
 * 也就是说**内边距行就是边框行**,padding 不额外占行(见 ui/card 的类注释与
 * test/routes/session/assistant-card.test.tsx 的宽度那条断言,列方向同理)。所以一张
 * 「类型行 + 标题行」的卡是 边框 + 2 行正文 + 边框 = 4 行。
 *
 * 这个数一旦写大,连线的中线(fromMidY = y + ⌊h/2⌋)就会落到卡片的底边框那一行 ——
 * 画出来是每条线都贴着卡片下沿横穿过去。所以它不是估的,flow-canvas.test.tsx 里量了
 * 真实帧里的卡片高度并与它对齐。
 */
export const NODE_HEIGHT = 4
/**
 * 相邻列之间的走廊宽度(列)。16 是照着标签反推的:两卡之间真正空着的是 GAP_X − 1 = 15 格,
 * 其中最后一格放箭头,标签最多占 14 格,而原型里最长的并行标签「并行 · 子代理」是 13 列
 * (并行 4 + 空格·空格 3 + 子代理 6)。
 */
export const GAP_X = 16
/**
 * 行带之间的通道高度(行)。3 = 两条车道(换行边各占一条)+ 1 行余量。
 * 必须是 3 而不是 2:换行边的横向段要落在**两行带之间**,占掉一整行通道;通道只有 1 行时,
 * 所有换行边只能挤在同一条线上,连线会糊成一片。
 */
export const GAP_Y = 3
/**
 * 画布左侧留出的空列(列)。**每一列的左边都必须有一条走廊**,否则换行边无处可去:
 * 一条边从上一行带的末尾绕回下一行带的行首时,横段之后要竖着落进目标卡的顶边,
 * 而那一竖必须走在**目标卡自己那一列的左边**。少了它,并行分支的第二张卡(叠在第一张下面)
 * 就会被上面那张卡挡住 —— 竖段直接穿卡而过。3 列宽给换行边分了三条车道。
 */
export const LEFT_MARGIN = 3
/** 列的步距:卡宽 + 走廊。 */
export const COLUMN_PITCH = NODE_WIDTH + GAP_X
/** 轮次分隔线占的行数:`─` 一行 + 标签同在这行。 */
export const SEPARATOR_ROWS = 2
/** 展开的详情框默认占几行。 */
export const DETAIL_ROWS = 6
/** 卡内可用列数(类型行与标题行共用)。推导见 NODE_WIDTH。 */
export const NODE_CONTENT_COLUMNS = NODE_WIDTH - 3

/** 详情正文的上限。再长对画布没有意义,只会让详情框出现「…」还是「…」的差别。 */
const DETAIL_MAX = 600

/** 写文件一类的工具。它们在画布上是琥珀色的「编辑文件」节点,不是青色的「工具调用」。 */
const EDIT_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch", "patch"])

function toolKind(tool: string): FlowNodeKind {
  if (tool === "task") return "subagent"
  if (EDIT_TOOLS.has(tool)) return "edit"
  return "tool"
}

/** 节点首行显示的类型文字(原型的 `.fc-kind`)。图例也用它,免得两处各写一份说法。 */
export function kindLabel(kind: FlowNodeKind) {
  if (kind === "user") return "用户输入"
  if (kind === "plan") return "任务拆解"
  if (kind === "subagent") return "子代理"
  if (kind === "edit") return "编辑文件"
  if (kind === "reply") return "NovaWay"
  if (kind === "fend") return "本轮结束"
  return "工具调用"
}

/** 工具节点这一类在**并行标签**里的短名。kindLabel 是「工具调用」,拼进「并行 · 」就 15 列了。 */
function parallelNoun(kind: FlowNodeKind) {
  return kindNoun(kind)
}

/**
 * 节点语义在**短**语境下的名字。图例与并行标签用它。
 *
 * 为什么要另有一个短名:节点首行写全称(`工具调用`、`本轮结束`)是因为那里有 25 列可用;
 * 而底部图例一行要并排放七个,全称加起来 82 列 —— 80 列的终端上最后一项直接被挤出屏幕。
 * 短名加起来 60 列,窄终端也放得下,而图例本来只需要说清「哪个颜色是哪一类」。
 */
export function kindNoun(kind: FlowNodeKind) {
  if (kind === "user") return "输入"
  if (kind === "plan") return "拆解"
  if (kind === "edit") return "编辑"
  if (kind === "reply") return "回复"
  if (kind === "fend") return "结束"
  if (kind === "subagent") return "子代理"
  return "工具"
}

/** 状态优先:失败与进行中必须如实说,不能被 kind 的「成功措辞」盖过去。 */
function outcomeLabel(node: FlowNode) {
  if (node.status === "error") return "✗ 失败"
  if (node.status === "running") return "进行中"
  if (node.kind === "user") return "用户请求"
  if (node.kind === "plan") return "拆解完成"
  if (node.kind === "subagent") return "子代理完成"
  if (node.kind === "edit") return "已编辑"
  if (node.kind === "reply") return "本轮完成"
  if (node.kind === "fend") return "新消息"
  return "✓ 完成"
}

/** 工具节点的头条标题。state.title 由后端填好(如 `Edit src/foo.ts`);拿不到就退回工具名。 */
function toolTitle(part: ToolPart) {
  const title = "title" in part.state ? part.state.title : undefined
  if (title) return title
  const description = part.state.input.description
  if (typeof description === "string" && description) return description
  const filePath = part.state.input.filePath
  if (typeof filePath === "string" && filePath) return `${part.tool} · ${filePath}`
  return part.tool
}

function toolStatus(part: ToolPart): FlowNodeStatus {
  if (part.state.status === "error") return "error"
  if (part.state.status === "pending" || part.state.status === "running") return "running"
  return "completed"
}

/** 工具节点的详情:输出或错误体。 */
function toolDetail(part: ToolPart) {
  if (part.state.status === "error") return part.state.error
  if (part.state.status === "completed") return part.state.output
  return "正在执行…"
}

/** 只有跑完的工具状态带 time.end;pending 连 time 都没有,running 只有 start。 */
function toolDuration(part: ToolPart) {
  const state = part.state
  if (state.status !== "completed" && state.status !== "error") return undefined
  return Math.max(0, state.time.end - state.time.start)
}

/**
 * 并行批次的判据:同一条助手消息里**连续**的工具 part,`state.time.start` 相同就算同一批。
 *
 * 为什么是「同一毫秒」而不是「同一消息」:一条消息里的工具本来就是一批并发派发的,
 * 但它们也会**先后**发起(等前一批回来再发下一批)。全算并行的话,原型里 n3/n4 之后的
 * n5(编辑文件)与 n6(复测)也会被塞进同一个并行组,画布就只剩一条分支,原型的「工具 → 编辑 →
 * 复测」这条链看不出来了。
 *
 * 为什么不按「时间挨得近」去猜:批与批之间的间隔由模型决定,可以短到几毫秒,任何阈值都会
 * 在某次会话上把两个批次粘成一个。这里只认同毫秒,不猜 —— 猜错的后果是画布退化(工具排成
 * 一条链),而退化出来的图仍然是**对的**。
 */
function parallelGroups(parts: readonly Part[]): ToolPart[][] {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool")
  const groups: ToolPart[][] = []
  for (const tool of tools) {
    const start = "time" in tool.state ? tool.state.time.start : undefined
    const current = groups[groups.length - 1]
    const head = current?.[0]
    if (current && head && start !== undefined && "time" in head.state && head.state.time.start === start) {
      current.push(tool)
      continue
    }
    groups.push([tool])
  }
  return groups
}

/**
 * 会话数据 → 节点与边。
 *
 * 节点映射(原型那七种语义):
 *   用户消息            → 用户输入
 *   助手 reasoning part → 任务拆解(同一消息里的多段并成一个节点)
 *   `task` 工具         → 子代理
 *   write/edit/… 工具    → 编辑文件
 *   其余工具            → 工具调用
 *   助手 text part      → NovaWay(同一消息里的多段并成一个节点)
 *   每轮的最后一个节点之后 → 本轮结束
 *
 * 轮次:以**用户消息**为界(每条用户消息开新一轮),对应原型的 `第 N 轮` 分隔线。
 *
 * 边:相邻两个**列组**之间做笛卡尔积。列组就是「同一列里上下叠放的那几个节点」——
 * 并行分支天然落在同一列,所以并行批次天然构成一个列组,不需要额外的判断。
 */
export function buildFlowModel(input: {
  messages: readonly Message[]
  parts: { readonly [messageID: string]: readonly Part[] | undefined }
}): FlowModel {
  const nodes: FlowNode[] = []
  const groups: FlowNode[][] = []
  let round = 0
  let group = 0

  const push = (node: FlowNode) => {
    nodes.push(node)
    return node
  }
  const pushColumn = (column: FlowNode[]) => {
    if (column.length === 0) return
    groups.push(column)
  }

  // 「本轮结束」是**每轮一个**,不是每条助手消息一个:一轮里模型可能来回好几轮工具调用,
  // 中间没有用户输入就不算又一轮。它自己独占一列(它是终点,不会再分叉出并行分支)。
  const flushRound = () => {
    if (round === 0) return
    const last = groups[groups.length - 1]?.[0]
    if (last?.kind === "fend") return
    pushColumn([
      push({
        id: `n:fend:${round}`,
        kind: "fend",
        kindLabel: kindLabel("fend"),
        meta: `第 ${round} 轮`,
        title: "等待新指令…",
        detail: `第 ${round} 轮已结束。这一轮里的用户输入、工具调用与回复都在上面,切回气泡视图可以看完整正文。`,
        round,
        group: group++,
        status: "completed",
        time: last?.time,
      }),
    ])
  }

  for (const message of input.messages) {
    if (message.role === "user") {
      flushRound()
      round += 1
      const text = (input.parts[message.id] ?? [])
        .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      pushColumn([
        push({
          id: `n:${message.id}`,
          kind: "user",
          kindLabel: kindLabel("user"),
          meta: Locale.time(message.time.created),
          title: Locale.oneLineToWidth(text, NODE_CONTENT_COLUMNS),
          detail: text || "（这条消息没有正文）",
          round,
          group: group++,
          time: message.time.created,
        }),
      ])
      continue
    }

    // 历史上没有用户消息就开头的会话(导入的、被裁剪过的):也算第 1 轮,
    // 否则节点会带着 round = 0,分隔线与轮次带全都不对。
    if (round === 0) round = 1

    const parts = input.parts[message.id] ?? []
    const reasoning = parts.filter((part): part is Extract<Part, { type: "reasoning" }> => part.type === "reasoning")
    if (reasoning.length > 0) {
      const body = reasoning.map((part) => part.text).join("\n")
      const span = Math.max(...reasoning.map((part) => part.time.end ?? part.time.start)) - reasoning[0]!.time.start
      pushColumn([
        push({
          id: `n:${reasoning[0]!.id}`,
          kind: "plan",
          kindLabel: kindLabel("plan"),
          meta: Locale.duration(Math.max(0, span)),
          title: Locale.oneLineToWidth(body, NODE_CONTENT_COLUMNS),
          detail: body,
          round,
          group: group++,
          status: "completed",
          time: message.time.created,
        }),
      ])
    }

    for (const batch of parallelGroups(parts)) {
      const column: FlowNode[] = []
      const batchGroup = group++
      for (const part of batch) {
        const kind = toolKind(part.tool)
        const duration = toolDuration(part)
        column.push(
          push({
            id: `n:${part.id}`,
            kind,
            kindLabel: kindLabel(kind),
            meta: duration === undefined ? "…" : Locale.duration(duration),
            title: Locale.oneLineToWidth(toolTitle(part), NODE_CONTENT_COLUMNS),
            detail: toolDetail(part),
            round,
            group: batchGroup,
            status: toolStatus(part),
            time: "time" in part.state ? part.state.time.start : undefined,
          }),
        )
      }
      pushColumn(column)
    }

    const text = parts
      .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text" && !part.synthetic)
      .map((part) => part.text)
      .join("\n\n")
    if (text.trim()) {
      pushColumn([
        push({
          id: `n:${parts.find((part) => part.type === "text" && !part.synthetic)?.id ?? message.id}`,
          kind: "reply",
          kindLabel: kindLabel("reply"),
          meta: Locale.time(message.time.created),
          title: Locale.oneLineToWidth(text, NODE_CONTENT_COLUMNS),
          detail: text,
          round,
          group: group++,
          status: message.time.completed ? "completed" : "running",
          time: message.time.created,
        }),
      ])
    }
  }
  flushRound()

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges: FlowEdge[] = []
  for (const [index, column] of groups.entries()) {
    for (const previous of groups[index - 1] ?? []) {
      for (const next of column) {
        const isParallel = column.length > 1
        edges.push({
          id: `e:${previous.id}→${next.id}`,
          from: previous.id,
          to: next.id,
          // 分叉边说「这是并行的哪一种」;其余边说「上一节点做了什么」(原型
          // n3→n5「测试报告 12 ✓」与 n4→n5「诊断建议」各说各的)。
          label: isParallel ? `并行 · ${parallelNoun(next.kind)}` : outcomeLabel(previous),
          parallel: isParallel,
        })
      }
    }
  }
  // byId 只用来保证边指向的节点都真实存在(模型自检,顺带避免未使用的变量)。
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) throw new Error(`边 ${edge.id} 指向了不存在的节点`)
  }

  return { nodes, edges, rounds: round }
}

// ---------- 布局 ----------

export function pointInRect(point: { x: number; y: number }, rect: FlowRect) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
}

export function rectsOverlap(a: FlowRect, b: FlowRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * 网格布局:一轮一行带(放不下就换行带),轮与轮之间插一条分隔线。
 *
 * 不重叠不是靠「算完再检查」,而是靠构造:列的 x 是列号乘以固定步距,列内节点按 slot
 * 乘以固定步距,行带的高度取本带里最高的列。所以任何两组坐标都不会撞上 ——
 * `rectsOverlap` 那条断言只是把这条不变量钉住,防的是有人后来把步距改成随内容变化。
 *
 * `expandedId` 让那一张卡的行带长高 DETAIL_ROWS,详情框正好落在长出来的那一块里 ——
 * 于是详情既贴着卡片,又不会压到下一行带(而整行带下移,后面的节点跟着让位)。
 */
export function layoutNodes(
  nodes: readonly FlowNode[],
  canvasWidth: number,
  options: { expandedId?: string; detailRows?: number } = {},
): FlowLayout {
  const detailRows = options.detailRows ?? DETAIL_ROWS
  // 一行带能放几列。步距是卡宽 + 走廊,再扣掉左侧那条留出来的走廊:
  // 每多一列要多 COLUMN_PITCH 列,而最后一列右边没有走廊,左边有 LEFT_MARGIN 列。
  const perRow = Math.max(1, Math.floor((canvasWidth + GAP_X - LEFT_MARGIN) / COLUMN_PITCH))
  const placed: PlacedNode[] = []
  const rows: FlowRow[] = []
  const separators: { round: number; y: number }[] = []

  // 按轮次把列切段。节点数组本身已经按轮次顺序排好,这里只需要在轮次变化处断开。
  const columns: FlowNode[][] = []
  for (const node of nodes) {
    const current = columns[columns.length - 1]
    if (current && current[0]!.group === node.group) current.push(node)
    if (!current || current[0]!.group !== node.group) columns.push([node])
  }

  let y = 0
  for (const round of [...new Set(nodes.map((node) => node.round))]) {
    if (round > 1) {
      separators.push({ round, y })
      y += SEPARATOR_ROWS
    }
    const roundColumns = columns.filter((column) => column[0]!.round === round)
    for (let start = 0; start < roundColumns.length; start += perRow) {
      const band = roundColumns.slice(start, start + perRow)
      // 展开的节点把自己的行带撑高,并把**同列下方**的节点一起顶下去 —— 详情框就长在
      // 节点与下一个节点之间那段多出来的空当里,谁也不压谁。
      const grown = (node: FlowNode) => node.id === options.expandedId
      const heightOf = (column: FlowNode[]) =>
        column.reduce(
          (total, node, index) => total + (index > 0 ? GAP_Y : 0) + NODE_HEIGHT + (grown(node) ? detailRows : 0),
          0,
        )
      const offsetsOf = (column: FlowNode[]) => {
        const offsets: number[] = []
        let offset = 0
        for (const node of column) {
          offsets.push(offset)
          offset += NODE_HEIGHT + GAP_Y + (grown(node) ? detailRows : 0)
        }
        return offsets
      }
      const bandHeight = Math.max(...band.map(heightOf))
      rows.push({ round, top: y, height: bandHeight })
      band.forEach((column, columnIndex) => {
        offsetsOf(column).forEach((offset, slot) => {
          const node = column[slot]!
          const rect: FlowRect = {
            x: LEFT_MARGIN + columnIndex * COLUMN_PITCH,
            y: y + offset,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          }
          placed.push({
            ...node,
            rect,
            slot,
            // 详情框不进 rect:连线只认卡片本身,展开与否不该改变走线。
            detailRect: grown(node) ? { ...rect, y: rect.y + NODE_HEIGHT, height: detailRows } : undefined,
          })
        })
      })
      y += bandHeight + GAP_Y
    }
  }

  const width = Math.max(NODE_WIDTH, ...placed.map((node) => node.rect.x + node.rect.width))
  return { nodes: placed, width, height: Math.max(1, y - GAP_Y), separators, rows }
}

// ---------- 连线路由 ----------

export type RouteCell = { x: number; y: number; ch: string }
/** 标签可以待着的那一段线段。x 起、columns 列宽;canvas 在里面挑一段不撞车的把标签摆上。 */
export type RouteLabelSpan = { x: number; y: number; columns: number }
export type EdgeRoute = { cells: RouteCell[]; labels: RouteLabelSpan[] }

/** 右向进入目标卡的箭头。`▸`(U+25B8)与 `▼`(U+25BC) 都是 East-Asian Ambiguous,Bun.stringWidth 记 1 列。 */
const ARROW_RIGHT = "▸"
const ARROW_DOWN = "▼"

/** 拐角按「有哪两条腿」取:上+右=└,上+左=┘,下+右=┌,下+左=┐。 */
function corner(up: boolean, right: boolean) {
  if (up) return right ? "└" : "┘"
  return right ? "┌" : "┐"
}

/** 两点之间铺一段直线。调用方保证同排或同列。 */
function run(from: { x: number; y: number }, to: { x: number; y: number }, ch: string): RouteCell[] {
  const cells: RouteCell[] = []
  const horizontal = from.y === to.y
  const step = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y)
  const steps = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y)
  for (let i = 0; i <= steps; i++) {
    cells.push(horizontal ? { x: from.x + i * step, y: from.y, ch } : { x: from.x, y: from.y + i * step, ch })
  }
  return cells
}

/**
 * 把几段直线接成一条折线。接缝那一格会被两段各产一次,这里只留一份 ——
 * 否则「相邻两格必有一格之差」那条断言会以「有重复格」的形式炸掉,而重复格正是接缝。
 */
function join(...segments: RouteCell[][]): RouteCell[] {
  const cells: RouteCell[] = []
  for (const segment of segments) {
    for (const cell of segment) {
      const last = cells[cells.length - 1]
      if (last && last.x === cell.x && last.y === cell.y) continue
      cells.push({ ...cell })
    }
  }
  return cells
}

function paint(cells: RouteCell[], at: { x: number; y: number }, ch: string) {
  const cell = cells.find((item) => item.x === at.x && item.y === at.y)
  if (cell) cell.ch = ch
}

/**
 * 一条边的直角折线路由。
 *
 * 两种形状,按目标相对源的位置选:
 *   目标在源右边(同一行带或下一行带都算)→ **横-竖-横**。竖段走在两列之间的走廊里,
 *     走廊整列都是空的(节点只占列起点起的 NODE_WIDTH 列),所以竖段永远不会穿过卡片。
 *   目标不在源右边(含换行回下一行带的行首、以及叠在并行分支第二位的那张卡)→ **竖-横-竖**。
 *     横段走在两行带之间的通道里,末段竖着落进目标卡**自己那一列的左边**——
 *     layout 之所以在画布左侧留 LEFT_MARGIN 列,就是为了让这一竖永远有地方走:
 *     否则并行分支的第二张卡会被上面那张卡挡住,竖段直接穿卡而过。
 *
 * 首尾两格都落在**节点边界之外、紧贴边界**的那一格上:连线从卡里长出来会被边框字符
 * 糊掉,而插进卡里就是「线压到卡片」。`index` 只用来在走廊/通道里选车道,让并行的几条边
 * 不共用同一条竖线(真撞上了也只是视觉重叠,不影响任何一条边的走向)。
 *
 * `labels` 按「优先程度」列出可以摆标签的线段,通常两段(靠源的那段、靠目标的那段)。
 * 为什么不直接钉死一段:并行分支会**分叉**、工具做完之后会**收束**,同一个画面上可能有两条边
 * 把标签摊在同一行上。给两段候选、让 canvas 去挑不撞车的那段(见 canvas 的 placeLabel),
 * 比在这里猜哪一段更可能有空位可靠。
 */
export function edgeRoute(from: FlowRect, to: FlowRect, index: number): EdgeRoute {
  const fromMidY = from.y + Math.floor(from.height / 2)
  const toMidY = to.y + Math.floor(to.height / 2)
  const rightward = to.x > from.x + from.width

  if (rightward && fromMidY === toMidY) {
    // 同一行带里紧挨着的两列:一条直线。
    const cells = run({ x: from.x + from.width, y: fromMidY }, { x: to.x - 1, y: fromMidY }, "─")
    cells[cells.length - 1]!.ch = ARROW_RIGHT
    return { cells, labels: [{ x: from.x + from.width, y: fromMidY, columns: cells.length - 1 }] }
  }

  if (rightward) {
    const lane = 1 + (index % (GAP_X - 2))
    const corridorX = from.x + from.width + lane
    const cells = join(
      run({ x: from.x + from.width, y: fromMidY }, { x: corridorX, y: fromMidY }, "─"),
      run({ x: corridorX, y: fromMidY }, { x: corridorX, y: toMidY }, "│"),
      run({ x: corridorX, y: toMidY }, { x: to.x - 1, y: toMidY }, "─"),
    )
    paint(cells, { x: corridorX, y: fromMidY }, corner(toMidY > fromMidY, false))
    paint(cells, { x: corridorX, y: toMidY }, corner(toMidY > fromMidY, true))
    cells[cells.length - 1]!.ch = ARROW_RIGHT
    return {
      cells,
      // 两段候选:靠目标的那段(从走廊一路伸到目标卡)与靠源的那段。
      // 靠源那段的可用宽度按**整条走廊**给,而不是「线本身走到 corridorX 为止」那几列 ——
      // 标签自带底色,压住底下的线是原型 .flabel 的做法,而走廊里除了线本来什么都没有。
      // 收束的两条边会同时盯上靠目标那段,canvas 那时才会退到靠源这段。
      labels: [
        { x: corridorX, y: toMidY, columns: to.x - 1 - corridorX },
        { x: from.x + from.width, y: fromMidY, columns: GAP_X },
      ],
    }
  }

  // 绕回左边(或叠在同一列的下一格):竖-横-竖。
  // 车道数是 GAP_Y − 1 —— 通道最后一格要留给「落进目标卡顶边」那一竖段。
  const lane = index % (GAP_Y - 1)
  const exitX = from.x + from.width - 2
  // 落点走在目标卡**自己那列的左边**,而不是它的中间列:并行分支的第二张卡上面还压着
  // 第一张,从它自己的列走必然穿卡。左侧那条走廊(layout 的 LEFT_MARGIN)永远空着。
  const enterX = to.x - 1
  const channelY = from.y + from.height + lane
  const cells = join(
    run({ x: exitX, y: from.y + from.height }, { x: exitX, y: channelY }, "│"),
    run({ x: exitX, y: channelY }, { x: enterX, y: channelY }, "─"),
    run({ x: enterX, y: channelY }, { x: enterX, y: to.y - 1 }, "│"),
  )
  paint(cells, { x: exitX, y: channelY }, corner(true, enterX > exitX))
  paint(cells, { x: enterX, y: channelY }, corner(false, exitX >= enterX))
  cells[cells.length - 1]!.ch = ARROW_DOWN
  return { cells, labels: [{ x: Math.min(exitX, enterX), y: channelY, columns: Math.abs(exitX - enterX) + 1 }] }
}
