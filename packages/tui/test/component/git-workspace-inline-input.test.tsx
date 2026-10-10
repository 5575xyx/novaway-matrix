/** @jsxImportSource @opentui/solid */
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup } from "solid-js"
import { tmpdir } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

type TestApp = Awaited<ReturnType<typeof testRender>>

// 等谓词为真,10ms 一轮。mockInput 是同步派发的,但 keymap 派发和渲染是异步的,
// 直接断言会读到旧帧 —— 文本输入测试全靠这个等下去。
async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

type InlineInputHarness = {
  root: string
  title: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

// 照抄 test/cli/tui/dialog-prompt.test.tsx 的整套 harness:那是仓库里唯一能驱动文本输入的脚手架。
// 关键三件套是 createDefaultOpenTuiKeymap(renderer) + registerNovaWayKeymap + onCleanup(off),
// 少一件,enter / esc 的绑定就挂不上,断言会读到空数组而查不出原因。
// test/component/** 下 fixture 相对路径少一层(见 dialog-prompt.test.tsx 同目录约定)。
async function mountInline(input: InlineInputHarness) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { InlineInput },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { NovaWayKeymapProvider, registerNovaWayKeymap },
  ] = await Promise.all([
    import("../../src/component/git-workspace/inline-input"),
    import("../../src/context/kv"),
    import("../../src/context/theme"),
    import("../../src/config"),
    import("../../src/keymap"),
  ])

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({ leader_timeout: 1000 })
    const off = registerNovaWayKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts
        directory={input.root}
        paths={{
          home: input.root,
          state,
          worktree: input.root,
        }}
      >
        <NovaWayKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <InlineInput title={input.title} width={40} onConfirm={input.onConfirm} onCancel={input.onCancel} />
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </NovaWayKeymapProvider>
      </TestTuiContexts>
    )
  }

  // kittyKeyboard 必须开:关掉时 enter / 方向键解析出的键名和真机不一致。
  const app = await testRender(() => <Harness />, { kittyKeyboard: true, width: 60, height: 20 })
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

async function focusTextarea(app: TestApp) {
  await wait(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  const editor = app.renderer.currentFocusedEditor
  if (!(editor instanceof TextareaRenderable)) throw new Error("expected focused inline textarea")
  return editor
}

test("enter 提交:走 keymap 绑定,不是 textarea 的 onSubmit", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const inline = await mountInline({
    root: tmp.path,
    title: "提交信息",
    onConfirm: (value) => confirmed.push(value),
    onCancel: () => {},
  })

  try {
    const textarea = await focusTextarea(inline.app)
    inline.app.mockInput.pressKey("a")
    inline.app.mockInput.pressKey("b")
    await inline.app.flush()

    expect(textarea.plainText).toBe("ab")

    inline.app.mockInput.pressEnter()
    await inline.app.flush()

    expect(confirmed).toEqual(["ab"])
    expect(textarea.plainText).toBe("ab")
  } finally {
    await inline.cleanup()
  }
})

test("esc 取消:onConfirm 不被调用", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const cancelled: string[] = []
  const inline = await mountInline({
    root: tmp.path,
    title: "新建分支",
    onConfirm: (value) => confirmed.push(value),
    onCancel: () => cancelled.push("cancelled"),
  })

  try {
    const textarea = await focusTextarea(inline.app)
    inline.app.mockInput.pressKey("m")
    inline.app.mockInput.pressKey("a")
    await inline.app.flush()
    expect(textarea.plainText).toBe("ma")

    inline.app.mockInput.pressEscape()
    await inline.app.flush()

    expect(cancelled).toEqual(["cancelled"])
    expect(confirmed).toEqual([])
  } finally {
    await inline.cleanup()
  }
})

test("空内容不提交:trim 后为空就静默返回", async () => {
  await using tmp = await tmpdir()
  const confirmed: string[] = []
  const inline = await mountInline({
    root: tmp.path,
    title: "添加远程",
    onConfirm: (value) => confirmed.push(value),
    onCancel: () => {},
  })

  try {
    await focusTextarea(inline.app)
    inline.app.mockInput.pressEnter()
    await inline.app.flush()
    expect(confirmed).toEqual([])

    // 纯空格同样不算内容:git 会把空标题当成合法参数,行为难解释。
    inline.app.mockInput.pressKey(" ")
    inline.app.mockInput.pressKey(" ")
    await inline.app.flush()
    inline.app.mockInput.pressEnter()
    await inline.app.flush()
    expect(confirmed).toEqual([])
  } finally {
    await inline.cleanup()
  }
})

test("首帧渲染出标题与冒号", async () => {
  await using tmp = await tmpdir()
  const inline = await mountInline({
    root: tmp.path,
    title: "提交信息",
    onConfirm: () => {},
    onCancel: () => {},
  })

  try {
    // 主题异步就绪,就绪前整屏空白;等标题真的画出来再断言。
    await wait(() => inline.app.captureCharFrame().includes("提交信息"))
    const frame = inline.app.captureCharFrame()
    expect(frame).toContain("提交信息")
    expect(frame).toContain("：")
  } finally {
    await inline.cleanup()
  }
})
