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
  /**
   * 这一行带的顶边 y。行带之上那几行(上一条行带自己的通道)在整幅宽度上都是空的,
   * 所以「目标在源上方」的绕行边可以放心走那里(见 RouteOptions.channelAbove)。
   */
  bandTop: number
  /**
   * 这一行带的底边 y。行带内所有卡片的底边都不超过它,所以「紧贴行带下沿的那一行」在整幅宽度上
   * 都是空的 —— 往下绕的边把横段落在那里,不必绕开任何卡片。
   */
  bandBottom: number
  /**
   * 这一张卡出发的绕行边该怎么走。展开与否、以及**卡被拖到了哪一行**都会改变答案,
   * 所以由布局按最终矩形算好交给 canvas,而不是让 canvas 去猜「这个节点下面有没有东西」。
   */
  route: RouteOptions
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
 * 节点卡宽度(列)。28 的来历:卡内可用列数 = 卡宽 − NeonCard 的 padding(左 2 + 右 1)= 25,
 * 够放下「● 工具调用」+ 时长 + `▸`。
 */
export const NODE_WIDTH = 28
/**
 * 节点卡高度(行)。**4**,不是 6。
 *
 * NeonBox 把边框画在自己第 0 行与最后一行,而 NeonCard 的 paddingTop/paddingBottom 各是 1 ——
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
 * 就会被上面那张卡挡住 —— 竖段直接穿卡而过。
 *
 * **2 列,不是 3**:换行边在这一侧只用到**一列**(`enterX = to.x − 1`),「三条车道」那个说法
 * 是从纵向的通道车道串过来的,并不成立 —— 纵向车道由 `GAP_Y` 给(见上)。而这一列的宽度直接
 * 决定最窄终端上能不能排下两列:`LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH = 2 + 44 + 28 = 74`,
 * 正好等于 80 列终端扣掉内边距与滚动条之后的视口宽。三列的话是 75,80 列终端就退化成单列,
 * 而 80 是最常见的宽度。少掉的那一列换不来任何东西:横向的竖段固定落在**列间走廊**里
 * (见 CORRIDOR_LANE),那条走廊在两张卡之间,与左侧留白无关。
 */
export const LEFT_MARGIN = 2
/**
 * 画布右侧留出的空列(列)。**1 列,不是 0**。
 *
 * 它只起一个作用:别让最后一列卡片的后边框紧贴画布右沿。右边紧贴着的是竖滚动条
 * (opentui 的 scrollbox 把滚动条画在自己那一列上,见 canvas 的 verticalScrollbarOptions),
 * 两者叠在一起时那一格同时有描边和滚动条的块字符,读起来像卡片破了个口。
 * 算式上它也正好补上 LEFT_MARGIN 的另一半 —— 画布宽 = 左留白 + 步距 × (列数 − 1) + 卡宽 + 右留白,
 * 两边对称,推出来的数不用凑。
 */
export const RIGHT_MARGIN = 1
/**
 * 一行带里**至少**放几列。
 *
 * 2 是原型那几屏流程图的形状,也是本实现自己在 80 / 120 列上一直给出的答案
 * (`2 + 44 + 28 = 74`)。把它设成下限而不是「视口能放几列就放几列」,是因为:
 *
 *   · 原型的 `.fcanvas` 是 `width:1040px; flex-shrink:0`(card-design-v7.html:669)——
 *     **画布有自己的固有宽度,页面横向滚动去够它**,而不是把画布压到视口那么宽。
 *     横向滚动一旦通了(见 MIN_BAND_VIEWPORT),「一列一行带」就成了画不出来的选择:
 *     并行分支的分叉与收束被拉成一条几十行的长蛇,画布读不出「这是并行」。
 *   · 反过来,视口窄到**一张卡加一条走廊都放不下**时,两列就变成了两张互相看不见的半张卡 ——
 *     那时宁可退化成单列(见 bandColumns 的 floor),纵向滚动去够。
 *
 * 所以这两条是一对:下限 2 列 + 上面的 RIGHT_MARGIN/LEFT_MARGIN,合起来就是
 * 「内容比视口宽的那一截由画布自己横向滚」。
 */
