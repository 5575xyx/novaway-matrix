/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { Message, Part } from "@novaway/sdk-v2-latest/v2"
import { AssistantCard } from "../assistant-card"
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
  type RouteLabelSpan,
} from "./layout"
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

// ---------- 连线层 ----------

/**
 * 连线层的字符网格。一格 = 一个字符 + 可选前景色,`ch` 是空格表示不落笔。
 *
 * 为什么把**整张画布**摊成一张网格,而不是「每条边一个绝对定位的 text」:
 * 边是会交叉的(并行分支的两条边共用同一条走廊,换行的边可能共用同一条通道),逐边渲染就得
 * 额外决定「谁盖住谁」;网格里后写的自然盖先写的,顺序完全可控,而且每条边只往里写自己那几十格。
 * 代价是空白格也占位置 —— 一张 80×40 的画布 3200 格,可以接受。
 *
 * **网格里只放单列字符**(制表线与箭头)。中文字符占 2 列,按「一格一个字」写进去会在字与字
 * 之间留下半个空档,那一格还得再补一个字符 —— 补出来的东西就成了 `并─行─·─子─代─理` 这种
 * 被线穿过的碎字。所以标签一律不进网格,改成独立的浮层(见下面 FlowLabel):
 * 它自带底色,正好盖住线,这就是原型 `.flabel { background: #0c1220 }` 的做法。
 */
type EdgeCell = { ch: string; fg?: RGBA }
type EdgeGrid = EdgeCell[][]

function blankGrid(width: number, height: number): EdgeGrid {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ ch: " ", fg: undefined }) as EdgeCell),
  )
}

function paintCell(grid: EdgeGrid, x: number, y: number, ch: string, fg: RGBA) {
  const row = grid[y]
  if (!row) return
  const cell = row[x]
  if (!cell) return
  cell.ch = ch
  cell.fg = fg
}

/**
 * 把一行网格折成「同色连续段」,**并给出这一行第一个非空格所在的列**。
 *
 * 空格必须原样留在串里:一行里可能有好几段互不相邻的线,而这一行的浮层盒子是贴着画布左边
 * 摆的。空格一旦被跳过,`<text>` 就从第一个非空字符开始画,整行的线都会**左移** ——
 * 移进左边那张卡片里,画出来就是「线从卡片左边穿出去」。所以这里只跳过**行首**的空格(靠
 * start 把偏移交给盒子的 left),行内的空格全部补回去(补在后面那一段里,空格不着色也看不见)。
 */
function rowSpans(row: EdgeCell[]) {
  const start = row.findIndex((cell) => cell.ch !== " ")
  if (start < 0) return { start: 0, spans: [] as { text: string; fg: RGBA }[] }
  const spans: { text: string; fg: RGBA }[] = []
  let blanks = 0
  for (const cell of row.slice(start)) {
    if (cell.ch === " " || !cell.fg) {
      blanks += 1
      continue
    }
    const last = spans[spans.length - 1]
    const chunk = " ".repeat(blanks) + cell.ch
    if (last && last.fg === cell.fg) last.text += chunk
    if (!last || last.fg !== cell.fg) spans.push({ text: chunk, fg: cell.fg })
    blanks = 0
  }
  return { start, spans }
}

/** 一条边揭示到第几格。原型 .fedge 的 edgeDraw 是「统一时长 + 阶梯 delay」,这里照抄。 */
function edgeReveal(frame: number, delay: number) {
  return Math.min(1, Math.max(0, (frame - delay) / EDGE_REVEAL_FRAMES))
}

const EDGE_REVEAL_FRAMES = 8
const EDGE_STAGGER = 2
const EDGE_FRAME_MS = 60

/** 箭头比线本身亮 35%:它是这条边的「结论」,却只占一格,不比线亮就会被当成线的收尾。 */
const ARROW_BOOST = 0.35

/**
 * 边标签的列数上限。走廊是 GAP_X − 1 列,标签占掉最后一列(箭头)之后还剩 GAP_X − 2;
 * 再兜一个底,免得哪条边的候选段特别宽时标签横跨到卡片上去。
 */
const LABEL_COLUMNS = GAP_X - 2

/** 详情框能显示多少列正文:DETAIL_ROWS 行 × 卡内可用列数。 */
const DETAIL_COLUMNS = DETAIL_ROWS * NODE_CONTENT_COLUMNS

