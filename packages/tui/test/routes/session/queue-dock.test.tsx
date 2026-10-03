/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import type { JSX } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { TuiKeybind } from "../../../src/config/keybind"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider } from "../../../src/context/runtime"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../../src/keymap"
import { QueueDock, QUEUE_GLYPH_FADE_FRAMES, queueGlyphFade } from "../../../src/routes/session/queue-dock"
import { resolveTheme, type ThemeJson } from "../../../src/theme"
import novawayTheme from "../../../src/theme/assets/novaway.json" with { type: "json" }
import type { QueueDraft } from "../../../src/prompt/queue"

const WIDTH = 72

const THEME = resolveTheme(novawayTheme as ThemeJson, "dark")

function cell(rgba: RGBA) {
  return `${rgba.r.toFixed(4)},${rgba.g.toFixed(4)},${rgba.b.toFixed(4)}`
}

function draft(id: string, inputText: string): QueueDraft {
  return {
    id,
    sessionID: "ses_test",
    agent: "build",
    model: { providerID: "novaway", modelID: "big-pickle" },
    inputText,
    nonTextParts: [],
  }
}

// 折叠键那条命令(session.queued_prompts)在会话页里注册,这里挂一层同名的,
// 让这一行的两端都有键名可显示 —— 断言的是左端那个「<键>追加」。
function KeymapLayer(props: { overrides: TuiKeybind.KeybindOverrides; children: JSX.Element }) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const keybinds = TuiKeybind.parse(props.overrides)
  const config = {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
  const offKeymap = registerNovaWayKeymap(keymap, renderer, config)
  const offLayer = keymap.registerLayer({
    bindings: config.keybinds.gather("session", ["session.queued_prompts"]),
  })
  onCleanup(() => {
    offLayer()
    offKeymap()
  })
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

async function renderDock(
  overrides: TuiKeybind.KeybindOverrides,
  collapsed = true,
  animate?: boolean,
  frameMs?: number,
) {
  const Body = () => (
    <box width={WIDTH}>
      <QueueDock
        items={[draft("q1", "把侧栏改成卡片式布局"), draft("q2", "顺手把过渡动画也统一了")]}
        collapsed={collapsed}
        onToggle={() => {}}
        onSend={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onClearAll={() => {}}
        animate={animate}
        frameMs={frameMs}
      />
    </box>
  )
  const app = await testRender(
    () => (
      <TuiPathsProvider
        value={{
          cwd: "/tmp/NovaWay/packages/tui",
          home: "/tmp/NovaWay/home",
          state: "/tmp/NovaWay/state",
          worktree: "/tmp/NovaWay",
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: true }}>
            <TuiConfigProvider config={createTuiResolvedConfig({ keybinds: overrides })}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <KeymapLayer overrides={overrides}>
                      <Body />
                    </KeymapLayer>
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    { width: WIDTH, height: 10 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      lines = app.captureCharFrame().split("\n")
      if (lines.some((line) => line.includes("条排队消息"))) return lines
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("渲染未在 40 轮内就绪,实际帧:" + JSON.stringify(lines.slice(0, 4)))
  } finally {
    app.renderer.destroy()
  }
}

const titleRow = (lines: string[]) => lines.find((line) => line.includes("条排队消息"))!

test("排队提示:折叠态那一行是「⇧ N 条排队消息 · <键>追加 · 预览」", async () => {
  const row = titleRow(await renderDock({}))
  expect(row).toContain("⇧")
  expect(row).toContain("2 条排队消息")
  // 键名来自 input.submit 的真实绑定(默认 return → formatKeySequence 给 "enter")
  expect(row).toContain("· enter 追加")
  expect(row).toContain("把侧栏改成卡片式布局")
})

test("排队提示:追加提示里的键跟着绑定走,不是写死的 enter", async () => {
  const row = titleRow(await renderDock({ input_submit: "ctrl+s" }))
  expect(row).toContain("· ctrl+s 追加")
  expect(row).not.toContain("enter")
})

test("排队提示:展开态那一行也带着键与追加提示", async () => {
  const row = titleRow(await renderDock({}, false))
  expect(row).toContain("⇧")
  expect(row).toContain("2 条排队消息")
  expect(row).toContain("· enter 追加")
  expect(row).toContain("将按顺序自动发送")
})

test("排队提示:一条时用单数文案,键与追加提示仍在", async () => {
  const app = await testRender(
    () => (
      <TuiPathsProvider
        value={{
          cwd: "/tmp/NovaWay/packages/tui",
          home: "/tmp/NovaWay/home",
          state: "/tmp/NovaWay/state",
          worktree: "/tmp/NovaWay",
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: true }}>
            <TuiConfigProvider config={createTuiResolvedConfig()}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <KeymapLayer overrides={{}}>
                      <box width={WIDTH}>
                        <QueueDock
                          items={[draft("q1", "只有一条")]}
                          collapsed={true}
                          onToggle={() => {}}
                          onSend={() => {}}
                          onEdit={() => {}}
                          onDelete={() => {}}
                          onClearAll={() => {}}
                        />
                      </box>
                    </KeymapLayer>
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    { width: WIDTH, height: 10 },
  )
  try {
    let row = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      row =
        app
          .captureCharFrame()
          .split("\n")
          .find((line) => line.includes("条排队消息")) ?? ""
      if (row) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(row).toContain("1 条排队消息")
    expect(row).toContain("· enter 追加")
  } finally {
    app.renderer.destroy()
  }
})

// ── 排队提示 `⇧` 的入场淡入(任务 3)───────────────────────────────────────
//
// 原型 card-design-v7.html:490 给 `.queue .arr` 挂的是 `nudge 1.6s infinite`,即一枚
// translateY(-3px) 的上下轻推。**单行的终端盒子里没有纵向位移**:一行就是一格,`⇧` 上下
// 挪一格就是把它画到邻居那一行上去(那正是「排队提示串到别处」这种问题)。所以走本仓库
// 已有的另一个维度 —— ui/neon 的 fadeIn:两个**实色**之间插值,也就是「它从 dock 底色里
// 长出来」。没有引入新维度(不做亮度脉动、不做缩放)。
//
// 注入口在 props 上(animate / frameMs)而不是从 KV 那一侧拨 animations_enabled:kv.set 会
// 写进**共享**的 state/kv.json(test/component/prompt-card.test.tsx:384 记着这件事),一旦中途
// 失败就把后续所有测试的动画关掉 —— 与 ViewEntrance / SegmentTabs 的做法一致。

type DockApp = Awaited<ReturnType<typeof testRender>>

async function mountDock(animate: boolean, frameMs: number) {
  const Body = () => (
    <box width={WIDTH}>
      <QueueDock
        items={[draft("q1", "把侧栏改成卡片式布局")]}
        collapsed={true}
        onToggle={() => {}}
        onSend={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onClearAll={() => {}}
        animate={animate}
        frameMs={frameMs}
      />
    </box>
  )
  const app = await testRender(
    () => (
      <TuiPathsProvider
        value={{
          cwd: "/tmp/NovaWay/packages/tui",
          home: "/tmp/NovaWay/home",
          state: "/tmp/NovaWay/state",
          worktree: "/tmp/NovaWay",
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: true }}>
            <TuiConfigProvider config={createTuiResolvedConfig()}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <KeymapLayer overrides={{}}>
                      <Body />
                    </KeymapLayer>
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    { width: WIDTH, height: 10 },
  )
  for (let attempt = 0; attempt < 40; attempt++) {
    await app.renderOnce()
    if (app.captureCharFrame().includes("条排队消息")) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return app
}

async function settleFrames(app: DockApp, times = 1) {
  for (let index = 0; index < times; index++) {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

/** `⇧` 那一段的字色。字符帧里看不出颜色,所以这一组断言只能从 captureSpans 读。 */
function glyphColor(app: DockApp) {
  for (const line of app.captureSpans().lines) {
    const span = line.spans.find((item) => item.text.includes("⇧"))
    if (span) return cell(span.fg)
  }
  throw new Error("帧里找不到 ⇧")
}

test("纯函数:第 0 帧就是 dock 底色(那一格看不见 ⇧),末帧精确等于终色", () => {
  const from = THEME.backgroundPanel
  const to = THEME.secondary
  expect(cell(queueGlyphFade(from, to, 0))).toBe(cell(from))
  expect(cell(queueGlyphFade(from, to, QUEUE_GLYPH_FADE_FRAMES))).toBe(cell(to))
  // 中间每一档都严格落在两端之间 —— 这一条钉住「它是插值出来的」:一个只在首末两帧之间跳的
  // 方波也能满足上面两条,但它读起来是闪烁而不是淡入。三个通道都要查(只看 r 会被
  // 「只有红通道在插值」的错实现溜过去)。
  for (let frame = 0; frame <= QUEUE_GLYPH_FADE_FRAMES; frame++) {
    const color = queueGlyphFade(from, to, frame)
    expect(color.r).toBeGreaterThanOrEqual(from.r)
    expect(color.r).toBeLessThanOrEqual(to.r)
    expect(color.g).toBeGreaterThanOrEqual(from.g)
    expect(color.g).toBeLessThanOrEqual(to.g)
    expect(color.b).toBeGreaterThanOrEqual(from.b)
    expect(color.b).toBeLessThanOrEqual(to.b)
  }
  for (let frame = 1; frame < QUEUE_GLYPH_FADE_FRAMES; frame++) {
    expect(cell(queueGlyphFade(from, to, frame))).not.toBe(cell(queueGlyphFade(from, to, frame - 1)))
  }
})

test("纯函数:相位越界夹紧(负数与超帧数都落回两端)", () => {
  const from = THEME.backgroundPanel
  const to = THEME.secondary
  expect(cell(queueGlyphFade(from, to, -10))).toBe(cell(from))
  expect(cell(queueGlyphFade(from, to, 9999))).toBe(cell(to))
})

test("排队提示:animate=false 时 ⇧ 一上来就是终色,不播淡入", async () => {
  const app = await mountDock(false, 1)
  try {
    await settleFrames(app, 3)
    expect(glyphColor(app)).toBe(cell(THEME.secondary))
  } finally {
    app.renderer.destroy()
  }
})

test("排队提示:animate=true 时 ⇧ 从 dock 底色里长出来", async () => {
  // frameMs 给一个跑不完的值:测试期间相位表一次都不推进,于是「起点不是终色」是确定的。
  const app = await mountDock(true, 60_000)
  try {
    await settleFrames(app, 3)
    expect(glyphColor(app)).toBe(cell(THEME.backgroundPanel))
    expect(glyphColor(app)).not.toBe(cell(THEME.secondary))
  } finally {
    app.renderer.destroy()
  }
})

test("排队提示:淡入走完停在终色(相位表推满即停,不留中间色)", async () => {
  const app = await mountDock(true, 1)
  try {
    let color = ""
    for (let attempt = 0; attempt < 60; attempt++) {
      await settleFrames(app, 2)
      color = glyphColor(app)
      if (color === cell(THEME.secondary)) break
    }
    expect(color).toBe(cell(THEME.secondary))
  } finally {
    app.renderer.destroy()
  }
})
