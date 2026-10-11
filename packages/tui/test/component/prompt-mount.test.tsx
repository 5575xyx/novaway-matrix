/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { onCleanup, type JSX } from "solid-js"
import fs from "fs"
import os from "os"
import path from "path"

import { Prompt } from "../../src/component/prompt"
import { usageRowColumns } from "../../src/component/prompt/card"
import { Home } from "../../src/routes/home"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { DataProvider } from "../../src/context/data"
import { EditorContextProvider } from "../../src/context/editor"
import { ExitProvider } from "../../src/context/exit"
import { KVProvider } from "../../src/context/kv"
import { LocalProvider } from "../../src/context/local"
import { LocationProvider } from "../../src/context/location"
import { PermissionProvider } from "../../src/context/permission"
import { ProjectProvider } from "../../src/context/project"
import { PromptRefProvider } from "../../src/context/prompt"
import { RouteProvider } from "../../src/context/route"
import { SDKProvider } from "../../src/context/sdk"
import { SyncProvider, useSync } from "../../src/context/sync"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { PluginRuntimeProvider, createPluginRuntime } from "../../src/plugin/runtime"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { FrecencyProvider } from "../../src/prompt/frecency"
import { PromptHistoryProvider } from "../../src/prompt/history"
import { PromptStashProvider } from "../../src/prompt/stash"

import { createEventSource, createFetch, directory } from "../fixture/tui-sdk"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