export const MIN_BAND_COLUMNS = 2
/**
 * 行带保持 `MIN_BAND_COLUMNS` 列所需的最小视口列数 = 一张卡 + 一条走廊 = 28 + 16 = **44**。
 *
 * 「放得下两列」要 74 列(LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH),但**看得懂**只要 44 列:
 * 44 ~ 73 这一档给两列,多出来的那截横向滚;43 列往下给一列。
 */
export const MIN_BAND_VIEWPORT = NODE_WIDTH + GAP_X
/** 列的步距:卡宽 + 走廊。 */
export const COLUMN_PITCH = NODE_WIDTH + GAP_X

/**
 * 一行带能放几列(纯函数,导出给测试钉住那张算式表)。
 *
 * 三档,谁大听谁的:
 *   · `fits` —— 视口**装得下**几列:`⌊(视口 + 走廊 − 左侧留白) / 步距⌋`。
 *     最后一列右边没有走廊、每列左边都有 LEFT_MARGIN,所以是「+ 走廊 − 留白」这一项。
 *   · `floor` —— 视口放得下一张卡 + 一条走廊(≥ MIN_BAND_VIEWPORT)时的下限 MIN_BAND_COLUMNS,
 *     否则 1。**这一档是「画布按内容尺寸排布」的落点**:它让图可以比视口宽,
 *     宽出来的那一截由 canvas 的横向滚动承担(见 MIN_BAND_COLUMNS 的注释)。
 *   · 1 —— 视口连一列都放不下时的兜底,`max(1, …)` 保证列数永远 ≥ 1。
 */
export function bandColumns(viewportWidth: number) {
  const fits = Math.floor((viewportWidth + GAP_X - LEFT_MARGIN) / COLUMN_PITCH)
  const floor = viewportWidth >= MIN_BAND_VIEWPORT ? MIN_BAND_COLUMNS : 1
  return Math.max(1, fits, floor)
}
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

/**
 * 节点语义在**短**语境下的名字。图例与并行标签用它。
 *
 * 为什么要另有一个短名:节点首行写全称(`工具调用`、`本轮结束`)是因为那里有 25 列可用;
 * 而底部图例一行要并排放七个,全称加起来 82 列 —— 80 列的终端上最后一项直接被挤出屏幕。
 * 短名加起来 60 列,窄终端也放得下,而图例本来只需要说清「哪个颜色是哪一类」。
 * 并行标签「并行 · 子代理」也是它 —— 拼全称(`并行 · 工具调用`)就有 15 列,走廊放不下。
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
          label: isParallel ? `并行 · ${kindNoun(next.kind)}` : outcomeLabel(previous),
          parallel: isParallel,
        })
      }
    }
  }
  // 自检:每条边的两端都必须指向真实存在的节点。这在构造上恒成立(边就是从 groups 两两连出来的),
  // 所以走**软失败**而不是 throw —— 这一层跑在**渲染路径**上,为一个永不可能发生的条件把整个
  // 界面抛掉,代价与收益完全不成比例。真正的断言留在 flow-layout.test.ts 里。
  const known = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (known.has(edge.from) && known.has(edge.to)) continue
    console.debug(`流程图模型自检:边 ${edge.id} 指向了不存在的节点`)
  }

  return { nodes, edges, rounds: round }
}

// ---------- 布局 ----------

// 矩形相交的两个谓词(pointInRect / rectsOverlap)住在 test/fixture/flow.ts:
// 它们只被不变量断言用,生产代码一处也不查 —— 自动布局的不重叠靠的是「坐标由固定步距算出来」
// 这条构造,不是靠事后比较。把它们放在这里会让「这个模块会检查自己的输出」看起来像是真的。

/**
 * 网格布局:一轮一行带(放不下就换行带),轮与轮之间插一条分隔线。
 *
 * 不重叠不是靠「算完再检查」,而是靠构造:列的 x 是列号乘以固定步距,列内节点按 slot
 * 乘以固定步距,行带的高度取本带里最高的列。所以任何两组坐标都不会撞上 ——
 * `rectsOverlap` 那条断言(flow-layout.test.ts)只是把这条不变量钉住,防的是有人后来
 * 把步距改成随内容变化。
 *
 * `expandedId` 让那一张卡的行带长高 DETAIL_ROWS,详情框正好落在长出来的那一块里 ——
 * 于是详情既贴着卡片,又不会压到下一行带(而整行带下移,后面的节点跟着让位),
 * 连同列里在它下方的节点一起让位。详情框**不进 rect**:连线只认卡片本身,
 * 展开与否不该改变**卡与卡之间**的走线;它只影响从这张卡出发的那一竖能不能往下走
 * (见 routeOptionsOf —— 那一竖会穿过不透明的详情面板,所以必须改从左边进走廊)。
 */
