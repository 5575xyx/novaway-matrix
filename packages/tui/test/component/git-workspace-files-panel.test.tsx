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
