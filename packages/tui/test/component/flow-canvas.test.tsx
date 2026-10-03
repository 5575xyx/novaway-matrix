/** @jsxImportSource @opentui/solid */
// D3 流程图画布的**渲染**测试。
//
// 纯函数那一半(节点/边/布局/走线)在 flow-layout.test.ts 里,连线字符层在 flow-grid.test.ts 里;
// 这里钉的是「屏幕上真的出现了什么」:节点卡是不是真的用了生产卡壳(渐变描边圆角 `╭`)、连线是不是
// 真的落在走廊里(`│` `─` `┐`)、箭头有没有、轮次分隔线与它的 `第 N 轮` 标签在不在、
// 点击能不能展开详情、**关掉动画之后画布还在不在**。
//
// 画布组件只依赖 useTheme()/useKV()/终端尺寸,所以直接用 ThemeTestProviders 挂真壳,
// 不必为了测试去 mock 一整个 session —— 数据喂 fixture(与 flow-layout.test.ts 同一份)。
import { expect, test } from "bun:test"
import type { Message, Part } from "@novaway/sdk-v2-latest/v2"
import { testRender } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { FlowCanvas } from "../../src/component/flow/canvas"
import {
  COLUMN_PITCH,
  DETAIL_ROWS,
  kindNoun,
  layoutNodes,
  LEFT_MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
  RIGHT_MARGIN,
} from "../../src/component/flow/layout"
import { Locale } from "../../src/util/locale"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import {
  arrowCells,
  CANVAS_OFFSET_Y,
  distinctCardColumns,
  FIXTURE_MESSAGES,
  FIXTURE_MODEL,
  FIXTURE_PARTS,
  frameCell,
} from "../fixture/flow"

const MESSAGES: Message[] = FIXTURE_MESSAGES
const PARTS: Record<string, Part[]> = FIXTURE_PARTS
const KINDS = ["user", "plan", "subagent", "tool", "edit", "reply", "fend"] as const

