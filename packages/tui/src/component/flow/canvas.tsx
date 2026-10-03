/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { BoxRenderable, RGBA, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
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
  GAP_X,
  kindNoun,
  layoutNodes,
  NODE_CONTENT_COLUMNS,
  NODE_WIDTH,
  type FlowNodeKind,
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
 * 「太重」的来源),于是取 0.72 —— 比面板卡的 0.70 还实一档:节点卡只有 28×4,
 * 边框占整张卡的比重远大于面板卡,再淡就读不出「这是一张节点卡」,圆角与类型文字也就
 * 撑不起那张卡。导出给测试直接引用。
 */
export const FLOW_NODE_ALPHA = 0.72

/**
 * 边标签的列数上限。走廊是 GAP_X − 1 列,标签占掉最后一列(箭头)之后还剩 GAP_X − 2;
 * 再兜一个底,免得哪条边的候选段特别宽时标签横跨到卡片上去。
 */
const LABEL_COLUMNS = GAP_X - 2

/** 详情框能显示多少列正文:DETAIL_ROWS 行 × 卡内可用列数。 */
const DETAIL_COLUMNS = DETAIL_ROWS * NODE_CONTENT_COLUMNS

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
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()

  const [selected, setSelected] = createSignal<string | null>(null)
  const [frame, setFrame] = createSignal(0)
  // 画布**盒子**自己的列数(0 = 还没量到)。量的是这个盒子,不是终端:
  // 会话页那一层是 `<box paddingLeft={2} paddingRight={2}>`(routes/session/index.tsx),
  // 再外面还有侧栏,所以 80 列终端 + 侧栏展开时画布只有 46 列 —— 拿终端宽去排布,
  // 右边那一整列卡片会被裁掉而且够不着(见 viewportColumns 的注释)。
  const [boxed, setBoxed] = createSignal(0)

  const model = createMemo(() => buildFlowModel({ messages: props.messages, parts: props.parts }))
  // 画布视口的可用列数 = 盒子宽 − 竖滚动条那 2 列。会话页外层的左右内边距已经由盒子宽
  // 本身扣掉了,内容盒子的左右留白在 layout 的 LEFT_MARGIN / RIGHT_MARGIN 里,这里都不再扣。
  // **这里不垫 NODE_WIDTH 的下限**:垫在下面的 contentWidth 上。垫在这里的话,26 列的终端会
  // 让画布声明 31 列宽却只有 26 列可用,右侧直接被裁掉。
  const viewportWidth = createMemo(() => {
    const measured = boxed()
    // 还没量到时退回「终端宽 − 6」:第一帧只有这一次会用到,量到之后立刻作废。
    const source = measured > 0 ? measured : dimensions().width - 6
    return Math.max(1, source - SCROLLBAR_COLUMNS)
  })
  const layout = createMemo(() => layoutNodes(model().nodes, viewportWidth(), { expandedId: selected() ?? undefined }))
  // **内容宽度 = 图自己的宽度**(layout.width),只有图比视口窄时才退回视口宽 ——
  // 宽的那一截是横向滚动范围(见 layout 的 MIN_BAND_COLUMNS),不是「多画一点出来」。
  const contentWidth = createMemo(() => Math.max(viewportWidth(), layout().width))

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
    // 一次 Map 建好「id → 矩形 / 类型色 / 走线方案」。原来这里是两个 `nodes.find(...)` 的闭包,
    // 每帧被调 3 × 边数次 —— 449 条边 × 400 个节点就是 50 万次线性扫描,白烧。
    const rects = new Map(nodes.map((node) => [node.id, node.rect]))
    const accents = new Map(nodes.map((node) => [node.id, accentOf(theme, node.kind)]))
    const routes = new Map(nodes.map((node) => [node.id, node.route]))
    const tick = revealTick(animated(), frame())

    // 先画**所有线**,再统一画箭头,最后收标签。顺序有讲究:
    //   · 线 vs 标签 —— 后画的线会从先摆的标签上穿过去,把标签切成 `并─行─·─工─具`;
    //   · 线 vs 箭头 —— 并行分支的两条边落进同一张卡,共用同一列入口竖段,后画的 `│`
    //     会把先画的 `▼` 盖掉,于是箭头时有时无。箭头最后画就稳定了。
    const arrows: { x: number; y: number; ch: string; fg: RGBA }[] = []
    const labels: { x: number; y: number; text: string }[] = []
    const placeLabel = makeLabelPlacer()
    const edges = model().edges

    edges.forEach((edge, index) => {
      const from = rects.get(edge.from)
      const to = rects.get(edge.to)
      if (!from || !to) return
      // 分叉边取**目标**的颜色(「并行 · 工具」那条线是青的,因为它通向工具);其余取源节点的
      // 颜色(工具做完之后那条线仍是青的,直到进了编辑节点才转琥珀)。
      const fg = accents.get(edge.parallel ? edge.to : edge.from)!
      const delay = edgeRevealDelay(index, edges.length)
      const route = edgeRoute(from, to, index, routes.get(edge.from))
      const revealed = Math.ceil(route.cells.length * edgeReveal(tick, delay))
      route.cells.slice(0, Math.max(0, revealed)).forEach((cell, cellIndex) => {
        if (cellIndex === route.cells.length - 1) {
          arrows.push({ x: cell.x, y: cell.y, ch: cell.ch, fg: brighten(fg, ARROW_BOOST, theme.text) })
          return
        }
        paintCell(canvas, bounds, cell.x, cell.y, cell.ch, fg)
      })
      if (tick <= delay) return
      // 文字先按**最宽的那段候选**截断:窄段放不下就整段不摆(见 makeLabelPlacer)。
      const room = Math.max(...route.labels.map((span) => span.columns))
      const label = placeLabel(route.labels, Locale.oneLineToWidth(edge.label, Math.min(room, LABEL_COLUMNS)))
      if (label) labels.push(label)
    })

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
          <box width={contentWidth()} height={layout().height} flexShrink={0}>
            {/* 连线层 zIndex 0:卡片永远压在它上面。布局已经保证连线不落在卡内,
                这一层只是兜底 —— 万一某一格算到了卡内,也是卡片盖住线,不是线糊在正文上。 */}
            <For each={grid().rows}>{(y) => <EdgeRow y={y} canvas={grid().canvas} width={contentWidth()} />}</For>
            {/* 标签浮层:在连线之上、卡片与详情面板之上(见 FlowLabel 的 zIndex 注释)。 */}
            <For each={grid().labels}>{(label) => <FlowLabel x={label.x} y={label.y} text={label.text} />}</For>
            <For each={layout().nodes}>
              {(node) => (
                <box position="absolute" left={node.rect.x} top={node.rect.y} width={NODE_WIDTH} zIndex={10}>
                  <NeonCard
                    gradientStops={semanticStops(theme, roleOf(node.kind))}
                    borderAlpha={FLOW_NODE_ALPHA}
                    onSelect={() => setSelected((value) => (value === node.id ? null : node.id))}
                  >
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      <text fg={accentOf(theme, node.kind)}>●</text>
                      <text fg={accentOf(theme, node.kind)}>{node.kindLabel}</text>
                      <box flexGrow={1} />
                      <text fg={theme.textMuted}>{node.meta}</text>
                      {/* 原型 .fc-caret:未展开 ▸,展开后转 90°(这里用 ▾ 表示同一件事)。 */}
                      <text fg={theme.textMuted}>{expandedId() === node.id ? "▾" : "▸"}</text>
                    </box>
                    {/* 模型侧已按 NODE_CONTENT_COLUMNS 截好(见 buildFlowModel 的 title 字段),
                        这里再截一次只是给未来的调用点兜底 —— 列数与模型侧一致,不再额外少一列。 */}
                    <text fg={theme.text} wrapMode="none">
                      {Locale.oneLineToWidth(node.title, NODE_CONTENT_COLUMNS)}
                    </text>
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
                        {/* **必须换行**:框内只有 NODE_CONTENT_COLUMNS = 25 列,一行放不下多少字。
                            压成一行(wrapMode="none")的话 DETAIL_ROWS 行里只有第一行有内容,
                            剩下 5 行是一片空底色,而布局还在为那 5 行把行带撑开。
                            正文先按「框里一共放得下多少列」截断,再由这里折成 DETAIL_ROWS 行 ——
                            于是算式 DETAIL_ROWS × NODE_CONTENT_COLUMNS 与看到的东西一致。 */}
                        <text fg={theme.textMuted} wrapMode="word" width="100%">
                          {Locale.oneLineToWidth(node.detail, DETAIL_COLUMNS)}
                        </text>
                      </box>
                    )}
                  </Show>
                </box>
              )}
            </For>
          </box>
        </Show>
      </scrollbox>
      <box flexDirection="row" gap={2} flexShrink={0} paddingLeft={1}>
        <For each={["user", "plan", "subagent", "tool", "edit", "reply", "fend"] as FlowNodeKind[]}>
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
          点击节点卡展开详情 · 完整正文见气泡视图
        </text>
      </box>
    </box>
  )
}
