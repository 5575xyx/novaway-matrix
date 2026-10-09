/** @jsxImportSource @opentui/solid */
// 提示条(feature-plugins/home/tips-view)的行为契约。
//
// 这里只测一条、也是唯一真正坏过的那一条:**点「稍后」消解掉的是「屏幕上正在显示的这一条」**。
//
// 坏掉的形状:tips.tsx 把 `props.dismissed`(上一次存进 kv 的值)当回调参数传回来再写回 kv。
// 首次点击拿到的是空串,存回去等于什么都没消解,卡原地不动 —— 用户报的就是「点了没有反应」。
// tip-card.test.tsx 已经证明 TipCard 那一侧的点击链路是通的,所以这里不再重复点位几何,
// 只钉「回调带回来的 key 是不是当前这条的纯文本」。
//
// 期望值**从帧里读**(「● 提示」到「稍后」之间那一段),不手抄提示文案:提示是 Math.random()
// 从候选池里挑的,把某一条的原文写死在这里,下次挑中别的那条测试就假红了。
//
// 挂载栈照 component/prompt-card.test.tsx 的 renderCard:Tips 一路 useCommandShortcut,没有
// keymap provider 会直接抛「Keymap not found」。
import { expect, test } from "bun:test"
import { onCleanup, type ParentProps, type JSX } from "solid-js"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { MouseEvent } from "@opentui/core"
import { ArgsProvider } from "../../src/context/args"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { Tips } from "../../src/feature-plugins/home/tips-view"
import { TIP_DISMISS_LABEL, TIP_LABEL } from "../../src/feature-plugins/home/tip-card"
import { createTuiPluginApi } from "../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

function KeymapContexts(props: ParentProps) {
  const renderer = useRenderer()
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const off = registerNovaWayKeymap(keymap, renderer, {
    keybinds: createTuiResolvedConfig().keybinds,
    leader_timeout: 2000,
  })
  onCleanup(off)
  return <NovaWayKeymapProvider keymap={keymap}>{props.children}</NovaWayKeymapProvider>
}

type Node = {
  getChildren(): unknown[]
  processMouseEvent: (event: MouseEvent) => void
  /** opentui 把 onMouseUp 存进 _mouseListeners.up,没有公开 getter —— 按实现里的字段找。 */
  _mouseListeners?: Record<string, unknown>
}

function clickableBoxes(node: Node, found: Node[] = []) {
  if (typeof node._mouseListeners?.up === "function") found.push(node)
  for (const child of node.getChildren()) clickableBoxes(child as Node, found)
  return found
}

function click(node: Node) {
  node.processMouseEvent(
    new MouseEvent(node as never, {
      type: "up",
      button: 0,
      x: 0,
      y: 0,
      modifiers: { shift: false, alt: false, ctrl: false },
    }),
  )
}

test("提示条:点「稍后」回调回来的是当前这条的纯文本,不是上一次存的值", async () => {
  const api = createTuiPluginApi()
  const dismissed: string[] = []
  const body = () => (
    <box width={80}>
      <Tips api={api} connected onDismiss={(key) => dismissed.push(key)} />
    </box>
  )
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <ArgsProvider>
            <KVProvider>
              <ThemeProvider mode="dark">
                <KeymapContexts>{body()}</KeymapContexts>
              </ThemeProvider>
            </KVProvider>
          </ArgsProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    // 90 列:提示条容器被 TIP_BAR_MAX 夹到 75,卡内宽 71 —— 候选池里最长的那几条都放得下,
    // 于是帧里读到的就是没被截断的整句,下面的逐字比对才不是在比半句话。
    { width: 90, height: 10 },
  )
  try {
    let frame = ""
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      frame = app.captureCharFrame()
      if (frame.includes(TIP_LABEL) && frame.includes(TIP_DISMISS_LABEL)) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const row = frame.split("\n").find((line) => line.includes(TIP_DISMISS_LABEL))
    expect(row, "提示卡没渲染出来,下面的点击会打在空树上").toBeDefined()

    const buttons = clickableBoxes(app.renderer.root as unknown as Node)
    expect(buttons.length).toBeGreaterThan(0)
    click(buttons.at(-1)!)

    // 帧里「● 提示」与「稍后」之间那一段,就是屏幕上那句话本身(胶囊只在两侧各垫一列空白)。
    const shown = row!.slice(row!.indexOf(TIP_LABEL) + TIP_LABEL.length, row!.indexOf(TIP_DISMISS_LABEL)).trim()
    // 这两条就是 bug 本体:坏掉的写法把「上一次存的值」传回来,首次点击是空串。
    expect(dismissed).toHaveLength(1)
    expect(dismissed[0]).not.toBe("")
    expect(dismissed[0]).toBe(shown)
  } finally {
    app.renderer.destroy()
  }
})
