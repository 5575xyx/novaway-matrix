import { describe, expect, test } from "bun:test"
import { logo } from "../src/logo"

describe("NovaWay TUI logo", () => {
  test("uses a four-row NOVA and WAY wordmark", () => {
    expect(logo.left).toHaveLength(4)
    expect(logo.right).toHaveLength(4)
    expect(logo.left[1]).toBe("█▀▄█ █▀▀█ █  █ █▀▀█")
    expect(logo.right[1]).toBe("█   █ █▀▀█ █   █")
  })

  test("keeps each side rectangular for terminal layout", () => {
    expect(new Set(logo.left.map((line) => line.length)).size).toBe(1)
    expect(new Set(logo.right.map((line) => line.length)).size).toBe(1)
  })
})
