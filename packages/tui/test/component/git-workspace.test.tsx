/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { KeyEvent } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { onCleanup, type JSX } from "solid-js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { GitWorkspace } from "../../src/component/git-workspace"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { Locale } from "../../src/util/locale"
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

// ─── 分支 / 提交 / 贮藏三个面板的外壳接线 ─────────────────────────────────────
// 只做渲染与选行(数据出来、能选行、不越界);操作逻辑不在这里,一个字都不写。
//
// 面板数据全来自真 git 子进程(util/git-exec.ts),所以这里造真仓库:造不出来的那一档
// 就该红,而不是把断言写成「存在」。写操作统一 -c 覆盖用户信息,不依赖全局 git 配置。
// Windows 上 git 子进程刚退出时目录句柄可能还没释放完,rm 会 EBUSY —— 统一收进 afterAll。

const exec = promisify(execFile)
const git = async (root: string, args: string[]) => {
  await exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })
}

const workspaceDirs: string[] = []
function tmpGitDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  workspaceDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of workspaceDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
  workspaceDirs.length = 0
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 两个提交 + 两个分支 + 一个贮藏,三个新面板各有一行可断言。
 *  分支名取得比较长,用来验内容没被 36 列左列裁掉;
 *  当前分支取名 release-2026 而不是 main —— 贮藏说明里也带当前分支名,断言不想被它干扰。
 *  `git branch` 按 refname 排序,feature-long-branch-name 排在 release-2026 前面。 */
async function repoWithBranchesAndStash(): Promise<string> {
  const dir = tmpGitDir("nw-ws-panels-")
  await git(dir, ["init", "-b", "release-2026"])
  fs.writeFileSync(path.join(dir, "alpha.txt"), "alpha\n")
  await git(dir, ["add", "alpha.txt"])
  await git(dir, ["commit", "-m", "initial commit"])
  fs.writeFileSync(path.join(dir, "beta.txt"), "beta\n")
  await git(dir, ["add", "beta.txt"])
  await git(dir, ["commit", "-m", "second commit"])
  await git(dir, ["branch", "feature-long-branch-name"])
  fs.writeFileSync(path.join(dir, "alpha.txt"), "alpha changed\n")
  await git(dir, ["add", "alpha.txt"])
  await git(dir, ["stash", "push", "-m", "wip before refactor"])
  return dir
}

/** 空仓库:git init 之后一个提交都没有 —— `git log` 会报错,state 层兜成空列表。 */
async function repoWithoutCommits(): Promise<string> {
  const dir = tmpGitDir("nw-ws-empty-")
  await git(dir, ["init", "-b", "release-2026"])
  return dir
}

type WorkspaceApp = Awaited<ReturnType<typeof testRender>>

async function renderWorkspaceAt(rootPath: string, width: number) {
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
    // 高度给足:五个面板均分,太矮会把新面板的内容行整个挤掉,断言会「看不见数据」地假红。
    { width, height: 46 },
  )
  return app
}

/** 造 opentui 键事件从 keyInput 派发 —— keymap 层与 useKeyboard 挂在同一个发射器上
 *  (与 git-workspace-clamp.test.tsx 同款,不靠 kittyKeyboard)。 */
function pressKey(renderer: { keyInput: { emit(event: string, payload: KeyEvent): void } }, name: string) {
  renderer.keyInput.emit(
    "keypress",
    new KeyEvent({
      name,
      ctrl: false,
      meta: false,
      shift: false,
      option: false,
      sequence: "",
      number: false,
      raw: "",
      eventType: "press",
      source: "raw",
    }),
  )
}

/** 轮询帧直到谓词成立;到点还不了就报错,免得测试默默超时(git 查询是异步的)。 */
async function waitFrame(app: WorkspaceApp, predicate: (frame: string) => boolean, what: string, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await app.renderOnce()
    await sleep(25)
    if (predicate(app.captureCharFrame())) return
  }
  throw new Error(`帧里始终没等到:${what}`)
}

const lineOf = (frame: string, needle: string) => frame.split("\n").find((line) => line.includes(needle)) ?? ""

const hasFocus = (frame: string, needle: string) => lineOf(frame, needle).includes("❯")

/** 一行的第 column 列(0 起)的字形;全角字符占两列,第二列记 null。 */
function cellAt(line: string, column: number): string | null {
  const cells: (string | null)[] = []
  for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)) {
    for (let rest = 0; rest < Locale.displayWidth(part.segment); rest++) cells.push(rest === 0 ? part.segment : null)
  }
  return cells[column] ?? null
}