function KeymapContexts(props: { children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const config = {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const off = registerNovaWayKeymap(keymap, renderer, config)
  onCleanup(off)
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

// KV / prompt history / stash / frecency 都往 paths.state 落盘。fixture 默认的
// /tmp/NovaWay/state 在 Windows 上不存在,会刷一串 ENOENT;这里给一个真实临时目录,
// 整轮测完删掉 —— 不去动任何共享路径。
let state: string | undefined
function stateDir() {
  if (state) return state
  state = fs.mkdtempSync(path.join(os.tmpdir(), "novaway-tui-prompt-"))
  // KVProvider 直接把「读不到」打在 console.error 上,先铺一个空文件让它安静下来
  fs.writeFileSync(path.join(state, "kv.json"), "{}")
  return state
}

afterAll(() => {
  if (!state) return
  fs.rmSync(state, { recursive: true, force: true })
  state = undefined
})

// app.tsx 里围在 <Prompt> 外面的整串 provider(testRender 版)。顺序照抄 src/app.tsx:265-367 ——
// 少挂一层不会「安静地少点东西」,而是会以 xxx context must be used within a context provider
// 报出来,把测试的注意力引到错的行上。
function PromptMount(props: { children: JSX.Element }) {
  const events = createEventSource()
  const { fetch } = createFetch(undefined, events)
  const runtime = createPluginRuntime()
  // 生产里 app.tsx 通过 props.pluginHost.start(...) 触发 setupSlots;不接上这一下,
  // 每个 <Slot> 都渲染 null —— 首页的 <Prompt> 就挂在 home_prompt 这个 slot 里(slot 空 → 提示不画)。
  runtime.setupSlots({ ...createTuiPluginApi(), renderer: useRenderer() })
  return (
    <TestTuiContexts directory={directory} paths={{ state: stateDir() }}>
      <ClipboardProvider>
        <KeymapContexts>
          <ExitProvider exit={() => {}}>
            <ArgsProvider>
              <KVProvider>
                <ToastProvider>
                  <RouteProvider>
                    <TuiConfigProvider config={createTuiResolvedConfig()}>
                      <PluginRuntimeProvider value={runtime}>
                        <SDKProvider
                          url="http://localhost:1"
                          directory={directory}
                          fetch={fetch}
                          events={events.source}
                        >
                          <PermissionProvider>
                            <ProjectProvider>
                              <SyncProvider>
                                <DataProvider>
                                  <ThemeProvider mode="dark">
                                    <LocalProvider>
                                      <PromptStashProvider>
                                        <DialogProvider>
                                          <FrecencyProvider>
                                            <PromptHistoryProvider>
                                              <PromptRefProvider>
                                                <EditorContextProvider>
                                                  <LocationProvider>{props.children}</LocationProvider>
                                                </EditorContextProvider>
                                              </PromptRefProvider>
                                            </PromptHistoryProvider>
                                          </FrecencyProvider>
                                        </DialogProvider>
                                      </PromptStashProvider>
                                    </LocalProvider>
                                  </ThemeProvider>
                                </DataProvider>
                              </SyncProvider>
                            </ProjectProvider>
                          </PermissionProvider>
                        </SDKProvider>
                      </PluginRuntimeProvider>
                    </TuiConfigProvider>
                  </RouteProvider>
                </ToastProvider>
              </KVProvider>
            </ArgsProvider>
          </ExitProvider>
        </KeymapContexts>
      </ClipboardProvider>
    </TestTuiContexts>
  )
}

type Harness = Awaited<ReturnType<typeof testRender>>

async function renderUntil(app: Harness, ready: (text: string) => boolean) {
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = app.captureCharFrame()
    if (ready(text)) return text
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  app.renderer.destroy()
  throw new Error("渲染未在 200 轮内就绪,实际帧:\n" + text)
}

async function renderMount(
  body: () => JSX.Element,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await testRender(() => <PromptMount>{body()}</PromptMount>, options)
  await renderUntil(app, ready)
  return app
}

// 真挂载 Prompt(不是抽出来的 PromptCard 壳)。这条存在的理由就是它能兜住「组件一挂载就崩」:
// canSend 这个 memo 曾经在 createStore 之前读 store.prompt.input,createMemo 首帧求值撞 TDZ,
// `bun dev` 起手即崩(Cannot access 'store' before initialization)——而当时全套 612 个测试
// 因为只挂 PromptCard/PromptSend 这几个壳,没有一个真的把 Prompt 挂起来过。
test("Prompt:真组件挂载不抛,输入卡的霓虹描边与发送按钮都在画面上", async () => {
  const app = await renderMount(
    () => <Prompt />,
    { width: 80, height: 20 },
    (text) => text.includes("发送"),
  )
  try {
    const text = app.captureCharFrame()
    expect(text).toContain("╭")
    expect(text).toContain("发送")
  } finally {
    app.renderer.destroy()
  }
})

// 目录在整个底部区域**只出现一次**,在会话页底栏(routes/session/footer.tsx)里。
// 这一行原来印的是 `location()?.directory ?? paths.cwd`,和底栏的 path.get().directory
// 是同一个目录(服务端 Session.createNext 的两个调用方都传 InstanceState.context.directory),
// 屏幕上于是上下叠着两条一模一样的路径。
//
// 这条特意用「sync 里没有这个会话」的 sessionID:那时 location() 是 undefined,旧实现会退到
// paths.cwd(测试 fixture 里就是 fixture 的 directory),所以断言对「打了任何一条路径」都成立,
// 不依赖会话数据。
test("Prompt:带 sessionID 挂载时,输入卡下的状态行不再打印目录路径", async () => {
  const app = await renderMount(
    () => <Prompt sessionID="ses_test" />,
    { width: 80, height: 20 },
    (text) => text.includes("发送"),
  )
  try {
    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
    const border = rows.findIndex((line) => line.includes("╯"))
    expect(border).toBeGreaterThanOrEqual(0)
    // 状态行在卡片下边框之下(见 prompt/index.tsx 的状态行布局)。那一段里不该有任何路径形态
    // 的文本:既没有实例目录,也没有「/」开头的相对路径。
    const status = rows.slice(border + 1)
    expect(status.join("\n")).not.toContain(directory)
    expect(status.some((line) => line.includes("/"))).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})

// 同一串 provider 下面再挂一次首页路由本身:`bun dev` 起手画的就是这棵树,而崩就崩在它
// 渲染 <Prompt> 的那一帧上(home_prompt 那个 slot 的默认内容就是 Prompt)。
// slot 不接 setupSlots 的话它渲染 null,这条会假通过 —— PromptMount 里那一步是这条成立的前提。
test("首页:整棵 home 树挂载不抛,输入卡在画面上", async () => {
  const app = await renderMount(
    () => <Home />,
    { width: 120, height: 40 },
    (text) => text.includes("发送"),
  )
  try {
    const text = app.captureCharFrame()
    expect(text).toContain("发送")
    expect(text).toContain("╭")
  } finally {
    app.renderer.destroy()
  }
})

/**
 * 往 sync 里塞一条**有 output** 的助手消息 —— sessionUsage 取的正是「最后一条有输出的
 * 助手消息」(util/usage),没有它 usage() 恒为 undefined,底下那条测试就量不到东西。
 * 走 sync 暴露的 set 而不是手改 store 代理,是为了和 message.updated 那条生产路径同源。
 */
function SeedUsage(props: { sessionID: string; children: JSX.Element }) {
  const sync = useSync()
  queueMicrotask(() => {
    sync.set("message", props.sessionID, [
      {
        id: "msg_usage",
        sessionID: props.sessionID,
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5",
        // 77_100 + 12 = 77_112 → Locale.number 渲染成「77.1K」
        tokens: { input: 77_100, output: 12, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1, completed: 2 },
      },
    ] as never)
  })
  return props.children
}

// 输入卡底下那一行的垂直节奏。
//
// 用户报的是「输入卡下面空了一行」:那条行只带一个右对齐的 `77.1K`,80 列里 75 列是空的,
// 读起来就是一条空行。实测(80×24,照抄 routes/session/index.tsx:1883 那一层的嵌套)那张行
// 就在下边框之下、终端底缘之上 —— 它本身不是多出来的空白,而是**一条几乎全空的行**。
// 于是这里钉的是折进卡内之后的节奏:上下文占用与 agent/模型/发送同在卡内底部行,
// 输入卡的下边框就是最后一行有字的行,下面只剩终端底缘那一行空白。
//
// 四档宽度都量:窄终端上 usage 会按档降级、末档整段不画(见 util/usage 的 usageLabel),
// 但**任何一档都不许在卡外留下半截数字或一条有字的行**。
const USAGE_FIGURE = "77.1K"

for (const width of [40, 60, 80, 120]) {
  test(`输入卡下方:${width} 列下上下文占用在卡内,下边框之下没有有字的行`, async () => {
    const app = await renderMount(
      () => (
        <SeedUsage sessionID="ses_usage">
          <Prompt sessionID="ses_usage" />
        </SeedUsage>
      ),
      { width, height: 20 },
      // 就绪信号只认「发送」:它恒在(连窄到放不下 usage 的那一档也在)。拿 usage 文本当信号
      // 会在 40 列那档永远不成立,ready 立刻返回 → 量到的是还没画完的半截帧(下边框 −1)。
      (text) => text.includes("发送"),
    )
    try {
      const rows = app
        .captureCharFrame()
        .split("\n")
        .map((line) => line.replace(/\s+$/, ""))
      const border = rows.findIndex((line) => line.includes("╯"))
      expect(border, `帧:\n${rows.join("\n")}`).toBeGreaterThanOrEqual(0)
      // 下边框之下**没有任何有字的行**(终端底缘那几行空白不算)。
      expect(rows.slice(border + 1).every((line) => line.trim() === "")).toBe(true)
      // 下边框就是最后一行有字的行:输入卡的底边直接压到屏幕底。
      expect(rows.findLastIndex((line) => line.trim() !== "")).toBe(border)
      // usage 在场时它落在**卡内**、与发送同一行,不是卡外那一行。
      const figure = rows.findIndex((line) => line.includes(USAGE_FIGURE))
      if (figure >= 0) {
        expect(figure).toBeLessThan(border)
        expect(rows[figure], `第 ${figure} 行:${rows[figure]}`).toContain("发送")
      } else {
        // 放不下时是整段不画(而不是被裁成「7」那种假数字):门槛就是 usageRowColumns。
        expect(usageRowColumns(width), `${width} 列本该放得下 ${USAGE_FIGURE}`).toBe(0)
      }
    } finally {
      app.renderer.destroy()
    }
  })
}

// 空闲时(没有任何助手消息 → usage() 为 undefined)输入卡底下同样什么都没有。
// 这条与上面那条是两种不同的空:上面是「有数字但几乎空的行」,这条是「连数字都没有」。
test("输入卡下方:空闲且没有用量时,下边框之下同样没有有字的行", async () => {
  const app = await renderMount(
    () => <Prompt sessionID="ses_idle" />,
    { width: 80, height: 20 },
    (text) => text.includes("发送"),
  )
  try {
    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
    const border = rows.findIndex((line) => line.includes("╯"))
    expect(border).toBeGreaterThanOrEqual(0)
    expect(rows.slice(border + 1).every((line) => line.trim() === "")).toBe(true)
    expect(rows.findLastIndex((line) => line.trim() !== "")).toBe(border)
  } finally {
    app.renderer.destroy()
  }
})

/** 把会话标成 busy —— 状态行的开关 statusRowVisible 就看它(见 prompt/index.tsx)。 */
function SeedBusy(props: { sessionID: string; children: JSX.Element }) {
  const sync = useSync()
  queueMicrotask(() => {
    sync.set("session_status", props.sessionID, { type: "busy" } as never)
  })
  return props.children
}

// 卡外状态行**没有被这次改动删掉**,只是收窄了触发条件:会话一忙起来它就该出现。
// 这条钉住那个开关的两端 —— 空闲时零内容(上面那两条)、忙时有内容(这一条)。
// 工作区提示 / 移动进度 / retry / 编辑器文件标签与 busy 走的是同一个开关的不同分支。
test("输入卡下方:会话忙时状态行仍在,紧贴下边框之下", async () => {
  const app = await renderMount(
    () => (
      <SeedBusy sessionID="ses_busy">
        <Prompt sessionID="ses_busy" />
      </SeedBusy>
    ),
    { width: 80, height: 20 },
    (text) => text.includes("中断"),
  )
  try {
    const rows = app
      .captureCharFrame()
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
    const border = rows.findIndex((line) => line.includes("╯"))
    expect(border, `帧:\n${rows.join("\n")}`).toBeGreaterThanOrEqual(0)
    // 状态行仍然存在,而且紧贴下边框之下(没有多出来的空行插在中间)。
    expect(rows[border + 1]).toContain("中断")
    // 转圈那一格左边缩进 1 列,所以 `esc` 不在行首 —— 这一行左半边是转圈。
    expect(rows[border + 2]!.trim()).toBe("")
  } finally {
    app.renderer.destroy()
  }
})

// 「自动批准权限」开关的确认闸门。
//
// 开了之后所有工具调用的权限请求都会被自动批掉,不再逐条询问 —— 包括删文件、执行命令这类
// 危险动作。所以点开关**只是把问题问出来**:关→开必须先弹一次对话框,用户按下「确定」之前
// permission.mode 一个字都不许动;反过来开→关是安全动作,直接生效。
//
// 只能在真 <Prompt> 上量:开关本体与闸门逻辑分别在 component/prompt/index.tsx 的
// toggleAutoApprove 与 ui/auto-approve.ts,<PromptCard> 壳里只有 <PromptAutoApprove>
// 自己的字形与点击回调(那两件由 prompt-card.test.tsx 钉住)。
const APPROVE_TITLE = "开启自动批准权限"

/** 开关上那颗实心/空心圆的位置 —— 点它就等于点开关。 */
function autoApproveCell(app: Harness, glyph: "○" | "●") {
  const rows = app
    .captureCharFrame()
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
  const y = rows.findIndex((line) => line.includes(glyph))
  if (y < 0) throw new Error(`帧里找不到 ${glyph} 自动批准开关,实际帧:\n${rows.join("\n")}`)
  // 圆与它左边的东西都是单列(边框、空格、">"),所以字符下标就是列号 —— CJK 在圆的右边,
  // 影响不到它的位置。
  return { x: rows[y]!.indexOf(glyph), y }
}

/**
 * 点一下开关并等确认框出现在帧上。
 *
 * 谓词认的是**确认框的标题**而不是开关的字形 —— 这一步本身就是「点开关必须先弹确认」的那条
 * 断言:要是有人把闸门去掉、让点击直接 set("auto"),这里会在 200 轮后带着当前帧报错。
 */
async function clickToggle(app: Harness, glyph: "○" | "●") {
  const cell = autoApproveCell(app, glyph)
  await app.mockMouse.click(cell.x, cell.y)
  await renderUntil(app, (text) => text.includes(APPROVE_TITLE))
}

test("自动批准开关:关→开弹确认,取消后开关仍然是关的", async () => {
  const app = await renderMount(
    () => <Prompt sessionID="ses_toggle_cancel" />,
    { width: 80, height: 24 },
    (text) => text.includes("自动批准"),
  )
  try {
    await clickToggle(app, "○")
    // 走「取消」那一支:左移到取消再回车(DialogConfirm 默认选中的是确定)。
    app.mockInput.pressArrow("left")
    app.mockInput.pressEnter()
    await renderUntil(app, (text) => !text.includes(APPROVE_TITLE))
    const text = app.captureCharFrame()
    expect(text).toContain("○ 自动批准")
    expect(text).not.toContain("● 自动批准")
  } finally {
    app.renderer.destroy()
  }
})

test("自动批准开关:确认框里按下确定才真的打开", async () => {
  const app = await renderMount(
    () => <Prompt sessionID="ses_toggle_confirm" />,
    { width: 80, height: 24 },
    (text) => text.includes("自动批准"),
  )
  try {
    await clickToggle(app, "○")
    app.mockInput.pressEnter()
    const text = await renderUntil(app, (value) => value.includes("● 自动批准"))
    // 对话框自己关掉了 —— DialogConfirm 的「确定」回调之后跟的就是 dialog.clear()。
    expect(text).not.toContain(APPROVE_TITLE)
  } finally {
    app.renderer.destroy()
  }
})

test("自动批准开关:开→关直接生效,不再弹确认", async () => {
  const app = await renderMount(
    () => <Prompt sessionID="ses_toggle_off" />,
    { width: 80, height: 24 },
    (text) => text.includes("自动批准"),
  )
  try {
    // 先按上一条那条路把它开起来。
    await clickToggle(app, "○")
    app.mockInput.pressEnter()
    await renderUntil(app, (text) => text.includes("● 自动批准"))
    // 再点一次:关掉是安全动作。谓词认的是「开关回到 ○」,它若去等确认框就会 200 轮超时。
    const cell = autoApproveCell(app, "●")
    await app.mockMouse.click(cell.x, cell.y)
    const text = await renderUntil(app, (value) => value.includes("○ 自动批准"))
    expect(text).not.toContain(APPROVE_TITLE)
  } finally {
    app.renderer.destroy()
  }
})
