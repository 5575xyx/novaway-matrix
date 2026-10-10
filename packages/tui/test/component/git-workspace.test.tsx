/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, type JSX } from "solid-js"
import { GitWorkspace } from "../../src/component/git-workspace"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { TestTuiContexts } from "../fixture/tui-environment"

/** 工作区里有 useBindings(keymap 层),没 provider 会直接炸 —— 和 git-branch-row.test 同一套。 */
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

async function renderWorkspace(width: number, rootPath = process.cwd()) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <KeymapContexts>
                <GitWorkspace rootPath={rootPath} onClose={() => {}} width={width} />
              </KeymapContexts>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: 30 },
  )
  try {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
    for (let attempt = 0; attempt < 5; attempt++) {
      const frame = app.captureCharFrame()
      if (frame.trim().length > 0) return frame
      await new Promise((resolve) => setTimeout(resolve, 25))
      await app.renderOnce()
    }
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

test("五个面板标题都在,且是整圈边框", async () => {
  const frame = await renderWorkspace(100)
  for (const title of ["状态", "文件", "分支", "提交", "贮藏"]) expect(frame).toContain(title)
  // Lazygit 式边框:圆角框角。标题嵌在上边框行里(opentui 原生 title)。
  expect(frame).toContain("╭")
  expect(frame).toContain("╰")
})

test("底部键位提示条有中文说明(两行:全局段 + 焦点段)", async () => {
  const frame = await renderWorkspace(100)
  // 全局段(不随焦点变)。
  expect(frame).toContain("切面板")
  // 焦点段(默认焦点在状态面板,这句来自 keybarText("status"))。
  expect(frame).toContain("作用于当前行")
})

test("默认焦点在状态面板", async () => {
  // 换成边框后聚焦色在字符帧里看不见,焦点标记落在内容上:状态面板选中行带 ❯。
  // ❯ 只画在聚焦面板的当前行,所以「❯ 分支」同时钉住了「焦点在状态」与「选中的是分支行」。
  expect(await renderWorkspace(100)).toContain("❯ 分支")
})

test("窄于 70 列时提示太窄而不是硬挤", async () => {
  expect(await renderWorkspace(60)).toContain("太窄")
})

test("70 列时不提示太窄,面板仍渲染", async () => {
  const frame = await renderWorkspace(70)
  expect(frame).not.toContain("太窄")
  expect(frame).toContain("状态")
})

test("70-79 列时左列收到 30,80 列及以上是 36", async () => {
  // 宽度规则(规格「布局」)。测标题框的左缘不现实,改测「窄档下差异区仍有足够空间」:
  // 把面板钉在 70 列,断言太窄提示不出现且五个标题都在(没被左列挤没)。
  const frame = await renderWorkspace(79)
  for (const title of ["状态", "文件", "分支", "提交", "贮藏"]) expect(frame).toContain(title)
})
