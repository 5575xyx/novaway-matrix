/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { BoxRenderable, MouseEvent, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { Message, Part } from "@novaway/sdk-v2-latest/v2"
import { NeonCard } from "../neon-card"
import { useTheme } from "../../context/theme"
import { useKV } from "../../context/kv"
import { brighten, semanticStops, type NeonRole } from "../../ui/neon"
import type { Theme } from "../../theme"
import { Locale } from "../../util/locale"
import { getScrollAcceleration } from "../../util/scroll"
import { useTuiConfig } from "../../config"
import {
  buildFlowModel,
  DETAIL_ROWS,
  edgeRoute,
  FLOW_NODE_KINDS,
  kindNoun,
  layoutNodes,
  LABEL_COLUMNS,
  MAX_NODE_WIDTH,
  nodeContentColumns,
  nodeSize,
  nodeTitleRows,
  snapDrag,
  type EdgeRoute,
  type FlowNodeKind,
  type FlowOffset,
  type PlacedNode,
} from "./layout"
import {
  centered,
  createGrid,
  EDGE_FRAME_MS,
  edgeReveal,
  edgeRevealDelay,
  gridRows,
  makeLabelPlacer,
  paintCell,
  paintRow,
  revealFrameBudget,
  revealTick,
  rowSpans,
  type EdgeGrid,
} from "./grid"
import "../../ui/card"

// ---------- 语义色 ----------

/**
 * 七种节点语义 → 描边色板 role(见 ui/neon 的 semanticStops)。
 *
 * 对照原型 card-design-v7.html 的 `.fcard[data-kind]`:
 *   user     粉紫 → `user`
 *   plan     紫   → `thinking`(neonMid → neonEnd;深色主题里是蓝 → 品红,两端都离开了主色,
 *                    画出来是有坡的一圈,不是一块平色 —— 平色在这个主题里很容易发生)
 *   subagent 紫   → 同 plan(原型里 n2「任务拆解」与 n4「子代理」本来就是同一个 data-kind)
 *   tool     青   → `tool`(霓虹三端)
 *   edit     琥珀 → `tip`(单段 warning;原型 `.fcard[data-kind="edit"]` 也是纯琥珀框)
 *   reply    绿青 → `success`(D3 新增的 role,见 neon.ts 的注释)
 *   fend     绿青 → `success`
 */
function roleOf(kind: FlowNodeKind): NeonRole {
  if (kind === "user") return "user"
  if (kind === "plan") return "thinking"
  if (kind === "subagent") return "thinking"
  if (kind === "edit") return "tip"
  if (kind === "reply") return "success"
  if (kind === "fend") return "success"
  return "tool"
}

/** 节点卡的文字色:取色板的**头端**,与卡片那圈描边的起色同色,点与类型文字才像同一张卡。 */
function accentOf(theme: Theme, kind: FlowNodeKind) {
  return semanticStops(theme, roleOf(kind))[0]!
}

/** 箭头比线本身亮 35%:它是这条边的「结论」,却只占一格,不比线亮就会被当成线的收尾。 */
const ARROW_BOOST = 0.35

/**
 * 节点卡的叠色档(见 ui/neon 的 BORDER_ALPHA_DEFAULT 注释表)。
 *
 * 原型 `.fcard` 用的是**不透明**的 `--fc`,抄不了 1.0(终端里 1 格满饱和描边正是
 * 「太重」的来源),于是取 0.72 —— 比面板卡的 0.70 还实一档:节点卡只有 20~24 列 × 4~7 行,
 * 边框占整张卡的比重远大于面板卡,再淡就读不出「这是一张节点卡」,圆角与类型文字也就
 * 撑不起那张卡。导出给测试直接引用。
 */
export const FLOW_NODE_ALPHA = 0.72

/**
 * 正在拖的那张卡的描边叠色档:**0.95**,比静态那一档(0.72)明显一截。
 *
 * 原型在拖动时把那张卡 `zIndex` 提到 45(压住详情面板与边标签)并且光标变成 `grab`。
 * 终端里没有光标形状,能表达的就两样:**抬高层级**与**描边提亮**。两样都做,是因为
 * 「我现在拎着的是哪一张」必须一眼看出来 —— 拎错了卡,放手时它就落在错的地方了。
 */
export const FLOW_DRAG_ALPHA = 0.95

/**
 * 拖动时卡头右侧那个字:未拖 `▸` / 展开 `▾`,**正在拖** 换成 `⠿`。
 *
 * 盲文点阵是终端里最像「抓手」的一个字形(原型 CSS 的 `cursor: grab`),宽度与 `▸` 一样是 1 列,
 * 于是换字不会让卡头那一行错位。
 */
const GRAB = "⠿"

/**
 * 拖拽状态:哪张卡、指针按在哪、那张卡原来的左上角。
 *
 * **只记相对量**是有意的:屏幕坐标到画布坐标要减去滚动位置与侧栏偏移,而位移在两边是一一对应的,
 * 省掉那套换算就少一处会算错的地方(见 moveDrag 的注释)。
 */
type DragState = { id: string; pointerX: number; pointerY: number; origin: FlowOffset }

/**
 * 位移多少(格,曼哈顿)才算「拖」而不是「点」。
 *
 * 原型是 4 像素,而一个终端格宽约 8 像素 —— 换成 1 格就是同一个量级的手感。
 * 更大(比如半个行距)会让「点一下展开详情」变得不稳,因为点的时候指针常有半格的抖动。
 */
const DRAG_THRESHOLD = 1

/** 除了 `id` 这张卡之外,画布上被占住的全部矩形(别人的卡 + 展开的详情框)。 */
function occupiedExcept(nodes: readonly PlacedNode[], id: string) {
  return nodes.flatMap((node) => (node.id === id ? [] : node.detailRect ? [node.rect, node.detailRect] : [node.rect]))
}

/** 每格归哪条边:标签要避开**别人的**格子(见 grid 的 makeLabelPlacer)。 */
function cellOwners(planned: readonly { index: number; route: EdgeRoute }[]) {
  const owners = new Map<string, number>()
  for (const item of planned) {
    for (const cell of item.route.cells) {
      const key = `${cell.x}:${cell.y}`
      if (!owners.has(key)) owners.set(key, item.index)
    }
  }
  return owners
}

/** 详情框能显示多少列正文:DETAIL_ROWS 行 × **这张卡**的卡内可用列数。 */
function detailColumns(kind: FlowNodeKind) {
  return DETAIL_ROWS * nodeContentColumns(kind)
}

/**
 * 竖滚动条那一块占掉的列数。**2,不是 1**:opentui 的 scrollbox 是
 * `flexDirection:row`(wrapper + 竖滚动条),而 `verticalScrollbarOptions` 里传了
 * `paddingLeft: 1` —— 那 1 列内边距把轨道从右边推开了 1 列,于是滚动条**盒子**占 2 列
 * (1 列内边距 + 1 列轨道),内容真正能摆的宽度是「盒子宽 − 2」。
 *
 * 这 2 列不是白占的:留出来的那一列就是竖滚动条与内容之间的缝,而内容自己的右边留白
 * (layout 的 RIGHT_MARGIN)也在里面,两侧读起来一样宽。
 *
 * **只扣这两列**:会话页外层自己的 paddingLeft/Right 已经体现在盒子宽里了,内容盒子的左沿
 * 还有 LEFT_MARGIN = 2 列留白,不必再扣。
 */
const SCROLLBAR_COLUMNS = 2

/**
 * 浮层文字(边标签 / 轮次标签):压在线上,靠自己的底色把线遮掉(原型 `.flabel` 就是这么做的 ——
 * 不遮的话「并行 · 工具」会被竖线切成两半)。
 *
 * 位置与宽度都在数据侧算好再传进来,不用 `justifyContent="center"`:一个绝对定位的盒子在
 * 这一层拿到的宽度不总等于写上去的那个数,靠盒内居中来摆标签就会飘。宽度写死成
 * `displayWidth(text)`,左右端点因此完全确定,也不会越出线段留给它的那几列。
 *
 * zIndex 12 —— **压在详情面板(11)之上**。标签的占位本来就在走廊里、压不到卡片,但展开的
 * 节点会把详情面板撑到卡片下方 6 行,那一段是可能被标签候选段蹭到的;zIndex 高一点,
 * 最坏情况是标签盖住面板的一角(看得见),而不是整块标签被面板吞掉(看不见)。
 */
function FlowLabel(props: { x: number; y: number; text: string }) {
  const { theme } = useTheme()
  return (
    <box
      position="absolute"
      left={props.x}
      top={props.y}
      width={Locale.displayWidth(props.text)}
      height={1}
      zIndex={12}
      backgroundColor={theme.background}
    >
      <text fg={theme.textMuted} wrapMode="none">
        {props.text}
      </text>
    </box>
  )
}

/**
 * 连线层的一行。
 *
 * 单独抽成组件是为了让 `rowSpans` **每行只算一次**:它要扫整行(O(width)),而这一行同时需要
 * 偏移量(`start`,交给盒子的 left)与分段(spans)。写在 JSX 里就是两处调用,两遍扫描。
 *
 * `<For each>` 给的是**行号**(原始值),所以没变过的行不会被销毁重建 —— 这是改成稀疏行之后
 * 最大的收益:原来每帧都是一张新数组,等于把全部行重画一遍。
 */
function EdgeRow(props: { y: number; canvas: EdgeGrid; width: number }) {
  const drawn = createMemo(() => rowSpans(props.canvas.get(props.y) ?? []))
  return (
    <box position="absolute" left={drawn().start} top={props.y} width={props.width} height={1} zIndex={0}>
      <text wrapMode="none">
        <For each={drawn().spans}>{(span) => <span style={{ fg: span.fg }}>{span.text}</span>}</For>
      </text>
    </box>
  )
}

// ---------- 节点卡的两种形状 ----------

/**
 * 六类节点卡的卡内内容:一行卡头(`● 类型 · meta · ▸`) + 若干行标题。
 *
 * **标题要折行**:卡高按类型在 5~7 行之间变,多出来那几行不是留白(见 nodeTitleRows)。
 * 折行安全靠的是模型侧已经按 `nodeTitleColumns(kind)` 截断过 —— 那是「行数 × 每行列数」
 * 的总数,所以再怎么折也超不出那几行。`wrapMode="word"` 是必须的:压成一行的话高卡下面
 * 几行是一片空底色,而布局还在为它们把行带撑开(与详情框那行注释是同一条道理)。
 *
 * 卡头那一行仍然是单行:它装的是 `● 类型 + meta + ▸`,模型侧没有为它留折行预算,
 * 而宽度是按「最宽的一行卡头 = 19 列」反推出来的(见 CARD_CELL_PX_WIDTH 那段推导),
 * 所以 `wrapMode="none"` + 外层 `flexShrink={0}` 就是正解 —— 挤不下时宁可裁,不许换行。
 */
function NodeCardBody(props: { node: PlacedNode; accent: RGBA; caret: string }) {
  const { theme } = useTheme()
  const node = props.node
  return (
    <box flexDirection="column" width="100%">
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={props.accent}>●</text>
        <text fg={props.accent}>{node.kindLabel}</text>
        <box flexGrow={1} />
        <text fg={theme.textMuted}>{node.meta}</text>
        {/* 原型 .fc-caret:未展开 ▸,展开后转 90°(这里用 ▾ 表示同一件事);
            正在拖时换成抓手(见 GRAB 的注释)。 */}
        <text fg={theme.textMuted}>{props.caret}</text>
      </box>
      {/* 标题行:`最新` 徽标(原型 .fc-new,card-design-v7.html:1054)+ 标题。
          **徽标在标题行而不是卡头行** —— 卡头行要塞 `● 类型 + meta + ▸`,一行放不下第三个
          彩色块;挪到标题行之后它读起来仍然是「这条是最新的回复」。模型侧已经把标题按
          「扣掉徽标那几列」的预算截好了(见 buildFlowModel 末尾那遍反查),所以不会顶到边框。 */}
      <box flexDirection="row" gap={1} width="100%">
        <Show when={node.badge}>
          <text fg={semanticStops(theme, "success")[0]} wrapMode="none">
            {node.badge}
          </text>
        </Show>
        <text fg={theme.text} wrapMode="word" width="100%">
          {node.title}
        </text>
      </box>
    </box>
  )
}

/**
 * 「本轮结束」那颗药丸(原型 `.fcard.fend`,card-design-v7.html:713-715 与 :1061)。
 *
 * 终端里画不出 `border-radius: 99px`,于是靠三件事把它读成药丸而不是一张卡:
 * **没有 `▸` 折角**(原型的药丸干脆就没有 `.fc-caret`)、两行内容**居中**、以及它本身
 * 更窄更短(20 × 4,而最宽最高的是 24 × 7 —— 见 nodeSize)。点它什么也不发生,
 * 与原型那句 `if (card.classList.contains('fend')) return`(:1286)一致(见 clickNode)。
 *
 * 两行的分配和原型的 `.fcard.fend .fc-head` 一样是**先标题再 meta**,只是原型的 meta 是
 * `等待新指令…`,本实现沿用 meta 那一格自己的 `第 N 轮`(见 buildFlowModel 的 flushRound) ——
 * 两者拼在一起是 `第 N 轮 · 等待新指令…`,按卡内可用列数截断。
 */
function RoundEndPill(props: { node: PlacedNode; accent: RGBA }) {
  const { theme } = useTheme()
  const node = props.node
  const columns = nodeContentColumns("fend")
  return (
    <box flexDirection="column" alignItems="center" width="100%">
      {/* 药丸那一行要**居中**,不是靠一个满宽的盒子去 justify —— 一个绝对定位盒子的实测宽度
          不总等于写上去的那个数(与 FlowLabel 同一档顾虑),而这张卡是定宽的,所以盒子居中
          自己那份内容是稳的。 */}
      <text fg={props.accent} wrapMode="none">
        {`⏹ ${node.kindLabel}`}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {Locale.oneLineToWidth(`${node.meta} · ${node.title}`, columns)}
      </text>
    </box>
  )
}

// ---------- 组件 ----------

export function FlowCanvas(props: {
  messages: readonly Message[]
  parts: { readonly [messageID: string]: readonly Part[] | undefined }
  /**
   * 覆盖「要不要播入场揭示」。省略 = 读 KV 的 `animations_enabled`。
   *
   * 存在的原因只有一个:**测试不能从 KV 那一侧拨这个开关** —— KVProvider 写的是**共享**的
   * `state/kv.json`,拨一下会脏掉别的用例(test/component/prompt-card.test.tsx:319 记着这件事)。
   * 而「关动画 ⇒ 显示终态」这条恰恰最需要测试:它是一个只在关掉时才走到的分支。
   */
  reveal?: boolean
  /**
   * 把滚动容器交出去。会话页的翻页 / 跳消息命令要作用在**当前那个**滚动容器上,
   * 而气泡视图那个 scrollbox 在流程图视图里根本没挂载(见 routes/session 的 activeScroll)。
   */
  onScrollBox?: (box: ScrollBoxRenderable) => void
  /**
   * 把「拖拽落点」这张表的变化交出去。**只给测试用**(与上面那个 `reveal` 同一个理由:
   * 组件内部的 state 没有别的观察口),生产调用点不传。
   *
   * 它是为了钉一条从外面看不见的规矩:切会话之后,已经不存在的那些落点必须从这张表里
   * 消失(否则一场长会话能攒下几百个死条目)。测试拿它断言「那张表真的被清小了」。
   */
  onOverrides?: (overrides: Record<string, FlowOffset>) => void
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()

  const [selected, setSelected] = createSignal<string | null>(null)
  const [frame, setFrame] = createSignal(0)
  /** 拖拽留下的落点,按节点 id 存(见下面那段 createEffect 的注释)。 */
  const [moved, setMoved] = createSignal<Record<string, FlowOffset>>({})
  /** 正在拖的那张卡:哪张、按在哪、它的原位。见 beginDrag 的注释。 */
  const [drag, setDrag] = createSignal<DragState | null>(null)
  /**
   * 刚刚被**真的拖过**的那张卡。与 `drag` 分开是因为时序:opentui 在鼠标抬起时先把
   * `onMouseDragEnd` 派发掉、再派发 `onMouseUp`(见 renderer 的 processSingleMouseEvent),
   * 于是「这一下算不算拖」必须在 drag 结束**之后**仍然读得到 —— 点击判定正好在 onMouseUp 里。
   */
  const [dragged, setDragged] = createSignal<string | null>(null)
  // 画布**盒子**自己的列数(0 = 还没量到)。量的是这个盒子,不是终端:
  // 会话页那一层是 `<box paddingLeft={2} paddingRight={2}>`(routes/session/index.tsx),
  // 再外面还有侧栏,所以 80 列终端 + 侧栏展开时画布只有 46 列 —— 拿终端宽去排布,
  // 右边那一整列卡片会被裁掉而且够不着(见 viewportColumns 的注释)。
  const [boxed, setBoxed] = createSignal(0)

  const model = createMemo(() => buildFlowModel({ messages: props.messages, parts: props.parts }))
  // 画布视口的可用列数 = 盒子宽 − 竖滚动条那 2 列。会话页外层的左右内边距已经由盒子宽
  // 本身扣掉了,内容盒子的左右留白在 layout 的 LEFT_MARGIN / RIGHT_MARGIN 里,这里都不再扣。
  // **这里不垫最宽卡的下限**:垫在下面的 contentWidth 上。垫在这里的话,26 列的终端会
  // 让画布声明 31 列宽却只有 26 列可用,右侧直接被裁掉。
  const viewportWidth = createMemo(() => {
    const measured = boxed()
    // 还没量到时退回「终端宽 − 6」:第一帧只有这一次会用到,量到之后立刻作废。
    const source = measured > 0 ? measured : dimensions().width - 6
    return Math.max(1, source - SCROLLBAR_COLUMNS)
  })
  const layout = createMemo(() =>
    layoutNodes(model().nodes, viewportWidth(), { expandedId: selected() ?? undefined, overrides: moved() }),
  )
  // **内容宽度 = 图自己的宽度**(layout.width),只有图比视口窄时才退回视口宽 ——
  // 宽的那一截是横向滚动范围(见 layout 的 MIN_BAND_COLUMNS),不是「多画一点出来」。
  const contentWidth = createMemo(() => Math.max(viewportWidth(), layout().width))

  /**
   * 节点位置被拖动过的那些卡,按节点 id 存落点。
   *
   * **数据换了之后怎么处理**:还活着的节点保留落点(用户刚摆好的图不该因为来了条新消息就被弹回去),
   * 已经不在模型里的那些**丢掉** —— 否则这份 state 只增不减,一场长会话里能攒下几百个死条目。
   * 这条清理写成 effect 而不是「重建整张表」:重建会让每一张卡的落点在数据变化时全部闪一下。
   */
  createEffect(() => {
    const current = moved()
    props.onOverrides?.(current)
    const alive = new Set(model().nodes.map((node) => node.id))
    const kept = Object.fromEntries(Object.entries(current).filter(([id]) => alive.has(id)))
    if (Object.keys(kept).length === Object.keys(current).length) return
    setMoved(kept)
  })

  /**
   * 选中态的**有效值**:数据换掉(切会话)之后,上一次选中的节点可能已经不在模型里了。
   * 这里从布局结果反查,而不是监听数据变化去清 signal —— 反查天然兜住了「选中项消失」,
   * 不需要一条容易漏掉的 createEffect。
   */
  const expandedId = createMemo(() => layout().nodes.find((node) => node.id === selected())?.id)

  /** 要不要播入场揭示。关掉时 revealTick 直接给终态,于是线/箭头/边标签全都完整在。 */
  const animated = createMemo(() => props.reveal ?? kv.get("animations_enabled", true))
  // 相位推到预算就停 —— 与 NeonBox 的相位表同一个取向(画完即静止,空闲零开销)。
  // 预算与边数无关(见 grid 的 EDGE_STAGGER_FRAMES),所以 50 轮的会话也是 1.7 秒画完。
  const budget = createMemo(() => revealFrameBudget(model().edges.length))
  createEffect(() => {
    if (!animated()) return
    const limit = budget()
    const timer = setInterval(() => {
      setFrame((value) => (value >= limit ? value : value + 1))
    }, EDGE_FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

  const grid = createMemo(() => {
    const bounds = { width: contentWidth(), height: layout().height }
    const canvas: EdgeGrid = createGrid()
    const nodes = layout().nodes
    // 一次 Map 建好「id → 矩形 / 类型色」。原来这里是两个 `nodes.find(...)` 的闭包,
    // 每帧被调 3 × 边数次 —— 449 条边 × 400 个节点就是 50 万次线性扫描,白烧。
    const rects = new Map(nodes.map((node) => [node.id, node.rect]))
    const accents = new Map(nodes.map((node) => [node.id, accentOf(theme, node.kind)]))
    const routes = new Map(nodes.map((node) => [node.id, node.route]))
    const tick = revealTick(animated(), frame())
    const edges = model().edges

    // **先算全部走线,再落笔、最后摆标签**。三段顺序各有讲究:
    //   · 全部走线先算完 —— 标签要避开**别的边**的格子,而那些边可能还没画(见 makeLabelPlacer);
    //   · 线 vs 标签 —— 后画的线会从先摆的标签上穿过去,把标签切成 `并─行─·─工─具`;
    //   · 线 vs 箭头 —— 并行分支的两条边落进同一张卡,共用同一列入口竖段,后画的 `│`
    //     会把先画的 `▼` 盖掉,于是箭头时有时无。箭头最后画就稳定了。
    const planned = edges.flatMap((edge, index) => {
      const from = rects.get(edge.from)
      const to = rects.get(edge.to)
      if (!from || !to) return []
      const route = edgeRoute(from, to, index, routes.get(edge.from))
      // 分叉边取**目标**的颜色(「并行 · 工具」那条线是青的,因为它通向工具);其余取源节点的
      // 颜色(工具做完之后那条线仍是青的,直到进了编辑节点才转琥珀)。
      const fg = accents.get(edge.parallel ? edge.to : edge.from)!
      return [{ index, edge, route, fg, delay: edgeRevealDelay(index, edges.length) }]
    })

    const arrows: { x: number; y: number; ch: string; fg: RGBA }[] = []
    const labels: { x: number; y: number; text: string }[] = []
    const placeLabel = makeLabelPlacer(cellOwners(planned))
    for (const item of planned) {
      const revealed = Math.ceil(item.route.cells.length * edgeReveal(tick, item.delay))
      item.route.cells.slice(0, Math.max(0, revealed)).forEach((cell, cellIndex) => {
        if (cellIndex === item.route.cells.length - 1) {
          arrows.push({ x: cell.x, y: cell.y, ch: cell.ch, fg: brighten(item.fg, ARROW_BOOST, theme.text) })
          return
        }
        paintCell(canvas, bounds, cell.x, cell.y, cell.ch, item.fg)
      })
      if (tick <= item.delay) continue
      // 文字先按**最宽的那段候选**截断:窄段放不下就整段不摆(见 makeLabelPlacer)。
      const room = Math.max(...item.route.labels.map((span) => span.columns))
      const label = placeLabel(
        item.route.labels,
        Locale.oneLineToWidth(item.edge.label, Math.min(room, LABEL_COLUMNS)),
        item.index,
      )
      if (label) labels.push(label)
    }

    for (const arrow of arrows) paintCell(canvas, bounds, arrow.x, arrow.y, arrow.ch, arrow.fg)

    // 轮次分隔线:`─` 横贯整张画布,`第 N 轮` 居中写在同一行(原型 .fsep 就是一行 flex,
    // `left:0; right:0` 横贯整个 .fcanvas)。所以它按画布**视口**宽度画,而不是按卡片用到
    // 的那点宽度 —— 单列布局下两者差着几十列,按卡片宽度画会得到一条短得看不懂的线。
    for (const separator of layout().separators) {
      const text = ` 第 ${separator.round} 轮 `
      const columns = Locale.displayWidth(text)
      const start = centered(0, bounds.width, text)
      paintRow(canvas, bounds, separator.y, "─", theme.border, (x) => x >= start && x < start + columns)
      labels.push({ x: start, y: separator.y, text })
    }
    return { canvas, rows: gridRows(canvas), labels }
  })

  // ---------- 拖拽 ----------

  /**
   * 按下:记住是哪张卡、按在哪、它原来的位置。
   *
   * `preventDefault` 与 `renderer.clearSelection()` 这一对是**必须**的,不是洁癖:
   * 卡里的 `<text>` 是 selectable 的,而 opentui 在 `down` 落到 selectable 元素上时会先
   * `startSelection(...)` 再把事件派发给我们。那次选择一旦留着,后续 `drag` 事件走的是
   * 「选择中」那条分支 —— 派发给**指针当前底下**的那个元素而不是按下的那个,并且顺手把选区
   * 拉大。于是指针一移出卡片,拖拽就断了,屏幕上还多了一块选区高亮。
   * `preventDefault` 会让渲染器**跳过**自己的清理(`if (!event.defaultPrevented) clearSelection()`),
   * 所以清理由我们自己做。
   */
  const beginDrag = (event: MouseEvent, node: PlacedNode) => {
    event.preventDefault()
    event.stopPropagation()
    renderer.clearSelection()
    setDragged(null)
    setDrag({ id: node.id, pointerX: event.x, pointerY: event.y, origin: { x: node.rect.x, y: node.rect.y } })
  }

  /**
   * 拖动中:按位移算落点,吸附到网格,写进 overrides。
   *
   * 位移直接取「这一次的指针 − 按下时的指针」,不需要知道画布在屏幕上的位置 ——
   * 屏幕格与画布格是一一对应的(都是终端的一格),所以滚动、侧栏展开都不影响这个差值。
   *
   * 落点每帧都过一次 `snapDrag`,所以**拖动过程中连线就已经是新的走线**(原型的 drawEdges
   * 是在 mousemove 里重画的,见 card-design-v7.html:1278),而且卡与卡之间始终留得下走廊:
   * 吸附只落在空锚点上,于是不会出现「线从卡片里穿过去」的那种中间帧。
   */
  const moveDrag = (event: MouseEvent) => {
    const state = drag()
    if (!state) return
    event.stopPropagation()
    const dx = event.x - state.pointerX
    const dy = event.y - state.pointerY
    // 原型的判据是 `Math.abs(dx) + Math.abs(dy) > 4`(像素,card-design-v7.html:1275)。
    // 这里换成**格**:终端一格就是一个字符那么宽,不足一格不算拖 —— 否则一次手抖就会
    // 把卡判成「拖过了」,而点击展开详情就被吞掉。
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    setDragged(state.id)
    const current = layout()
    const next = snapDrag(
      { x: state.origin.x + dx, y: state.origin.y + dy },
      {
        anchors: current.anchors,
        blocked: occupiedExcept(current.nodes, state.id),
        // 每一列的数据宽度:落点那一列装不下这张卡时 snapDrag 会跳过它(走廊一窄就摆不下
        // 竖段与并行标签了,见 layout 的 snapDrag)。
        columnWidths: current.columnWidths,
        bounds: { width: current.width, height: current.height },
        // **这张卡自己的尺寸**,不是全表最宽的那一档 —— 卡宽按类型在变(见 nodeSize),
        // 拿错尺寸去挡重叠,要么放走一个真正会压上的落点,要么把合法的落点全挡掉。
        size: nodeSize(current.nodes.find((item) => item.id === state.id)?.kind ?? "plan"),
      },
    )
    if (!next) return
    setMoved((before) =>
      before[state.id]?.x === next.x && before[state.id]?.y === next.y ? before : { ...before, [state.id]: next },
    )
  }

  /**
   * 抬起:收掉拖拽状态。**不动 overrides** —— 落点已经写进去了,这一收只是把状态清干净。
   *
   * 收尾挂在两处:卡片自己的 `onMouseUp`(见 clickNode)与画布内容盒子的 `onMouseUp`。
   * 两处都留着是因为 opentui 的捕获规则:第一次左键拖动时它把「指针当时底下的那个元素」
   * 设为 *captured renderable*,之后的 `drag-end` / `up` 只发给它 —— 指针停在画布外就收不到,
   * 抓手会一直亮着。画布内松手(含在空白处松手)两条路都盖得住;真拖出画布才松手的话,
   * 下一次在任意一张卡上按下时 `beginDrag` 会把状态重置,不会串到别的卡上。
   */
  const endDrag = () => {
    setDrag(null)
  }

  /**
   * 点击(没有真的拖动):展开/收起详情。
   *
   * 「拖过就不算点」这一条是原型的 `click` 里那两行(card-design-v7.html:1284-1288):
   * 拖动结束时浏览器还会补一次 click,不挡住的话每拖一次就会顺手把详情也开了。
   *
   * 「本轮结束」那颗药丸**点它什么也不发生** —— 原型同一段里就有一句
   * `if (card.classList.contains('fend')) return`(:1286),它连 `.fc-pop` 都没有。
   * 拖动仍然允许(原型的 mousedown/mousemove 是绑在所有 `.fcard` 上的,只有 cursor 是
   * `default`),所以这里只挡「点」这一档。
   *
   * **这里也要收掉拖拽状态**:opentui 的 `onMouseDragEnd` 只在**真的发生过拖动**时才会派发
   * (它挂在「captured renderable」那一档上,而按住不动就没有 capture),所以一次纯点击之后
   * `drag` 还挂着,那张卡会一直显示成抓手。画布那一层也挂了同一个收尾(见内容盒子的 onMouseUp),
   * 兜住「在卡片上按下、在别处松手」那种抬起位置。
   */
  const clickNode = (node: PlacedNode) => {
    endDrag()
    if (dragged() === node.id) return
    if (node.kind === "fend") return
    setSelected((value) => (value === node.id ? null : node.id))
  }

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection="column"
      ref={(element: BoxRenderable) => {
        // 量自己,不量终端:侧栏展开时这两者差着侧栏那么多列(见 viewportWidth 的注释)。
        // 首帧 yoga 还没算完,onSizeChange 会在第一次落定尺寸时补一次 —— 所以这里
        // 立即读一次宽度,把「量到的第一帧」提前到不晚于第一次渲染。
        element.onSizeChange = () => setBoxed(element.width)
        setBoxed(element.width)
      }}
    >
      <scrollbox
        ref={(box: ScrollBoxRenderable) => {
          // **横向滚动这一档只能在这里接上**,不能写成 JSX 属性:opentui 的 solid 渲染器
          // 建元素时只传 `{ id }`,其余 props 全走 `setProperty`(node[name] = value),
          // 而 `scrollX` 在 ScrollBoxRenderable 上**只有构造参数、没有 setter** ——
          // 写 `scrollX={true}` 会被当成一个没人读的普通字段,静默失效。
          // 它真正控制的是 content 的宽度约束:默认 `maxWidth:"100%"` 会把宽内容挤回视口宽
          // 直接裁掉(这正是「右边被截断」),摘掉这一条,内容就能比视口宽,
          // `recalculateBarProps()` 随即把 `scrollWidth` 顶上去,横向滚动条也随之自动出现
          // (它只在「内容比视口宽」时才 visible,见 ScrollBarRenderable.recalculateVisibility)。
          box.content.maxWidth = undefined
          props.onScrollBox?.(box)
        }}
        flexGrow={1}
        scrollAcceleration={getScrollAcceleration(tuiConfig)}
        viewportOptions={{ paddingRight: 0 }}
        verticalScrollbarOptions={{ paddingLeft: 1, visible: true }}
        // 横向滚动条不传 `visible`:传了就变成「永远可见」(_manualVisibility),图装得下时
        // 屏幕上会白多一行。留空由 opentui 自己按内容/视口之比决定。
        horizontalScrollbarOptions={{
          paddingTop: 0,
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.border,
          },
        }}
      >
        <Show
          when={model().nodes.length > 0}
          fallback={
            <box paddingLeft={1} paddingTop={1} flexShrink={0}>
              <text fg={theme.textMuted} wrapMode="none">
                这一轮还没有能画成节点的消息 —— 发出第一条消息就会出现在这里
              </text>
            </box>
          }
        >
          <box
            width={contentWidth()}
            height={layout().height}
            flexShrink={0}
            // 拖动的三个事件挂在**画布这一层**,不是挂在某张卡上。
            //
            // 为什么:opentui 在第一次左键拖动时,把「指针当时底下的那个元素」设为
            // *captured renderable*,之后所有鼠标事件只发给它
            // (见 renderer 的 processSingleMouseEvent)。指针一离开那张卡,捕获到的就是
            // 画布的空白盒子 —— 而空白盒子是所有卡的**父级**,事件从它往上冒泡,卡根本收不到。
            // 挂在画布这一层就两种情况都盖住:捕获到卡里的文字时事件冒泡上来,捕获到空白时
            // 直接命中这里。谁在被拖由 `drag()` 记着(按下时记的),不需要事件目标就是那张卡。
            onMouseDrag={moveDrag}
            onMouseDragEnd={endDrag}
            // 兜底:在画布里任何地方松开鼠标都收掉拖拽状态。卡片自己的 onMouseUp 已经收过
            // 一次(见 clickNode),这一层是为了「在卡片上按下、在空白处松手」那种抬起位置 ——
            // 那种情况下事件根本不会送回卡片,抓手会一直亮着。
            onMouseUp={endDrag}
          >
            {/* 连线层 zIndex 0:卡片永远压在它上面。布局已经保证连线不落在卡内,
                这一层只是兜底 —— 万一某一格算到了卡内,也是卡片盖住线,不是线糊在正文上。 */}
            <For each={grid().rows}>{(y) => <EdgeRow y={y} canvas={grid().canvas} width={contentWidth()} />}</For>
            {/* 标签浮层:在连线之上、卡片与详情面板之上(见 FlowLabel 的 zIndex 注释)。 */}
            <For each={grid().labels}>{(label) => <FlowLabel x={label.x} y={label.y} text={label.text} />}</For>
            <For each={layout().nodes}>
              {(node) => {
                const lifting = () => drag()?.id === node.id
                const pill = () => node.kind === "fend"
                // 卡头右侧那一个字:未展开 ▸ / 展开 ▾ / 正在拖 ⠿(见 GRAB 的注释)。
                // 「本轮结束」那颗药丸没有这一格(见 RoundEndPill)。
                const caret = () => (lifting() ? GRAB : expandedId() === node.id ? "▾" : "▸")
                return (
                  <box
                    position="absolute"
                    left={node.rect.x}
                    top={node.rect.y}
                    // **尺寸逐卡给**,不是全表一个数 —— 见 layout 的 NODE_SIZE_PX/nodeSize。
                    // 高度写死成 rect.height 是必须的:卡高按类型在 4~7 行之间变,而连线的中线
                    // 取 `y + ⌊h/2⌋`(见 edgeRoute),卡壳的实际高度必须与布局算的那个数一致,
                    // 否则每条线都会贴着错的那一行横穿过去。
                    width={node.rect.width}
                    height={node.rect.height}
                    // 原型拖动时 `zIndex = 45`(压住详情面板与边标签);这里的 20 就是那个意思。
                    zIndex={lifting() ? 20 : 10}
                    // 只有「按下」挂在卡上(要知道按的是哪一张);拖动与抬起挂在画布那一层,
                    // 理由见内容盒子那三条事件的注释。
                    onMouseDown={(event: MouseEvent) => beginDrag(event, node)}
                    onMouseUp={() => clickNode(node)}
                  >
                    <NeonCard
                      gradientStops={semanticStops(theme, roleOf(node.kind))}
                      borderAlpha={lifting() ? FLOW_DRAG_ALPHA : FLOW_NODE_ALPHA}
                      height={node.rect.height}
                    >
                      <Show
                        when={pill()}
                        fallback={<NodeCardBody node={node} accent={accentOf(theme, node.kind)} caret={caret()} />}
                      >
                        <RoundEndPill node={node} accent={accentOf(theme, node.kind)} />
                      </Show>
                    </NeonCard>
                    <Show when={node.detailRect}>
                      {(rect) => (
                        <box
                          position="absolute"
                          left={rect().x - node.rect.x}
                          top={rect().y - node.rect.y}
                          width={rect().width}
                          height={rect().height}
                          zIndex={11}
                          paddingLeft={2}
                          paddingRight={1}
                          backgroundColor={theme.backgroundPanel}
                        >
                          {/* **必须换行**:框内只有这张卡的卡内可用列数(20~21 列),一行放不下多少字。
                              压成一行(wrapMode="none")的话 DETAIL_ROWS 行里只有第一行有内容,
                              剩下 5 行是一片空底色,而布局还在为那 5 行把行带撑开。
                              正文先按「框里一共放得下多少列」截断,再由这里折成 DETAIL_ROWS 行 ——
                              于是算式 DETAIL_ROWS × 卡内可用列数与看到的东西一致。 */}
                          <text fg={theme.textMuted} wrapMode="word" width="100%">
                            {Locale.oneLineToWidth(node.detail, detailColumns(node.kind))}
                          </text>
                        </box>
                      )}
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </scrollbox>
      <box flexDirection="row" gap={2} flexShrink={0} paddingLeft={1}>
        <For each={FLOW_NODE_KINDS}>
          {(kind) => (
            <text fg={accentOf(theme, kind)} wrapMode="none">
              <span style={{ fg: accentOf(theme, kind) }}>● </span>
              {kindNoun(kind)}
            </text>
          )}
        </For>
      </box>
      <box flexShrink={0} paddingLeft={1}>
        <text fg={theme.textMuted} wrapMode="none">
          点击节点卡展开详情 · 按住拖动可挪到别的格子 · 完整正文见气泡视图
        </text>
      </box>
    </box>
  )
}
