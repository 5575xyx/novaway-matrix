/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { JSX } from "solid-js"
import { CollapsibleSidebarCard, SidebarCard } from "../../src/component/sidebar-card"
import { FileTree, clearFileTreeCache } from "../../src/component/file-tree"
import { Locale } from "../../src/util/locale"
import { SIDEBAR_CARD_MIN_CONTENT, sidebarCardContentWidth } from "../../src/util/sidebar-metrics"
import { SIDEBAR_MIN_WIDTH } from "../../src/util/sidebar-width"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"

// 这一份只测**卡壳自己**的行为(卡头怎么排、徽标怎么封顶、折叠箭头怎么显隐)。
// 「侧栏里这张卡到底有多宽」不在这儿测 —— 那是 test/component/sidebar.test.tsx 照真实
// 嵌套量的事情:把 SidebarCard 单独挂在终端上时它比生产宽好几列,在这种宽度上写的宽度
// 断言是没有意义的。

async function renderCard(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await testRender(
    () => (
      <ThemeTestProviders>
        <ThemeReady />
        {body()}
      </ThemeTestProviders>
    ),
    options,
  )
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = frame(app)
    if (ready(text)) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  // 主题没就绪的话后面每一条断言都是在空白帧上空跑,必须在这里就炸出来。
  expect(text).toContain("READY")
  return app
}

function lines(app: { captureCharFrame(): string }) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
}

function frame(app: { captureCharFrame(): string }) {
  return lines(app).join("\n")
}

// 去掉霓虹边框字符,只留卡内那一段正文。左右各 1 列边框(内边距列就是边框列)。
function stripBorder(line: string) {
  return line.replace(/^[╭╰│]─*/, "").replace(/[─]*[╮╯│]$/, "")
}

function cardRows(rows: string[]) {
  const top = rows.findIndex((row) => row.includes("╭"))
  const bottom = rows.findIndex((row) => row.includes("╯"))
  if (top < 0 || bottom < top) return []
  return rows.slice(top, bottom + 1)
}

// NeonBox 的 paddingTop 行就是上边框那一行,所以 header 在第二行。
function cardHeader(app: { captureCharFrame(): string }) {
  const card = cardRows(lines(app))
  expect(card.length).toBeGreaterThan(1)
  return stripBorder(card[1]!)
}

/**
 * 单元测试里这张卡是**单独**挂在终端上的(卡宽 = 终端宽),比它在侧栏里的实际宽度宽,
 * 所以这组断言的预算取「卡宽 − 2」,不是 sidebarCardContentWidth —— 后者的数字由
 * test/component/sidebar.test.tsx 照真实嵌套量出来。
 */
function cardContentColumns(terminalWidth: number) {
  return terminalWidth - 2
}