export function layoutNodes(
  nodes: readonly FlowNode[],
  canvasWidth: number,
  options: { expandedId?: string; detailRows?: number } = {},
): FlowLayout {
  const detailRows = options.detailRows ?? DETAIL_ROWS
  // 一行带能放几列。步距是卡宽 + 走廊,再扣掉左侧那条留出来的走廊 —— 整张表见 bandColumns。
  const perRow = bandColumns(canvasWidth)
  // 先只摆矩形:走线方案依赖**全部**卡片的最终矩形,只能最后统一补(见文件末尾那一段)。
  const seeded: SeededNode[] = []
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
      const bandBottom = y + bandHeight
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
          seeded.push({ ...node, rect, slot, bandTop: y, bandBottom })
        })
      })
      y += bandHeight + GAP_Y
    }
  }
  // 详情框与走线方案都在**最终**矩形上算 —— 展开的详情框、被拖走的那张卡,两者都会改答案。
  const detailOf = (node: SeededNode) =>
    node.id === options.expandedId ? { ...node.rect, y: node.rect.y + NODE_HEIGHT, height: detailRows } : undefined
  const details = new Map(seeded.map((node) => [node.id, detailOf(node)]))
  const occupied = seeded.flatMap((node) => (details.get(node.id) ? [node.rect, details.get(node.id)!] : [node.rect]))
  const placed: PlacedNode[] = seeded.map((node) => ({
    ...node,
    detailRect: details.get(node.id),
    route: routeOptionsOf(node, details.get(node.id), occupied),
  }))

  // 画布用掉的宽度 = **最宽那条行带** + 左右留白,而不是视口宽。
  // 算式:LEFT_MARGIN + (列数 − 1) × COLUMN_PITCH + NODE_WIDTH + RIGHT_MARGIN,
  // 其中「列数 − 1」是因为第一列的左边已经有 LEFT_MARGIN 了。
  // 这就是 canvas 交给 scrollbox 的 contentWidth —— 内容比视口宽时差出来的那一截
  // 由画布自己横向滚(见 MIN_BAND_COLUMNS),所以这一行**不能**再拿视口宽去夹。
  const width =
    Math.max(LEFT_MARGIN + NODE_WIDTH, ...placed.map((node) => node.rect.x + node.rect.width)) + RIGHT_MARGIN
  return { nodes: placed, width, height: Math.max(1, y - GAP_Y), separators, rows }
}

/** 走线方案还没算出来之前的中间形态:`route` 依赖全部卡片的最终矩形,只能最后统一补。 */
type SeededNode = FlowNode & { rect: FlowRect; slot: number; bandTop: number; bandBottom: number }

/**
 * 这一张卡出发/到达的绕行边该怎么走 —— 按**最终**矩形算,所以展开的详情框与拖拽都算进去了。
 *
 * 通道那两行是构造上必然空的,所以只需要回答「那一竖空不空」:
 *   · 往下:`rect.x + width − 2` 那一列,从卡片下沿到行带下沿。展开的详情框就压在这里,
 *     所以展开的那张卡只能改从左边进走廊(那一列任何行都是空的,见 LEFT_MARGIN)。
 *   · 往上:同一列,从行带之上到卡片上沿。默认的自动布局里它恒空(同列上方不是同列下一格就是
 *     上一条行带的通道),拖拽把卡拖到别的行带之后就不一定,于是要真查一遍。
 * 两列都没空的时候 `left` 兜底:`rect.x − 1` 那一列不可能被任何卡片占着 ——
 * 卡片的左沿都在列锚上,而列锚之间恒等于 COLUMN_PITCH = 44 > NODE_WIDTH = 28,
 * 所以 `rect.x − 1` 落在两条列锚之间的走廊里(详情框与卡片同锚,同理)。
 */
