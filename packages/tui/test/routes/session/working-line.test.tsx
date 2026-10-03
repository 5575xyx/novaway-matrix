/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { TuiConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider } from "../../../src/context/runtime"
import { messageColumns } from "../../../src/routes/session/message-anchor"
import { workingTitleColumns, type WorkingPart } from "../../../src/routes/session/thinking-step"
import { WorkingLine } from "../../../src/routes/session"
import { displayWidth } from "../../../src/util/locale"

// 跑的是生产件 WorkingLine 本体,不手抄 —— 手抄的话改列预算或换动词都不会有测试变红。
// 目标与动词的判定在纯函数里(thinking-step,另有单测);这里只钉**排版**:标题行与计时
// 是不是同一行、计时是不是右对齐、有目标时那一段在不在、没有目标时这一行是否仍然完整。
const WIDTH = 48
const COLUMNS = workingTitleColumns(WIDTH)

const reasoning = (text: string): WorkingPart => ({ type: "reasoning", text })
const tool = (status: string, input?: Record<string, unknown>): WorkingPart => ({
  type: "tool",
  state: { status, input },
})

// 动效总闸那一档要**预置一个 kv.json**,而不是在测试里 kv.set —— KVProvider 的写是落到
// `<TuiPathsProvider>.state/kv.json` 的真文件,用共享的那个路径会把 animations_enabled
// 留给后面所有测试(实测:assistant-card / footer-bar 的帧整个变空)。这里给每个档一份
// 自己的 state 目录,测试之间与测试之外都不串。
const stateDirs = new Map<boolean, string>()
async function stateDirFor(animations: boolean) {
  const cached = stateDirs.get(animations)
  if (cached) return cached
  const dir = path.join(os.tmpdir(), `tui-working-line-anim-${animations ? "on" : "off"}-${process.pid}`)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "kv.json"), JSON.stringify({ animations_enabled: animations }))
  stateDirs.set(animations, dir)
  return dir
}

