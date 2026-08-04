import { describe, expect, test } from "bun:test"
import { resolveFloatingRestoreAnchor, resolveFloatingWidgetMode } from "./floating-widget-state"

describe("floating widget state", () => {
  test("关闭状态重启后只显示 logo 入口", () => {
    expect(resolveFloatingWidgetMode(false)).toBe("minimal")
  })

  test("开启状态重启后显示完整宠物", () => {
    expect(resolveFloatingWidgetMode(true)).toBe("full")
  })

  test("从 logo 恢复时保持右下角对齐", () => {
    expect(resolveFloatingRestoreAnchor({ x: 1856, y: 1016, width: 48, height: 48 }, 144)).toEqual({
      x: 1760,
      y: 920,
    })
  })
})
