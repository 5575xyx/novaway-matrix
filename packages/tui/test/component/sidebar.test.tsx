/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { TuiPluginApi } from "@opencode/plugin/tui"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { SDKProvider } from "../../src/context/sdk"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { ExitProvider } from "../../src/context/exit"
import { SyncProvider } from "../../src/context/sync"
import { ArgsProvider } from "../../src/context/args"
import { PluginRuntimeProvider, createPluginRuntime } from "../../src/plugin/runtime"
import { Sidebar, setSidebarTab } from "../../src/routes/session/sidebar"
import { SidebarCard } from "../../src/component/sidebar-card"
import { clearFileTreeCache, setSelectedPath } from "../../src/component/file-tree"
import { sidebarCardContentWidth, SIDEBAR_CARD_MIN_CONTENT } from "../../src/util/sidebar-metrics"
import { SIDEBAR_MIN_WIDTH } from "../../src/util/sidebar-width"
import { workbenchOptions } from "../../src/component/dialog-workbench"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createFetch, eventSource, json } from "../fixture/tui-sdk"

test("工具工作台按数据与智能中枢分组选项", async () => {
  let options: ReturnType<typeof workbenchOptions> = []
  const app = await testRender(
    () => {
      options = workbenchOptions()
      return <text>{options.map((option) => option.title).join(" ")}</text>
    },
    { width: 80, height: 5 },
  )

  try {
    await app.renderOnce()
    expect(options).toHaveLength(7)
    expect(options[0]).toMatchObject({ value: "data", category: "数据", title: "数据" })
    expect(options.slice(1).every((option) => option.category === "智能中枢")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

// 标签行照旧渲染,会话专属内容(标题、检查点/目标/工作流/编排)跳过,不崩。
test("侧栏在无会话时渲染标签行,跳过会话专属内容", async () => {
  const runtime = createPluginRuntime()

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <SDKProvider
                url="http://test"
                directory="/tmp/NovaWay/packages/tui"
                fetch={createFetch().fetch}
                events={eventSource()}
              >
                <PermissionProvider>
                  <ProjectProvider>
                    <ExitProvider exit={() => {}}>
                      <SyncProvider>
                        <ThemeProvider mode="dark">
                          <PluginRuntimeProvider value={runtime}>
                            <Sidebar />
                          </PluginRuntimeProvider>
                        </ThemeProvider>
                      </SyncProvider>
                    </ExitProvider>
                  </ProjectProvider>
                </PermissionProvider>
              </SDKProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 10 },
  )

  try {
    let frame = ""
    for (let attempt = 0; attempt < 10; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      // 等 sync 拉完、标签行画出来
      if (frame.includes("待办与统计") && frame.includes("Git")) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(frame).toContain("待办与统计")
    expect(frame).toContain("文件")
    expect(frame).toContain("Git")
    expect(frame).not.toContain("智能中枢")
    expect(frame).not.toContain("数据")
  } finally {
    app.renderer.destroy()
  }
})

// 宽度模型的唯一真相:渲染**整个** Sidebar,照着真实嵌套量出分区卡的可用列数。
// 之前那条测试把 SidebarCard 单独挂在 44/60 列终端上,那里内容区有 42/58 列,比生产宽 5~6 列,
// 于是把根卡内边距改成 0、或者把卡的内边距改成 3,测试都照样绿 —— 量的是错的层。
//
// 这里量的是 NeonBoxRenderable.width:卡片自己的左右边框就画在最外两列上(内边距行/列就是
// 边框行/列),所以「内容区 = 卡宽 − 2」。期望值 37 / 36 是实测数,不是从公式推出来的:
//   侧栏 44 = 根卡内边距 4 + 滚动条列 1 + 卡边框 2                    → 文件页 37
//   侧栏 44 = 上面那 7 列 + info/git 页那层 <box paddingRight={1}> 的 1 列 → 36
type Node = { width: number; screenX: number; getChildren(): unknown[] }

/** 深度优先找出第一个满足条件的 NeonBox(分区卡;根侧栏卡 screenX 是 0)。 */
function findNeonBox(node: Node, match: (node: Node) => boolean): Node | undefined {
  if (node.constructor.name === "NeonBoxRenderable" && match(node)) return node
  for (const child of node.getChildren()) {
    const found = findNeonBox(child as Node, match)
    if (found) return found
  }
  return undefined
}

/**
 * 收集子树里所有**已经布局过**的节点。没排过版的节点(插件槽占位等)没有 screenX,
 * 拿它们比列号会得到 undefined。
 */
function collect(node: Node): Node[] {
  const children = node.getChildren() as Node[]
  return children.length > 0 ? children.flatMap((child) => [child, ...collect(child)]) : [node]
}

function laidOut(node: Node) {
  return typeof node.screenX === "number" && typeof node.width === "number" && node.width > 0
}

async function renderSidebar(input: {
  tab: "files" | "info"
  directory: string
  terminalWidth: number
  /** 默认 12:宽度模型那几条只关心列数,行数给矮一点反而更容易溢出。 */
  terminalHeight?: number
  registerProbeCard?: boolean
  /** 在 sidebar_footer 槽里插一张有内容的探针 —— 默认那张槽在测试里没人注册,渲染成空。 */
  registerProbeFooter?: boolean
  /** 等这一段出现在帧里;省略就是各页自己的老条件。 */
  waitFor?: string
}) {
  setSidebarTab(input.tab)
  const runtime = createPluginRuntime()
  const Body = () => {
    const renderer = useRenderer()
    // 生产里这层卡是内置插件(slot)插进来的;测试里注册一张同名探针卡,
    // 量的是完全相同的嵌套:根卡 → scrollbox → <box paddingRight={1}> → SidebarCard。
    if (input.registerProbeCard || input.registerProbeFooter) {
      runtime.setupSlots({ renderer, theme: { current: {} } } as unknown as TuiPluginApi).register({
        id: "test:probe-card",
        slots: {
          sidebar_content: () => (
            <SidebarCard title="探针卡" badge="BADGE">
              <text>内容</text>
            </SidebarCard>
          ),
          ...(input.registerProbeFooter ? { sidebar_footer: () => <text>FOOTER-PROBE</text> } : {}),
        },
      })
    }
    return <Sidebar />
  }

  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <SDKProvider
                url="http://test"
                directory={input.directory}
                fetch={
                  createFetch((url) =>
                    url.pathname === "/path"
                      ? json({ home: "", state: "", config: "", worktree: input.directory, directory: input.directory })
                      : undefined,
                  ).fetch
                }
                events={eventSource()}
              >
                <PermissionProvider>
                  <ProjectProvider>
                    <ExitProvider exit={() => {}}>
                      <SyncProvider>
                        <ThemeProvider mode="dark">
                          <PluginRuntimeProvider value={runtime}>
                            <Body />
                          </PluginRuntimeProvider>
                        </ThemeProvider>
                      </SyncProvider>
                    </ExitProvider>
                  </ProjectProvider>
                </PermissionProvider>
              </SDKProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: input.terminalWidth, height: input.terminalHeight ?? 12 },
  )
  let frame = ""
  const ready = input.waitFor ?? (input.tab === "files" ? "file-0" : "探针卡")
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    frame = app.captureCharFrame()
    if (frame.includes(ready)) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return { app, frame }
}

test("分区卡的可用列数:侧栏 44 时文件页 37、待办页 36(照真实嵌套量)", async () => {
  // 文件页:文件树要真的溢出,滚动条才会占掉那一列。
  const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-geometry-"))
  for (let index = 0; index < 40; index++) await writeFile(path.join(root, `file-${index}-long-name.ts`), "")

  try {
    const files = await renderSidebar({ tab: "files", directory: root, terminalWidth: 120 })
    try {
      // 根侧栏卡(44)+ 分区卡;分区卡才是要量的那个。
      const card = findNeonBox(files.app.renderer.root as Node, (node) => node.screenX > 0)!
      expect(card.width).toBe(39)
      // 卡内可用列 = 卡宽 − 2(左右边框,内边距列就是边框列)。
      expect(card.width - 2).toBe(37)
      expect(sidebarCardContentWidth(SIDEBAR_MIN_WIDTH, "files")).toBe(37)
    } finally {
      files.app.renderer.destroy()
    }

    const info = await renderSidebar({ tab: "info", directory: root, terminalWidth: 120, registerProbeCard: true })
    try {
      const card = findNeonBox(info.app.renderer.root as Node, (node) => node.screenX > 0)!
      expect(card.width).toBe(38)
      expect(card.width - 2).toBe(36)
      expect(SIDEBAR_CARD_MIN_CONTENT).toBe(36)
    } finally {
      info.app.renderer.destroy()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("分区卡在侧栏最窄时也不把正文顶到右边框外", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-border-"))
  for (let index = 0; index < 40; index++) await writeFile(path.join(root, `file-${index}-long-name.ts`), "")
  try {
    const files = await renderSidebar({ tab: "files", directory: root, terminalWidth: 120 })
    try {
      const card = findNeonBox(files.app.renderer.root as Node, (node) => node.screenX > 0)!
      // 卡自己的边框占最外两列,中间才是内容。
      const contentLeft = card.screenX + 1
      const contentRight = card.screenX + card.width - 2
      expect(contentRight - contentLeft + 1).toBe(37)

      // 卡里的每一个**盒子**都必须待在内容区内。文本节点不给这条断言:TextRenderable 报的
      // 是自身排好版的宽度,超长的那部分由渲染器裁掉,宽度值本身比边框大是正常的
      // (所以「文本有没有被裁得看不出省略号」要靠 truncateToWidth 那几组单测兜)。
      const boxes = collect(card).filter((node) => laidOut(node) && node.constructor.name !== "TextRenderable")
      expect(boxes.length).toBeGreaterThan(3)
      for (const node of boxes) {
        expect(node.screenX).toBeGreaterThanOrEqual(contentLeft)
        expect(node.screenX + node.width).toBeLessThanOrEqual(contentRight + 1)
      }
    } finally {
      files.app.renderer.destroy()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// 「快速预览」卡挂在文件页里、在 scrollbox **外面**,所以要验的是「它出现了而且有内容」。
//
// 这条只钉住「预览卡出现 + 有内容」,不碰高度:高度那条归下面 height 24 的用例管。
// 高度得给 20(默认 12 那个是宽度模型用的)—— previewMaxLines(12) 是 0 行,正文根本不会出现。
test("侧栏文件页:选中文件后「快速预览」卡出现并有内容", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-preview-"))
  clearFileTreeCache()
  for (let index = 0; index < 40; index++) await writeFile(path.join(root, `file-${index}-long-name.ts`), "")
  const picked = path.join(root, "file-7-long-name.ts")
  await writeFile(picked, ["export const quick = true", "export const preview = 7"].join("\n"))
  setSelectedPath(picked)
  try {
    const files = await renderSidebar({
      tab: "files",
      directory: root,
      terminalWidth: 120,
      terminalHeight: 20,
      waitFor: "quick",
    })
    try {
      expect(files.frame).toContain("快速预览")
      expect(files.frame).toContain("file-7-long-name.ts")
      expect(files.frame).toContain("export const quick = true")
      // 没选中文件时这张卡整个不存在(空态)。
      setSelectedPath(null)
      await files.app.renderOnce()
      const empty = await renderSidebar({ tab: "files", directory: root, terminalWidth: 120 })
      try {
        expect(empty.frame).toContain("file-0")
        expect(empty.frame).not.toContain("快速预览")
      } finally {
        empty.app.renderer.destroy()
      }
    } finally {
      files.app.renderer.destroy()
    }
  } finally {
    setSelectedPath(null)
    clearFileTreeCache()
    await rm(root, { recursive: true, force: true })
  }
})

// 24 行终端上,一张**长**文件的预览卡曾经吃掉 16 行,加上侧栏 6 行固定开销是 22 行,文件树
// 只剩 2 行;20 行的终端直接 0 行,而根侧栏卡当时也没有 overflow="hidden",品牌页脚被顶出去。
// 封顶按 util/file-preview-head 的 previewMaxLines 算:24 行给正文 9 行。
//
// 三件事都要成立:预览正文在、文件树第一行在、品牌页脚在。只断言「预览看得见」的话,
// 预览把树吃光也照样绿 —— 上一条就栽在这里(它按 12 行终端渲染,树必然有地方)。
test("侧栏文件页(24 行):预览卡按可用高度封顶,文件树与品牌页脚都还在屏内", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-cap-"))
  clearFileTreeCache()
  for (let index = 0; index < 40; index++) await writeFile(path.join(root, `file-${index}-long-name.ts`), "")
  const picked = path.join(root, "file-7-long-name.ts")
  // 40 行:不封顶的话预览卡会要满 12 行,封顶后只给 9 行。
  await writeFile(picked, Array.from({ length: 40 }, (_, i) => `export const quick${i} = ${i}`).join("\n"))
  setSelectedPath(picked)
  try {
    const files = await renderSidebar({
      tab: "files",
      directory: root,
      terminalWidth: 120,
      terminalHeight: 24,
      registerProbeFooter: true,
      waitFor: "quick0",
    })
    try {
      expect(files.frame).toContain("快速预览")
      // 截断提示在 = 正文真的被截到 9 行,而不是文件本来就那么短。
      expect(files.frame).toContain("还有 31 行")
      expect(files.frame).toContain("export const quick8")
      expect(files.frame).not.toContain("quick12")
      // 文件树还在:封顶就是为它留的位置(不封顶时树只剩卡头与边框,一个文件名都放不下)。
      expect(files.frame).toContain("file-0")
      // 品牌页脚也没被顶出去。footer 槽在测试里默认没人注册(渲染成空盒子),所以插一张探针。
      expect(files.frame).toContain("FOOTER-PROBE")
    } finally {
      files.app.renderer.destroy()
    }
  } finally {
    setSelectedPath(null)
    clearFileTreeCache()
    await rm(root, { recursive: true, force: true })
  }
})
