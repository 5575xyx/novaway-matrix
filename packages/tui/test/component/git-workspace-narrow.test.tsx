/** @jsxImportSource @opentui/solid */
//
// 窄宽度(窄于 70 列)下工作区只显示「终端太窄」提示,面板与确认行都不渲染 ——
// 但 useKeyboard / useBindings 在 early return 之前注册,按键照样汇进 run()。
// 危险命令在这里必须整条拦掉:用户看不见「再按一次 d 确认」的提示,连按两下却真把
// 工作区改动丢了 —— 无提示的危险操作比慢一步更糟。
//
// 流程:先以 100 列渲染,等真仓库数据加载完(帧里出现「文件」面板),再把宽度收到 60
// 模拟用户把终端拉窄,然后按 tab、d、d —— 断言文件没被还原、面板里 a.txt 还在。
// 阳性对照(不收窄、同款按键)钉住「链路本身通」:没有它,窄宽度那条测试在数据没加载完
// 时也会绿,等于假绿。
import { expect, test, afterAll } from "bun:test"
import { KeyEvent } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { createSignal, onCleanup, type JSX } from "solid-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { GitWorkspace } from "../../src/component/git-workspace"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

/** 工作区里有 useBindings(keymap 层),没 provider 会直接炸 —— 和 git-workspace.test 同一套。 */
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

const tmpDirs: string[] = []
function tmpGitDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) {
    // Windows 上 git 子进程刚退出时目录句柄可能还没释放完,rm 会 EBUSY。
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
  tmpDirs.length = 0
})

const exec = promisify(execFile)
const git = (root: string, args: string[]) =>
  exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })

/** 造一个有未暂存改动的仓库:main 上提交过 a.txt,工作区把它改掉。 */
async function repoWithDirtyFile(): Promise<string> {
  const dir = tmpGitDir("nw-ws-narrow-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "base\n")
  await git(dir, ["add", "a.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n")
  return dir
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 读文件内容并归一换行。Windows 上 core.autocrlf=true 时 git restore 检出的是 CRLF,
 *  直接和写入时的 "base\n" 比会永远不等 —— 阳性对照会因此假失败。 */
const readLF = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")

async function captureFrame(app: Awaited<ReturnType<typeof testRender>>) {
  await app.renderOnce()
  await sleep(25)
  await app.renderOnce()
  for (let attempt = 0; attempt < 20; attempt++) {
    const frame = app.captureCharFrame()
    if (frame.trim().length > 0) return frame
    await sleep(25)
    await app.renderOnce()
  }
  return app.captureCharFrame()
}

/** 造 opentui 键事件从 keyInput 派发 —— keymap 与 useKeyboard 都挂在同一个发射器上。 */
function pressKey(
  renderer: { keyInput: { emit(event: string, payload: KeyEvent): void } },
  name: string,
  shift = false,
) {
  renderer.keyInput.emit(
    "keypress",
    new KeyEvent({
      name,
      ctrl: false,
      meta: false,
      shift,
      option: false,
      sequence: "",
      number: false,
      raw: "",
      eventType: "press",
      source: "raw",
    }),
  )
}

/** 渲染工作区,width 是 signal —— 便于「先宽加载、再收窄」地模拟拉窗口。 */
async function renderWorkspace(rootPath: string) {
  const [width, setWidth] = createSignal(100)
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <KeymapContexts>
                <GitWorkspace rootPath={rootPath} onClose={() => {}} width={width()} />
              </KeymapContexts>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30 },
  )
  return { app, setWidth }
}

/** 等数据加载完成:帧里出现 a.txt(改动文件列表来自真 git status,标题常在、内容才作数)。 */
async function waitDataReady(app: Awaited<ReturnType<typeof testRender>>) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await captureFrame(app)).includes("a.txt")) return
    await sleep(50)
  }
  throw new Error("workspace 数据没在限时内加载完,帧里始终没有 a.txt")
}

/** Solid 的 signal 更新经微任务 flush 才落到组件树,renderOnce 前先让一拍。 */
const flush = () => sleep(25)

test("宽 100 时 d d 真会丢弃改动(阳性对照:键路本身通)", async () => {
  const dir = await repoWithDirtyFile()
  const { app } = await renderWorkspace(dir)
  try {
    await waitDataReady(app)
    pressKey(app.renderer, "tab")
    pressKey(app.renderer, "d")
    pressKey(app.renderer, "d")
    for (let attempt = 0; attempt < 40; attempt++) {
      if (readLF(path.join(dir, "a.txt")) === "base\n") return
      await sleep(50)
    }
    throw new Error("a.txt 没被还原 —— 丢弃链路本身没通,窄宽度那条测试会假绿")
  } finally {
    app.renderer.destroy()
  }
})

test("收窄到 60 后连按 d d 不丢弃(看不见确认提示就不许执行)", async () => {
  const dir = await repoWithDirtyFile()
  const { app, setWidth } = await renderWorkspace(dir)
  try {
    await waitDataReady(app)
    // 模拟用户把终端拉窄:面板整体换成「太窄」提示。
    setWidth(60)
    await flush()
    expect(await captureFrame(app)).toContain("太窄")

    pressKey(app.renderer, "tab")
    pressKey(app.renderer, "d")
    pressKey(app.renderer, "d")

    // 未修复时 fire 会在几十毫秒内还原文件;轮询一秒足够让它暴露。
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(readLF(path.join(dir, "a.txt"))).toBe("changed\n")
      await sleep(50)
    }
    // 顺便钉住面板里 a.txt 还在(refresh 没把它弄丢)。
    setWidth(100)
    await flush()
    expect(await captureFrame(app)).toContain("a.txt")
  } finally {
    app.renderer.destroy()
  }
})
