/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { JSX } from "solid-js"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { SidebarCard } from "../../src/component/sidebar-card"
import { FileTree, clearFileTreeCache } from "../../src/component/file-tree"
import {
  FILE_TREE_NAME_MAX,
  GIT_FILE_LABEL_MAX,
  SIDEBAR_CARD_MAX_CONTENT,
  SIDEBAR_CARD_MIN_CONTENT,
  sidebarCardContentWidth,
} from "../../src/util/sidebar-metrics"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// 卡壳只依赖 useTheme():不挂 session/local context 也能量真实几列,
// 所以这里刻意用最轻的一串 provider —— 少挂一层就少一处「测试里补了、生产里没有」的风险。
async function renderCard(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">{body()}</ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    options,
  )
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = lines(app).join("\n")
    if (ready(text)) return app
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  app.renderer.destroy()
  throw new Error("渲染未在 200 轮内就绪,实际帧:\n" + text)
}

function lines(app: { captureCharFrame(): string }) {
  return app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
}

// 去掉霓虹边框字符,只留卡内那一段正文。左右各 1 列边框 + 1 列内边距。
function stripBorder(line: string) {
  return line.replace(/^[╭╰│]─*/, "").replace(/[─]*[╮╯│]$/, "")
}

function cardRows(rows: string[]) {
  const top = rows.findIndex((row) => row.includes("╭"))
  const bottom = rows.findIndex((row) => row.includes("╯"))
  if (top < 0 || bottom < top) return []
  return rows.slice(top, bottom + 1)
}

// 取第一张卡的 header 正文。NeonBox 的 paddingTop 行就是上边框那一行,所以 header 在
// 第二行。取不到就直接断言失败,免得后面的 undefined 报成别的错。
function cardHeader(app: { captureCharFrame(): string }) {
  const card = cardRows(lines(app))
  expect(card.length).toBeGreaterThan(1)
  return stripBorder(card[1]!)
}

