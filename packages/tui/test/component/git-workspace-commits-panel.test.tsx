/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { CommitsPanel } from "../../src/component/git-workspace/commits-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { GitCommitRow } from "../../src/component/git-workspace/state"

const ROWS: GitCommitRow[] = [
  { full: "a".repeat(40), hash: "abc1234", subject: "feat: 加上提交面板" },
  { full: "b".repeat(40), hash: "def5678", subject: "fix: 修掉渲染问题" },
  { full: "c".repeat(40), hash: "1112223", subject: "chore: 更新依赖" },
]

// boxWidth 传 0 表示不加约束(只验文案);传具体值时把面板包进恰好那么宽的盒子,
// flex 收缩才会真的裁切 —— 宽度算错必须在这里露馅,不能靠「布局不受约束」蒙混过去。
async function renderFrame(selected: number, rows: GitCommitRow[] = ROWS, boxWidth = 0) {
  // CommitsPanel 必须在 Provider 树**内部**创建:Solid 的 JSX 是急切求值,提前在树外
  // `const panel = <CommitsPanel/>` 会立刻跑 useTheme(),那时 context 还没建立。
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              {boxWidth > 0 ? (
                <box width={boxWidth} flexDirection="column">
                  <CommitsPanel rows={rows} selected={() => selected} width={boxWidth} />
                </box>
              ) : (
                <CommitsPanel rows={rows} selected={() => selected} width={36} />
              )}
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

test("显示短哈希和提交主题", async () => {
  const frame = await renderFrame(0)
  expect(frame).toContain("abc1234")
  expect(frame).toContain("feat: 加上提交面板")
})

test("不画完整哈希 —— 40 位顶掉半行,完整哈希留给复制", async () => {
  // full 是 40 个 a,断言 8 个连续 a 不出现:短哈希里不可能有这种连续字符,
  // 所以这条不会误伤。
  expect(await renderFrame(0)).not.toContain("aaaaaaaa")
})

test("焦点行有 ❯ 标记", async () => {
  const line = (await renderFrame(1)).split("\n").find((l) => l.includes("def5678"))
  expect(line).toContain("❯")
})

test("没有焦点行(-1)时不画任何焦点标记", async () => {
  expect(await renderFrame(-1)).not.toContain("❯")
})

test("空列表显示（暂无提交）", async () => {
  expect(await renderFrame(0, [])).toContain("（暂无提交）")
})

test("36 列契约:超长主题截断,哈希不被截掉", async () => {
  const frame = await renderFrame(0, [{ full: "d".repeat(40), hash: "abc1234", subject: "主".repeat(80) }], 36)
  const line = frame.split("\n").find((l) => l.includes("abc1234")) ?? ""
  expect(line).toContain("…")
  // 哈希是引用,截了就没法定位提交 —— 它是不可牺牲的一方。
  expect(line).toContain("abc1234")
  expect(Bun.stringWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})
