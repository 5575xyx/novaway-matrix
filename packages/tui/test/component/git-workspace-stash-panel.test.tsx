/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { StashPanel } from "../../src/component/git-workspace/stash-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { ArmedConfirm } from "../../src/component/git-workspace/confirm"
import type { GitStashEntry } from "../../src/util/git-status"

const ROWS: GitStashEntry[] = [
  { ref: "stash@{0}", message: "WIP on main" },
  { ref: "stash@{1}", message: "重构中间态" },
]

const ARMED: ArmedConfirm = { key: "d", label: "再按一次 d 丢弃这个贮藏", deadline: Number.MAX_SAFE_INTEGER }

// boxWidth 传 0 表示不加约束(只验文案);传具体值时把面板包进恰好那么宽的盒子,
// flex 收缩才会真的裁切 —— 宽度算错必须在这里露馅,不能靠「布局不受约束」蒙混过去。
async function renderFrame(selected: number, rows: GitStashEntry[] = ROWS, armed?: ArmedConfirm, boxWidth = 0) {
  // StashPanel 必须在 Provider 树**内部**创建:Solid 的 JSX 是急切求值,提前在树外
  // `const panel = <StashPanel/>` 会立刻跑 useTheme(),那时 context 还没建立。
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              {boxWidth > 0 ? (
                <box width={boxWidth} flexDirection="column">
                  <StashPanel rows={rows} selected={() => selected} armed={armed} width={boxWidth} />
                </box>
              ) : (
                <StashPanel rows={rows} selected={() => selected} armed={armed} width={36} />
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

test("ref 和说明同一行显示", async () => {
  const line = (await renderFrame(0)).split("\n").find((l) => l.includes("stash@{0}")) ?? ""
  expect(line).toContain("WIP on main")
})

test("ref 完整可见,不被截断 —— 它是喂给 git stash pop 的引用", async () => {
  const frame = await renderFrame(0, [{ ref: "stash@{1234}", message: "x".repeat(60) }], undefined, 36)
  const line = frame.split("\n").find((l) => l.includes("❯")) ?? ""
  expect(line).toContain("stash@{1234}")
  expect(line).not.toContain("stash@{…")
  // 被截断的是说明,不是 ref。
  expect(line).toContain("…")
})

test("焦点行有 ❯ 标记", async () => {
  const line = (await renderFrame(1)).split("\n").find((l) => l.includes("stash@{1}"))
  expect(line).toContain("❯")
})

test("没有焦点行(-1)时不画任何焦点标记", async () => {
  expect(await renderFrame(-1)).not.toContain("❯")
})

test("空列表显示（暂无）", async () => {
  expect(await renderFrame(0, [])).toContain("（暂无）")
})

test("确认态时焦点行显示确认文案而不是 ref", async () => {
  const frame = await renderFrame(0, ROWS, ARMED)
  expect(frame).toContain("再按一次 d 丢弃这个贮藏")
  // 非焦点行的 ref 照常显示 —— 确认文案只换掉被选中的那一行。
  expect(frame).not.toContain("stash@{0}")
  expect(frame).toContain("stash@{1}")
})

test("36 列契约:超长说明截断,ref 不被挤掉", async () => {
  const frame = await renderFrame(0, [{ ref: "stash@{0}", message: "说".repeat(80) }], undefined, 36)
  const line = frame.split("\n").find((l) => l.includes("stash@{0}")) ?? ""
  expect(line).toContain("…")
  expect(Bun.stringWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})
