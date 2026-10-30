import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { integrate } from "@/team/integration"

const git = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" })
const run = (cwd: string, args: string[]) => {
  const result = git(cwd, args)
  if (result.status !== 0) throw new Error(`${args.join(" ")}: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

async function repo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-integration-"))
  git(dir, ["init", "-q"])
  git(dir, ["config", "user.email", "test@example.com"])
  git(dir, ["config", "user.name", "test"])
  await fs.writeFile(path.join(dir, "shared.txt"), "base\n")
  git(dir, ["add", "."])
  git(dir, ["commit", "-q", "-m", "init"])
  return dir
}

/** 模拟团队 worktree：从 base 建分支，改一处再提交。 */
async function team(root: string, name: string, file: string, content: string, baseSHA?: string) {
  const branch = "novaway/team/run-1/" + name
  const dir = path.join(root, "wt-" + name)
  git(root, ["worktree", "add", "-b", branch, dir, baseSHA ?? "HEAD"])
  await fs.writeFile(path.join(dir, file), content)
  git(dir, ["add", "."])
  git(dir, ["commit", "-q", "-m", name])
  return { name, branch }
}

describe("team integration", () => {
  test("merges every team branch into one integration commit on top of the base", async () => {
    const base = await repo()
    const baseSHA = run(base, ["rev-parse", "HEAD"])
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-integration-root-"))
    const a = await team(base, "alpha", "a.txt", "from alpha\n", baseSHA)
    const b = await team(base, "beta", "b.txt", "from beta\n", baseSHA)

    const outcome = await integrate({ base, baseSHA, runID: "run_1", teams: [a, b], root })
    expect(outcome.kind).toBe("merged")
    if (outcome.kind !== "merged") return
    expect(outcome.merged).toEqual(["alpha", "beta"])
    // 集成结果同时包含两边的改动：这才是「可交付」的含义。
    expect(await fs.readFile(path.join(outcome.directory, "a.txt"), "utf8")).toContain("from alpha")
    expect(await fs.readFile(path.join(outcome.directory, "b.txt"), "utf8")).toContain("from beta")
    // 合并提交可指认：每个团队一个 --no-ff 合并，出问题能回答是谁那一步坏的。
    expect(run(outcome.directory, ["log", "--oneline", "-1"])).toContain("integrate: beta")
    // 用户自己的分支不受影响：集成只发生在工作区之外的分支上。
    expect(run(base, ["rev-parse", "HEAD"])).toBe(baseSHA)
  })

  test("a conflict stops the merge, lists the files, and leaves the tree clean", async () => {
    const base = await repo()
    const baseSHA = run(base, ["rev-parse", "HEAD"])
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-integration-root-"))
    const a = await team(base, "alpha", "shared.txt", "alpha version\n", baseSHA)
    const b = await team(base, "beta", "shared.txt", "beta version\n", baseSHA)

    const outcome = await integrate({ base, baseSHA, runID: "run_2", teams: [a, b], root })
    expect(outcome.kind).toBe("conflict")
    if (outcome.kind !== "conflict") return
    // 冲突要指名到团队与文件：返工任务需要知道找谁、改哪里。
    expect(outcome.team).toBe("beta")
    expect(outcome.files).toEqual(["shared.txt"])
    // `merge --abort` 之后不能残留未合并路径，否则后续重验会读到半个结果。
    expect(run(outcome.directory, ["diff", "--name-only", "--diff-filter=U"]).trim()).toBe("")
    expect(run(outcome.directory, ["status", "--porcelain"]).trim()).toBe("")
  })

  test("naming no team branches is skipped, not silently reported as merged", async () => {
    const base = await repo()
    const outcome = await integrate({ base, baseSHA: run(base, ["rev-parse", "HEAD"]), runID: "run_3", teams: [] })
    expect(outcome.kind).toBe("skipped")
  })
})