/**
 * 浮层文字(边标签 / 轮次标签):压在线上,靠自己的底色把线遮掉(原型 `.flabel` 就是这么做的 ——
 * 不遮的话「并行 · 工具」会被竖线切成两半)。
 *
 * 位置与宽度都在数据侧算好再传进来,不用 `justifyContent="center"`:一个绝对定位的盒子在
 * 这一层拿到的宽度不总等于写上去的那个数,靠盒内居中来摆标签就会飘。宽度写死成
 * `displayWidth(text)`,左右端点因此完全确定,也不会越出线段留给它的那几列。
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
      zIndex={5}
      backgroundColor={theme.background}
    >
      <text fg={theme.textMuted} wrapMode="none">
        {props.text}
      </text>
    </box>
  )
}

/** 在 [x, x + columns) 这一段里居中放一段文字,返回它的左端列。 */
function centered(x: number, columns: number, text: string) {
  return x + Math.max(0, Math.floor((columns - Locale.displayWidth(text)) / 2))
}

/**
 * 标签落在哪一段线上。
 *
 * 同一行上可能有好几条边都想在这摆标签:并行分支**分叉**时两条边的候选段挨着,
 * 工具做完**收束**时两条边的候选段又完全重合。所以按边的顺序依次摆,谁先摆谁占位,
 * 后来的那条在自己的候选段里找一段没被占的;两段都撞上了就**不摆这个标签** ——
 * 少一个标签只是信息少一点,两个标签叠在一起则是画布看起来坏掉了。
 */
function makeLabelPlacer() {
  const taken: { y: number; from: number; to: number }[] = []
  return (spans: RouteLabelSpan[], text: string) => {
    const width = Locale.displayWidth(text)
    for (const span of spans) {
      // 比文字还窄的段一律不摆:标签盒子会盖住底下的线,摆出去就盖到卡片边框上了。
      if (span.columns < width) continue
      const from = centered(span.x, span.columns, text)
      const to = from + width
      const clash = taken.some((item) => item.y === span.y && from < item.to && item.from < to)
      if (clash) continue
      taken.push({ y: span.y, from, to })
      return { x: from, y: span.y, text }
    }
    return undefined
  }
}

// ---------- 组件 ----------

