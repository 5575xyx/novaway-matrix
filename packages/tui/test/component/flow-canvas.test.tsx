/** @jsxImportSource @opentui/solid */
// D3 流程图画布的**渲染**测试。
//
// 纯函数那一半(节点/边/布局/走线)在 flow-layout.test.ts 里;这里钉的是「屏幕上真的出现了什么」:
// 节点卡是不是真的用了生产卡壳(渐变描边圆角 `╭`)、连线是不是真的落在走廊里(`│` `─` `┐`)、
// 箭头有没有、轮次分隔线与它的 `第 2 轮` 标签在不在、点击能不能展开详情。
//
// 画布组件只依赖 useTheme()/useKV()/终端尺寸,所以直接用 ThemeTestProviders 挂真壳,
// 不必为了测试去 mock 一整个 session —— 数据喂最小构造数据即可(与 flow-layout.test.ts 同一份形状)。
import { expect, test } from "bun:test"
import type { Message, Part } from "@novaway/sdk-v2-latest/v2"
import { testRender } from "@opentui/solid"
import { FlowCanvas } from "../../src/component/flow/canvas"
import { kindNoun, NODE_HEIGHT, NODE_WIDTH } from "../../src/component/flow/layout"
import { Locale } from "../../src/util/locale"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"

const CREATED = new Date(2026, 0, 2, 14, 32).getTime()

const MESSAGES: Message[] = [
  {
    id: "msg_1",
    sessionID: "ses_1",
    role: "user",
    time: { created: CREATED },
    agent: "build",
    model: { providerID: "novaway", modelID: "claude-sonnet-4" },
  },
  {
    id: "msg_2",
    sessionID: "ses_1",
    role: "assistant",
    time: { created: CREATED + 1_000, completed: CREATED + 20_000 },
    parentID: "msg_root",
    modelID: "claude-sonnet-4",
    providerID: "novaway",
    mode: "build",
    agent: "build",
    path: { cwd: "/repo", root: "/repo" },
    cost: 0,
    tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
  },
  {
    id: "msg_3",
    sessionID: "ses_1",
    role: "user",
    time: { created: CREATED + 30_000 },
    agent: "build",
    model: { providerID: "novaway", modelID: "claude-sonnet-4" },
  },
]

const text = (messageID: string, id: string, body: string): Part => ({
  id,
  sessionID: "ses_1",
  messageID,
  type: "text",
  text: body,
  time: { start: CREATED, end: CREATED + 1_000 },
})
const reasoning = (messageID: string, id: string, body: string): Part => ({
  id,
  sessionID: "ses_1",
  messageID,
  type: "reasoning",
  text: body,
  time: { start: CREATED, end: CREATED + 2_400 },
})
const tool = (messageID: string, id: string, name: string, start: number, ms: number): Part => ({
  id,
  sessionID: "ses_1",
  messageID,
  type: "tool",
  callID: `call_${id}`,
  tool: name,
  state: {
    status: "completed",
    input: {},
    output: "输出",
    title: name,
    metadata: {},
    time: { start: CREATED + start, end: CREATED + start + ms },
  },
})

const PARTS: Record<string, Part[]> = {
  msg_1: [text("msg_1", "pr_1", "你好,帮我修复失败的测试")],
  msg_2: [
    reasoning("msg_2", "pr_2", "测试 → 定位 → 修复 → 复测"),
    tool("msg_2", "pr_3", "bash", 1_500, 3_200),
    tool("msg_2", "pr_4", "task", 1_500, 8_400),
    tool("msg_2", "pr_5", "edit", 12_000, 400),
    text("msg_2", "pr_6", "已修复:改用 pollWithTimeout"),
  ],
  msg_3: [text("msg_3", "pr_7", "再把侧栏动画也优化一下")],
}

const KINDS = ["user", "plan", "subagent", "tool", "edit", "reply", "fend"] as const

