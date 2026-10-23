import { describe, expect, test } from "bun:test"
import { isDisabled, matchServers } from "@/tool/lsp-setup"
import * as LSPServer from "@/lsp/server"
import type { Info } from "@/lsp/server"

const fake = (id: string, extensions: string[]): Info => ({
  id,
  extensions,
  root: async () => undefined,
  spawn: async () => undefined,
})

const servers: Info[] = [
  fake("gopls", [".go"]),
  fake("pyright", [".py", ".pyi"]),
  fake("rust-analyzer", [".rs"]),
  fake("typescript", [".ts", ".tsx"]),
]

describe("lsp_setup matching", () => {
  test("matches by server id", () => {
    expect(matchServers("gopls", servers).map((item) => item.id)).toEqual(["gopls"])
    expect(matchServers("PYRIGHT", servers).map((item) => item.id)).toEqual(["pyright"])
  })

  test("matches by language name and extension", () => {
    expect(matchServers("go", servers).map((item) => item.id)).toEqual(["gopls"])
    expect(matchServers(".rs", servers).map((item) => item.id)).toEqual(["rust-analyzer"])
    expect(matchServers("ts", servers).map((item) => item.id)).toEqual(["typescript"])
  })

  test("returns every server when no filter is given", () => {
    expect(matchServers(undefined, servers)).toHaveLength(4)
    expect(matchServers("   ", servers)).toHaveLength(4)
  })

  test("returns nothing for an unknown language", () => {
    expect(matchServers("cobol", servers)).toEqual([])
  })

  test("reads the disabled flag from config", () => {
    expect(isDisabled(true, "gopls")).toBe(false)
    expect(isDisabled({}, "gopls")).toBe(false)
    expect(isDisabled({ gopls: { disabled: true } }, "gopls")).toBe(true)
    expect(isDisabled({ gopls: { disabled: false } }, "gopls")).toBe(false)
    expect(isDisabled(false, "gopls")).toBe(true)
  })

  test("the real server registry exposes ids and extensions", () => {
    const real = matchServers(undefined)
    expect(real.length).toBeGreaterThan(20)
    expect(real.some((item) => item.id === "gopls" && item.extensions.includes(".go"))).toBe(true)
    expect(Object.values(LSPServer).filter((item) => typeof (item as Info).id === "string").length).toBe(real.length)
  })
})