test("分区卡:图标、标题、徽标在同一行,正文在霓虹边框内", async () => {
  const app = await renderCard(
    () => (
      <SidebarCard title="资源管理器" icon="@" badge="novaway-coder">
        <text>文件树正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("文件树正文"),
  )
  try {
    const rows = lines(app)
    const card = cardRows(rows)
    expect(card.length).toBeGreaterThan(0)
    // 正文行左右两侧都是竖边框:内容没有被边框字符吃掉,也没有漏到卡外。
    const body = card.slice(1, -1)
    expect(body.length).toBeGreaterThan(0)
    for (const row of body) expect(row.startsWith("│")).toBe(true)
    expect(rows.join("\n")).toContain("文件树正文")

    const header = cardHeader(app)
    expect(header).toContain("@")
    expect(header).toContain("资源管理器")
    expect(header).toContain("novaway-coder")
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
    expect(header).toContain("main")
    expect(header.trimEnd().endsWith("main")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

// 折叠交互(▼/▶ + 点击 header 切换)是插件原本就有的能力,卡片化之后不能丢。
test("分区卡:可折叠时头部给箭头,展开是 ▼、折叠是 ▶", async () => {
  const open = await renderCard(
    () => (
      <SidebarCard title="待办事项" badge="2/5" collapsible collapsed={false}>
        <text>待办正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("待办正文"),
  )
  let openHeader = ""
  try {
    openHeader = cardHeader(open)
  } finally {
    open.renderer.destroy()
  }
  expect(openHeader).toContain("▼")
  expect(openHeader).toContain("待办事项")

  const closed = await renderCard(
    () => (
      <SidebarCard title="待办事项" badge="2/5" collapsible collapsed={true}>
        <text>待办正文</text>
      </SidebarCard>
    ),
    { width: 44, height: 8 },
    (text) => text.includes("待办正文"),
  )
  try {
    const header = cardHeader(closed)
    expect(header).toContain("▶")
    expect(header).not.toContain("▼")
    expect(header).toContain("2/5")
  } finally {
    closed.renderer.destroy()
  }
})

// 侧栏分区卡的内容宽度是所有「按宽度截断」常量的地基:根卡内边距 4 列 + 插件槽给
// 滚动条留的 1 列 + 分区卡自己的边框 2 与内边距 2,合计 9 列固定开销。
// 入参是侧栏宽(44~60),所以最窄侧栏剩 35 列,最宽剩 51 列。
test("侧栏分区卡内容宽度:最窄侧栏剩 35,最宽侧栏剩 51", () => {
  expect(sidebarCardContentWidth(44)).toBe(35)
  expect(sidebarCardContentWidth(60)).toBe(51)
  expect(SIDEBAR_CARD_MIN_CONTENT).toBe(35)
  expect(SIDEBAR_CARD_MAX_CONTENT).toBe(51)
  // 永远比侧栏本身窄,不会因为上限没生效而反向溢出。
  expect(SIDEBAR_CARD_MAX_CONTENT).toBeLessThan(60)
})

// 截断上限必须落在最窄分区卡里,否则窄终端上文件名会压到右边框上。
test("截断上限:文件名与 Git 文件名都放得进最窄分区卡", () => {
  // 文件树一行 = 缩进 2×深度 + 箭头 2 + 图标 2 + 名字前空格 1 + paddingRight 1 = 2×深度 + 6。
  // 名字上限 18 时第 5 层(2×5+6+18 = 34)仍有余量,第 6 层开始由渲染器裁尾。
  expect(FILE_TREE_NAME_MAX + 2 * 5 + 6).toBeLessThanOrEqual(SIDEBAR_CARD_MIN_CONTENT)
  // Git 文件行 = 名字 + paddingLeft 1 + 状态码 2 + 统计左边距 1 + 最坏 ±999 的 9 + 悬停「 丢弃」5 + 余量 2。
  expect(GIT_FILE_LABEL_MAX + 18 + 2).toBe(SIDEBAR_CARD_MIN_CONTENT)
})

// 实测:44 列(最窄)与 60 列(最宽)下,文件树装进分区卡后每一行的右边框都还在 ——
// 也就是说文件名/徽标都没有溢出边框。
for (const width of [44, 60]) {
  test(`文件树装进分区卡:${width} 列下没有一行溢出右边框`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-card-"))
    clearFileTreeCache()
    await mkdir(path.join(root, "packages", "novaway"), { recursive: true })
    await writeFile(path.join(root, "a-very-long-entry-name-for-truncation.ts"), "")
    await writeFile(path.join(root, "packages", "novaway", "index.ts"), "")

    const app = await renderCard(
      () => (
        <SidebarCard title="资源管理器" icon="@" badge={path.basename(root)}>
          <FileTree rootPath={root} />
        </SidebarCard>
      ),
      { width, height: 10 },
      (text) => text.includes("资源管理器") && text.includes("a-very-long"),
    )
    try {
      const rows = lines(app)
      const card = cardRows(rows)
      expect(card.length).toBeGreaterThan(1)
      expect(cardHeader(app)).toContain("资源管理器")
      // 文件树读盘是异步的,等它把内容铺出来再逐行查边框。
      let ok = false
      for (let attempt = 0; attempt < 200 && !ok; attempt++) {
        await app.renderOnce()
        const body = cardRows(lines(app)).slice(1, -1)
        ok = body.some((row) => row.includes("index.ts") || row.includes("a-very-long"))
        if (!ok) await new Promise((resolve) => setTimeout(resolve, 25))
      }
      const body = cardRows(lines(app)).slice(1, -1)
      const withContent = body.filter((row) => row.trim() !== "││" && row.trim() !== "│ │")
      expect(withContent.length).toBeGreaterThan(0)
      for (const row of withContent) {
        expect(row.startsWith("│")).toBe(true)
        // 卡宽 = 终端宽,正文行最后一列必须还是右边框。
        expect(row.trimEnd().endsWith("│")).toBe(true)
      }
    } finally {
      app.renderer.destroy()
      clearFileTreeCache()
      await rm(root, { recursive: true, force: true })
    }
  })
}