async function renderLine(
  parts: readonly WorkingPart[],
  options: { thinking?: boolean; width?: number; animations?: boolean } = {},
) {
  const width = options.width ?? WIDTH
  const state = await stateDirFor(options.animations ?? true)
  const Body = () => (
    <box width={width}>
      <WorkingLine sessionID="ses_test" thinking={options.thinking ?? false} parts={parts} ctxWidth={width} />
    </box>
  )
  const app = await testRender(
    () => (
      <TuiPathsProvider
        value={{
          cwd: "/tmp/NovaWay/packages/tui",
          home: "/tmp/NovaWay/home",
          state,
          worktree: "/tmp/NovaWay",
        }}
      >
        <TuiTerminalEnvironmentProvider value={{ platform: "linux" }}>
          <TuiStartupProvider value={{ skipInitialLoading: true }}>
            <TuiConfigProvider config={createTuiResolvedConfig()}>
              <ArgsProvider>
                <KVProvider>
                  <ThemeProvider mode="dark">
                    <Body />
                  </ThemeProvider>
                </KVProvider>
              </ArgsProvider>
            </TuiConfigProvider>
          </TuiStartupProvider>
        </TuiTerminalEnvironmentProvider>
      </TuiPathsProvider>
    ),
    { width, height: 8 },
  )
  try {
    let lines: string[] = []
    for (let attempt = 0; attempt < 40; attempt++) {
      await app.renderOnce()
      lines = app.captureCharFrame().split("\n")
      if (lines[1]?.includes("✦")) return lines
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("渲染未在 40 轮内就绪,实际帧:" + JSON.stringify(lines.slice(0, 4)))
  } finally {
    app.renderer.destroy()
  }
}

/** 计时那一格落在第几列(1 起算的显示列数)。CJK 占 2 列,所以不能直接 indexOf。 */
function timerColumn(row: string, timer: string) {
  const at = row.indexOf(timer)
  if (at < 0) return -1
  return displayWidth(row.slice(0, at + timer.length))
}

test("思考块标题行:目标可判定时是「✦ 分析 <目标> <动词>」,计时在同一行右缘", async () => {
  const row = (await renderLine([tool("running", { filePath: "src/index.tsx" })]))[1]
  expect(row).toContain("✦")
  // 字与字之间的空格是 JSX 表达式给的(`{" 分析"}` 与 span 里那个前导空格);
  // 写成裸文本的话画面上会挤成 `✦分析src/index.tsx` —— 一个空格都没有。
  expect(row).toContain("✦ 分析 ")
  expect(row).toContain(" 分析 src/index.tsx 执行")
  // 目标紧跟在「分析」后面、动词在目标后面 —— 顺序本身就是这条断言要锁的东西
  expect(row.indexOf("src/index.tsx")).toBeGreaterThan(row.indexOf("分析"))
  expect(row.indexOf("执行")).toBeGreaterThan(row.indexOf("src/index.tsx"))
  // 计时器从挂载起算,首帧是 0ms
  expect(row).toContain("0ms")
})

test("思考块标题行:计时右缘与助手气泡卡的右边框同列(消息列那一道)", async () => {
  const row = (await renderLine([reasoning("先看 src/index.tsx")], { thinking: true }))[1]
  // 行缩进 2 列 + 行宽 min(容器, 行预算)→ 计时那一格落在 messageColumns(ctxWidth) 列,
  // 而 MessageAnchor 的 maxWidth:78% 让助手卡右边框落在同一列(见 message-anchor 的注释)。
  expect(COLUMNS).toBe(messageColumns(WIDTH) - 2)
  expect(timerColumn(row, "0ms")).toBe(messageColumns(WIDTH))
})

test("思考块标题行:目标取自推理正文里的路径 / 符号时也一样画出来", async () => {
  const pathRow = (await renderLine([reasoning("先看看 queue-dock.tsx 怎么排的")], { thinking: true }))[1]
  expect(pathRow).toContain("✦ 分析 queue-dock.tsx 推理")
  const symbolRow = (await renderLine([reasoning("messageColumns 那个上限得跟着收窄")], { thinking: true }))[1]
  expect(symbolRow).toContain("✦ 分析 messageColumns 推理")
})

test("思考块标题行:判定不出目标时整段省略,前缀与计时仍然完整", async () => {
  const row = (await renderLine([reasoning("先确认一下整体思路再动手")], { thinking: true }))[1]
  expect(row).toContain("✦ 分析 ")
  expect(row).toContain(" 推理")
  // 没有被截碎的路径碎片 —— 降级是「少一段」,不是「多一截认不出的东西」
  expect(row).not.toContain("…")
  // 右对齐不受影响
  expect(timerColumn(row, "0ms")).toBe(messageColumns(WIDTH))
})

test("思考块标题行:窄到目标预算跌破下限时降级,计时不被挤掉", async () => {
  // 39 列主区 → 消息列 30 → 行预算 28 → 目标预算 7,低于下限 8
  const row = (await renderLine([reasoning("先看 src/routes/session/index.tsx")], { thinking: true, width: 39 }))[1]
  expect(row).toContain("✦ 分析 ")
  expect(row).toContain(" 推理")
  expect(row).not.toContain("src/routes")
  expect(row).toContain("0ms")
  expect(timerColumn(row, "0ms")).toBe(messageColumns(39))
})

test("思考块:标题行下面那条 crush 噪声流仍在,仍然 24 列", async () => {
  const lines = await renderLine([reasoning("先看 src/index.tsx")], { thinking: true })
  expect(lines[1]).toContain("✦")
  // 噪声流是标题行的下一行:出生前每个格子显示渐变色的 "."(见 util/anim-spinner 的 birth 偏移)
  expect(lines[2]?.trim()).toMatch(/^[.]{24}/)
  // 阶段标签还在噪声流那一行(它说的是「哪一段」,与标题行里那个动词不是同一句话)
  expect(lines[2]).toContain("思考中")
})

test("思考块:关掉 animations_enabled 后噪声流走 ⋯ 兜底,标题行一个字都不变", async () => {
  const parts: readonly WorkingPart[] = [reasoning("先看 src/index.tsx")]
  const animated = await renderLine(parts, { thinking: true })
  const still = await renderLine(parts, { thinking: true, animations: false })
  // 标题行在两个档下完全一致 —— 原型的 `.th-row` 上没有 animation,所以这一行
  // 本来就没有自己的动画可关;真正读那个总闸的是它下面那条 crush 流。
  expect(still[1]).toBe(animated[1])
  expect(still[1]).toContain("✦ 分析 src/index.tsx 推理")
  // 噪声流那两档确实不同:关掉时是 WorkingSpinner 的 `⋯` 兜底
  expect(animated[2].trim()).toMatch(/^[.]{24}/)
  expect(still[2]).toContain("⋯")
})
