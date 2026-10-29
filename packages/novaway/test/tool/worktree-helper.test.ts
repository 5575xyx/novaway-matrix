import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { create, remove, state } from "../../src/tool/worktree-helper"

const dirs: string[] = []

async function repo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-worktree-"))
  dirs.push(dir)
  const run = async (args: string[], cwd = dir) => {
    const proc = Bun.spawn(["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, , code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed`)
    return stdout.trim()
  }
  await run(["init", "-q"])
  await fs.writeFile(path.join(dir, "README.md"), "hello\n")
  await run(["add", "."])
  await run(["commit", "-q", "-m", "init"])
  return { dir, run }
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

describe("worktree-helper", () => {
  test("reports a clean worktree with its branch", async () => {
    const { dir } = await repo()
    const created = await create(dir, "clean")
    expect(created).toBeDefined()

    const info = await state(created!.directory, dir)
    expect(info.files).toEqual([])
    expect(info.ahead).toBe(0)
    expect(info.branch).toBe(created!.branch)
  })

  test("reports uncommitted files and unmerged commits", async () => {
    const { dir, run } = await repo()
    const created = await create(dir, "dirty")

    await fs.writeFile(path.join(created!.directory, "new.txt"), "x")
    const dirty = await state(created!.directory, dir)
    expect(dirty.files.length).toBeGreaterThan(0)

    await run(["add", "."], created!.directory)
    await run(["commit", "-q", "-m", "work"], created!.directory)
    const committed = await state(created!.directory, dir)
    expect(committed.files).toEqual([])
    expect(committed.ahead).toBe(1)
  })

  test("removes the worktree directory and branch", async () => {
    const { dir, run } = await repo()
    const created = await create(dir, "gone")

    const result = await remove(dir, created!.directory, created!.branch)
    expect(result.ok).toBe(true)
    await expect(fs.stat(created!.directory)).rejects.toThrow()
    const branches = await run(["branch", "--list", created!.branch])
    expect(branches).toBe("")
  })
})