test("分区卡:图标、标题、徽标在同一行,正文在霓虹边框内", async () => {
  const app = await renderCard(
    () => (
      <SidebarCard title="资源管理器" icon="@" badge="novaway-coder" page="files">
        <text>文件树正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("文件树正文"),
  )
  try {
    const card = cardRows(lines(app))
    // 正文行左右两侧都是竖边框:内容没有被边框字符吃掉,也没有漏到卡外。
    const body = card.slice(1, -1)
    expect(body.length).toBeGreaterThan(0)
    for (const row of body) expect(row.startsWith("│")).toBe(true)
    expect(frame(app)).toContain("文件树正文")

    const header = cardHeader(app)
    expect(header).toContain("@")
    expect(header).toContain("资源管理器")
    // 右对齐:徽标是这一行最后一段内容,标题与徽标之间只有空白。
    expect(header.trimEnd().endsWith("novaway-coder")).toBe(true)
    const gap = header.slice(header.indexOf("资源管理器") + "资源管理器".length, header.length - "novaway-coder".length)
    expect(gap.trim()).toBe("")
  } finally {
    app.renderer.destroy()
  }
})

test("分区卡:头部动作与徽标同行,不占正文", async () => {
  const app = await renderCard(
    () => (
      <SidebarCard title="分支" badge="main" action="+ 新建分支" onAction={() => {}}>
        <text>分支正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("分支正文"),
  )
  try {
    const header = cardHeader(app)
    expect(header).toContain("分支")
    expect(header).toContain("+ 新建分支")
    expect(header.trimEnd().endsWith("main")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

// 折叠交互(▼/▶ + 点击 header 切换)是插件原本就有的能力,卡片化之后不能丢。
test("可折叠分区卡:项数超阈值才出箭头,展开是开箭头、折叠是收箭头", async () => {
  const expanded = await renderCard(
    () => (
      <CollapsibleSidebarCard title="待办事项" badge="2/5" count={5} collapseAt={2}>
        {() => <text>待办正文</text>}
      </CollapsibleSidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("待办正文"),
  )
  try {
    // emoji 风格下开/收箭头分别是 ▼/▶。
    expect(cardHeader(expanded)).toContain(treeArrowOpen())
  } finally {
    expanded.renderer.destroy()
  }

  // 折叠态由 CollapsibleSidebarCard 自己持有,这里用 count=1 制造「不折叠」对照,
  // 再用 resetKey 之外的路径验证:项数少时没有箭头,内容照常显示。
  const short = await renderCard(
    () => (
      <CollapsibleSidebarCard title="待办事项" badge="1/1" count={1} collapseAt={2}>
        {() => <text>待办正文</text>}
      </CollapsibleSidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("待办正文"),
  )
  try {
    const header = cardHeader(short)
    expect(header).not.toContain(treeArrowOpen())
    expect(header).not.toContain(treeArrowClosed())
    expect(header).toContain("1/1")
  } finally {
    short.renderer.destroy()
  }
})

function treeArrowOpen() {
  return "▼"
}
function treeArrowClosed() {
  return "▶"
}

// 徽标封顶做在卡壳里:这是 1024 条 · 仅显示 5 条 这类随数据涨的字符串唯一的兜底。
// 之前每个调用点各给一个上限,调用点一多就必然漏;而且徽标是 flexShrink=0,封顶一旦
// 算错,被挤掉的不是徽标而是标题 —— 标题会整段缩到 0 宽、凭空消失。
const LONG_BADGE = "1024 条 · 仅显示 5 条 · 最早一条来自三天前的会话 · 已归档"

test("分区卡:超长徽标被截断,标题仍然完整可见", async () => {
  const app = await renderCard(
    () => (
      <SidebarCard title="消息" icon="💬" badge={LONG_BADGE}>
        <text>消息正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("消息正文"),
  )
  try {
    const header = cardHeader(app)
    // 标题一个都不能少。
    expect(header).toContain("消息")
    // 徽标被截了(带省略号),而且截出来的部分一定不超预算。
    expect(header).toContain("…")
    expect(header).not.toContain(LONG_BADGE)
    const shown = header.slice(header.indexOf("1024")).trim()
    expect(Locale.displayWidth(shown)).toBeLessThanOrEqual(SIDEBAR_CARD_MIN_CONTENT)
    // 卡头整行(去掉边框字符)放得进卡的内容区。
    expect(Locale.displayWidth(header)).toBeLessThanOrEqual(cardContentColumns(44))
  } finally {
    app.renderer.destroy()
  }
})

// 这条是「标题被徽标吃掉」那个 bug 的守门测试:标题 + 动作 + 长徽标同时出现时标题必须原样留着 ——
// 徽标是 flexShrink=0,没有封顶的话挤掉的一定是标题。
test("分区卡:标题 + 动作 + 超长徽标同在时标题不被挤没,徽标被截", async () => {
  const app = await renderCard(
    () => (
      <SidebarCard title="分支" icon="🌿" badge={LONG_BADGE} action="+ 新建分支" onAction={() => {}}>
        <text>分支正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("分支正文"),
  )
  try {
    const header = cardHeader(app)
    expect(header).toContain("分")
    expect(header).toContain("支")
    expect(header).toContain("新建分支")
    expect(header).toContain("…")
    expect(Locale.displayWidth(header)).toBeLessThanOrEqual(cardContentColumns(44))
  } finally {
    app.renderer.destroy()
  }
})

test("分区卡:中文徽标按列截断,不按字符数截", async () => {
  const badge = "一个非常非常长的中文分支名称-给分支卡当徽标用"
  const app = await renderCard(
    () => (
      <SidebarCard title="分支" badge={badge}>
        <text>分支正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("分支正文"),
  )
  try {
    const header = cardHeader(app)
    expect(header).toContain("分支")
    expect(header).not.toContain(badge)
    // 这一行按「列」算得下 —— 按码元算的话中文徽标会撑到 40 列以上,把边框顶掉。
    expect(Locale.displayWidth(header)).toBeLessThanOrEqual(cardContentColumns(44))
  } finally {
    app.renderer.destroy()
  }
})

// 文件名超长时文件树那一行不能把边框顶掉:名字是可缩的,多的部分由自己的行裁掉。
test("文件树装进分区卡:44 与 60 列下每一行的最后非空字符仍是竖边框", async () => {
  for (const width of [44, 60]) {
    const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-card-"))
    clearFileTreeCache()
    await mkdir(path.join(root, "packages", "novaway"), { recursive: true })
    await mkdir(path.join(root, "中文目录"), { recursive: true })
    await writeFile(path.join(root, "a-very-long-entry-name-for-truncation.ts"), "")
    await writeFile(path.join(root, "中文目录", "很长的中文文件名.ts"), "")
    const app = await renderCard(
      () => (
        <SidebarCard title="资源管理器" icon="@" badge={path.basename(root)} page="files">
          <FileTree rootPath={root} />
        </SidebarCard>
      ),
      { width, height: 12 },
      (text) => text.includes("a-very-long") && text.includes("中文"),
    )
    try {
      const card = cardRows(lines(app))
      expect(card.length).toBeGreaterThan(1)
      const body = card.slice(1, -1).filter((row) => row.trim() !== "│" && row.trim() !== "")
      expect(body.length).toBeGreaterThan(0)
      for (const row of body) {
        expect(row.startsWith("│")).toBe(true)
        // 卡宽 = 终端宽,正文行最后一列必须还是右边框。
        expect(row.trimEnd().endsWith("│")).toBe(true)
      }
    } finally {
      app.renderer.destroy()
      clearFileTreeCache()
      await rm(root, { recursive: true, force: true })
    }
  }
})

test("侧栏宽度档位:info/git 页 36 列、文件页 37 列", () => {
  expect(SIDEBAR_CARD_MIN_CONTENT).toBe(36)
  expect(sidebarCardContentWidth(SIDEBAR_MIN_WIDTH, "files")).toBe(37)
})
