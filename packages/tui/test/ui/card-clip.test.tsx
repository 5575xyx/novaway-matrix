/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA, type ScrollBoxRenderable } from "@opentui/core"
import "../../src/ui/card"

const stops = [RGBA.fromHex("#ff0000"), RGBA.fromHex("#0000ff")]
const bg = RGBA.fromHex("#101010")

describe("NeonBox 裁剪", () => {
  test("顶部被 overflow-hidden 裁掉时,越界边框格不夹到裁剪边缘(无残影)", async () => {
    const app = await testRender(
      () => (
        <box width={20} height={6} flexDirection="column">
          <box width={12} height={3} overflow="hidden">
            <neonbox
              position="absolute"
              left={0}
              top={-1}
              width={12}
              height={4}
              backgroundColor={bg}
              gradientStops={stops}
            />
          </box>
        </box>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const lines = app.captureCharFrame().split("\n")
      expect(lines[0]?.trimEnd()).toBe("│          │")
      expect(lines[1]?.trimEnd()).toBe("│          │")
      expect(lines[2]).toContain("╰──────────╯")
      expect(lines[0]).not.toContain("─")
      expect(app.captureCharFrame()).not.toContain("╭")
    } finally {
      app.renderer.destroy()
    }
  })

  test("底部被 overflow-hidden 裁掉时,越界边框格不夹到裁剪边缘(无残影)", async () => {
    const app = await testRender(
      () => (
        <box width={20} height={6} flexDirection="column">
          <box width={12} height={3} overflow="hidden">
            <neonbox
              position="absolute"
              left={0}
              top={0}
              width={12}
              height={4}
              backgroundColor={bg}
              gradientStops={stops}
            />
          </box>
        </box>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      const lines = app.captureCharFrame().split("\n")
      expect(lines[0]).toContain("╭──────────╮")
      expect(lines[1]?.trimEnd()).toBe("│          │")
      expect(lines[2]?.trimEnd()).toBe("│          │")
      expect(app.captureCharFrame()).not.toContain("╰")
    } finally {
      app.renderer.destroy()
    }
  })

  test("卡片滚出 scrollbox 视口时不在视口边线留下边框残影", async () => {
    let scroll: ScrollBoxRenderable | undefined
    const app = await testRender(
      () => (
        <scrollbox width={20} height={4} ref={(r: ScrollBoxRenderable) => (scroll = r)}>
          {[0, 1, 2].map(() => (
            <neonbox width={12} height={3} backgroundColor={bg} gradientStops={stops} />
          ))}
        </scrollbox>
      ),
      { width: 20, height: 6 },
    )
    try {
      await app.renderOnce()
      if (scroll) scroll.scrollTop = 6
      await app.renderOnce()
      const frame = app.captureCharFrame()
      expect(frame).toContain("╰──────────╯")
      expect(frame).not.toContain("│──────────╯")
    } finally {
      app.renderer.destroy()
    }
  })
})
