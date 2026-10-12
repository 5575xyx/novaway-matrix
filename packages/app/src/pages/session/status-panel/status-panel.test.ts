import { describe, expect, test } from "bun:test"
import { shouldMountStatusPanel } from "./status-panel"

describe("shouldMountStatusPanel", () => {
  test("never mounts without content", () => {
    expect(shouldMountStatusPanel([])).toBe(false)
  })

  test("mounts once at least one section survives filtering", () => {
    expect(shouldMountStatusPanel([{ id: "git" }])).toBe(true)
  })
})
