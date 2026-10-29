import { describe, expect, it } from "bun:test"
import { concurrencySafe, readOnly, resolveFlag } from "../../src/tool/tool"

describe("tool capabilities", () => {
  it("resolves static flags", () => {
    expect(resolveFlag(true, {}, false)).toBe(true)
    expect(resolveFlag(undefined, {}, true)).toBe(true)
    expect(resolveFlag(false, {}, true)).toBe(false)
  })

  it("resolves argument-based flags and fails closed", () => {
    const flag = (args: unknown) => (args as { ok?: boolean }).ok === true
    expect(resolveFlag(flag, { ok: true }, false)).toBe(true)
    expect(resolveFlag(flag, { ok: false }, true)).toBe(false)
    expect(
      resolveFlag(
        () => {
          throw new Error("boom")
        },
        {},
        true,
      ),
    ).toBe(true)
  })

  it("exposes helpers on tool definitions", () => {
    const def = { capabilities: { readOnly: true, concurrencySafe: true } }
    expect(readOnly(def, {})).toBe(true)
    expect(concurrencySafe(def, {})).toBe(true)
    expect(concurrencySafe({}, {})).toBe(false)
  })
})

describe("builtin capabilities", () => {
  it("marks read-only tools as concurrency safe", async () => {
    const { CAPABILITIES } = await import("../../src/tool/registry")
    for (const id of ["read", "grep", "glob", "webfetch"]) {
      const cap = CAPABILITIES[id] as { readOnly?: boolean; concurrencySafe?: boolean } | undefined
      expect(cap?.readOnly).toBe(true)
      expect(cap?.concurrencySafe).toBe(true)
    }
  })

  it("treats the shell as read-only only for safe commands", async () => {
    const { CAPABILITIES } = await import("../../src/tool/registry")
    const check = CAPABILITIES.bash.concurrencySafe as (args: unknown) => boolean
    expect(check({ command: "git status" })).toBe(true)
    expect(check({ command: "ls -la" })).toBe(true)
    expect(check({ command: "rm -rf build" })).toBe(false)
    expect(check({ command: "git status && rm x" })).toBe(false)
  })

  it("treats PowerShell read-only cmdlets as safe, writes as unsafe", async () => {
    const { CAPABILITIES } = await import("../../src/tool/registry")
    const check = CAPABILITIES.bash.concurrencySafe as (args: unknown) => boolean
    expect(check({ command: "Get-ChildItem -LiteralPath . -Recurse" })).toBe(true)
    expect(check({ command: "Test-Path -LiteralPath build" })).toBe(true)
    expect(check({ command: "dir" })).toBe(true)
    expect(check({ command: "Remove-Item -LiteralPath build" })).toBe(false)
    expect(check({ command: "Get-Content a.txt | Out-File b.txt" })).toBe(false)
    expect(check({ command: "Get-ChildItem; Remove-Item x" })).toBe(false)
  })

  it("lets independent subagents run in parallel", async () => {
    const { CAPABILITIES } = await import("../../src/tool/registry")
    expect(CAPABILITIES.task.concurrencySafe).toBe(true)
  })
})
