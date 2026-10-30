import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { create, head, remove, slug } from "@/team/worktree"

const git = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" })

/** 临时仓库：团队 worktree 的输入是一个真实仓库，用假的就测不到 git 的行为。 */
async function repo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-team-wt-"))
  git(dir, ["init", "-q"])
  git(dir, ["config", "user.email", "test@example.com"])
  git(dir, ["config", "user.name", "test"])
  await fs.writeFile(path.join(dir, "a.txt"), "hello\n")
  git(dir, ["add", "a.txt"])
  git(dir, ["commit", "-q", "-m", "init"])
  return dir
}

describe("team worktree", () => {
  test("creates an isolated checkout bound to the base commit", async () => {
    const base = await repo()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-team-root-"))
    const result = await create({ base, runID: "run_abc", name: "代码审查团队", root })
    expect(result.kind).toBe("created")
    if (result.kind !== "created") return

    const sha = git(base, ["rev-parse", "HEAD"]).stdout.trim()
    expect(result.worktree.baseSHA).toBe(sha)
    // 分支名可读、可预测：novaway/team/<run>/<team>。
    expect(result.worktree.branch).toMatch(/^novaway\/team\/run-abc\/[a-z0-9-]+$/)
    expect(await head(result.worktree.directory)).toBe(sha)
    // 检出可能按平台的换行规则落盘，比较内容而不比较字节。
    expect((await fs.readFile(path.join(result.worktree.directory, "a.txt"), "utf8")).trim()).toBe("hello")

    // worktree 里的写入不会出现在用户仓库的状态里 —— 这就是它的意义。
    await fs.writeFile(path.join(result.worktree.directory, "a.txt"), "changed\n")
    expect(git(base, ["status", "--porcelain"]).stdout.trim()).toBe("")

    const removed = await remove({ base, directory: result.worktree.directory, branch: result.worktree.branch })
    expect(removed.ok).toBe(true)
    expect(git(base, ["branch", "--list", result.worktree.branch]).stdout.trim()).toBe("")
  })

  test("refuses to invent a snapshot when the base is not a repository", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-team-plain-"))
    const skipped = await create({ base: plain, runID: "run_x", name: "t" })
    expect(skipped.kind).toBe("skipped")
    // 跳过必须给出原因：静默降级成「在工作区里跑」会让证据失去意义。
    expect(skipped.kind === "skipped" && skipped.reason.length > 0).toBe(true)
  })

  test("a repository without commits cannot produce a reproducible snapshot", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-team-empty-"))
    git(dir, ["init", "-q"])
    const skipped = await create({ base: dir, runID: "run_x", name: "t" })
    expect(skipped.kind).toBe("skipped")
    expect(skipped.kind === "skipped" && skipped.reason).toContain("还没有提交")
  })

  test("slugs keep branch names usable in git", () => {
    expect(slug("代码审查团队")).toBe("team")
    expect(slug("Review / Team #1")).toBe("review-team-1")
    expect(slug("  ")).toBe("team")
  })
})
