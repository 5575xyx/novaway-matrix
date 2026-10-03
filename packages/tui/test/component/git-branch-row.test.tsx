/** @jsxImportSource @opentui/solid */
import { afterAll, expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { createBindingLookup } from "@opentui/keymap/extras"
import { onCleanup, type JSX } from "solid-js"
import fs from "fs"
import os from "os"
import path from "path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { GitPanel } from "../../src/component/git-panel"
import { SidebarCard } from "../../src/component/sidebar-card"
import { ArgsProvider } from "../../src/context/args"
import { ClipboardProvider } from "../../src/context/clipboard"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TuiKeybind } from "../../src/config/keybind"
import { NovaWayKeymapProvider, registerNovaWayKeymap } from "../../src/keymap"
import { DialogProvider } from "../../src/ui/dialog"
import { ToastProvider } from "../../src/ui/toast"
import { Locale } from "../../src/util/locale"
import { DEFAULT_THEMES, resolveTheme } from "../../src/theme"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// 分支行现在带两样东西(原型 card-design-v7.html:853-855 与 :253-260):
// 当前分支一枚 `●` 且名字同色;每一行按需跟 `⇡ N` / `⇣ N`,**为 0 的那一枚不画**。
//
// ahead/behind 有没有数据,这里不假设:面板自己起真 git 子进程(util/git-exec.ts),
// 所以测试直接造一个真仓库 —— 造不出来的那一档就该红,而不是把断言写成「存在」。
// 上游用**本地分支**充当:git 算领先/落后只看 upstream 那条 ref,与它是不是远程无关
// (所以这个测试不需要配 remote、不需要联网)。

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

let state: string | undefined
function stateDir() {
  if (state) return state
  state = fs.mkdtempSync(path.join(os.tmpdir(), "nw-git-branch-"))
  fs.writeFileSync(path.join(state, "kv.json"), "{}")
  return state
}

afterAll(() => {
  if (!state) return
  fs.rmSync(state, { recursive: true, force: true })
  state = undefined
})

function GitMount(props: { root: string; children: JSX.Element }) {
  return (
    <TestTuiContexts directory={props.root} paths={{ state: stateDir() }}>
      <ClipboardProvider>
        <KeymapContexts>
          <ArgsProvider>
            <KVProvider>
              <ToastProvider>
                <DialogProvider>
                  <TuiConfigProvider config={createTuiResolvedConfig()}>
                    <ThemeProvider mode="dark">{props.children}</ThemeProvider>
                  </TuiConfigProvider>
                </DialogProvider>
              </ToastProvider>
            </KVProvider>
          </ArgsProvider>
        </KeymapContexts>
      </ClipboardProvider>
    </TestTuiContexts>
  )
}

const exec = promisify(execFile)
const git = async (root: string, args: string[]) => {
  await exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })
}
const commit = async (root: string, name: string) => {
  fs.writeFileSync(path.join(root, `${name}.txt`), name)
  await git(root, ["add", "."])
  await git(root, ["commit", "-m", name])
}

/**
 * 造一个分支拓扑,让几行分别落在不同状态上(C1/C2/… 是推进顺序,见下面每一步):
 *   main(当前) ← future:两者分叉过 → `⇡ 1 ⇣ 1`(两枚都在,而且都不是 0)
 *   topic      ← base          → `⇡ 3`(只有领先)
 *   stale      ← main          → `⇣ 2`(只有落后)
 *   plain / base / future 没有上游 → 两枚都不画
 *
 * 数字别照抄注释:算的是提交集合的差,不是步数 —— future 上那个 c4 不在 main 的树里,
 * 所以 stale 落后的是 C3 与 C5 两个,topic 领先 base 的是 C2/C3/C5 三个。
 */
async function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nw-git-repo-"))
  await git(root, ["init", "-b", "main"])
  await commit(root, "c1")
  await git(root, ["branch", "base"]) // base = C1
  await commit(root, "c2") // main = C2
  await git(root, ["branch", "stale"]) // stale = C2
  await commit(root, "c3") // main = C3
  await git(root, ["branch", "plain"]) // plain = C3,刻意不给上游
  // 分叉:future 与 main 各走一步,于是谁也不是谁的前沿。
  await git(root, ["branch", "future"]) // future = C3
  await git(root, ["checkout", "future"])
  await commit(root, "c4") // future = C4
  await git(root, ["checkout", "main"])
  await commit(root, "c5") // main = C5
  await git(root, ["branch", "topic"]) // topic = C5
  await git(root, ["branch", "--set-upstream-to=future", "main"]) // C5 vs C4 → ⇡1 ⇣1
  await git(root, ["branch", "--set-upstream-to=base", "topic"]) // C5 vs C1 → ⇡3
  await git(root, ["branch", "--set-upstream-to=main", "stale"]) // C2 vs C5 → ⇣2
  return root
}