async function mount(
  width: number,
  height: number,
  options: {
    messages?: readonly Message[]
    parts?: Record<string, Part[]>
    reveal?: boolean
    /** 画布盒子本身多宽(列)。缺省 = 整个终端宽。真实会话里侧栏展开时它比终端窄得多。 */
    box?: number
    onScrollBox?: (box: ScrollBoxRenderable) => void
  } = {},
) {
  const canvas = () => (
    <FlowCanvas
      messages={options.messages ?? MESSAGES}
      parts={options.parts ?? PARTS}
      reveal={options.reveal}
      onScrollBox={options.onScrollBox}
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

async function render(width: number, height = 64, options?: Parameters<typeof mount>[2]) {
  const app = await mount(width, height, options)
  try {
    return await settled(app, "第 2 轮")
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
  // 底部图例把七种语义一次列全(短名,窄终端也放得下)。
  for (const kind of KINDS) expect(frame, `图例:${kindNoun(kind)}`).toContain(kindNoun(kind))
})

// 这条把 layout 的 NODE_HEIGHT 与真实渲染钉在一起:NeonBox 的内边距行**就是**边框行,
// padding 不额外占行。写错的话连线的中线会落到卡片底边框那一行,每条线都贴着卡片下沿横穿。
test("流程图画布:卡片的真实高度就是 NODE_HEIGHT(边框行 = 内边距行,不额外占行)", async () => {
  const lines = await render(96, 64, { reveal: false })
  const top = lines.findIndex((line) => line.includes("╭"))
  const column = lines[top]!.indexOf("╭")
  const bottom = lines.findIndex((line, index) => index > top && line[column] === "╰")
  expect(top).toBeGreaterThanOrEqual(0)
  expect(bottom - top + 1).toBe(NODE_HEIGHT)
})

test("流程图画布:连线用直角折线的字符画出来,终点是箭头", async () => {
  const frame = (await render(96, 64, { reveal: false })).join("\n")
  expect(frame).toContain("│")
  expect(frame).toContain("─")
  expect(/[┌┐└┘]/.test(frame), "换行边/并行分支应有拐角").toBe(true)
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
    expect(joined).toContain("轮询")
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
  const app = await mount(96, 64, { reveal: false })
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
    // 视口 96 − 6 = 90 列,与渲染时算布局用的宽度一致。
    const layout = layoutNodes(FIXTURE_MODEL.nodes, 90, { expandedId: "n:msg_1" })
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
  const app = await mount(72, 12, { messages: [], parts: {} })
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
// 视口 = 盒子宽 − 2(竖滚动条那一块:`paddingLeft: 1` + 轨道)。两列行带要
// LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH = 74 列,所以 80 列终端(视口 78)放得下两列还余 4 列;
// 120 列(视口 118)放得下三列(2 + 44×2 + 28 = 118,刚好)。
// 三列在 80 列上是放不下的(75 > 78 之前那版按终端宽 − 6 算也只有 74,刚好塞两列)。
test("流程图画布:80 列排下两列,120 列排下三列,卡片都在画面内", async () => {
  const narrow = await render(80, 60, { reveal: false })
  const wide = await render(120, 60, { reveal: false })
  for (const [width, lines] of [
    [80, narrow],
    [120, wide],
  ] as const) {
    const cards = lines.filter((line) => line.includes("╭") && line.includes("╮"))
    expect(cards.length, `${width} 列应有节点卡`).toBeGreaterThan(0)
    for (const row of cards) {
      expect(Locale.displayWidth(row), `${width} 列的卡片行`).toBeLessThanOrEqual(width)
      const from = row.indexOf("╭")
      const to = row.indexOf("╮", from)
      expect(to - from + 1, `${width} 列的卡宽`).toBe(NODE_WIDTH)
    }
  }
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
// 这里把盒子宽度显式压到 50 列(视口 48 ≥ 44 = 一张卡 + 一条走廊,所以仍是两列)复现那一幕,
// 再钉住两件事:内容宽度是**图自己的宽度**(两列行带 = 75 列);横向滚过去右边那列真的出现。
const SIDEBAR_BOX = 50
const SIDEBAR_VIEWPORT = SIDEBAR_BOX - 2

async function mountNarrowBox() {
  let handed: ScrollBoxRenderable | undefined
  const app = await mount(120, 40, { reveal: false, box: SIDEBAR_BOX, onScrollBox: (box) => (handed = box) })
  // 等画面稳定:画布的取宽是**量自己盒子**得到的,首帧 yoga 还没落定,那之前走的是
  // 「终端宽 − 6」那一档兜底(见 canvas 的 viewportWidth)。不等到稳定就会量到兜底值。
  const lines = await settled(app, "第 2 轮")
  return { app, handed: handed!, lines }
}

/** 右边那一列卡片的**右边框**那一列(两列行带的第二列:46 + 28 − 1 = 73 列)。 */
const RIGHT_BORDER = LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH - 1

test("流程图画布:盒子比终端窄很多时按**内容**宽度排布(而不是被视口裁掉)", async () => {
  const { app, handed, lines } = await mountNarrowBox()
  try {
    const layout = layoutNodes(FIXTURE_MODEL.nodes, SIDEBAR_VIEWPORT)
    expect(new Set(layout.nodes.map((node) => node.rect.x)).size, "50 列盒子仍应排两列").toBe(2)
    expect(layout.width).toBe(LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH + RIGHT_MARGIN)
    // scrollbox 的内容比视口宽 —— 差出来的那一截就是横向滚动范围。
    expect(handed.scrollWidth, "内容宽度应是图自己的宽度").toBe(layout.width)
    expect(handed.scrollWidth).toBeGreaterThan(handed.viewport.width)
    // 右边那一列卡片的右边框初始落在画面之外(这正是被截断的那一幕),滚到最右才看得见。
    // 注意横向滚动是把内容往左搬,所以取帧时列号要减掉 scrollLeft。
    const top = layout.nodes.find((node) => node.rect.x === LEFT_MARGIN + COLUMN_PITCH)!.rect.y
    expect(frameCell(lines, top + 1 + CANVAS_OFFSET_Y, RIGHT_BORDER), "未滚动时右边框被裁掉").not.toBe("│")
    handed.scrollTo({ x: handed.scrollWidth, y: handed.scrollTop })
    expect(handed.scrollLeft).toBe(handed.scrollWidth - handed.viewport.width)
    await app.renderOnce()
    expect(
      frameCell(app.captureCharFrame().split("\n"), top + 1 + CANVAS_OFFSET_Y, RIGHT_BORDER - handed.scrollLeft),
    ).toBe("│")
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
test("流程图画布:40 列退化成单列,60 与 80 列都是两列", async () => {
  for (const [width, columns] of [
    [40, 1],
    [60, 2],
    [80, 2],
  ] as const) {
    const lines = await render(width, 60, { reveal: false })
    expect(distinctCardColumns(lines), `${width} 列应有 ${columns} 列卡片`).toBe(columns)
  }
})

// 60 列:两列行带 75 列 > 视口,右边那一列被切掉一截,但差出来的那一截能横向滚过去。
test("流程图画布:60 列下第二列被切掉右边框,横向滚过去就完整了", async () => {
  let handed: ScrollBoxRenderable | undefined
  const app = await mount(60, 40, { reveal: false, onScrollBox: (box) => (handed = box) })
  try {
    const lines = await settled(app, "第 2 轮")
    const layout = layoutNodes(FIXTURE_MODEL.nodes, 58)
    expect(handed!.scrollWidth).toBe(LEFT_MARGIN + COLUMN_PITCH + NODE_WIDTH + RIGHT_MARGIN)
    expect(handed!.scrollWidth).toBeGreaterThan(handed!.viewport.width)
    const top = layout.nodes.find((node) => node.rect.x === LEFT_MARGIN + COLUMN_PITCH)!.rect.y
    expect(frameCell(lines, top + 1 + CANVAS_OFFSET_Y, RIGHT_BORDER), "未滚动时右边框被裁掉").not.toBe("│")
    handed!.scrollTo({ x: handed!.scrollWidth, y: 0 })
    await app.renderOnce()
    expect(
      frameCell(app.captureCharFrame().split("\n"), top + 1 + CANVAS_OFFSET_Y, RIGHT_BORDER - handed!.scrollLeft),
    ).toBe("│")
  } finally {
    app.renderer.destroy()
  }
})
