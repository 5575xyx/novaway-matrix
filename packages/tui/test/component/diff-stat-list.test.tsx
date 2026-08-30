/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { JSX } from "solid-js"
import { DIFF_STAT_MAX_FILES, DiffStatList, uniqueDiffStats } from "../../src/component/diff-stat-list"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { TestTuiContexts } from "../fixture/tui-environment"

describe("uniqueDiffStats", () => {
  test("同一文件只留最后一条,顺序按最后一次出现的位置", () => {
    const result = uniqueDiffStats([
      { file: "a.ts", additions: 1, deletions: 0 },
      { file: "b.ts", additions: 2, deletions: 3 },
      { file: "a.ts", additions: 10, deletions: 5 },
    ])
    expect(result).toEqual([
      { file: "b.ts", additions: 2, deletions: 3 },
      { file: "a.ts", additions: 10, deletions: 5 },
    ])
  })

  test("没有 file 字段的条目丢掉,缺增删数的补 0", () => {
    const result = uniqueDiffStats([
      { additions: 4, deletions: 4 },
      undefined,
      { file: "bin.dat" },
      { file: "c.ts", additions: 7 },
    ] as any)
    expect(result).toEqual([
      { file: "bin.dat", additions: 0, deletions: 0 },
      { file: "c.ts", additions: 7, deletions: 0 },
    ])
  })

  test("空输入返回空数组", () => {
    expect(uniqueDiffStats(undefined)).toEqual([])
    expect(uniqueDiffStats([])).toEqual([])
  })
})

describe("DiffStatList 渲染", () => {
  test("超过上限只显示前 N 个,余量用一行文字带过", async () => {
    const files = Array.from({ length: DIFF_STAT_MAX_FILES + 3 }, (_, i) => ({
      file: `f${i}.ts`,
      additions: 1,
      deletions: 0,
    }))
    const frame = await renderFrame(() => <DiffStatList files={files} />)
    expect(frame).toContain("f0.ts")
    expect(frame).toContain(`f${DIFF_STAT_MAX_FILES - 1}.ts`)
    expect(frame).not.toContain(`f${DIFF_STAT_MAX_FILES}.ts`)
    expect(frame).toContain("还有 3 个文件")
  })

  test("+0 和 -0 不显示,非 0 的正常显示", async () => {
    const frame = await renderFrame(() => (
      <DiffStatList
        files={[
          { file: "only-add.ts", additions: 5, deletions: 0 },
          { file: "only-del.ts", additions: 0, deletions: 2 },
        ]}
      />
    ))
    expect(frame).toContain("+5")
    expect(frame).toContain("-2")
    expect(frame).not.toContain("+0")
    expect(frame).not.toContain("-0")
  })
})

async function renderFrame(component: () => JSX.Element) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <TuiConfigProvider config={createTuiResolvedConfig()}>
          <KVProvider>
            <ThemeProvider mode="dark">{component()}</ThemeProvider>
          </KVProvider>
        </TuiConfigProvider>
      </TestTuiContexts>
    ),
    { width: 60, height: 14 },
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