async function renderPanel(root: string) {
  const app = await testRender(
    () => (
      <GitMount root={root}>
        <SidebarCard title="分支" badge="main">
          <GitPanel rootPath={root} />
        </SidebarCard>
      </GitMount>
    ),
    { width: 60, height: 22 },
  )
  let frame = ""
  for (let attempt = 0; attempt < 400; attempt++) {
    await app.renderOnce()
    frame = app.captureCharFrame()
    // 分支行齐了才算就绪(那七条 git 查询都是异步的)。
    if (frame.includes("plain") && frame.includes("topic") && frame.includes("stale")) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return { app, frame: () => app.captureCharFrame(), lines: () => app.captureCharFrame().split("\n") }
}

/** 一行帧文本 → 每列一个字形(宽字符占两列,第二列记 null)。 */
function columns(line: string) {
  const cells: (string | null)[] = []
  for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line)) {
    cells.push(part.segment)
    for (let rest = 1; rest < Locale.displayWidth(part.segment); rest++) cells.push(null)
  }
  return cells
}

test("Git 面板:当前分支标 ●、其余标 ○,ahead/behind 按需显示,为 0 的那一枚不画", async () => {
  const root = await makeRepo()
  const app = await renderPanel(root)
  try {
    const frame = app.frame()
    const lines = app.lines()
    // 分支行 = 同时含标记与分支名的那一行。卡头徽标与标题行里也有 "main",
    // 所以不能只按名字找(踩过:badge 那一行也被当成分支行)。
    const row = (branch: string) =>
      lines.find((line) => line.includes(branch) && columns(line).some((cell) => cell === "●" || cell === "○"))!
    // 名字之后的那一段(计数与悬停「 删」都在这里)。计数是被名字那一段的 flexGrow 推到
    // 行尾的,所以右端紧挨着卡边框 —— 断言前把边框字符与空白去掉。
    const tail = (branch: string) =>
      row(branch)
        .slice(row(branch).indexOf(branch) + branch.length)
        .replace(/[│\s]+$/, "")
        .trim()
    const theme = resolveTheme(DEFAULT_THEMES.novaway, "dark")

    // 计数:分叉的那一行两枚都在,只领先/只落后的各一枚,没有上游的一枚都没有。
    // 非当前分支的行尾还有一格悬停才显形的「 删」(占位恒定),当前分支没有它。
    expect(tail("main")).toBe("⇡ 1 ⇣ 1")
    expect(tail("topic")).toBe("⇡ 3 删")
    expect(tail("stale")).toBe("⇣ 2 删")
    expect(tail("plain")).toBe("删")
    expect(tail("base")).toBe("删")
    // 「0 的那一枚不画」:整帧里不该出现 ⇡ 0 / ⇣ 0。
    expect(frame).not.toContain("⇡ 0")
    expect(frame).not.toContain("⇣ 0")
    // 只有落后的那一行不画 ⇡(证明是「按需」而不是「两枚都画个 0」)。
    expect(tail("stale")).not.toContain("⇡")
    expect(tail("topic")).not.toContain("⇣")

    // 标记:当前分支 ●,其余 ○。
    const markAt = (line: string) => columns(line).findIndex((cell) => cell === "●" || cell === "○")
    expect(columns(row("main"))[markAt(row("main"))]).toBe("●")
    for (const branch of ["topic", "stale", "plain", "base"])
      expect(columns(row(branch))[markAt(row(branch))]).toBe("○")

    // 颜色:● 与当前分支的名字都是 success;○ 与其余名字不是那一档。
    const grid = app.app.captureSpans().lines.map((line) => {
      const cells: { r: number; g: number; b: number }[] = []
      for (const span of line.spans) for (const _ of span.text) cells.push({ r: span.fg.r, g: span.fg.g, b: span.fg.b })
      return cells
    })
    const lineAt = (branch: string) => lines.findIndex((line) => line === row(branch))
    const color = (branch: string, column: number) => grid[lineAt(branch)][column]
    const rgb = (value: { r: number; g: number; b: number }) => ({ r: value.r, g: value.g, b: value.b })
    expect(color("main", markAt(row("main"))), "● 应当是 success").toEqual(rgb(theme.success))
    // 名字起点:标记段之后就是名字(标记段恒定 2 列)。
    expect(color("main", markAt(row("main")) + 2), "当前分支的名字应当同色").toEqual(rgb(theme.success))
    expect(color("stale", markAt(row("stale"))), "○ 应当是 textMuted").toEqual(rgb(theme.textMuted))
    expect(color("stale", markAt(row("stale")) + 2), "普通分支的名字不占用当前分支那一档").not.toEqual(
      rgb(theme.success),
    )
    // 领先那一枚是 warning(琥珀,原型 `.ahead` 那一档),落后那一枚是 error。
    const mainCells = columns(row("main"))
    const aheadAt = mainCells.indexOf("⇡")
    const behindAt = mainCells.indexOf("⇣")
    expect(color("main", aheadAt)).toEqual(rgb(theme.warning))
    expect(color("main", behindAt)).toEqual(rgb(theme.error))
  } finally {
    app.app.renderer.destroy()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
