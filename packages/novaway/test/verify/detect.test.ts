import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { detect } from "@/verify/detect"

const roots: string[] = []
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-verify-"))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("verify.detect", () => {
  test("reads package.json scripts with the right package manager", async () => {
    const root = await tempRoot()
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest", lint: "eslint ." } }),
    )
    await fs.writeFile(path.join(root, "bun.lock"), "")
    const commands = await detect(root)
    expect(commands.map((item) => item.id)).toEqual(["npm:test", "npm:lint"])
    expect(commands[0].command).toBe("bun run test")
    expect(commands[0].kind).toBe("test")
    expect(commands[1].kind).toBe("lint")
  })

  test("prefers e2e when the script exists", async () => {
    const root = await tempRoot()
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { "test:e2e": "playwright test", test: "vitest" } }),
    )
    const commands = await detect(root)
    expect(commands[0]).toMatchObject({ id: "npm:test:e2e", kind: "e2e" })
  })

  test("detects go, cargo and make", async () => {
    const root = await tempRoot()
    await fs.writeFile(path.join(root, "go.mod"), "module x")
    await fs.writeFile(path.join(root, "Cargo.toml"), "[package]")
    await fs.writeFile(path.join(root, "Makefile"), "test:\n\techo ok\n")
    const ids = (await detect(root)).map((item) => item.id)
    expect(ids).toContain("go:test")
    expect(ids).toContain("cargo:test")
    expect(ids).toContain("make:test")
  })

  test("returns nothing for an empty project", async () => {
    expect(await detect(await tempRoot())).toEqual([])
  })
})
