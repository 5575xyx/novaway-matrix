/** @jsxImportSource @opentui/solid */
// D3 流程图画布的**渲染**测试。
//
// 纯函数那一半(节点/边/布局/走线)在 flow-layout.test.ts 里,连线字符层在 flow-grid.test.ts 里;
// 这里钉的是「屏幕上真的出现了什么」:节点卡是不是真的用了生产卡壳(渐变描边圆角 `╭`)、连线是不是
// 真的落在走廊里(`│` `─` `┐`)、箭头有没有、轮次分隔线与它的 `第 N 轮` 标签在不在、
// 点击能不能展开详情、**能不能按住拖动**、**关掉动画之后画布还在不在**。
//
// 画布组件只依赖 useTheme()/useKV()/终端尺寸,所以直接用 ThemeTestProviders 挂真壳,
// 不必为了测试去 mock 一整个 session —— 数据喂 fixture(与 flow-layout.test.ts 同一份)。
import { createSignal } from "solid-js"
import { expect, test } from "bun:test"
import type { Message, Part } from "@novaway/sdk-v2-latest/v2"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { FlowCanvas } from "../../src/component/flow/canvas"
import {
  COLUMN_PITCH,
  DETAIL_ROWS,
  GAP_X,
  GAP_Y,
  layoutNodes,
  LEFT_MARGIN,
  MAX_NODE_WIDTH,
  nodeContentColumns,
  nodeSize,
  RIGHT_MARGIN,
} from "../../src/component/flow/layout"
import { Locale } from "../../src/util/locale"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import {
  arrowCells,
  CANVAS_OFFSET_Y,
  cardColumns,
  distinctCardColumns,
  FIXTURE_MESSAGES,
  FIXTURE_MODEL,
  FIXTURE_PARTS,
  frameCell,
  lineColumns,
} from "../fixture/flow"

const MESSAGES: Message[] = FIXTURE_MESSAGES
const PARTS: Record<string, Part[]> = FIXTURE_PARTS
/** 升序去重(列锚 / 行锚都用它)。 */
function gridLines(values: readonly number[]) {
  return [...new Set(values)].toSorted((a, b) => a - b)
}

/** 第 index 列的列锚(与 layout 的 layoutNodes 里那段累加同一套算式)。 */
function columnX(layout: { columnWidths: readonly number[] }, index: number) {
  let x = LEFT_MARGIN
  for (let i = 0; i < index; i++) x += layout.columnWidths[i]! + GAP_X
  return x
}

async function mount(
  width: number,
  height: number,
  options: {
    messages?: () => readonly Message[]
    parts?: () => Record<string, Part[]>
    reveal?: boolean
    /** 画布盒子本身多宽(列)。缺省 = 整个终端宽。真实会话里侧栏展开时它比终端窄得多。 */
    box?: number
    onScrollBox?: (box: ScrollBoxRenderable) => void
    onOverrides?: (overrides: Record<string, { x: number; y: number }>) => void
  } = {},
) {
  const canvas = () => (
    <FlowCanvas
      messages={options.messages?.() ?? MESSAGES}
      parts={options.parts?.() ?? PARTS}
      reveal={options.reveal}
      onScrollBox={options.onScrollBox}
      onOverrides={options.onOverrides}
    />
  )
  return testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        {options.box === undefined ? canvas() : <box width={options.box}>{canvas()}</box>}
      </ThemeTestProviders>
    ),
    { width, height },
  )
}

/**
 * 等到「画布真的画完了」再返回。
 *
 * 连线是分帧揭示的(原型 edgeDraw,每 60ms 一帧),所以第一帧只有第一条边的一小段。
 * 判据不能是「看到某个字就停」——`▸` 在第一条边揭示完就出现了,那时其余的边还没画。
 * 也不能是「连续两帧相同」:轮询间隔 25ms 短于揭示的一帧(60ms),两次采样很容易落在同一帧里,
 * 于是刚揭开第一帧就被判成「稳定」。
 *
 * 所以要连续 **6 帧**相同才算稳定:6 × 25ms ≈ 150ms > 60ms,中间至少跨过一次揭示,
 * 而揭示走完之后画面确实不再变(相位推到上限就停)。
 *
 * `reveal: false` 的那批用例不播动画,第一帧就是终态,所以只要一帧就够 —— 用同一个判据也不会
 * 多等(它本来就稳定)。
 */
const STABLE_FRAMES = 6

async function settled(app: Awaited<ReturnType<typeof mount>>, want: string) {
  let previous = ""
  let stable = 0
  let frame = ""
  for (let attempt = 0; attempt < 400; attempt++) {
    await app.renderOnce()
    frame = app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
    stable = frame === previous ? stable + 1 : 0
    previous = frame
    if (stable >= STABLE_FRAMES && frame.includes(want)) return frame.split("\n")
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`画布未在 400 轮内稳定,实际帧:\n${frame}`)
}

/**
 * 取一帧,等到「画布真的稳定且出现了某个标记」为止。
 *
 * `want` 默认是 `第 2 轮`(轮次分隔线)。**40 列那一档要换标记**:单列排布下整张图有 100 行上下,
 * 而视口只有 130 行,`第 2 轮` 那条分隔线仍然在画面外 —— 那时候判据换成第 1 轮的卡头。
 */
async function render(width: number, height = 64, options?: Parameters<typeof mount>[2], want = "第 2 轮") {
  const app = await mount(width, height, options)
  try {
    return await settled(app, want)
  } finally {
    app.renderer.destroy()
  }
}

test("流程图画布:节点卡用生产卡壳画出渐变描边圆角,七类语义都在", async () => {
  const frame = (await render(96, 64, { reveal: false })).join("\n")
  // 圆角边框 = NeonBox 自己画的(复用 NeonCard 的直接证据,不是手搓的 `┌`)。
  expect(frame).toContain("╭")
  expect(frame).toContain("╰")
  for (const label of ["用户输入", "任务拆解", "工具调用", "子代理", "编辑文件", "NovaWay", "本轮结束"]) {
    expect(frame, label).toContain(label)
  }
})

