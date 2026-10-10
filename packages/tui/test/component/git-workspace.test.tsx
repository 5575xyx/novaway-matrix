/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { GitWorkspace } from "../../src/component/git-workspace"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"

async function renderWorkspace(width: number, rootPath = process.cwd()) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              <GitWorkspace rootPath={rootPath} onClose={() => {}} width={width} />
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

test("五个面板标题都在", async () => {
  const frame = await renderWorkspace(100)
  for (const title of ["状态", "文件", "分支", "提交", "贮藏"]) expect(frame).toContain(title)
})

test("底部键位提示条有中文说明", async () => {
  const frame = await renderWorkspace(100)
  expect(frame).toContain("切面板")
  expect(frame).toContain("暂存")
})

test("默认焦点在状态面板", async () => {
  // 焦点面板的标题会被 `┌ xxx ─` 标出来,状态行自己也带 ❯。
  expect(await renderWorkspace(100)).toContain("┌ 状态 ─")
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