function routeOptionsOf(node: SeededNode, detail: FlowRect | undefined, occupied: readonly FlowRect[]): RouteOptions {
  const column = node.rect.x + node.rect.width - 2
  return {
    bandTop: node.bandTop,
    bandBottom: node.bandBottom,
    // 展开的那张卡**不能**往下出:它自己的详情面板就贴在正下方(见 detailRect),
    // 那一竖从卡片下沿起步,第一步就落在面板里。所以这一档不看「有没有别人」,直接否掉。
    downFree:
      detail === undefined && columnFree(occupied, node, column, node.rect.y + node.rect.height, node.bandBottom),
    upFree: columnFree(occupied, node, column, node.bandTop - GAP_Y, node.rect.y - 1),
  }
}

/** `[from, to]` 那几行里,`column` 那一列有没有压到别人的卡片或详情框。 */
function columnFree(occupied: readonly FlowRect[], self: SeededNode, column: number, from: number, to: number) {
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  if (high < 0) return false
  return !occupied.some(
    (rect) =>
      rect !== self.rect &&
      column >= rect.x &&
      column < rect.x + rect.width &&
      high >= rect.y &&
      low < rect.y + rect.height,
  )
}

// ---------- 连线路由 ----------

export type RouteCell = { x: number; y: number; ch: string }
/** 标签可以待着的那一段线段。x 起、columns 列宽;canvas 在里面挑一段不撞车的把标签摆上。 */
export type RouteLabelSpan = { x: number; y: number; columns: number }
export type EdgeRoute = { cells: RouteCell[]; labels: RouteLabelSpan[] }

/**
 * 绕行边(目标不在源右边那一侧)的走线方案,由布局按最终矩形算好(见 routeOptionsOf)。
 *
 * 两行通道都是构造上必然空的:行带之下那 GAP_Y 行、上一条行带之下那 GAP_Y 行 ——
 * 自动布局与拖拽都把卡片整个关在行带里面(锚点的行 y 满足 `bandTop ≤ y ≤ bandBottom − NODE_HEIGHT`),
 * 所以这两条行带之间/之下的空行永远没有卡片。
 */
export type RouteOptions = {
  /** 源所在行带的顶边。目标在源上方时通道取 `bandTop − GAP_Y`(上一条行带自己的空行)。 */
  bandTop: number
  /** 源所在行带的下沿。目标在源下方(或同一条行带里往回走)时通道取它。 */
  bandBottom: number
  /** 源卡片正下方那一竖空不空。空才敢往下出,否则改从左边进走廊。 */
  downFree: boolean
  /** 源卡片正上方那一竖空不空。空才敢往上出,否则改从左边进走廊。 */
  upFree: boolean
}

/** 右向进入目标卡的箭头。`▸`(U+25B8)与 `▼`(U+25BC) 都是 East-Asian Ambiguous,Bun.stringWidth 记 1 列。 */
const ARROW_RIGHT = "▸"
const ARROW_DOWN = "▼"
/** 从目标卡**下边框**往上扎进去的箭头。只有拖拽把一张卡拖到它目标上方时才会用到(见 edgeRoute)。 */
const ARROW_UP = "▲"

/**
 * 拐角字符。**圆角那一套** `╭ ╮ ╰ ╯`,与 NeonBox 画卡片边框用的是同一组
 * (见 ui/neon 的 perimeterCells):`╭` 上左(向右 + 向下两条腿)、`╮` 上右、
 * `╯` 下右、`╰` 下左。于是「线的折角」与「卡的圆角」读起来是同一种语言 ——
 * 直角的 `┌ ┐ └ ┘` 在这个界面里只有 tab-bar 那个 <box> 边框在用。
 *
 * 直角那一套留在字符白名单里(test/component/flow-layout.test.ts 也留着),
 * 是为了有人换回去时能看见白名单变了,而不是悄悄换掉。
 */
export const CORNER_CHARS = new Set(["╭", "╮", "╰", "╯"])

