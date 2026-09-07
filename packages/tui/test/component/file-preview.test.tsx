/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createSignal } from "solid-js"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { testRender, useRenderer } from "@opentui/solid"
import { KVProvider } from "../../src/context/kv"
import { ThemeProvider } from "../../src/context/theme"
import { TuiConfigProvider } from "../../src/config"
import { NovaWayKeymapProvider } from "../../src/keymap"
import { FilePreview } from "../../src/component/file-preview"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"
import { TestTuiContexts } from "../fixture/tui-environment"

// 回归:切预览文件时组件不重挂载,textarea 的 initialValue 只在挂载时生效,
// 内容必须靠命令式 setText 灌进去 —— 否则永远显示第一个文件的内容。
describe("FilePreview 切换文件", () => {
  test("filePath 变化后内容跟着切换,且不误标已修改", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nw-preview-"))
    const fileA = path.join(dir, "a.txt")
    const fileB = path.join(dir, "b.txt")
    writeFileSync(fileA, "AAA-CONTENT-OF-A")
    writeFileSync(fileB, "BBB-CONTENT-OF-B\nsecond line")

    const [fp, setFp] = createSignal<string | null>(fileA)
    const app = await renderPreview(fp)
    try {
      let frame = await settle(app)
      expect(frame).toContain("a.txt")
      expect(frame).toContain("AAA-CONTENT-OF-A")

      // 模拟文件树里点了另一个文件:同一个 FilePreview 实例,只有 filePath 变了
      setFp(fileB)
      frame = await settle(app)
      expect(frame).toContain("b.txt")
      expect(frame).toContain("BBB-CONTENT-OF-B")
      expect(frame).not.toContain("AAA-CONTENT-OF-A")

      // 再等几帧:setText 的原生回显(若异步到达)不得把文件误标成"已修改"
      await new Promise((resolve) => setTimeout(resolve, 120))
      await app.renderOnce()
      frame = await settle(app)
      expect(frame).not.toContain("已修改")
    } finally {
      app.renderer.destroy()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

async function renderPreview(getPath: () => string | null) {
  const config = createTuiResolvedConfig()
  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    return (
      <TestTuiContexts>
        <NovaWayKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <FilePreview filePath={getPath()} onClose={() => {}} />
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </NovaWayKeymapProvider>
      </TestTuiContexts>
    )
  }
  return testRender(() => <Harness />, { width: 80, height: 24 })
}

async function settle(app: Awaited<ReturnType<typeof testRender>>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await app.renderOnce()
    await new Promise((resolve) => setTimeout(resolve, 25))
    const frame = app.captureCharFrame()
    if (frame.includes("行")) return frame
  }
  return app.captureCharFrame()
}
