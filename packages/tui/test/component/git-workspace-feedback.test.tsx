/** @jsxImportSource @opentui/solid */
//
// 工作区的反馈完整性:git 命令失败必须在状态面板「提示」行给出原因(中文,经 hintFromError
// 映射),且失败后照样 refresh() —— 早先版本 gitExec 失败时既不刷新也无提示,
// 用户按了键毫无动静,只剩一条没人看的 unhandled rejection。
//
// 制造失败的办法:仓库里只放一个**未跟踪**文件,在文件面板对它连按 d d ——
// `git restore --worktree --staged -- b.txt` 对未跟踪文件必然失败(pathspec 不匹配),
// 而仓库本身仍然健康,后续刷新、暂存都能成功 —— 正好把「失败路径」和「成功清提示」
// 两条线都钉住。
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

/** 只有未跟踪文件的仓库:a.txt 已提交且干净,b.txt 未跟踪 —— 对 b.txt 的 restore 必然失败。 */
async function repoWithUntracked(): Promise<string> {
  const dir = tmpGitDir("nw-ws-feedback-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "base\n")
  await git(dir, ["add", "a.txt"])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "b.txt"), "untracked\n")
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

test("git 命令失败时提示行给出原因,成功后清掉", async () => {
  const dir = await repoWithUntracked()
  const app = await renderWorkspace(dir)
  try {
    await waitFrame(app, (frame) => frame.includes("b.txt"), "数据加载完(b.txt 进列表)")
    pressKey(app.renderer, "tab")
    // d d:对未跟踪文件 discard —— git restore 必然失败(pathspec 不匹配)。
    pressKey(app.renderer, "d")
    pressKey(app.renderer, "d")
    // 失败原因必须出现在状态面板的「提示」行(整帧里唯一会出现这句的地方)。
    await waitFrame(app, (frame) => frame.includes("git 执行失败"), "失败提示「git 执行失败」")
    // 失败后照样 refresh():b.txt 还在列表里,视图没有停在过期状态。
    expect(await captureFrame(app)).toContain("b.txt")
    // 再按空格暂存它 —— add 对未跟踪文件成功,提示应当被清掉(成功路径也接了反馈)。
    pressKey(app.renderer, "space")
    await waitFrame(app, (frame) => !frame.includes("git 执行失败"), "成功后失败提示消失")
  } finally {
    app.renderer.destroy()
  }
})
