/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import type { CapturedFrame } from "@opentui/core"
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
import builtinSidebarFooter from "../../src/feature-plugins/sidebar/footer"
import { SidebarCard } from "../../src/component/sidebar-card"
import { clearFileTreeCache, setSelectedPath } from "../../src/component/file-tree"
import { sidebarCardContentWidth, SIDEBAR_CARD_MIN_CONTENT } from "../../src/util/sidebar-metrics"
import { SIDEBAR_MIN_WIDTH } from "../../src/util/sidebar-width"
import { workbenchOptions } from "../../src/component/dialog-workbench"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createFetch, eventSource, json } from "../fixture/tui-sdk"
import { createTuiPluginApi } from "../fixture/tui-plugin"

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
type Node = { width: number; height: number; screenX: number; screenY: number; getChildren(): unknown[] }

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
  /** 把**真的**内置页脚插件(feature-plugins/sidebar/footer.tsx)注册进那张槽。 */
  registerBuiltinFooter?: boolean
  /** 等这一段出现在帧里;省略就是各页自己的老条件。 */
  waitFor?: string
}) {
  setSidebarTab(input.tab)
  const runtime = createPluginRuntime()
  const Body = () => {
    const renderer = useRenderer()
    // 生产里这层卡是内置插件(slot)插进来的;测试里注册一张同名探针卡,
    // 量的是完全相同的嵌套:根卡 → scrollbox → <box paddingRight={1}> → SidebarCard。
    if (input.registerProbeCard || input.registerProbeFooter || input.registerBuiltinFooter) {
      // setupSlots 只调一次:它内部会重建 registry 并替换掉槽的渲染函数,调第二次会把
      // 第一次注册进去的东西(探针卡)一起丢掉。
      const host = runtime.setupSlots({ renderer, theme: { current: {} } } as unknown as TuiPluginApi)
      if (input.registerProbeCard || input.registerProbeFooter) {
        host.register({
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
      if (input.registerBuiltinFooter) {
        // 内置页脚插件要走生产那条注册路径:宿主把插件交来的 slots 收进 registry 并补上 id
        // (见 packages/novaway/src/plugin/tui/runtime.ts 的 slots.register)。
        // provider 给一个非 NovaWay 的条目 → 插件判定「已经连上别的提供商」,快速开始引导块不画,
        // 于是这一帧里页脚只剩品牌落款,「有没有印目录」这条断言不会被引导块的文案干扰。
        const api = {
          ...createTuiPluginApi({
            state: {
              // mock 数据只带了 id,Provider/Session 的其余必填字段用 never 强转掉
              // (同一手法见 test/feature-plugins/sidebar-messages.test.tsx)。
              provider: [{ id: "test-provider" }] as never,
              // 实例目录必须与侧栏那份一致:生产里插件印的就是 state.path.directory,
              // 送一个别的目录进来,「页脚没有目录」这条就会假通过。
              path: { state: "", config: "", worktree: input.directory, directory: input.directory },
            },
          }),
          renderer,
          slots: {
            register(plugin: { slots: Record<string, unknown> }) {
              return host.register({ ...plugin, id: "test:builtin-sidebar-footer" } as never)
            },
          },
        } as unknown as TuiPluginApi
        void builtinSidebarFooter.tui(api, undefined, {} as never)
      }
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

// 侧栏页脚**不印目录**:目录在整个底部区域由会话页底栏(routes/session/footer.tsx)独家显示,
// 那一行还带着 abbreviateHome 过的路径与 `⑂ 分支`(会话页底栏那条另有断言,见
// test/component/prompt-mount.test.tsx)。侧栏这两处(内置插件与下面这段兜底)曾经都印过,
// 于是屏幕底部上下叠着两条一模一样的路径、分支跟着印了两遍。
//
// 这一条量的是**兜底**那一层:sidebar_footer 槽在没有插件注册时就落到它身上,所以兜底里
// 加回目录是一次真实的回归。生产里占住那张槽的是内置插件(feature-plugins/sidebar/footer.tsx),
// 它的对应断言在 test/feature-plugins/sidebar-footer.test.tsx。
//
// 目录给一个**短**路径是有意的:侧栏最宽 60 列(SIDEBAR_MAX_WIDTH),长的临时目录路径会被
// 渲染器裁掉,那样「帧里没有这个目录」就成了一句裁切之后的空话。停在信息页也是有意的 ——
// 文件页的分区卡徽标本来就印着 basename(rootDirName),那一页量不到「目录没被印第二遍」。
test("侧栏页脚(插件缺席时的兜底)不打印目录", async () => {
  const files = await renderSidebar({
    tab: "info",
    directory: "/w/nwsf",
    terminalWidth: 120,
    registerProbeCard: true,
  })
  try {
    // 闸门:兜底确实渲染了(品牌落款 + 版本),否则「没有目录」只是一句空话。
    expect(files.frame).toContain("NovaWay")
    expect(files.frame).toContain("探针卡")
    // 契约:实例目录不在侧栏这一列里。
    expect(files.frame).not.toContain("/w/nwsf")
  } finally {
    files.app.renderer.destroy()
  }
})

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

// 「谁在什么时候动」这一对必须**在同一帧里一起量**,单独量任何一边都钉不住:
//   · 侧栏根卡右边框 = 原型 `.sidebar::after { animation: railV 9s linear infinite }`
//     那根永不间歇的 1px 导轨(card-design-v7.html:109-115)。原型侧栏自己不带描边 ——
//     那一列的轮廓就是这根轨,所以终端里根卡的右缘是同一块表面,这一档保留 flow。
//   · 同屏那张分区卡底态冻结:原型 `.card` 底态不流,`gbFlow` 挂在 `:hover` 上(:159-163)。
//
// 判据逐格逐通道比而不用亮度:叠色(alpha)把亮度坡压平了,r 升 g 降互相抵消,亮度差
// 会掉进 8bit 量化噪声里(理由见 test/component/card-hover.test.tsx 的 borderRow)。
// 根卡侧只要求「动了」,门槛就是 8bit 的一档(1/255 = 0.004);分区卡侧要求**恰好 0**。
test("侧栏根卡常驻流动(原型那根 railV 导轨),同屏的分区卡底态冻结", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nw-sidebar-flow-"))
  // 文件给少一点:树短,分区卡的顶边框整排都落在滚动视口内,采样点不会落到被裁掉的行上。
  for (let index = 0; index < 6; index++) await writeFile(path.join(root, `file-${index}.ts`), "")
  try {
    const files = await renderSidebar({ tab: "files", directory: root, terminalWidth: 120, terminalHeight: 16 })
    try {
      const rootCard = findNeonBox(files.app.renderer.root as Node, (node) => node.screenX === 0)!
      const section = findNeonBox(files.app.renderer.root as Node, (node) => node.screenX > 0)!
      // 导轨 = 根卡右边框那一列(去掉上下两个圆角),也就是原型那根轨贴的那条边。
      const rail = Array.from({ length: rootCard.height - 4 }, (_, offset) => {
        return `${rootCard.screenY + 2 + offset}:${rootCard.screenX + rootCard.width - 1}`
      })
      // 分区卡的顶边框(同样避开圆角)。
      const head = [2, 3, 4, 5, 6].map((offset) => `${section.screenY}:${section.screenX + offset}`)
      // 采样点必须真的画在描边上。边框格被祖先的 visibleClip 跳过时那一格留的是背景,
      // 采到的颜色自然一动不动 —— 「恰好 0」会变成一句空话,所以先把「整圈都在可视区里」
      // 钉住:根卡贴满终端高度(右边框那一列必然可见),分区卡整张落在滚动视口之内
      // (顶边框没被裁)。
      expect(rootCard.screenY + rootCard.height, "根卡应当贴满终端高度").toBe(16)
      expect(section.screenY + section.height, "分区卡整张都该在滚动视口内,顶边框没被裁").toBeLessThanOrEqual(
        rootCard.height,
      )

      const moving = await sample(files.app, rail, 4)
      expect(
        Math.max(...moving.slice(1).map((shot) => maxChannel(moving[0], shot))),
        "侧栏根卡应当在无人悬停时也流动",
      ).toBeGreaterThan(0.004)

      const still = await sample(files.app, head, 4)
      for (const shot of still) {
        expect(maxChannel(still[0], shot), "分区卡底态应当逐格冻结").toBe(0)
      }
    } finally {
      files.app.renderer.destroy()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** captureSpans 给的是「一段同色字符」,边框是逐格渐变的带子 —— 先按字符摊平,再按格取值。 */
function cellGrid(app: { captureSpans(): CapturedFrame }) {
  const map = new Map<string, { r: number; g: number; b: number }>()
  app.captureSpans().lines.forEach((line, row) => {
    let col = 0
    for (const span of line.spans) {
      for (const _ of span.text) {
        map.set(`${row}:${col}`, { r: span.fg.r, g: span.fg.g, b: span.fg.b })
        col += 1
      }
    }
  })
  return map
}

/** 相位每 80ms 走一格,200ms 至少跨两格;这里只等定时器,不依赖渲染循环。 */
const PHASE_WAIT = 200

async function sample(
  app: { renderOnce(): Promise<void>; captureSpans(): CapturedFrame },
  points: string[],
  count: number,
) {
  const shots: { r: number; g: number; b: number }[][] = []
  for (let index = 0; index < count; index++) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PHASE_WAIT))
    await app.renderOnce()
    const cells = cellGrid(app)
    shots.push(points.map((key) => cells.get(key)!))
  }
  return shots
}

function maxChannel(a: { r: number; g: number; b: number }[], b: { r: number; g: number; b: number }[]) {
  return Math.max(
    ...a.flatMap((left, index) => {
      const right = b[index]
      return [Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)]
    }),
  )
}