async function mount(width: number, height: number, messages: readonly Message[] = MESSAGES, parts = PARTS) {
  return testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        <FlowCanvas messages={messages} parts={parts} />
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

async function render(width: number, height = 40) {
  const app = await mount(width, height)
  try {
    return await settled(app, "第 2 轮")
  } finally {
    app.renderer.destroy()
  }
}

test("流程图画布:节点卡用生产卡壳画出渐变描边圆角,七类语义都在", async () => {
  const lines = await render(96)
  const frame = lines.join("\n")
  // 圆角边框 = NeonBox 自己画的(复用 AssistantCard 的直接证据,不是手搓的 `┌`)。
  expect(frame).toContain("╭")
  expect(frame).toContain("╰")
  // 数据里有的那些类型文字(第 2 轮只有用户输入,所以「任务拆解」只在第 1 轮出现一次)。
  for (const label of ["用户输入", "任务拆解", "工具调用", "子代理", "编辑文件", "NovaWay", "本轮结束"]) {
    expect(frame, label).toContain(label)
  }
  // 底部图例把七种语义一次列全(短名,窄终端也放得下)。
  for (const kind of KINDS) expect(frame, `图例:${kindNoun(kind)}`).toContain(kindNoun(kind))
})

// 这条把 layout 的 NODE_HEIGHT 与真实渲染钉在一起:NeonBox 的内边距行**就是**边框行,
// padding 不额外占行。写错的话连线的中线会落到卡片底边框那一行,每条线都贴着卡片下沿横穿。
test("流程图画布:卡片的真实高度就是 NODE_HEIGHT(边框行 = 内边距行,不额外占行)", async () => {
  const lines = await render(96)
  const top = lines.findIndex((line) => line.includes("╭"))
  const column = lines[top]!.indexOf("╭")
  const bottom = lines.findIndex((line, index) => index > top && line[column] === "╰")
  expect(top).toBeGreaterThanOrEqual(0)
  // top..bottom 一共 bottom − top + 1 行。
  expect(bottom - top + 1).toBe(NODE_HEIGHT)
})

test("流程图画布:连线用直角折线的字符画出来,终点是箭头", async () => {
  const frame = (await render(96)).join("\n")
  expect(frame).toContain("│")
  expect(frame).toContain("─")
  // 换行边与并行分支都必然带拐角。
  expect(/[┌┐└┘]/.test(frame), "换行边/并行分支应有拐角").toBe(true)
  expect(frame).toContain("▸")
  // 换行到下一轮时箭头朝下。
  expect(frame).toContain("▼")
})

test("流程图画布:连线标签与轮次分隔线都画出来", async () => {
  const frame = (await render(96)).join("\n")
  // 并行分支的两条分叉边各带一个标签(原型「并行 · 工具」「并行 · 子代理」)。
  expect(frame).toContain("并行 · 工具")
  expect(frame).toContain("并行 · 子代理")
  // 分隔线只画在第 2 轮及以后(第 1 轮是起点,原型也没有它那条线),
  // 但两张「本轮结束」卡的 meta 各写着自己的轮次号,所以两个轮次号都看得见。
  expect(frame).toContain("第 2 轮")
  expect(frame).toContain("第 1 轮")
  // 收束与跨轮的边也各有标签。
  expect(frame).toContain("用户请求")
  expect(frame).toContain("本轮完成")
  expect(frame).toContain("新消息")
})

// 收束的两条边(工具 → 编辑文件、子代理 → 编辑文件)都会把标签摊在目标卡左边那一行上。
// 摆不下就该**不摆**,而不是两个标签叠在一起 —— 叠在一起的字比没有字更像界面坏了。
//
// 「标签没被切开」由 `includes` 本身保证:切开之后长这样 `并─行─·─工─具`,`includes` 就匹配不到了。
// 所以这里断言的是**出现次数**(每条边一个标签,该摆的都摆上了)与**箭头数 = 边数**
// (箭头是每条边的收尾;箭头被后画的竖线盖掉时,箭头数会少于边数)。
test("流程图画布:每条边的标签都摆上了,每条边都以一个箭头收尾", async () => {
  const lines = await render(96)
  // `用户请求` 出现两次是对的:这一份数据有两条用户消息,每条各带一条出边。
  // `第 2 轮` 也是两次:分隔线的标签一次,「本轮结束」那张卡的 meta 一次。
  for (const [label, times] of [
    ["用户请求", 2],
    ["并行 · 工具", 1],
    ["并行 · 子代理", 1],
    ["✓ 完成", 1],
    ["子代理完成", 1],
    ["已编辑", 1],
    ["第 2 轮", 2],
  ] as const) {
    expect(lines.filter((line) => line.includes(label)).length, `${label} 的出现次数`).toBe(times)
  }
  // 箭头数。**要把卡片上的 `▸` 折叠箭头排除掉**:卡头那一行有 `●`,连线那一行没有,
  // 所以按「这一行有没有 ●」把两者分开数。
  //
  // 9 条边但只有 8 个箭头格子:收束的两条边(工具→编辑文件、子代理→编辑文件)进入的是
  // **同一格** —— 同一张卡的同一个入口。两个箭头叠在一格上,画出来就是一个,这是对的:
  // 一张卡只需要一个「箭头指进来」。
  const edgeLines = lines.filter((line) => !line.includes("●"))
  const arrows = edgeLines
    .join("\n")
    .split("")
    .filter((char) => char === "▸" || char === "▼").length
  expect(arrows, "9 条边、其中两条收束进同一格 → 8 个箭头格子").toBe(8)
  // 反过来钉一次:连线箭头与卡片上的折叠箭头是两回事。每一张**看得见的**卡头都必须带
  // 折叠箭头(原型 .fc-caret)—— 用「看得见的」限定,是因为 40 行视口下末尾那几张卡已经被
  // 裁掉了,数全部节点会把「视口裁剪」当成「折叠箭头没画」来报。
  const heads = lines.filter((line) => line.includes("│ ●"))
  expect(heads.length).toBeGreaterThan(0)
  for (const head of heads) expect(head, "卡头缺折叠箭头").toContain("▸")
})

test("流程图画布:点节点卡展开详情框,再点一次收起", async () => {
  const app = await mount(96, 40)
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
    // 详情正文是工具输出,只在展开后出现。
    expect(opened).toContain("输出")
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

test("流程图画布:空会话说清为什么空,不画一片空白", async () => {
  // 真的要**没有消息**:只把 parts 清空的话,三条消息还在,画布上会有三个「本轮结束」节点。
  const app = await mount(72, 12, [], {})
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

// 窄终端:画布必须退化成单列而不是把卡片挤出可视区或叠在一起。
test("流程图画布:80 列与 120 列下卡片都在画面内,80 列退化成单列", async () => {
  // 一行里可能并排着两张卡,所以要数**每一行所有** `╭` 的列,不能只看每行第一个。
  const columnsOf = (lines: string[]) => {
    const columns = new Set<number>()
    for (const line of lines) {
      for (let x = 0; x < line.length; x++) if (line[x] === "╭") columns.add(x)
    }
    return columns.size
  }
  const narrow = await render(80, 60)
  const wide = await render(120, 60)
  for (const [width, lines] of [
    [80, narrow],
    [120, wide],
  ] as const) {
    const cards = lines.filter((line) => line.includes("╭") && line.includes("╮"))
    expect(cards.length, `${width} 列应有节点卡`).toBeGreaterThan(0)
    for (const row of cards) {
      expect(Locale.displayWidth(row), `${width} 列的卡片行`).toBeLessThanOrEqual(width)
      // 一张卡恰好 NODE_WIDTH 列:从左边框 `╭` 量到同一张卡的右边框 `╮`。
      const from = row.indexOf("╭")
      const to = row.indexOf("╮", from)
      expect(to - from + 1, `${width} 列的卡宽`).toBe(NODE_WIDTH)
    }
  }
  // 80 列扣掉画布留白后放不下两列(两列要 LEFT_MARGIN + 步距 + 卡宽 = 75 列,而视口只有 74),
  // 120 列放得下 —— 走廊的账不能算错,否则窄终端上白丢一列。
  expect(columnsOf(narrow)).toBe(1)
  expect(columnsOf(wide)).toBe(2)
})
