/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { BranchesPanel } from "../../src/component/git-workspace/branches-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { ArmedConfirm } from "../../src/component/git-workspace/confirm"
import type { BranchRow } from "../../src/component/git-workspace/state"

const ROWS: BranchRow[] = [
  { name: "main", current: true, count: "↑3 ↓1" },
  { name: "feature/login", current: false },
  { name: "origin/feature", current: false },
]

const ARMED: ArmedConfirm = { key: "d", label: "再按一次 d 删除这个分支", deadline: Number.MAX_SAFE_INTEGER }

/** 从数据里取当前分支名,避免断言写死字面量后,改数据就假红。 */
const CURRENT_NAME = ROWS.find((row) => row.current)?.name ?? ""

// boxWidth 传 0 表示不加约束(只验文案);传具体值时把面板包进恰好那么宽的盒子,
// flex 收缩才会真的裁切 —— 宽度算错必须在这里露馅,不能靠「布局不受约束」蒙混过去。
async function renderFrame(selected: number, rows: BranchRow[] = ROWS, armed?: ArmedConfirm, boxWidth = 0) {
  // BranchesPanel 必须在 Provider 树**内部**创建:Solid 的 JSX 是急切求值,提前在树外
  // `const panel = <BranchesPanel/>` 会立刻跑 useTheme(),那时 context 还没建立。
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              {boxWidth > 0 ? (
                <box width={boxWidth} flexDirection="column">
                  <BranchesPanel rows={rows} selected={() => selected} armed={armed} width={boxWidth} />
                </box>
              ) : (
                <BranchesPanel rows={rows} selected={() => selected} armed={armed} width={36} />
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

test("本地与远程分支同列显示,远程分支保留 git 原本的 origin/ 形式", async () => {
  const frame = await renderFrame(0)
  expect(frame).toContain("feature/login")
  expect(frame).toContain("origin/feature")
})

test("当前分支标 ●,而且这一行不会再画焦点标记", async () => {
  const marked = (await renderFrame(1)).split("\n").filter((line) => line.includes("●"))
  expect(marked.length).toBe(1)
  expect(marked[0]).not.toContain("❯")
})

test("当前分支既是焦点时也只显示 ●,两个标记不抢一格", async () => {
  // find 落空时 line 是 undefined,expect(undefined) 会直接抛错,断言才咬得住(不带 ?? "")。
  const line = (await renderFrame(0)).split("\n").find((l) => l.includes("●"))
  expect(line, "当前分支那一行应当画着 ●").toContain(CURRENT_NAME)
  expect(line).not.toContain("❯")
})

test("焦点行有 ❯ 标记", async () => {
  const featureLine = (await renderFrame(1)).split("\n").find((line) => line.includes("feature/login"))
  expect(featureLine).toContain("❯")
})

test("没有焦点行(-1)时不画任何焦点标记", async () => {
  expect(await renderFrame(-1)).not.toContain("❯")
})

test("计数显示在带计数的分支行", async () => {
  const line = (await renderFrame(0)).split("\n").find((l) => l.includes("●")) ?? ""
  expect(line).toContain("↑3 ↓1")
})

test("空列表显示（暂无）", async () => {
  expect(await renderFrame(0, [])).toContain("（暂无）")
})

test("确认态时焦点行显示确认文案而不是分支名", async () => {
  const frame = await renderFrame(1, ROWS, ARMED)
  expect(frame).toContain("再按一次 d 删除这个分支")
  // 非焦点行的名字照常显示 —— 确认文案只换掉被选中的那一行。
  expect(frame).not.toContain("feature/login")
  expect(frame).toContain("origin/feature")
})

test("36 列契约:超长分支名截断,不撑破面板宽度", async () => {
  const frame = await renderFrame(0, [{ name: "b".repeat(80), current: true, count: "↑3 ↓1" }], undefined, 36)
  const line = frame.split("\n").find((l) => l.includes("●")) ?? ""
  expect(line).toContain("…")
  // 计数不被挤掉 —— 分支名是被牺牲的一方,它才是要无限长的东西。
  expect(line).toContain("↑3 ↓1")
  expect(Bun.stringWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})

test("36 列契约:超长远程分支名同样不撑破宽度", async () => {
  const frame = await renderFrame(0, [{ name: "origin/" + "z".repeat(80), current: false }], undefined, 36)
  const line = frame.split("\n").find((l) => l.includes("❯")) ?? ""
  expect(line).toContain("…")
  expect(Bun.stringWidth(line.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})