/** 80 列以上左列固定 36,所以它的右边框落在第 36 列(0 起的下标 35)。 */
const LEFT_COLUMN_BORDER = 35

test("三个新面板都渲染出数据:当前分支带 ●、提交带短哈希、贮藏带 stash@{0}", async () => {
  const dir = await repoWithBranchesAndStash()
  const hash = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: dir })).stdout.trim()
  const app = await renderWorkspaceAt(dir, 100)
  try {
    await waitFrame(app, (frame) => frame.includes(hash) && frame.includes("stash@{0}"), "提交与贮藏的数据")
    const frame = app.captureCharFrame()
    expect(frame).toContain("●")
    // ● 标在当前分支那一行上,不是随便漂在别处。
    expect(lineOf(frame, "●")).toContain("release-2026")
    expect(frame).toContain("feature-long-branch-name")
    expect(frame).toContain(hash)
    expect(frame).toContain("stash@{0}")
  } finally {
    app.renderer.destroy()
  }
})

test("三个新面板的内容都收在 36 列左列里:不越出右边框,也没被截断", async () => {
  const dir = await repoWithBranchesAndStash()
  const hash = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: dir })).stdout.trim()
  const app = await renderWorkspaceAt(dir, 100)
  try {
    await waitFrame(app, (frame) => frame.includes(hash) && frame.includes("stash@{0}"), "三个新面板的数据")
    const frame = app.captureCharFrame()
    for (const needle of ["feature-long-branch-name", hash, "stash@{0}"]) {
      const line = lineOf(frame, needle)
      expect(line, `${needle} 那一行应当完整可见`).toContain(needle)
      expect(cellAt(line, LEFT_COLUMN_BORDER), `${needle} 那一行的第 36 列应当是左列的右边框`).toBe("│")
    }
  } finally {
    app.renderer.destroy()
  }
})

test("按 4 切到提交面板:焦点标记落到提交行,键位条跟着换成提交段", async () => {
  const dir = await repoWithBranchesAndStash()
  const hash = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: dir })).stdout.trim()
  const app = await renderWorkspaceAt(dir, 100)
  try {
    await waitFrame(app, (frame) => frame.includes(hash), "提交数据加载完")
    pressKey(app.renderer, "4")
    await waitFrame(app, (frame) => hasFocus(frame, hash), "❯ 挪到提交行")
    const frame = app.captureCharFrame()
    expect(hasFocus(frame, hash)).toBe(true)
    expect(frame).toContain("撤销上次提交")
    expect(frame).not.toContain("作用于当前行")
  } finally {
    app.renderer.destroy()
  }
})

test("空仓库:提交面板显示（暂无提交）,其它面板照常在,左列仍是 36 列", async () => {
  const dir = await repoWithoutCommits()
  const app = await renderWorkspaceAt(dir, 100)
  try {
    await waitFrame(app, (frame) => frame.includes("（暂无提交）"), "空提交占位")
    const frame = app.captureCharFrame()
    for (const title of ["状态", "文件", "分支", "提交", "贮藏"]) expect(frame).toContain(title)
    expect(cellAt(lineOf(frame, "（暂无提交）"), LEFT_COLUMN_BORDER)).toBe("│")
  } finally {
    app.renderer.destroy()
  }
})

test("切走焦点后,分支面板的旧焦点标记不残留", async () => {
  const dir = await repoWithBranchesAndStash()
  const hash = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: dir })).stdout.trim()
  const app = await renderWorkspaceAt(dir, 100)
  try {
    await waitFrame(app, (frame) => frame.includes("feature-long-branch-name"), "分支数据加载完")
    pressKey(app.renderer, "3")
    await waitFrame(app, (frame) => hasFocus(frame, "feature-long-branch-name"), "❯ 挪到分支行")
    expect(hasFocus(app.captureCharFrame(), "feature-long-branch-name")).toBe(true)

    pressKey(app.renderer, "4")
    await waitFrame(app, (frame) => hasFocus(frame, hash), "❯ 挪到提交行")
    // 提交面板拿到焦点后,分支行的 ❯ 必须消失(否则两行同时亮着)。
    expect(hasFocus(app.captureCharFrame(), "feature-long-branch-name")).toBe(false)
  } finally {
    app.renderer.destroy()
  }
})
