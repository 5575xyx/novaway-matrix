import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { slug } from "./worktree"

/**
 * 串行集成（§10.2）。
 *
 * 团队 worktree 让每个团队看到自己那份代码，但「各自的 `pass`」不构成可交付：
 * 只有当多个团队的改动合到一起之后仍然成立，才算真的做成。所以集成单独跑一遍：
 *
 * 1. 从运行开始时的提交建一个**集成分支**（`novaway/integrate/<run>`），
 *    不直接合进用户的分支 —— 合并进用户分支是用户的动作，不是运行的副作用；
 * 2. 按团队顺序**逐个**合并，遇到冲突立刻停下：后面的团队是基于「前面的都成立」
 *    才验证的，硬合下去只会把冲突扩散到更多文件；
 * 3. 冲突不做自动解决。`git merge --abort` 回到干净状态，把冲突文件列出来，
 *    交给返工 —— 自动解冲突是「把代码改对」的猜测，恰恰是最该被验证器盯住的动作。
 */

export type TeamBranch = { name: string; branch: string }

export type Outcome =
  | { kind: "merged"; directory: string; branch: string; sha: string; merged: string[] }
  | { kind: "conflict"; directory: string; branch: string; team: string; files: string[]; message: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; message: string }

function git(cwd: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()))
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()))
    child.on("error", (error) => resolve({ code: 1, stdout: "", stderr: String(error) }))
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/** 冲突文件：只列 `UU/AA/DU…` 这类未合并路径。 */
export async function conflicts(directory: string) {
  const status = await git(directory, ["diff", "--name-only", "--diff-filter=U"])
  return status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * 团队分支与仓库当前 HEAD 的分岔点。
 *
 * 它就是「运行开始时的那次提交」：用户的仓库可能在运行期间又提交了东西，
 * 直接从当前 HEAD 起集成会把用户的新改动混进团队结果里。
 */
export async function forkPoint(base: string, branches: readonly string[]) {
  if (branches.length === 0) return undefined
  const result = await git(base, ["merge-base", ...branches])
  return result.code === 0 ? result.stdout.trim() || undefined : undefined
}

/**
 * 建集成 worktree 并依次合并各团队分支。
 *
 * `base` 是团队的来源仓库，`baseSHA` 是运行开始时的提交。用同一个提交建分支，
 * 「集成结果和谁比」才有确定答案。
 */
export async function integrate(input: {
  base: string
  baseSHA: string
  runID: string
  teams: readonly TeamBranch[]
  /** 测试可覆盖；生产走全局数据目录。 */
  root?: string
}): Promise<Outcome> {
  if (input.teams.length === 0) return { kind: "skipped", reason: "没有团队分支可合并" }

  const run = slug(input.runID)
  const base = input.root ?? path.join(Global.Path.data, "worktree", "integrations")
  const directory = path.join(base, run + "-" + Date.now().toString(36))
  const branch = "novaway/integrate/" + run
  await fs.mkdir(base, { recursive: true })

  const added = await git(input.base, ["worktree", "add", "-b", branch, directory, input.baseSHA])
  if (added.code !== 0) {
    return { kind: "failed", message: added.stderr.trim() || added.stdout.trim() || "git worktree add 失败" }
  }

  const merged: string[] = []
  for (const team of input.teams) {
    // `--no-ff` 让每个团队都有一个可指认的合并提交：出问题能回答「是谁那一步坏的」。
    const result = await git(directory, ["merge", "--no-ff", "--no-edit", "-m", "integrate: " + team.name, team.branch])
    if (result.code !== 0) {
      const files = await conflicts(directory)
      const message = (result.stderr || result.stdout).trim()
      // 回到合并前的干净状态：冲突现场留在 worktree 里会污染后续重验。
      await git(directory, ["merge", "--abort"])
      return { kind: "conflict", directory, branch, team: team.name, files, message }
    }
    merged.push(team.name)
  }

  const head = await git(directory, ["rev-parse", "HEAD"])
  if (head.code !== 0) return { kind: "failed", message: "无法读取集成后的提交" }
  return { kind: "merged", directory, branch, sha: head.stdout.trim(), merged }
}

/**
 * 把团队分支直接合进某个已存在的 worktree（Mission 工作区，§3.2）。
 *
 * 与 `integrate()` 的差别是**没有新建集成分支**：Mission 的工作区跨运行复用，
 * 合并结果就该落在它的分支上，下一次运行从这里继续。因此这里先要求工作区干净 ——
 * 上一次运行留下的半成品不能冒充「起点」。
 */
export async function integrateInto(input: { directory: string; teams: readonly TeamBranch[] }): Promise<Outcome> {
  if (input.teams.length === 0) return { kind: "skipped", reason: "没有团队分支可合并" }

  const status = await git(input.directory, ["status", "--porcelain"])
  if (status.code !== 0) return { kind: "failed", message: status.stderr.trim() || "无法读取工作区状态" }
  if (status.stdout.trim()) return { kind: "failed", message: "Mission 工作区不干净：先处理未提交改动再集成。" }

  const current = await git(input.directory, ["rev-parse", "--abbrev-ref", "HEAD"])
  const branch = current.stdout.trim()
  if (current.code !== 0 || !branch || branch === "HEAD")
    return { kind: "failed", message: "Mission 工作区不在分支上（detached HEAD）" }

  const merged: string[] = []
  for (const team of input.teams) {
    const result = await git(input.directory, [
      "merge",
      "--no-ff",
      "--no-edit",
      "-m",
      "integrate: " + team.name,
      team.branch,
    ])
    if (result.code !== 0) {
      const files = await conflicts(input.directory)
      const message = (result.stderr || result.stdout).trim()
      await git(input.directory, ["merge", "--abort"])
      return { kind: "conflict", directory: input.directory, branch, team: team.name, files, message }
    }
    merged.push(team.name)
  }

  const head = await git(input.directory, ["rev-parse", "HEAD"])
  if (head.code !== 0) return { kind: "failed", message: "无法读取集成后的提交" }
  return { kind: "merged", directory: input.directory, branch, sha: head.stdout.trim(), merged }
}

export type MergeInto =
  | { kind: "merged"; branch: string; sha: string }
  | { kind: "conflict"; files: string[]; message: string }
  | { kind: "dirty"; files: string[] }
  | { kind: "failed"; message: string }

/**
 * 显式合并动作（§16 P2）：把集成分支合进用户当前检出的分支。
 *
 * 这是**用户**的动作，不是运行的副作用 —— 所以只在这里做，且必须先满足两个条件：
 * 1. 工作区干净：用户还有未提交改动时合并，等于把两批改动搅在一起，
 *    出了事没人分得清哪一半是自己的；
 * 2. 运行已经结束：跑着的时候合进去，会让后续验证对着一个正在变的目录。
 */
export async function mergeInto(input: { base: string; branch: string }): Promise<MergeInto> {
  const status = await git(input.base, ["status", "--porcelain"])
  if (status.code !== 0) return { kind: "failed", message: status.stderr.trim() || "无法读取工作区状态" }
  const dirty = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (dirty.length > 0) return { kind: "dirty", files: dirty }

  const current = await git(input.base, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (current.code !== 0) return { kind: "failed", message: "无法确定当前分支（detached HEAD？）" }

  const merged = await git(input.base, ["merge", "--no-ff", "--no-edit", "-m", "merge: " + input.branch, input.branch])
  if (merged.code !== 0) {
    const files = await conflicts(input.base)
    const message = (merged.stderr || merged.stdout).trim()
    await git(input.base, ["merge", "--abort"])
    return { kind: "conflict", files, message }
  }
  const head = await git(input.base, ["rev-parse", "HEAD"])
  return { kind: "merged", branch: current.stdout.trim(), sha: head.code === 0 ? head.stdout.trim() : "" }
}

/** 删除集成 worktree 与分支。 */
export async function remove(input: { base: string; directory: string; branch?: string }) {
  const removed = await git(input.base, ["worktree", "remove", "--force", input.directory])
  if (input.branch) await git(input.base, ["branch", "-D", input.branch])
  await git(input.base, ["worktree", "prune"])
  if (removed.code !== 0) return { ok: false as const, error: removed.stderr.trim() || removed.stdout.trim() }
  return { ok: true as const }
}
