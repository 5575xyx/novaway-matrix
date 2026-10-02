/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { ThemeReady, ThemeTestProviders } from "../fixture/providers"
import { QuickPreviewCard } from "../../src/component/quick-preview-card"
import { clearFileTreeCache, setSelectedPath } from "../../src/component/file-tree"
import { PREVIEW_MAX_LINES } from "../../src/util/file-preview-head"

// 这份只测**这张卡自己**的行为(卡头/徽标/正文/降级)。它挂在终端上的宽度比生产宽,
// 所以宽度模型的真相仍在 test/component/sidebar.test.tsx 与 sidebar-cards.test.tsx 里量。

async function renderCard(
  body: () => unknown,
  options: { width: number; height: number },
  ready: (text: string) => boolean,
) {
  const app = await testRender(body as never, options)
  let text = ""
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    text = app.captureCharFrame()
    if (ready(text)) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  expect(text).toContain("READY")
  return app
}

async function withRoot(body: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "nw-quick-preview-"))
  clearFileTreeCache()
  try {
    await body(root)
  } finally {
    clearFileTreeCache()
    setSelectedPath(null)
    await rm(root, { recursive: true, force: true })
  }
}

test("没选中文件时整张卡不出现", async () => {
  await withRoot(async () => {
    setSelectedPath(null)
    const app = await renderCard(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <QuickPreviewCard />
        </ThemeTestProviders>
      ),
      { width: 60, height: 20 },
      (text) => text.includes("READY"),
    )
    try {
      const frame = app.captureCharFrame()
      expect(frame).not.toContain("快速预览")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("选中文件后卡头是「快速预览」+ 文件名,正文是那几行代码", async () => {
  await withRoot(async (root) => {
    const file = path.join(root, "index.ts")
    await writeFile(file, ["const answer = 42", "export { answer }"].join("\n"))
    setSelectedPath(file)
    const app = await renderCard(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <QuickPreviewCard />
        </ThemeTestProviders>
      ),
      { width: 60, height: 20 },
      (text) => text.includes("answer"),
    )
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("快速预览")
      // 徽标是文件名,不是整条路径。
      expect(frame).toContain("index.ts")
      expect(frame).not.toContain(root)
      expect(frame).toContain("const answer = 42")
      // 分区卡是霓虹卡:圆角边框在。
      expect(frame).toContain("╭")
      expect(frame).toContain("╯")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("长文件只显示前若干行,并明确告诉用户还剩多少行", async () => {
  await withRoot(async (root) => {
    const file = path.join(root, "long.ts")
    await writeFile(file, Array.from({ length: PREVIEW_MAX_LINES + 9 }, (_, i) => `const v${i} = ${i}`).join("\n"))
    setSelectedPath(file)
    const app = await renderCard(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <QuickPreviewCard />
        </ThemeTestProviders>
      ),
      { width: 60, height: 30 },
      (text) => text.includes("还有 9 行"),
    )
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain(`const v0 = 0`)
      expect(frame).not.toContain("const v12")
      expect(frame).toContain("还有 9 行")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("读不到的文件给出明确降级文案,不是一张空白卡", async () => {
  await withRoot(async (root) => {
    setSelectedPath(path.join(root, "does-not-exist.ts"))
    const app = await renderCard(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <QuickPreviewCard />
        </ThemeTestProviders>
      ),
      { width: 60, height: 20 },
      (text) => text.includes("无法读取"),
    )
    try {
      const frame = app.captureCharFrame()
      expect(frame).toContain("快速预览")
      expect(frame).toContain("无法读取")
    } finally {
      app.renderer.destroy()
    }
  })
})

test("二进制文件给出明确降级文案", async () => {
  await withRoot(async (root) => {
    const file = path.join(root, "blob.bin")
    await writeFile(file, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x41, 0x42]))
    setSelectedPath(file)
    const app = await renderCard(
      () => (
        <ThemeTestProviders>
          <ThemeReady />
          <QuickPreviewCard />
        </ThemeTestProviders>
      ),
      { width: 60, height: 20 },
      (text) => text.includes("二进制"),
    )
    try {
      expect(app.captureCharFrame()).toContain("二进制")
    } finally {
      app.renderer.destroy()
    }
  })
})