// 这条把 layout 的 nodeSize 与真实渲染钉在一起:NeonBox 的内边距行**就是**边框行,
// padding 不额外占行;而卡高按节点类型在 4~7 行之间变,所以每一种都要量一遍。
// 写错的话连线的中线会落到卡片底边框那一行,每条线都贴着卡片下沿横穿。
test("流程图画布:卡片的真实高度就是 nodeSize(kind) 那一档(边框行 = 内边距行)", async () => {
  const lines = await render(96, 64, { reveal: false })
  const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT)
  let measured = 0
  for (const node of layout.nodes) {
    const top = node.rect.y + CANVAS_OFFSET_Y
    const size = nodeSize(node.kind)
    // 卡顶边框就在 `rect.y` 那一行,卡底边框在 `rect.y + 高 − 1` —— 逐格取,不去「找第一个
    // `╰`」,否则同一列下方还有别的卡时会量到那一张的底边框(这一列下方常常就是下一轮)。
    if (lineColumns(lines[top] ?? "")[node.rect.x] !== "╭") continue
    measured += 1
    // 高卡在 40~64 行的视口里看得不全,这一档只断言「看得见的那几张」。
    if (top + size.height > lines.length) continue
    expect(lineColumns(lines[top + size.height - 1]!)[node.rect.x], `${node.kind} 的卡底边框`).toBe("╰")
    expect(lineColumns(lines[top] ?? "")[node.rect.x + size.width - 1], `${node.kind} 的卡宽`).toBe("╮")
  }
  expect(measured, "一张卡都没量到,这条等于空跑").toBeGreaterThan(3)
  // 高度确实分档:最高的 7 行、最矮的 4 行,差 3 行。
  expect(nodeSize("edit").height - nodeSize("fend").height).toBe(3)
})

