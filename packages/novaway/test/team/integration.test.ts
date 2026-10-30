import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { integrate, integrateInto, mergeInto } from "@/team/integration"
import { createMission } from "@/team/worktree"

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

/**
 * 模拟团队 worktree：从 base 建分支，改一处再提交。
 *
 * worktree 落在 `root`（仓库之外）而不是仓库里 —— 建在仓库内会让它自己变成
 * 未跟踪目录，把「工作区是否干净」这个判断搅乱。
 */
async function team(base: string, root: string, name: string, file: string, content: string, baseSHA?: string) {
  const branch = "novaway/team/run-1/" + name
  const dir = path.join(root, "wt-" + name)
  git(base, ["worktree", "add", "-b", branch, dir, baseSHA ?? "HEAD"])
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
    const a = await team(base, root, "alpha", "a.txt", "from alpha\n", baseSHA)
    const b = await team(base, root, "beta", "b.txt", "from beta\n", baseSHA)

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
    const a = await team(base, root, "alpha", "shared.txt", "alpha version\n", baseSHA)
    const b = await team(base, root, "beta", "shared.txt", "beta version\n", baseSHA)

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

describe("team merge (explicit user action)", () => {
  test("lands the integration branch on the checked-out branch and names the commit", async () => {
    const base = await repo()
    const baseSHA = run(base, ["rev-parse", "HEAD"])
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-merge-root-"))
    const a = await team(base, root, "alpha", "a.txt", "from alpha\n", baseSHA)
    const integrated = await integrate({ base, baseSHA, runID: "run_m", teams: [a], root })
    expect(integrated.kind).toBe("merged")
    if (integrated.kind !== "merged") return

    const outcome = await mergeInto({ base, branch: integrated.branch })
    expect(outcome.kind).toBe("merged")
    if (outcome.kind !== "merged") return
    // 合并之后用户的 HEAD 就是那个提交：运行的产出能指认到具体是谁、合在哪。
    expect(outcome.branch).toBe(run(base, ["rev-parse", "--abbrev-ref", "HEAD"]))
    expect(run(base, ["rev-parse", "HEAD"])).toBe(outcome.sha)
    expect(run(base, ["log", "--oneline", "-1"])).toContain("merge: " + integrated.branch)
    expect(await fs.readFile(path.join(base, "a.txt"), "utf8")).toContain("from alpha")
  })

  test("refuses to merge over uncommitted work instead of mixing two sets of changes", async () => {
    const base = await repo()
    const baseSHA = run(base, ["rev-parse", "HEAD"])
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-merge-root-"))
    const a = await team(base, root, "alpha", "a.txt", "from alpha\n", baseSHA)
    const integrated = await integrate({ base, baseSHA, runID: "run_d", teams: [a], root })
    if (integrated.kind !== "merged") throw new Error("integration failed")

    await fs.writeFile(path.join(base, "shared.txt"), "mine\n")
    const outcome = await mergeInto({ base, branch: integrated.branch })
    expect(outcome.kind).toBe("dirty")
    if (outcome.kind !== "dirty") return
    expect(outcome.files.length).toBe(1)
    // 拒绝就是拒绝：用户的改动和 HEAD 都不能被动过。
    expect(run(base, ["rev-parse", "HEAD"])).toBe(baseSHA)
    expect(await fs.readFile(path.join(base, "shared.txt"), "utf8")).toContain("mine")
  })
})

describe("mission integration", () => {
  test("merges into the mission worktree, so the next run starts from what was already done", async () => {
    const base = await repo()
    const baseSHA = run(base, ["rev-parse", "HEAD"])
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-mission-root-"))
    const mission = await createMission({ base, missionID: "mis_1", baseSHA, root })
    expect(mission.kind).toBe("created")
    if (mission.kind !== "created") return

    const first = await team(base, root, "alpha", "a.txt", "from alpha\n", baseSHA)
    const one = await integrateInto({ directory: mission.worktree.directory, teams: [first] })
    expect(one.kind).toBe("merged")
    if (one.kind !== "merged") return
    // 合并落在目标分支上，而不是另开一个一次性分支。
    expect(one.branch).toBe(mission.worktree.branch)
    expect(run(mission.worktree.directory, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(mission.worktree.branch)

    // 第二次运行从目标工作区当前的 HEAD 切分支：上一次的改动必须还在。
    const second = await team(
      base,
      root,
      "beta",
      "b.txt",
      "from beta\n",
      run(mission.worktree.directory, ["rev-parse", "HEAD"]),
    )
    const two = await integrateInto({ directory: mission.worktree.directory, teams: [second] })
    expect(two.kind).toBe("merged")
    expect(await fs.readFile(path.join(mission.worktree.directory, "a.txt"), "utf8")).toContain("from alpha")
    expect(await fs.readFile(path.join(mission.worktree.directory, "b.txt"), "utf8")).toContain("from beta")
    // 用户的仓库仍然停在起点：目标工作区是仓库之外的一份副本。
    expect(run(base, ["rev-parse", "HEAD"])).toBe(baseSHA)
  })

  test("refuses to integrate over uncommitted changes in the mission worktree", async () => {
    const base = await repo()
    const baseSHA = run(base, ["rev-parse", "HEAD"])
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "novaway-mission-root-"))
    const mission = await createMission({ base, missionID: "mis_2", baseSHA, root })
    if (mission.kind !== "created") throw new Error("mission worktree missing")
    const alpha = await team(base, root, "alpha", "a.txt", "from alpha\n", baseSHA)
    await fs.writeFile(path.join(mission.worktree.directory, "shared.txt"), "half done\n")

    const outcome = await integrateInto({ directory: mission.worktree.directory, teams: [alpha] })
    expect(outcome.kind).toBe("failed")
    // 半成品不能被当成下一次运行的起点。
    expect(outcome.kind === "failed" && outcome.message).toContain("不干净")
  })
})
