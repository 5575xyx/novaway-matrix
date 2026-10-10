/** @jsxImportSource @opentui/solid */
//
// GitWorkspace 的测试挂载器(Task 6 沉淀,Task 7-10 共用)。
//
// 「挂载工作区 → 注入按键 → 读字符帧 / 轮询真 git 结果」这套脚手架之前散在
// test/component/git-workspace-clamp.test.tsx 与 test/cli/tui/dialog-prompt.test.tsx 里,
// 新用例只能抄一遍。抄一遍就错一遍:少一层 provider 报 context 缺失,少一次 renderOnce 读到旧帧。
//
// provider 栈全套照抄 git-workspace-clamp.test.tsx:NovaWayKeymapProvider 给 useBindings 用
// (工作区自己注册了 tab / shift+tab 一层),KVProvider 需要 state/kv.json 存在
// (缺文件只刷一条 ENOENT 噪音,不是失败),少一层就报 context 缺失。
//
// 按键走 app.mockInput.pressKey(opentui 官方输入模拟,经 stdin → 真实解析器),
// 而不是 renderer.keyInput.emit:后者绕过解析器,空格 / 数字键的 sequence 形态可能对不上
// focus.ts 的 keyOfParsed 口径。
//
// 等异步结果一律轮询(wait / waitForFrame),不用固定 sleep 判胜 —— test/AGENTS.md 明确禁止。
import { afterAll } from "bun:test"
import { createBindingLookup } from "@opentui/keymap/extras"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, type JSX } from "solid-js"
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { GitWorkspace } from "../../src/component/git-workspace"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

export type TestApp = Awaited<ReturnType<typeof testRender>>

export interface WorkspaceOptions {
  /** 要打开的 git 仓库根目录。 */
  root: string
  /** 渲染宽度。低于 70 列整个工作区只显示「请加宽」,默认 100。 */
  width?: number
  /** 渲染高度,默认 30。 */
  height?: number
  /** 按 esc 关工作区时的回调,默认空实现。 */
  onClose?: () => void
}

export interface WorkspaceHarness {
  /** testRender 的原生返回:需要 mockInput / captureSpans 之类时直接用。 */
  app: TestApp
  /** 派发一次按键,等该帧画完才返回 —— 连续按两个键必须逐个等,顺序才不会乱。 */
  pressKey(name: string, opts?: { ctrl?: boolean; shift?: boolean }): Promise<void>
  /** 当前字符帧(已等一帧画完)。 */
  frame(): Promise<string>
  /** 轮询字符帧直到谓词成立;到点抛出,不让测试静默挂到 30s 超时。 */
  waitForFrame(predicate: (frame: string) => boolean, what: string): Promise<void>
  /** 轮询**真 git 输出**用的等待器:git 子进程是异步的,固定 sleep 既慢又抖。 */
  wait(fn: () => boolean | Promise<boolean>, what: string, timeoutMs?: number): Promise<void>
  cleanup(): void
  [Symbol.dispose](): void
}

/** 一次性 git 工作目录,注册到 afterAll 统一清。 */
const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs) {
    // Windows 上 git 子进程刚退出时目录句柄可能还没释放完,rm 会 EBUSY。
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
  tmpDirs.length = 0
})

export function tmpGitDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

const runGitProcess = promisify(execFile)

/** 建仓库用的异步 git。非零退出码会抛 —— 建仓库失败就该红,不该让断言自己猜。 */
export async function git(root: string, args: string[]): Promise<void> {
  await runGitProcess("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], {
    cwd: root,
  })
}

/**
 * 轮询用的同步 git 输出:返回 stdout,失败时返回空串。
 *
 * 失败返回空串而不是抛出:它出现在 wait() 的谓词里,是「还没到位」的合法中间态
 * (贮藏还没 pop 完、分支还没切过去)。抛出去会让轮询死在第一次还没到位的采样上。
 * 真出问题时 wait() 的超时信息会带上 what,照样能查。
 */
export function gitOut(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], {
      cwd: root,
      encoding: "utf8",
    })
  } catch {
    return ""
  }
}

/**
 * `git status --porcelain` 输出。只去掉行尾换行,**不能 trim**:
 * porcelain 用**行首空格**区分暂存(`M  file`)与未暂存(` M file`),trim 会把这一格吃掉,
 * 两种状态就再也分不清了。
 */
export function porcelain(root: string): string {
  return gitOut(root, ["status", "--porcelain"]).trimEnd()
}

/** 帧里包含 needle 的**全部**行 —— 一个名字可能同时出现在状态面板和分支面板里,取第一行会误判。 */
export function linesOf(frame: string, needle: string): string[] {
  return frame.split("\n").filter((line) => line.includes(needle))
}

const sleep = (ms: number) => Bun.sleep(ms)

/** 等一帧画完再取字符帧。主题异步就绪,就绪前整屏空白,所以要重试到非空。 */
async function captureFrame(app: TestApp): Promise<string> {
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

/** 工作区里有 useBindings(keymap 层),没 provider 会直接炸 —— 和 git-workspace.test.tsx 同一套。 */
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

export async function mountWorkspace(options: WorkspaceOptions): Promise<WorkspaceHarness> {
  const width = options.width ?? 100
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <KeymapContexts>
                <GitWorkspace rootPath={options.root} onClose={options.onClose ?? (() => {})} width={width} />
              </KeymapContexts>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width, height: options.height ?? 30 },
  )

  return {
    app,
    pressKey: async (name, opts) => {
      app.mockInput.pressKey(name, opts)
      await captureFrame(app)
    },
    frame: () => captureFrame(app),
    waitForFrame: async (predicate, what) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (predicate(await captureFrame(app))) return
        await sleep(25)
      }
      throw new Error(`字符帧里始终没等到:${what}`)
    },
    wait: async (fn, what, timeout = 3000) => {
      const start = Date.now()
      while (!(await fn())) {
        if (Date.now() - start > timeout) throw new Error(`始终没等到:${what}`)
        await sleep(25)
      }
    },
    cleanup: () => {
      app.renderer.destroy()
    },
    [Symbol.dispose]() {
      app.renderer.destroy()
    },
  }
}
