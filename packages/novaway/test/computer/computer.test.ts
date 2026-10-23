import { describe, expect, test } from "bun:test"
import { toSendKeys } from "@/computer/computer"

describe("computer.toSendKeys", () => {
  test("maps modifiers", () => {
    expect(toSendKeys("Ctrl+A")).toBe("^a")
    expect(toSendKeys("Ctrl+Shift+A")).toBe("^+a")
    expect(toSendKeys("Alt+F4")).toBe("%{F4}")
    expect(toSendKeys("Enter")).toBe("{ENTER}")
    expect(toSendKeys("Ctrl+Enter")).toBe("^{ENTER}")
  })

  test("returns empty for empty input", () => {
    expect(toSendKeys("")).toBe("")
  })
})
