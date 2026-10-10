/** @jsxImportSource @opentui/solid */
//
// 列表收缩后的选中行 clamp:refresh() 换掉整个 fileRows 时,越界的 fileRow 会让
// 文件面板不再高亮任何行(❯ 消失),而差异面板、键位条还按旧行说事 —— 三个面板
// 对「当前选中谁」各说各话。moveRow 每一步都 clamp,但后台刷新换列表这条路没人管。
//
// 流程:两个未跟踪文件,选中第二个,连按 x x 删除它 —— git clean 落地后 refresh,
// 列表收缩成一个文件,❯ 必须跟着夹回到幸存的那一行上。
import { expect, test, afterAll } from "bun:test"
import { KeyEvent } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, type JSX } from "solid-js"
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

/** a.txt 已提交,b.txt / c.txt 两个未跟踪 —— 删除 c.txt 后列表从两行缩成一行。 */
async function repoWithTwoUntracked(): Promise<string> {
  const dir = tmpGitDir("nw-ws-clamp-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "base\n")
  await git(dir, ["add", "a.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n")
  fs.writeFileSync(path.join(dir, "c.txt"), "c\n")
  return dir
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 取一帧;空帧(还没画出来)就重试几轮 —— 和 git-workspace.test.tsx 的 renderWorkspace 同款。 */
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

/** 轮询帧直到谓词成立;到点还不了就报错,免得测试默默超时。 */
async function waitFrame(
  app: Awaited<ReturnType<typeof testRender>>,
  predicate: (frame: string) => boolean,
  what: string,
  attempts = 40,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate(await captureFrame(app))) return
    await sleep(50)
  }
  throw new Error(`帧里始终没等到:${what}`)
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

async function renderWorkspace(rootPath: string) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <KeymapContexts>
                <GitWorkspace rootPath={rootPath} onClose={() => {}} width={100} />
              </KeymapContexts>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 30 },
  )
  return app
}

test("删除选中行后列表收缩,❯ 夹回到幸存的那一行", async () => {
  const dir = await repoWithTwoUntracked()
  const app = await renderWorkspace(dir)
  try {
    await waitFrame(
      app,
      (frame) => frame.includes("b.txt") && frame.includes("c.txt"),
      "数据加载完(b/c 两个未跟踪文件)",
    )
    pressKey(app.renderer, "tab")
    pressKey(app.renderer, "j")
    // 武装瞬间的选中行必须是 c.txt:❯ 应该已经挪到第二行。
    await waitFrame(app, (frame) => lineOf(frame, "c.txt").includes("❯"), "j 后 ❯ 在 c.txt 行")
    // x x 删除 c.txt:clean 落地 → refresh → 列表从两行缩成一行。
    pressKey(app.renderer, "x")
    pressKey(app.renderer, "x")
    await waitFrame(app, (frame) => !frame.includes("c.txt"), "c.txt 从列表消失")
    // 夹回的选中行:❯ 必须落在幸存的 b.txt 行上,而不是谁也不高亮。
    expect(lineOf(await captureFrame(app), "b.txt")).toContain("❯")
  } finally {
    app.renderer.destroy()
  }
})

/** 帧里包含某文件名的那一行 —— 断言「❯ 在哪一行」比断言整帧稳定得多。 */
function lineOf(frame: string, needle: string): string {
  return frame.split("\n").find((line) => line.includes(needle)) ?? ""
}
