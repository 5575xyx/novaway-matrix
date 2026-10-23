import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { clean, contentHash, isTemporaryPath, list, record } from "@/session/temp-files"

const roots: string[] = []
async function tempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-temp-"))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("session.temp-files", () => {
  test("recognises only clearly temporary paths", () => {
    expect(isTemporaryPath("tmp-check.mjs")).toBe(true)
    expect(isTemporaryPath("scripts/temp-debug.ts")).toBe(true)
    expect(isTemporaryPath("scratch/output.json")).toBe(true)
    expect(isTemporaryPath("src/.tmp/x.ts")).toBe(true)
    expect(isTemporaryPath("build/app.tmp")).toBe(true)
    expect(isTemporaryPath("notes.md.bak")).toBe(true)

    expect(isTemporaryPath("src/app.ts")).toBe(false)
    expect(isTemporaryPath("README.md")).toBe(false)
    expect(isTemporaryPath("templates/index.html")).toBe(false)
    expect(isTemporaryPath("node_modules/x/tmp-a.js")).toBe(false)
    expect(isTemporaryPath("../outside-tmp.js")).toBe(false)
  })

  test("records only temporary files created by tools", async () => {
    const root = await tempRoot()
    const temp = path.join(root, "tmp-probe.mjs")
    const source = path.join(root, "app.ts")
    await fs.writeFile(temp, "console.log(1)")
    await fs.writeFile(source, "export const a = 1")

    expect(await record({ sessionID: "ses_a", worktree: root, file: temp, tool: "write" })).toBeDefined()
    expect(await record({ sessionID: "ses_a", worktree: root, file: source, tool: "write" })).toBeUndefined()
    expect((await list("ses_a")).map((item) => item.relative)).toEqual(["tmp-probe.mjs"])
  })

  test("clean removes unmodified files and keeps edited ones", async () => {
    const root = await tempRoot()
    const a = path.join(root, "tmp-a.mjs")
    const b = path.join(root, "tmp-b.mjs")
    await fs.writeFile(a, "a")
    await fs.writeFile(b, "b")
    await record({ sessionID: "ses_b", worktree: root, file: a, tool: "write" })
    await record({ sessionID: "ses_b", worktree: root, file: b, tool: "write" })

    await fs.writeFile(b, "b changed")
    const result = await clean({ sessionID: "ses_b", worktree: root })
    expect(result.removed).toEqual(["tmp-a.mjs"])
    expect(result.skipped).toEqual([{ path: "tmp-b.mjs", reason: "modified" }])
    expect((await list("ses_b")).map((item) => item.relative)).toEqual(["tmp-b.mjs"])
  })

  test("auto clean defers young files, manual clean does not", async () => {
    const root = await tempRoot()
    const file = path.join(root, "tmp-young.mjs")
    await fs.writeFile(file, "x")
    await record({ sessionID: "ses_c", worktree: root, file: file, tool: "write" })

    const early = await clean({ sessionID: "ses_c", worktree: root, auto: true })
    expect(early.removed).toEqual([])

    const manual = await clean({ sessionID: "ses_c", worktree: root })
    expect(manual.removed).toEqual(["tmp-young.mjs"])
  })

  test("cleans up empty temporary directories", async () => {
    const root = await tempRoot()
    const dir = path.join(root, "scratch")
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, "out.json")
    await fs.writeFile(file, "{}")
    await record({ sessionID: "ses_d", worktree: root, file, tool: "write" })

    await clean({ sessionID: "ses_d", worktree: root })
    await expect(fs.stat(dir)).rejects.toThrow()
  })

  test("content hash is stable", () => {
    expect(contentHash("abc")).toBe(contentHash(Buffer.from("abc")))
  })
})