export function FlowCanvas(props: {
  messages: readonly Message[]
  parts: { readonly [messageID: string]: readonly Part[] | undefined }
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()

  const [selected, setSelected] = createSignal<string | null>(null)
  const [frame, setFrame] = createSignal(0)

  const model = createMemo(() => buildFlowModel({ messages: props.messages, parts: props.parts }))
  // 画布视口的可用列数:会话页外层已经留了左右各 2 列内边距,这里再留 2 列给滚动条与呼吸。
  const viewportWidth = createMemo(() => Math.max(NODE_WIDTH, dimensions().width - 6))
  const layout = createMemo(() => layoutNodes(model().nodes, viewportWidth(), { expandedId: selected() ?? undefined }))
  const contentWidth = createMemo(() => Math.max(viewportWidth(), layout().width))

  /**
   * 选中态的**有效值**:数据换掉(切会话)之后,上一次选中的节点可能已经不在模型里了。
   * 这里从布局结果反查,而不是监听数据变化去清 signal —— 反查天然兜住了「选中项消失」,
   * 不需要一条容易漏掉的 createEffect。
   */
  const selectedNode = createMemo(() => layout().nodes.find((node) => node.id === selected()))
  const expandedId = createMemo(() => selectedNode()?.id)

  // 相位只在动画开着时推进,推到最长那条边揭示完就停 —— 与 NeonBox 的相位表同一个取向。
  const edgeFrames = createMemo(() => model().edges.length * EDGE_STAGGER + EDGE_REVEAL_FRAMES)
  createEffect(() => {
    if (!kv.get("animations_enabled", true)) return
    const limit = edgeFrames()
    const timer = setInterval(() => {
      setFrame((value) => (value >= limit ? value : value + 1))
    }, EDGE_FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })

  const rectOf = (id: string) => layout().nodes.find((node) => node.id === id)?.rect

  const grid = createMemo(() => {
    // 网格按**视口**宽开,不是按卡片用到的宽度:轮次分隔线要横贯整张画布(原型 .fsep 是
    // `left:0; right:0`)。paintCell 对越界的格静默丢弃,所以网格窄一点分隔线就会被截短。
    const canvas = blankGrid(contentWidth(), layout().height)
    const accent = (id: string) => accentOf(theme, layout().nodes.find((node) => node.id === id)?.kind ?? "tool")
    const tick = frame()

    // 先画**所有线**,再统一画箭头,最后收标签。顺序有讲究:
    //   · 线 vs 标签 —— 后画的线会从先摆的标签上穿过去,把标签切成 `并─行─·─工─具`;
    //   · 线 vs 箭头 —— 并行分支的两条边落进同一张卡,共用同一列入口竖段,后画的 `│`
    //     会把先画的 `▼` 盖掉,于是箭头时有时无。箭头最后画就稳定了。
    const arrows: { x: number; y: number; ch: string; fg: RGBA }[] = []
    const labels: { x: number; y: number; text: string }[] = []
    const placeLabel = makeLabelPlacer()

    model().edges.forEach((edge, index) => {
      const from = rectOf(edge.from)
      const to = rectOf(edge.to)
      if (!from || !to) return
      // 分叉边取**目标**的颜色(「并行 · 工具」那条线是青的,因为它通向工具);其余取源节点的
      // 颜色(工具做完之后那条线仍是青的,直到进了编辑节点才转琥珀)。
      const fg = accent(edge.parallel ? edge.to : edge.from)
      const route = edgeRoute(from, to, index)
      const revealed = Math.ceil(route.cells.length * edgeReveal(tick, index * EDGE_STAGGER))
      route.cells.slice(0, Math.max(0, revealed)).forEach((cell, cellIndex) => {
        const isArrow = cellIndex === route.cells.length - 1
        if (isArrow) {
          arrows.push({ x: cell.x, y: cell.y, ch: cell.ch, fg: brighten(fg, ARROW_BOOST, theme.text) })
          return
        }
        paintCell(canvas, cell.x, cell.y, cell.ch, fg)
      })
      if (tick <= index * EDGE_STAGGER) return
      // 文字先按**最宽的那段候选**截断:窄段放不下就整段不摆(见 makeLabelPlacer)。
      const room = Math.max(...route.labels.map((span) => span.columns))
      const label = placeLabel(route.labels, Locale.oneLineToWidth(edge.label, Math.min(room, LABEL_COLUMNS)))
      if (label) labels.push(label)
    })

    for (const arrow of arrows) paintCell(canvas, arrow.x, arrow.y, arrow.ch, arrow.fg)

    // 轮次分隔线:`─` 横贯整张画布,`第 N 轮` 居中写在同一行(原型 .fsep 就是一行 flex,
    // `left:0; right:0` 横贯整个 .fcanvas)。所以它按画布**视口**宽度画,而不是按卡片用到
    // 的那点宽度 —— 单列布局下两者差着几十列,按卡片宽度画会得到一条短得看不懂的线。
    for (const separator of layout().separators) {
      const text = ` 第 ${separator.round} 轮 `
      const columns = Locale.displayWidth(text)
      const start = centered(0, contentWidth(), text)
      for (let x = 0; x < contentWidth(); x++) {
        if (x < start || x >= start + columns) paintCell(canvas, x, separator.y, "─", theme.border)
      }
      labels.push({ x: start, y: separator.y, text })
    }
    return { canvas, labels }
  })

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column">
      <scrollbox
        flexGrow={1}
        scrollAcceleration={getScrollAcceleration(tuiConfig)}
        viewportOptions={{ paddingRight: 0 }}
        verticalScrollbarOptions={{ paddingLeft: 1, visible: true }}
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
            <For each={grid().canvas}>
              {(row, index) => (
                <box
                  position="absolute"
                  left={rowSpans(row).start}
                  top={index()}
                  width={contentWidth()}
                  height={1}
                  zIndex={0}
                >
                  <text wrapMode="none">
                    <For each={rowSpans(row).spans}>{(span) => <span style={{ fg: span.fg }}>{span.text}</span>}</For>
                  </text>
                </box>
              )}
            </For>
            {/* 标签浮层 zIndex 5:在连线之上。标签的占位本就在走廊里,不会压到卡片。 */}
            <For each={grid().labels}>{(label) => <FlowLabel x={label.x} y={label.y} text={label.text} />}</For>
            <For each={layout().nodes}>
              {(node) => (
                <box position="absolute" left={node.rect.x} top={node.rect.y} width={NODE_WIDTH} zIndex={10}>
                  <AssistantCard
                    gradientStops={semanticStops(theme, roleOf(node.kind))}
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
                    <text fg={theme.text} wrapMode="none">
                      {Locale.oneLineToWidth(node.title, NODE_CONTENT_COLUMNS - 1)}
                    </text>
                  </AssistantCard>
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
                        {/* 详情按框里的格数截断:多出来的不会换行撑破框,也不会被终端裁掉半行。
                            框只有这么多格,完整正文要去气泡视图看 —— 画布底部那行提示就是这么说的。 */}
                        <text fg={theme.textMuted} wrapMode="none">
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
