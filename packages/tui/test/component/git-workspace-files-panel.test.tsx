/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { FilesPanel } from "../../src/component/git-workspace/files-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { FileRow } from "../../src/component/git-workspace/state"

const ROWS: FileRow[] = [
  { file: "a.ts", label: "已改", count: "+10 -2", staged: true, unstaged: false },
  { file: "b.ts", label: "未跟踪", staged: false, unstaged: true },
]

// 和 src/util/locale.ts 用的同一把尺子(Bun.stringWidth),别自己数字符。
const stringWidth = (value: string) => Bun.stringWidth(value.replace(/\s+$/, ""))

async function renderFrame(
  selected: number,
  rows: FileRow[] = ROWS,
  armed?: { key: string; label: string; deadline: number },
) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <FilesPanel rows={rows} selected={() => selected} armed={armed} width={36} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
  )
  try {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    await app.renderOnce()
    // 首帧可能整屏空白(布局还没落定),照 diff-stat-list 的口径:非空才认。
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

test("文件行显示中文状态词", async () => {
  const frame = await renderFrame(0)
  expect(frame).toContain("已改")
  expect(frame).toContain("未跟踪")
})

test("有 numstat 的行显示加删行数", async () => {
  expect(await renderFrame(0)).toContain("+10 -2")
})

test("焦点行有 ❯ 标记", async () => {
  const focused = (await renderFrame(1)).split("\n").find((line) => line.includes("未跟踪"))
  expect(focused).toContain("❯")
})

test("非焦点行没有 ❯ 标记", async () => {
  const other = (await renderFrame(1)).split("\n").find((line) => line.includes("已改"))
  expect(other).not.toContain("❯")
})

test("空列表显示暂无", async () => {
  expect(await renderFrame(0, [])).toContain("暂无")
})

test("确认态时焦点行显示确认文案而不是文件名", async () => {
  const frame = await renderFrame(0, ROWS, { key: "d", label: "再按一次 d 丢弃这个文件", deadline: 3000 })
  expect(frame).toContain("再按一次 d")
  // 焦点行被确认文案顶掉,不该再露文件名。(未跟踪那行的 b.ts 还在,所以只查 a.ts。)
  expect(frame).not.toContain("a.ts")
})

// 宽度契约:上面那些测试把面板放在 60 列根盒里、却传 width={36} —— 只有计算用到 36,
// 布局并不受约束,截断压根没被真正考验到。这条把面板包进**恰好 36 列**的盒子,
// flex 收缩才会真的裁切,算错就会在这里露馅。
async function renderConstrainedFrame(rows: FileRow[]) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <box width={36} flexDirection="column">
                <FilesPanel rows={rows} selected={() => 0} width={36} />
              </box>
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 20 },
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

test("长路径按宽度截断,计数不被挤出屏幕", async () => {
  const frame = await renderConstrainedFrame([
    {
      file: "packages/tui/src/component/git-workspace/files-panel.tsx",
      label: "已改",
      count: "+10 -2",
      staged: true,
      unstaged: false,
    },
  ])
  const row = frame.split("\n").find((line) => line.includes("已改")) ?? ""
  // 计数必须还在:预算算错时它会被路径顶出 36 列之外,整行被裁掉后半截。
  expect(row).toContain("+10 -2")
  // 路径必须带省略号截断,而不是硬切 —— 硬切说明截断没生效、是 flex 裁的。
  expect(row).toContain("…")
  // 整行不能超过 36 列。用显示宽度量(中文按 2 列算),别用字符数。
  expect(stringWidth(row)).toBeLessThanOrEqual(36)
})
