import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { terminalTabLabel } from "./terminal-label"

const contextSource = readFileSync(join(import.meta.dir, "../../context/terminal.tsx"), "utf8")
const panelSource = readFileSync(join(import.meta.dir, "terminal-panel.tsx"), "utf8")

const t = (key: string, vars?: Record<string, string | number | boolean>) => {
  if (key === "terminal.title.numbered") return `Terminal ${vars?.number}`
  if (key === "terminal.title") return "Terminal"
  return key
}

describe("terminalTabLabel", () => {
  test("returns custom title unchanged", () => {
    const label = terminalTabLabel({ title: "server", titleNumber: 3, t })
    expect(label).toBe("server")
  })

  test("normalizes default numbered title", () => {
    const label = terminalTabLabel({ title: "Terminal 2", titleNumber: 2, t })
    expect(label).toBe("Terminal 2")
  })

  test("falls back to generic title", () => {
    const label = terminalTabLabel({ title: "", titleNumber: 0, t })
    expect(label).toBe("Terminal")
  })
})

describe("terminal create failure", () => {
  test("records the create failure instead of swallowing it", () => {
    const at = contextSource.indexOf("Failed to create terminal")
    expect(at).toBeGreaterThan(-1)
    expect(contextSource.slice(at, at + 240)).toContain("setCreateError(error instanceof Error")
  })

  test("clears the recorded error once a terminal is created", () => {
    expect(contextSource).toContain("setCreateError(undefined)")
    expect(contextSource).toContain("createError: () => workspace().createError()")
  })

  test("panel surfaces the failure with a retry action", () => {
    expect(panelSource).toContain("all().length === 0 && terminal.createError()")
    expect(panelSource).toContain('language.t("terminal.connectError.retry")')
    expect(panelSource).toContain("onClick={() => terminal.new()}")
  })
})