test("流程图画布:「本轮结束」那颗药丸居中、没有折叠箭头,点它什么也不发生", async () => {
  const app = await mount(96, 64, { reveal: false })
  try {
    const lines = await settled(app, "第 2 轮")
    const row = lines.findIndex((line) => line.includes("⏹ 本轮结束"))
    expect(row, "药丸没有画出来").toBeGreaterThan(0)
    const cell = lineColumns(lines[row]!)
    const left = cell.indexOf("⏹")
    const text = Locale.displayWidth("⏹ 本轮结束")
    // 卡内 padding 左 2 右 1(边框不占格),所以内容区是 `[rect.x + 2, rect.x + width − 2)`,
    // 宽 `卡宽 − 3` 列。第一行居中 ⇒ 左右留白差不超过 1 列。
    const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT)
    const pill = layout.nodes.find((node) => node.kind === "fend")!
    const inner = pill.rect.width - 3
    const offset = left - pill.rect.x - 2
    expect(offset, "药丸那一行应该落在内容区里").toBeGreaterThanOrEqual(0)
    expect(offset + text).toBeLessThanOrEqual(inner)
    expect(Math.abs(offset - (inner - offset - text)), "药丸那一行居中").toBeLessThanOrEqual(1)
    // **药丸那一行没有 `▸`**:原型的 `.fcard.fend` 干脆就没有 `.fc-caret`。
    expect(lines[row]).not.toContain("▸")
    // 第二行是「第 N 轮 · 等待新指令…」,按卡内可用列数截断(见 RoundEndPill)。
    expect(lines[row + 1]).toContain("第 1 轮")
    // 点它不展开:整张画布上不会出现 `▾`,详情也不会出现。
    await app.mockMouse.click(left + 1, row)
    for (let attempt = 0; attempt < 20; attempt++) {
      await app.renderOnce()
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(app.captureCharFrame()).not.toContain("▾")
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:最后一条回复卡挂着「最新」徽标", async () => {
  const lines = await render(96, 64, { reveal: false })
  const last = [...FIXTURE_MODEL.nodes].reverse().find((node) => node.kind === "reply")!
  expect(last.badge, "最后一条回复卡该有徽标").toBe("最新")
  expect(FIXTURE_MODEL.nodes.filter((node) => node.badge).length, "只有一张卡挂徽标").toBe(1)
  const rows = lines.flatMap((line, index) => (line.includes("最新") ? [index] : []))
  expect(rows.length, "帧里没有「最新」").toBe(1)
  // 徽标与标题**同一行**,而那一行的上一行是卡头行(原型把 `.fc-new` 放在 `.fc-row` 里,
  // 我们那一行要塞 `● 类型 + meta + ▸`,塞不下第三个彩色块,见 NodeCardBody 的注释)。
  const row = rows[0]!
  expect(lines[row], "徽标与标题同一行").toContain(last.title.slice(0, 4))
  expect(lines[row - 1], "徽标行的上一行是卡头行").toContain("● NovaWay")
  expect(lines[row - 1], "卡头行不该有徽标").not.toContain("最新")
})

test("流程图画布:连线用带折点的正交折线画出来,终点是箭头", async () => {
  const frame = (await render(96, 64, { reveal: false })).join("\n")
  expect(frame).toContain("│")
  expect(frame).toContain("─")
  // 圆角拐角 —— 与卡片边框同一套字符(见 layout 的 CORNER_CHARS)。
  expect(/[╭╮╰╯]/.test(frame), "连线折点应有圆角拐角").toBe(true)
  expect(frame).toContain("▸")
  expect(frame).toContain("▼")
})

test("流程图画布:连线标签与轮次分隔线都画出来", async () => {
  const frame = (await render(96, 64, { reveal: false })).join("\n")
  expect(frame).toContain("并行 · 工具")
  expect(frame).toContain("并行 · 子代理")
  // 分隔线只画在第 2 轮及以后(第 1 轮是起点,原型也没有它那条线),
  // 但两张「本轮结束」卡的 meta 各写着自己的轮次号,所以两个轮次号都看得见。
  expect(frame).toContain("第 2 轮")
  expect(frame).toContain("第 1 轮")
  expect(frame).toContain("用户请求")
  expect(frame).toContain("本轮完成")
  expect(frame).toContain("新消息")
})

// 每条边的标签都摆上了,每条边都以一个箭头收尾。
// 箭头数用**模型算出来的格子集合**去对,而不是写死:收束的两条边(工具→编辑文件、
// 子代理→编辑文件)进入的是同一格,两个箭头叠在一格上画出来就是一个 —— 一张卡只需要一个
// 「箭头指进来」,所以边数与箭头格数本来就不相等。
test("流程图画布:每条边的标签都摆上了,每个箭头格子都被画出来", async () => {
  const lines = await render(96, 64, { reveal: false })
  for (const label of [
    "用户请求",
    "并行 · 工具",
    "并行 · 子代理",
    "✓ 完成",
    "子代理完成",
    "已编辑",
    "本轮完成",
    "新消息",
  ]) {
    expect(lines.filter((line) => line.includes(label)).length, `${label} 应出现`).toBeGreaterThan(0)
  }
  // 卡片上的折叠箭头(卡头那一行有 `●`)与连线箭头不是同一个东西,分开数。
  const edgeLines = lines.filter((line) => !line.includes("●"))
  const arrows = edgeLines
    .join("")
    .split("")
    .filter((char) => char === "▸" || char === "▼").length
  const layout = layoutNodes(FIXTURE_MODEL.nodes, 90)
  expect(arrows, "箭头格数应与模型算出来的一致").toBe(arrowCells(FIXTURE_MODEL, layout).size)
  // 反过来钉一次:每一张**看得见的**卡头都必须带折叠箭头(原型 .fc-caret)。
  // 用「看得见的」限定,是因为 40 行视口下末尾那几张卡已经被裁掉了。
  const heads = lines.filter((line) => line.includes("│ ●"))
  expect(heads.length).toBeGreaterThan(0)
  for (const head of heads) expect(head, "卡头缺折叠箭头").toContain("▸")
  // 「本轮结束」那颗药丸**没有**折叠箭头(原型干脆没给它 `.fc-caret`)——所以上面那一条
  // 只对六类带卡头的卡成立,药丸不在其中。
  expect(lines.filter((line) => line.includes("│ ● 本轮结束"))).toEqual([])
  expect(lines.filter((line) => line.includes("⏹ 本轮结束")).length).toBe(2)
})

// ---------- C1:关掉动画 = 终态,不是「不揭示」 ----------
//
// 原来 `if (!animations_enabled) return` 让 frame 永远停在 0,于是「一条线都不画、标签全不摆」,
// 用户看到的是一列孤零零的卡片 —— 那是把功能关掉了,不是「关掉动画」。
// 这里用 `reveal={false}` 那个注入口来测:测试不能从 KV 那一侧拨这个开关(KVProvider 写的是
// 共享的 state/kv.json,见 test/component/prompt-card.test.tsx:319)。
test("流程图画布:关掉动画时画布显示**终态** —— 线、箭头、边标签一样不少", async () => {
  const still = (await render(96, 64, { reveal: false })).join("\n")
  const animated = (await render(96, 64)).join("\n")
  for (const marker of ["╭", "│", "─", "▸", "▼", "并行 · 工具", "并行 · 子代理", "用户请求", "本轮完成", "新消息"]) {
    expect(still, `关动画后应仍有 ${marker}`).toContain(marker)
  }
  // 关动画的帧与动画走完的帧**逐字相同** —— 这就是「终态」的定义。
  expect(still).toBe(animated)
})

// ---------- I4:详情框真的折成多行 ----------
test("流程图画布:展开的详情框真的折成多行,不是 1 行字配 5 行空底色", async () => {
  const app = await mount(96, 64, { reveal: false })
  try {
    const lines = await settled(app, "第 2 轮")
    // 挑输出最长的那张卡(fixture 里 task 工具的输出有六十几字),否则折行与不折行看起来一样,
    // 这条断言就废了。**必须带 `│ ●` 限定**:底部图例里也有「子代理」三个字,不加限定会点到图例上。
    const row = lines.findIndex((line) => line.includes("│ ● 子代理"))
    expect(row).toBeGreaterThan(0)
    await app.mockMouse.click(8, row)
    let opened = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      opened = app.captureCharFrame()
      if (opened.includes("▾")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const openedLines = opened.split("\n").map((line) => line.replace(/\s+$/, ""))
    const cardRow = openedLines.findIndex((line) => line.includes("▾"))
    expect(cardRow).toBeGreaterThan(0)
    // 卡片下边框之下、DETAIL_ROWS(6)行之内,数有几行真的印着字。
    // 卡内竖线是 NeonBox 自绘的边框,█ 是 scrollbox 的滚动条,两者都不算正文。
    const inner = (line: string) => line.replace(/[│█\s]/g, "")
    const detailRows = openedLines
      .slice(cardRow + 2, cardRow + 2 + DETAIL_ROWS)
      .filter((line) => inner(line).length > 0)
    expect(detailRows.length, `详情框里只有 ${detailRows.length} 行有内容`).toBeGreaterThanOrEqual(4)
    // 每一行的字都真的在里面(逐行取一段,证明不是同一行被数了几遍)。
    // 正文按「框里一共放得下多少列」截断,所以只断言**前 150 列之内**的内容。
    const joined = detailRows.map(inner).join("")
    expect(joined).toContain("读了")
    expect(joined).toContain("定位到")
    expect(joined).toContain("transition")
    // 正文按「框里一共放得下多少列」截断,而框宽是**那张卡**的卡内可用列数(见 detailColumns),
    // 所以断言只看预算之内的那一段 —— 超出预算的正文在模型侧就已经被截掉了,帧上当然找不到。
    expect(joined.length, "详情正文没有超出预算").toBeLessThanOrEqual(DETAIL_ROWS * nodeContentColumns("subagent"))
  } finally {
    app.renderer.destroy()
  }
})

// ---------- I5:展开的节点不能把连线切断 ----------
//
// 详情面板是不透明的,占的是卡片正下方那几行。原来的通道行恰好是 from.y + NODE_HEIGHT,
// 于是横段被面板整段吞掉。现在行带里只要有一张卡是展开的,整条行带的换行边都改从左边进走廊、
// 通道基准落到行带下沿 —— 那里整幅宽度都是空的。
//
// 这里不挑「展开哪一张」:直接拿**模型算出来的每一个箭头格子**去帧里核对。箭头是每条边的收尾,
// 它落在目标卡边界上那一格;只要有一格不见了,就是那条边被切断了 —— 不管它是被面板吞掉、
// 还是被后面的边盖掉、还是算错了坐标。
test("流程图画布:展开某个节点之后,每条边的箭头格子仍然可见", async () => {
  // 高度给 80:展开会把**整条行带**撑高 DETAIL_ROWS 行,后面每一行带跟着下移 ——
  // 64 行的视口里最后一轮的卡片已经被裁到画面外,「每一格箭头都看得见」这句话就没法验了。
  const app = await mount(96, 80, { reveal: false })
  try {
    const lines = await settled(app, "第 2 轮")
    const head = lines.findIndex((line) => line.includes("用户输入"))
    expect(head).toBeGreaterThan(0)
    await app.mockMouse.click(8, head)
    let opened = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      opened = app.captureCharFrame()
      if (opened.includes("▾")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(opened).toContain("▾")
    const after = opened.split("\n").map((line) => line.replace(/\s+$/, ""))
    // 视口 94 列,与渲染时算布局用的宽度一致(VIEWPORT)。
    const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT, { expandedId: "n:msg_1" })
    const missing = [...arrowCells(FIXTURE_MODEL, layout)].filter((key) => {
      const [x, y] = key.split(":").map(Number)
      const char = frameCell(after, y + CANVAS_OFFSET_Y, x)
      return char !== "▸" && char !== "▼"
    })
    expect(missing, "展开后这些箭头的位置上没有箭头").toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:点节点卡展开详情框,再点一次收起", async () => {
  const app = await mount(96, 64, { reveal: false })
  try {
    const lines = await settled(app, "第 2 轮")
    const row = lines.findIndex((line) => line.includes("工具调用"))
    expect(row).toBeGreaterThan(0)
    expect(lines[row]!.includes("▾"), "未选中时不该有展开箭头").toBe(false)
    await app.mockMouse.click(8, row)
    let opened = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      opened = app.captureCharFrame()
      if (opened.includes("▾")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(opened).toContain("▾")
    // 工具输出确实在里面(选的是输出最长的 task 卡,正文里有这两段)。
    expect(opened).toContain("Explorer")
    const again = opened.split("\n").findIndex((line) => line.includes("工具调用"))
    await app.mockMouse.click(8, again)
    let closed = opened
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      closed = app.captureCharFrame()
      if (!closed.includes("▾")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(closed).not.toContain("▾")
  } finally {
    app.renderer.destroy()
  }
})

// ---------- I7:把滚动容器交出去 ----------
// 会话页的翻页 / 跳消息命令要作用在**当前活着的那个**滚动容器上,而气泡视图那个 scrollbox
// 在流程图视图里根本没挂载。画布通过 onScrollBox 把它自己那个交出去。
test("流程图画布:把自己的滚动容器交给调用方(会话页的翻页命令靠它)", async () => {
  let handed: ScrollBoxRenderable | undefined
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <FlowCanvas messages={MESSAGES} parts={PARTS} reveal={false} onScrollBox={(box) => (handed = box)} />
      </ThemeTestProviders>
    ),
    { width: 96, height: 30 },
  )
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      if (handed) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(handed, "画布没有把滚动容器交出来").toBeDefined()
    expect(handed!.isDestroyed).toBe(false)
    // 交出来的得是**能滚的**那一个:内容比视口高才谈得上翻页。
    expect(handed!.scrollHeight).toBeGreaterThan(handed!.height)
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:空会话说清为什么空,不画一片空白", async () => {
  // 真的要**没有消息**:只把 parts 清空的话,三条消息还在,画布上会有节点。
  const app = await mount(72, 12, { messages: () => [], parts: () => ({}) })
  try {
    let frame = ""
    for (let attempt = 0; attempt < 200; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("READY") && frame.includes("还没有")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame).toContain("还没有能画成节点的消息")
    expect(frame).not.toContain("╭")
  } finally {
    app.renderer.destroy()
  }
})

// ---------- M9:常见宽度必须排得下两列 ----------
//
// 视口 = 盒子宽 − 2(竖滚动条那一块:`paddingLeft: 1` + 轨道)。新步距是
// COLUMN_PITCH = 最宽的卡(24) + 走廊(16) = 40,所以两列要
// LEFT_MARGIN + COLUMN_PITCH + MAX_NODE_WIDTH = 66 列 —— 80 列终端(视口 78)排两列余 12 列。
// 三列要视口 ≥ 106:120 列终端(视口 114)刚好排下三列,而三列的内容宽
// 2 + 2×40 + 24 + 1 = 107 ≤ 114,不必横向滚。**诚实的上限是三列**:四列要 147 列内容宽,
// 只有 ≥ 150 列的终端才装得下(见 layout 的 bandColumns 注释)。
test("流程图画布:80 列排下两列,120 列排下三列,卡片都在画面内", async () => {
  const narrow = await render(80, 60, { reveal: false })
  const wide = await render(120, 60, { reveal: false })
  for (const [width, lines] of [
    [80, narrow],
    [120, wide],
  ] as const) {
    const viewport = width - 2
    const layout = layoutNodes(FIXTURE_MODEL.nodes, viewport)
    let checked = 0
    for (const node of layout.nodes) {
      const row = lines[node.rect.y + CANVAS_OFFSET_Y]
      if (!row) continue
      // 右边被横向裁掉的卡只量左沿那一段(见下面那句「卡片都在画面内」)。
      expect(lineColumns(row)[node.rect.x], `${node.id} 的卡顶边框`).toBe("╭")
      if (node.rect.x + node.rect.width - 1 >= viewport) continue
      checked += 1
      const cells = lineColumns(row)
      expect(cells[node.rect.x + node.rect.width - 1], `${node.id} 的卡右边界`).toBe("╮")
      expect(
        cells.slice(node.rect.x + 1, node.rect.x + node.rect.width - 1).every((cell) => cell === "─"),
        `${node.id} 的顶边框`,
      ).toBe(true)
    }
    expect(checked, `${width} 列一张完整卡片都没量到`).toBeGreaterThan(4)
    // 卡片行整体不超宽。
    for (const row of lines.filter((line) => line.includes("╭") && line.includes("╮"))) {
      expect(Locale.displayWidth(row), `${width} 列的卡片行`).toBeLessThanOrEqual(width)
    }
  }
  // 列数按**卡头行**数:右侧被横向裁掉的卡(60 列那一档)卡头仍看得见,所以仍然算一列。
  expect(cardColumns(narrow), "80 列的卡片列").toEqual([LEFT_MARGIN, LEFT_MARGIN + COLUMN_PITCH])
  expect(distinctCardColumns(narrow), "80 列应有两列").toBe(2)
  expect(distinctCardColumns(wide), "120 列应有三列").toBe(3)
})

// ---------- 画布按**内容**尺寸排布,两轴都能滚 ----------
//
// 原来的取宽是 `dimensions().width − 6`,也就是**终端**宽减 6。而真实会话里画布盒子是
// `终端宽 − 侧栏宽 − 4`(routes/session/index.tsx 的 paddingLeft/Right 各 2),80 列终端 +
// 30 列侧栏只剩 46 列 —— 画布却按 74 列排布,右边那一整列卡片直接被裁掉,而且 scrollbox
// 没开横向滚动,那一列**根本够不着**。这就是「右侧节点被截断」。
//
// 这里把盒子宽度显式压到 50 列(视口 48 ≥ 40 = 一张最宽的卡 + 一条走廊,所以仍是两列)
// 复现那一幕,再钉住两件事:内容宽度是**图自己的宽度**;横向滚过去右边那列真的出现。
const SIDEBAR_BOX = 50
const SIDEBAR_VIEWPORT = SIDEBAR_BOX - 2

async function mountNarrowBox() {
  let handed: ScrollBoxRenderable | undefined
  // 高度给 80:节点卡高按类型在 4~7 行之间变之后,两列排布下整张图有 70 行上下,
  // 40 行视口里 `第 2 轮` 那条分隔线已经在画面外了。
  const app = await mount(120, 80, { reveal: false, box: SIDEBAR_BOX, onScrollBox: (box) => (handed = box) })
  // 等画面稳定:画布的取宽是**量自己盒子**得到的,首帧 yoga 还没落定,那之前走的是
  // 「终端宽 − 6」那一档兜底(见 canvas 的 viewportWidth)。不等到稳定就会量到兜底值。
  const lines = await settled(app, "第 2 轮")
  return { app, handed: handed!, lines }
}

/**
 * 右边那一列卡片的**右边框**那一列。
 *
 * 列 x 是从 `columnWidths`(每一列在整幅图上最宽的那张卡)推出来的,所以右边框那一列要**算**,
 * 不能写死 —— 第二列的列锚是 `LEFT_MARGIN + columnWidths[0] + GAP_X`。
 */
function rightBorderColumn(layout: ReturnType<typeof layoutNodes>, kind: "plan" | "edit") {
  const column = columnX(layout, 1)
  const node = layout.nodes.find((item) => item.rect.x === column && item.kind === kind)!
  return { column, border: column + nodeSize(kind).width - 1, top: node.rect.y }
}

test("流程图画布:盒子比终端窄很多时按**内容**宽度排布(而不是被视口裁掉)", async () => {
  const { app, handed, lines } = await mountNarrowBox()
  try {
    const layout = layoutNodes(FIXTURE_MODEL.nodes, SIDEBAR_VIEWPORT)
    const columns = gridLines(layout.nodes.map((node) => node.rect.x))
    expect(columns.length, "50 列盒子仍应排两列").toBe(2)
    expect(layout.width).toBeLessThanOrEqual(LEFT_MARGIN + COLUMN_PITCH + MAX_NODE_WIDTH + RIGHT_MARGIN)
    expect(layout.width).toBeGreaterThan(SIDEBAR_VIEWPORT)
    // scrollbox 的内容比视口宽 —— 差出来的那一截就是横向滚动范围。
    expect(handed.scrollWidth, "内容宽度应是图自己的宽度").toBe(layout.width)
    expect(handed.scrollWidth).toBeGreaterThan(handed.viewport.width)
    // 右边那一列卡片的右边框初始落在画面之外(这正是被截断的那一幕),滚到最右才看得见。
    // 注意横向滚动是把内容往左搬,所以取帧时列号要减掉 scrollLeft。
    const { border, top } = rightBorderColumn(layout, "plan")
    expect(frameCell(lines, top + 1 + CANVAS_OFFSET_Y, border), "未滚动时右边框被裁掉").not.toBe("│")
    handed.scrollTo({ x: handed.scrollWidth, y: handed.scrollTop })
    expect(handed.scrollLeft).toBe(handed.scrollWidth - handed.viewport.width)
    await app.renderOnce()
    expect(frameCell(app.captureCharFrame().split("\n"), top + 1 + CANVAS_OFFSET_Y, border - handed.scrollLeft)).toBe(
      "│",
    )
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:滚动容器两轴都真的能滚(翻页/换行命令走的就是它)", async () => {
  const { app, handed } = await mountNarrowBox()
  try {
    expect(handed.scrollHeight).toBeGreaterThan(handed.viewport.height)
    // 纵向:换行/翻页命令那一族用的是 `scrollBy(数)`。
    const top = handed.scrollTop
    handed.scrollBy(1)
    expect(handed.scrollTop, "纵向 scrollBy(1)").toBe(top + 1)
    handed.scrollBy(-1)
    expect(handed.scrollTop).toBe(top)
    // 纵向翻页(会话页 `session.page.down` 用的那一档)。
    handed.scrollBy(handed.viewport.height / 2)
    expect(handed.scrollTop).toBeGreaterThan(top)
    // 横向:`scrollBy({x, y})` 的两轴必须分别作用在两根滚动条上。
    expect(handed.scrollLeft).toBe(0)
    handed.scrollBy({ x: 5, y: 0 })
    expect(handed.scrollLeft, "横向 scrollBy({x})").toBe(5)
    handed.scrollBy({ x: 0, y: 0 })
    expect(handed.scrollLeft, "y 为 0 时横向不动").toBe(5)
    handed.scrollBy({ x: -5, y: 0 })
    expect(handed.scrollLeft, "横向往回滚").toBe(0)
    handed.scrollTo({ x: 12, y: top })
    expect(handed.scrollLeft).toBe(12)
    expect(handed.scrollTop).toBe(top)
    await app.renderOnce()
  } finally {
    app.renderer.destroy()
  }
})

// 40 / 60 / 80 列各自的降级形态。判据是**帧里真的有几列卡片**,不是布局函数返回什么。
// 40 列那一档单列排布,图有 100 行上下,所以标记换成第 1 轮的卡头而不是 `第 2 轮`。
test("流程图画布:40 列退化成单列,60 与 80 列都是两列", async () => {
  for (const [width, height, columns, want] of [
    [40, 130, 1, "用户输入"],
    [60, 64, 2, "第 2 轮"],
    [80, 64, 2, "第 2 轮"],
  ] as const) {
    const lines = await render(width, height, { reveal: false }, want)
    expect(distinctCardColumns(lines), `${width} 列应有 ${columns} 列卡片`).toBe(columns)
  }
})

// 60 列:两列行带 66 列 > 视口 58,右边那一列被切掉一截,但差出来的那一截能横向滚过去。
test("流程图画布:60 列下第二列被切掉右边框,横向滚过去就完整了", async () => {
  let handed: ScrollBoxRenderable | undefined
  const app = await mount(60, 80, { reveal: false, onScrollBox: (box) => (handed = box) })
  try {
    const lines = await settled(app, "第 2 轮")
    const layout = layoutNodes(FIXTURE_MODEL.nodes, 58)
    expect(handed!.scrollWidth).toBe(layout.width)
    expect(handed!.scrollWidth).toBeGreaterThan(handed!.viewport.width)
    const { border, top } = rightBorderColumn(layout, "plan")
    expect(frameCell(lines, top + 1 + CANVAS_OFFSET_Y, border), "未滚动时右边框被裁掉").not.toBe("│")
    handed!.scrollTo({ x: handed!.scrollWidth, y: 0 })
    await app.renderOnce()
    expect(frameCell(app.captureCharFrame().split("\n"), top + 1 + CANVAS_OFFSET_Y, border - handed!.scrollLeft)).toBe(
      "│",
    )
  } finally {
    app.renderer.destroy()
  }
})

// ---------- 拖拽 ----------
//
// 走的是 opentui 的那套事件:`onMouseDown` / `onMouseDrag` / `onMouseDragEnd` / `onMouseUp`
// (见 canvas.tsx 的注释)。测试这一侧对应 `createMockMouse` 的 `pressDown` / `moveTo` /
// `release` —— 按住时 `moveTo` 发的是 drag 事件,和真终端一模一样。
//
// 屏幕坐标与画布坐标的换算:96 列下画布内容 67 列 < 视口 94 列,所以**没有滚动**,
// 画布第 x 列就是帧第 x 列、第 y 行就是帧第 y + CANVAS_OFFSET_Y 行(READY 哨兵占掉第 0 行)。
//
// **视口 = 终端宽 − 2**:那 2 列是竖滚动条那一块(`paddingLeft: 1` + 轨道,见 canvas 的
// SCROLLBAR_COLUMNS)。测试里凡是拿布局结果去对帧的地方,都必须用同一个数 —— 上一版这里
// 写的是 `96 − 2 − 2`,于是「卡片的真实高度」那条拿 92 列的布局去对 94 列的帧,列数都不同,
// 对出来的是另一张图的坐标。
const VIEWPORT = 96 - 2

/** 一张卡在帧里的那一格(用画布坐标)。 */
function cellAt(app: { captureCharFrame: () => string }, canvasY: number, canvasX: number) {
  return frameCell(app.captureCharFrame().split("\n"), canvasY + CANVAS_OFFSET_Y, canvasX)
}

/** 卡头行(帧行号)。判据是 `│ ● <类型文字>`,每张卡只有一行长这样(底部图例那一行前面没有 `│`)。 */
function headRow(app: { captureCharFrame: () => string }, kind: string, from = 0) {
  return app
    .captureCharFrame()
    .split("\n")
    .findIndex((line, index) => index >= from && line.includes(`│ ● ${kind}`))
}

/**
 * 把一张卡拖到「它右边那一列上、离它最近的一个**合法**落点」—— 与 flow-layout.test 里那份
 * `nearestEmptyAnchor` 同一套判据(snapDrag 会给哪一种落点,见 layout 的 snapDrag)。
 * 列 x 从 `columnWidths` 推出来,所以「右边那一列」只能算,不能写死。
 */
function dropTarget(layout: ReturnType<typeof layoutNodes>, id: string) {
  const card = layout.nodes.find((item) => item.id === id)!
  const occupied = layout.nodes.flatMap((node) => (node.detailRect ? [node.rect, node.detailRect] : [node.rect]))
  const others = occupied.filter((rect) => !(rect.x === card.rect.x && rect.y === card.rect.y))
  // 列 x 从 columnWidths 累加出来,所以「右边那一列」是算出来的(见 layout 的 layoutNodes)。
  const slot = layout.columnWidths.findIndex((_, index) => columnX(layout, index) === card.rect.x)
  const column = columnX(layout, slot + 1)
  const found = layout.anchors
    .filter(
      (anchor) =>
        anchor.x === column &&
        anchor.y !== card.rect.y &&
        anchor.y + card.rect.height <= anchor.bandBottom &&
        !others.some(
          (rect) =>
            rect.x < anchor.x + card.rect.width &&
            anchor.x < rect.x + rect.width &&
            rect.y < anchor.y + card.rect.height &&
            anchor.y < rect.y + rect.height,
        ),
    )
    .toSorted((a, b) => Math.abs(a.y - card.rect.y) - Math.abs(b.y - card.rect.y))
    .at(0)
  if (!found) throw new Error(`${id} 右边那一列上没有合法落点`)
  return { x: found.x, y: found.y }
}

test("流程图画布:按住拖动把节点卡挪到网格锚点上,连线跟着重画", async () => {
  const seen: Record<string, { x: number; y: number }>[] = []
  const app = await mount(96, 64, { reveal: false, onOverrides: (value) => seen.push(value) })
  try {
    await settled(app, "第 2 轮")
    // 拿「工具调用」那张卡(fixture 里的第一个工具节点):它自动摆在第 0 列,右边那一列上
    // 有一个空着的行锚 —— 拖过去正好落在网格上。
    const node = FIXTURE_MODEL.nodes.find((item) => item.id === "n:pr_3")!
    const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT)
    const from = layout.nodes.find((item) => item.id === node.id)!
    const target = dropTarget(layout, "n:pr_3")
    // 卡宽按类型在变,所以位置与尺寸都从布局里读,不写死。
    expect(from.rect).toEqual({ x: LEFT_MARGIN, y: 9, width: nodeSize("tool").width, height: nodeSize("tool").height })
    expect(target.x).toBe(LEFT_MARGIN + layout.columnWidths[0]! + GAP_X)
    // 按下之前:卡在原来的位置,箭头也在原来的格子上。
    const before = arrowCells(FIXTURE_MODEL, layout)
    expect(cellAt(app, from.rect.y + 1, from.rect.x + 2), "拖之前卡头在原位").toBe("●")

    const pressRow = from.rect.y + 1 + CANVAS_OFFSET_Y
    await app.mockMouse.pressDown(from.rect.x + 8, pressRow)
    await app.mockMouse.moveTo(target.x + 8, target.y + 1 + CANVAS_OFFSET_Y)
    await app.renderOnce()

    // 拖动中的两样「抓手」信号:抓手字 + 层级抬高(后者不在这条断言里,见 FLOW_DRAG_ALPHA)。
    const dragging = app.captureCharFrame()
    expect(dragging, "拖动中卡头右侧换成抓手").toContain("⠿")
    // 卡已经落到目标格子(顶上那一行是卡边框)。
    expect(frameCell(dragging.split("\n"), target.y + CANVAS_OFFSET_Y, target.x), "落点没有对齐到网格").toBe("╭")

    await app.mockMouse.release(target.x + 8, target.y + 1 + CANVAS_OFFSET_Y)
    let after = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      after = app.captureCharFrame()
      if (!after.includes("⠿")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(after.includes("⠿"), "松手后抓手收掉").toBe(false)

    // 组件里的落点与纯函数算出来的一致 —— 即拖动真的写进了 overrides(而不是只挪了个渲染位置)。
    expect(seen.at(-1)).toEqual({ "n:pr_3": target })
    const moved = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT, { overrides: { "n:pr_3": target } })
    const landed = moved.nodes.find((item) => item.id === node.id)!
    expect(landed.rect.x).toBe(target.x)
    expect(landed.rect.y).toBe(target.y)
    expect(frameCell(after.split("\n"), target.y + 1 + CANVAS_OFFSET_Y, target.x + 2), "卡头落在落点上").toBe("●")
    // 别的卡一步没动:子代理那张仍在原来的行上。
    const sibling = moved.nodes.find((item) => item.id === "n:pr_4")!
    expect(frameCell(after.split("\n"), sibling.rect.y + 1 + CANVAS_OFFSET_Y, sibling.rect.x + 2)).toBe("●")

    // 连线跟着重画:挪过之后的箭头集合与挪之前不同,而且**每一格都真的画在屏幕上**
    // (这就是「拖动中连线实时重算」的可观测证据)。
    const now = arrowCells(FIXTURE_MODEL, moved)
    expect(
      [...now].some((key) => !before.has(key)),
      "箭头格子应该变了",
    ).toBe(true)
    const missing = [...now].filter((key) => {
      const [x, y] = key.split(":").map(Number)
      const char = frameCell(after.split("\n"), y + CANVAS_OFFSET_Y, x)
      return char !== "▸" && char !== "▼" && char !== "▲"
    })
    expect(missing, "拖过之后这些箭头的位置上没有箭头").toEqual([])
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:位移不足一格不算拖(原地按下松开仍然展开详情),真拖过则不展开", async () => {
  const app = await mount(96, 64, { reveal: false })
  try {
    await settled(app, "第 2 轮")
    const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT)
    const node = layout.nodes.find((item) => item.id === "n:pr_3")!
    const pressRow = node.rect.y + 1 + CANVAS_OFFSET_Y

    // 按下 → 拖动半格 → 松手:既没有展开详情,卡也没有挪(吸附回原来的锚点)。
    await app.mockMouse.pressDown(node.rect.x + 8, pressRow)
    await app.mockMouse.moveTo(node.rect.x + 8 + 4, pressRow)
    await app.mockMouse.release(node.rect.x + 8 + 4, pressRow)
    let frame = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame.includes("⠿"), "半格位移不该进拖动态").toBe(false)
    expect(frameCell(frame.split("\n"), node.rect.y + 1 + CANVAS_OFFSET_Y, node.rect.x + 2), "卡还在原位").toBe("●")
    // 没展开:卡头右侧仍然是折叠的 `▸`。整个画布上只有展开的那张卡会写 `▾`,
    // 所以这是一个不会误判的判据(详情正文会折行,拿正文里的某一段来判反而不可靠)。
    expect(frame.includes("▾"), "半格位移不该顺手展开详情").toBe(false)

    // 真的拖一整步(一个列步距)过去:挪了,但**不展开**详情。
    const shift = layout.columnWidths[0]! + GAP_X
    await app.mockMouse.pressDown(node.rect.x + 8, pressRow)
    await app.mockMouse.moveTo(node.rect.x + 8 + shift, pressRow)
    await app.mockMouse.release(node.rect.x + 8 + shift, pressRow)
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frameCell(frame.split("\n"), node.rect.y + 1 + CANVAS_OFFSET_Y, node.rect.x + 2) !== "●") break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frameCell(frame.split("\n"), node.rect.y + 1 + CANVAS_OFFSET_Y, node.rect.x + 2), "卡还在原位").not.toBe("●")
    expect(frame.includes("▾"), "拖过不该顺手把详情也开了").toBe(false)

    // 接着原地点一下:这一次才展开(点与拖的分界就在这一格位移上)。
    const again = headRow(app, "工具调用")
    expect(again).toBeGreaterThan(0)
    await app.mockMouse.click(8, again)
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes("▾")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame, "原地点击仍然展开详情").toContain("▾")
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:拖落点按网格吸附,只挪那一张卡", async () => {
  const app = await mount(96, 64, { reveal: false })
  try {
    await settled(app, "第 2 轮")
    const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT)
    const node = layout.nodes.find((item) => item.id === "n:pr_3")!
    const pressRow = node.rect.y + 1 + CANVAS_OFFSET_Y
    const shift = layout.columnWidths[0]! + GAP_X
    const headBefore = cardColumns(app.captureCharFrame().split("\n"))

    // 位移不到半个列步距(40 / 2 = 20 列):最近的锚点仍然是**自己**这一格,于是哪也不去。
    // 这一档钉的是「吸附到最近的网格线」而不是「一动手就换列」。
    await app.mockMouse.pressDown(node.rect.x + 8, pressRow)
    await app.mockMouse.moveTo(node.rect.x + 8 + 10, pressRow + 2)
    await app.mockMouse.release(node.rect.x + 8 + 10, pressRow + 2)
    await app.renderOnce()
    expect(frameCell(app.captureCharFrame().split("\n"), node.rect.y + 1 + CANVAS_OFFSET_Y, node.rect.x + 2)).toBe("●")

    // 位移够一整步:落到隔壁列锚那一行的**最近合法锚点**。落点仍然是网格,不是随手放的位置 ——
    // 具体落哪一格由 snapDrag 判(见上面那份 dropTarget),所以这里把它算出来再对账。
    const target = dropTarget(layout, "n:pr_3")
    await app.mockMouse.pressDown(node.rect.x + 8, pressRow)
    await app.mockMouse.moveTo(node.rect.x + 8 + shift, pressRow + 1)
    await app.mockMouse.release(node.rect.x + 8 + shift, pressRow + 1)
    let frame = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frameCell(frame.split("\n"), target.y + CANVAS_OFFSET_Y, target.x) === "╭") break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const cells = lineColumns(frame.split("\n")[target.y + CANVAS_OFFSET_Y] ?? "")
    expect(cells[target.x], "落在了隔壁列锚的合法锚点上").toBe("╭")
    expect(cells[target.x + nodeSize("tool").width - 1], "卡右边界也在那一格").toBe("╮")
    // 别的列一列没少(挪的是这张卡,不是整张图重排)。
    expect(cardColumns(frame.split("\n"))).toEqual(headBefore)
  } finally {
    app.renderer.destroy()
  }
})