/** 拐角按「有哪两条腿」取:上+右=╰,上+左=╯,下+右=╭,下+左=╮。 */
function corner(up: boolean, right: boolean) {
  if (up) return right ? "╰" : "╯"
  return right ? "╭" : "╮"
}

/**
 * 走廊里那条竖段固定在第几列 —— **相对源卡片右边那一列往右数**。
 *
 * 走廊的列是 `from.x + width … from.x + width + GAP_X − 1`(GAP_X = 16),最后一列
 * (`to.x − 1`)放箭头,所以竖段只能落在 0 … 14 之间。
 *
 * **取 GAP_X − 3 = 13,而不是取中间那一列**,因为标签要住在这条走廊里:
 * 靠源那一段的宽度是 `CORRIDOR_LANE + 1 = 14` 列,而原型最长的并行标签「并行 · 子代理」
 * 是 13 列(见 kindNoun)。竖段若落在中间(7),靠源那段只有 8 列,那个标签永远放不下;
 * 落在 13 时它正好嵌进 0 … 13,收束边最后那 3 列(`13 … 15`,含箭头)留给同一条走廊里
 * **另一条**边的收尾横段 —— 两条边并排进同一张卡时,先摆下的那个标签正好压住自己那条线
 * (标签自带底色,原型 .flabel 就是这么做的),不会碰到对方那一段。
 *
 * 也是**为什么竖段必须固定**:原型那边每条边都是一条贝塞尔(card-design-v7.html:966-977),
 * 读起来「一排线是平行的弧」而不是「一堆折返」。上一版按 `index % 2` 让相邻的边一上一下地折返,
 * 满足「必须有折点」这条字面要求,画出来是一排压扁的弹簧 —— 那是用户抱怨「连线有点混乱」的由来。
 * 固定一列之后,一排同向的边是**同一条形状**平移,读起来就是平行的弧。
 */
export const CORRIDOR_LANE = GAP_X - 3

/**
 * 边标签的列数上限。
 *
 * 走廊是 GAP_X 列,最后一列放箭头,所以标签最多占 GAP_X − 2 列。这里同时是 canvas 截断标签时的
 * 上限 —— 与候选段里最宽的那一段取小者(见 canvas 里 `Math.min(room, LABEL_COLUMNS)`),
 * 免得哪条边的候选段特别宽时标签横跨到卡片上去。放在这里而不是 canvas:它算的是走廊的宽度,
 * 而走廊是这一层的事;不变量断言(标签不许压到别的边)也要用同一个数重演一遍 canvas 的截断。
 */
export const LABEL_COLUMNS = GAP_X - 2

/** 一条边最多拐几次(方向变化次数)。3 段直线 = 最多拐 2 次,也就是 S/Z 形,没有回头路。 */
export const MAX_ROUTE_TURNS = 2

/** 目标整张卡在源右边 —— 也就是「同带右向」那一类,走走廊。 */
export function isRightward(from: FlowRect, to: FlowRect) {
  return to.x > from.x + from.width
}

/** 走廊里那条竖段所在的列(见 CORRIDOR_LANE)。 */
export function corridorColumn(from: FlowRect) {
  return from.x + from.width + CORRIDOR_LANE
}

/** 这一条边横向铺开几列。 */
export function routeSpanX(cells: readonly RouteCell[]) {
  if (cells.length === 0) return 0
  return Math.max(...cells.map((cell) => cell.x)) - Math.min(...cells.map((cell) => cell.x)) + 1
}

/** 折点数(带拐角字符的格数)。 */
export function routeBends(cells: readonly RouteCell[]) {
  return cells.filter((cell) => CORNER_CHARS.has(cell.ch)).length
}

/**
 * 拐弯次数(方向变化的次数),导出给 fixture 的 flowInvariants 当契约钉。
 *
 * 这是**形状**的度量,不是折角字符的个数:一条狗腿(横-竖-横-竖-横)量出来是 4,
 * 而新契约要求每条边至多 2 —— 三段直线、最多一个 S 形。零长度的线段不计入
 * (两列中线同高时竖段长度是 0,那条边量出来是 0 次拐弯,正是原型 n1→n2 那条直线的形状,
 * card-design-v7.html:966 的 `M198,73 C232,73 262,74 292,74`)。
 */
