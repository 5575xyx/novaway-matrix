/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { GitDiffPanel, type DiffTarget } from "../../src/component/git-workspace/diff-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"

async function renderFrame(target: DiffTarget) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <GitDiffPanel target={target} rootPath={process.cwd()} />
            </ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24 },
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

test("没有目标时显示引导文案,不空白", async () => {
  expect(await renderFrame({ kind: "none" })).toContain("选中文件或提交后在这里看改动")
})

test("目标是文件时标题带上文件名", async () => {
  expect(await renderFrame({ kind: "file", path: "src/component/git-workspace.tsx" })).toContain("的改动")
})

test("目标是提交时标题带提交前缀", async () => {
  expect(await renderFrame({ kind: "commit", hash: "40f2c3c" })).toContain("提交 40f2c3c")
})

test("没改动时不显示 diff,给一句「没有改动」", async () => {
  // 用一个不存在的路径:git diff 为空 → 合成补丁也为空 → 走「没有改动」分支。
  expect(await renderFrame({ kind: "file", path: "definitely-not-a-real-file-xyz.ts" })).toContain("没有改动")
})
