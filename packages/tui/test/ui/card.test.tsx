/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import "../../src/ui/card"

describe("NeonBox 渐变卡片", () => {
  test("自绘圆角边框,内容画在边框内侧", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={12}
          height={4}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
        >
          <text>hi</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const lines = frame.split("\n")
      expect(lines[0]).toContain("╭──────────╮")
      expect(frame).toContain("│")
      expect(frame).toContain("╯")
      expect(frame).toContain("│hi")
    } finally {
      app.renderer.destroy()
    }
  })

  test("JSX 直写 paddingTop=0/paddingLeft=0 被 setter 夹到 1,内容不盖掉边框", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={10}
          height={3}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
          paddingTop={0}
          paddingLeft={0}
        >
          <text>ab</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("╭────────╮")
      expect(frame).toContain("│ab")
    } finally {
      app.renderer.destroy()
    }
  })

  test("JSX 直写 padding=0/paddingX=0 简写也被 setter 夹到 1,内容不盖掉边框", async () => {
    const app = await testRender(
      () => (
        <neonbox
          width={10}
          height={3}
          backgroundColor={RGBA.fromHex("#101010")}
          gradientStops={[RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]}
          padding={0}
          paddingX={0}
        >
          <text>ab</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      const lines = frame.split("\n")
      expect(frame).toContain("╭────────╮")
      expect(frame).toContain("│ab")
      expect(lines.some((line) => line.startsWith("ab"))).toBe(false)
    } finally {
      app.renderer.destroy()
    }
  })

  test("不给 gradientStops 时不画边框(退回普通 box 行为)", async () => {
    const app = await testRender(
      () => (
        <neonbox width={8} height={3} backgroundColor={RGBA.fromHex("#101010")}>
          <text>plain</text>
        </neonbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("plain")
      expect(frame).not.toContain("╭")
    } finally {
      app.renderer.destroy()
    }
  })
})