test("流程图画布:切会话之后,已经不存在的那些落点从表里消失", async () => {
  const [messages, setMessages] = createSignal(MESSAGES)
  const [parts, setParts] = createSignal(PARTS)
  const seen: Record<string, { x: number; y: number }>[] = []
  const app = await mount(96, 64, {
    reveal: false,
    messages: () => messages(),
    parts: () => parts(),
    onOverrides: (value) => seen.push(value),
  })
  try {
    await settled(app, "第 2 轮")
    const layout = layoutNodes(FIXTURE_MODEL.nodes, VIEWPORT)
    const node = layout.nodes.find((item) => item.id === "n:pr_3")!
    const pressRow = node.rect.y + 1 + CANVAS_OFFSET_Y
    const shift = layout.columnWidths[0]! + GAP_X
    await app.mockMouse.pressDown(node.rect.x + 8, pressRow)
    await app.mockMouse.moveTo(node.rect.x + 8 + shift, pressRow + 1)
    await app.mockMouse.release(node.rect.x + 8 + shift, pressRow + 1)
    await app.renderOnce()
    expect(Object.keys(seen.at(-1)!)).toEqual(["n:pr_3"])

    // 换成只剩第 1 轮前半段的会话:「工具调用」那张卡不在了,落点也必须跟着走。
    setMessages([MESSAGES[0], MESSAGES[1]])
    setParts({ msg_1: PARTS.msg_1, msg_2: [PARTS.msg_2[0]] })
    let last = seen.at(-1)!
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      last = seen.at(-1)!
      if (Object.keys(last).length === 0) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(last, "节点没了,落点也该被清掉(否则这份 state 只增不减)").toEqual({})
  } finally {
    app.renderer.destroy()
  }
})
