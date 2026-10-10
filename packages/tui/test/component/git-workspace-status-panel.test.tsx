/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { StatusPanel } from "../../src/component/git-workspace/status-panel"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"
import type { StatusRow } from "../../src/component/git-workspace/state"

const ROWS: StatusRow[] = [
  { kind: "branch", label: "分支", detail: "main", count: "↑91" },
  { kind: "remote", label: "远程", detail: "origin" },
  { kind: "changes", label: "变更", detail: "2 个文件", count: "+15 -5" },
  { kind: "hint", label: "提示", detail: "有未提交的改动" },
]

// boxWidth 传 0 表示不加约束(只验文案);传具体值时把面板包进恰好那么宽的盒子,
// flex 收缩才会真的裁切 —— 宽度算错必须在这里露馅,不能靠「布局不受约束」蒙混过去。
async function renderFrame(selected: number, rows: StatusRow[] = ROWS, remoteUrl?: string, boxWidth = 0) {
  // StatusPanel 必须在 Provider 树**内部**创建:Solid 的 JSX 是急切求值,提前在树外
  // `const panel = <StatusPanel/>` 会立刻跑 useTheme(),那时 context 还没建立。
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">
              {boxWidth > 0 ? (
                <box width={boxWidth} flexDirection="column">
                  <StatusPanel rows={rows} selected={() => selected} remoteUrl={remoteUrl} width={boxWidth} />
                </box>
              ) : (
                <StatusPanel rows={rows} selected={() => selected} remoteUrl={remoteUrl} width={36} />
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

test("四行都在,且是中文", async () => {
  const frame = await renderFrame(0)
  for (const label of ["分支", "远程", "变更", "提示"]) expect(frame).toContain(label)
})

test("焦点行有 ❯ 标记", async () => {
  const remoteLine = (await renderFrame(1)).split("\n").find((line) => line.includes("远程"))
  expect(remoteLine).toContain("❯")
})

test("选中远程行时把完整地址摊开", async () => {
  expect(await renderFrame(1, ROWS, "https://gitee.com/x/y.git")).toContain("gitee.com")
})

test("地址行和标签列对齐,不顶到第 0 列", async () => {
  // 这条专门钉 paddingLeft 的坑:opentui 里 <text paddingLeft={n}> 完全无效(只收缩内容宽度、
  // 不平移绘制起点),写了等于没写。地址会顶到最左缘,像一条和远程行无关的孤儿行 ——
  // 而地址行存在的全部意义就是「它属于上面那行」。必须包 <box paddingLeft={3}> 才对。
  const lines = (await renderFrame(1, ROWS, "https://gitee.com/x/y.git")).split("\n")
  const labelLine = lines.find((line) => line.includes("远程")) ?? ""
  const urlLine = lines.find((line) => line.includes("gitee.com")) ?? ""
  expect(urlLine.indexOf("http")).toBe(labelLine.indexOf("远程"))
  // 顶到第 0 列就是没缩进。
  expect(urlLine.startsWith("http")).toBe(false)
})

test("计数超过 8 列时截断,不把 detail 挤掉", async () => {
  // count 来自全仓求和,`+12345 -6789` 这种是真实可达的。不截断的话它会反过来挤掉 detail,
  // 让「detail 按宽度截断」的契约静默失效。
  const frame = await renderFrame(
    0,
    [{ kind: "changes", label: "变更", detail: "改了几个文件", count: "+12345 -67890" }],
    undefined,
    36,
  )
  const row = frame.split("\n").find((line) => line.includes("变更")) ?? ""
  expect(row).toContain("改了几个文件")
  expect(row).toContain("…")
  expect(Bun.stringWidth(row.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})

test("没选中远程行时不显示地址", async () => {
  expect(await renderFrame(0, ROWS, "https://gitee.com/x/y.git")).not.toContain("gitee.com")
})

test("没有远端时显示未配置远端", async () => {
  expect(await renderFrame(0, [{ kind: "remote", label: "远程", detail: "未配置远端" }])).toContain("未配置远端")
})

test("领先计数显示在分支行", async () => {
  expect(await renderFrame(0)).toContain("↑91")
})

test("长 detail 在 36 列内截断,计数不被挤掉", async () => {
  const frame = await renderFrame(
    0,
    [{ kind: "changes", label: "变更", detail: "工作区里有一大堆被改动的文件等着处理", count: "+100 -20" }],
    undefined,
    36,
  )
  const row = frame.split("\n").find((line) => line.includes("变更")) ?? ""
  expect(row).toContain("+100 -20")
  expect(row).toContain("…")
  expect(Bun.stringWidth(row.replace(/\s+$/, ""))).toBeLessThanOrEqual(36)
})