export function routeTurns(cells: readonly RouteCell[]) {
  const directions: string[] = []
  for (let index = 1; index < cells.length; index++) {
    const from = cells[index - 1]!
    const cell = cells[index]!
    const direction = cell.x === from.x ? (cell.y === from.y ? "" : "v") : cell.y === from.y ? "h" : "d"
    if (direction === "" || directions.at(-1) === direction) continue
    directions.push(direction)
  }
  return Math.max(0, directions.length - 1)
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
 * 一条边的直角折线走线。**一类边一种形状**,没有第三种。
 *
 *   **同带右向**(目标整张卡在源右边)→ **横-竖-横**,竖段固定落在走廊里那一列
 *     (CORRIDOR_LANE = 13,靠目标那 3 列留给收尾与箭头)。一排同向的边于是是同一个形状平移,
 *     读起来就是原型那排平行的弧。两列中线同高时竖段长度是 0,整条边就是一条直线 ——
 *     原型那条 n1→n2 也是这么画的(card-design-v7.html:966 `M198,73 C232,73 262,74 292,74`),
 *     这时候连折角都不画:两个折角会叠在同一格上,画出来是一条直线上多一个接头。
 *
 *   **绕行**(其余全部:目标不在源右边 —— 下一条行带的行首、同一列的下一格、
 *     以及拖拽把某张卡拖到了它目标左边/上方)→ **竖-横-竖**。竖段走在走廊列上,横段落在
 *     行带之外的空行上(行带之下,或上一条行带之下 —— 那几行按构造必然没有卡片,见 RouteOptions),
 *     末段落在目标卡**自己那一列的左边**(`enterX = to.x − 1`)再扎进它的上边框或下边框。
 *     layout 之所以在画布左侧留 LEFT_MARGIN 列,就是为了让这一竖永远有地方走:
 *     否则并行分支的第二张卡会被上面那张卡挡住,竖段直接穿卡而过。
 *
 * 首尾两格都落在**节点边界之外、紧贴边界**的那一格上:连线从卡里长出来会被边框字符
 * 糊掉,而插进卡里就是「线压到卡片」。
 *
 * `index` 只用来在**行带通道**里选车道(`index % (GAP_Y − 1)`,两条车道留给不同行带层级的横段)——
 * 那是同一条形状里的「走第几道车道」,不是另一种形状。走廊里那一列是固定的:上一版按边序
 * 一上一下地折返,满足「必须有折点」却画出一排压扁的弹簧,那才是「连线有点混乱」的来源。
 *
 * `labels` 按「优先程度」列出可以摆标签的线段。为什么要给多段而不是钉死一段:
 * 并行分支会**分叉**、工具做完之后会**收束**,同一个画面上可能有两条边把标签摊在同一行上。
 * 给几段候选、让 canvas 去挑一段既不撞车、也不压着**别的边**的那段
 * (见 grid 的 makeLabelPlacer),比在这里猜哪一段更可能有空位可靠。
 */
export function edgeRoute(from: FlowRect, to: FlowRect, index: number, options: Partial<RouteOptions> = {}): EdgeRoute {
  const fromMidY = from.y + Math.floor(from.height / 2)
  const toMidY = to.y + Math.floor(to.height / 2)

  if (isRightward(from, to)) {
    const corridorX = corridorColumn(from)
    const dropping = toMidY > fromMidY
    const cells = join(
      run({ x: from.x + from.width, y: fromMidY }, { x: corridorX, y: fromMidY }, "─"),
      run({ x: corridorX, y: fromMidY }, { x: corridorX, y: toMidY }, "│"),
      run({ x: corridorX, y: toMidY }, { x: to.x - 1, y: toMidY }, "─"),
    )
    // 竖段长度是 0 时**不画折角**:那一格上只有一条直线,画个接头只会让人以为那里拐了个弯。
    if (fromMidY !== toMidY) {
      // 两条腿各是什么:出竖段那一格是「朝源的那条横线 + 竖的方向」,落进目标那一格是
      // 「朝目标的那条横线 + 来时的竖方向」。`corner(up, right)` 按腿取圆角:
      // 上+右=╰、上+左=╯、下+右=╭、下+左=╮(与 NeonBox 的四个卡角同一套,见 CORNER_CHARS)。
      paint(cells, { x: corridorX, y: fromMidY }, corner(!dropping, false))
      paint(cells, { x: corridorX, y: toMidY }, corner(dropping, true))
    }
    cells[cells.length - 1]!.ch = ARROW_RIGHT
    return {
      cells,
      // 两段候选:靠源那一段(CORRIDOR_LANE + 1 = 14 列,放得下 13 列的并行标签),靠目标那一段
      // (GAP_X − CORRIDOR_LANE = 3 列,收束的另一条边正好占着它,于是两条并行标签各落一处)。
      labels: [
        { x: from.x + from.width, y: fromMidY, columns: CORRIDOR_LANE + 1 },
        { x: corridorX, y: toMidY, columns: to.x - 1 - corridorX + 1 },
      ],
    }
  }

  // 绕行:竖-横-竖。
  //
  // 通道取在**目标之外**的那一侧:目标整体在源之上(只有拖拽能把边走成这样)就取行带之上那几行,
  // 其余(下一条行带、同一行带里往回走)取行带之下那几行。车道数是 GAP_Y − 1 ——
  // 通道最后几行要留给「扎进目标卡边」那一竖段。
  const bandTop = options.bandTop ?? from.y
  const above = to.y + to.height <= from.y
  const channelY = Math.max(
    0,
    (above ? bandTop - GAP_Y : (options.bandBottom ?? from.y + from.height)) + (index % (GAP_Y - 1)),
  )
  const enterX = to.x - 1
  // 出口:能直上直下就走自己那一列(横段长、标签有地方摆),那一竖被别的东西压住时
  // 改从左边那条走廊进 —— 那一列不可能被卡片占着(见 routeOptionsOf 的注释)。
  const exit = above ? (options.upFree ?? true) : (options.downFree ?? true)
  const exitX = exit ? from.x + from.width - 2 : from.x - 1
  const head = exit ? { x: exitX, y: above ? from.y - 1 : from.y + from.height } : { x: exitX, y: fromMidY }
  // 落点:目标在通道之下就从上边框扎进去(▼),在通道之上就从下边框往上扎(▲)。
  // 出口与入口同列时没有横段可走(见下面那一档),落点改成按「目标在出口的哪一侧」判。
  const sameColumn = exitX === enterX
  const enterTop = sameColumn ? to.y > head.y : to.y - 1 > channelY
  const enterY = enterTop ? to.y - 1 : to.y + to.height
  const cells = sameColumn
    ? run(head, { x: exitX, y: enterY }, "│")
    : join(
        run(head, { x: exitX, y: channelY }, "│"),
        run({ x: exitX, y: channelY }, { x: enterX, y: channelY }, "─"),
        run({ x: enterX, y: channelY }, { x: enterX, y: enterY }, "│"),
      )
  // 两段竖线同在 exitX 上时(单列布局的绕行边,或者一张卡被拖到它目标同一列)没有拐角,
  // 那个格子就该留 `│`,硬画一个拐角会把一条直线画成两个不相干的接头。
  // 末段竖线长度是 0 时同理:那一格是箭头,不是接头。
  if (!sameColumn) {
    paint(cells, { x: exitX, y: channelY }, corner(!above, enterX > exitX))
    if (enterY !== channelY) paint(cells, { x: enterX, y: channelY }, corner(enterY < channelY, enterX < exitX))
  }
  cells[cells.length - 1]!.ch = enterTop ? ARROW_DOWN : ARROW_UP
  return {
    cells,
    labels: sameColumn
      ? // 同列时这条边**没有横段**,于是标签改挂在源那条行带的通道行上(整幅宽度上都没卡片),
        // 从画布左沿一直给到那一竖 —— 摆不摆得下由 placer 判(压着别的边就整段不摆)。
        [{ x: 0, y: channelY, columns: exitX + 1 }]
      : [{ x: Math.min(exitX, enterX), y: channelY, columns: Math.abs(exitX - enterX) + 1 }],
  }
}
