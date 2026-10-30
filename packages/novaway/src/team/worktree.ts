import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@novaway/core/global"

/**
 * 团队级 worktree（§10.1 / §10.2 第一半）。
 *
 * 为什么要它：成员在用户的工作区里读写，等于把「用户还没提交的改动」混进证据里 ——
 * 同一个验收项在两次验证之间可能因为用户随手存盘而改变结论。团队 worktree 给每个团队
 * 一份 `HEAD` 的独立副本，证据绑定的是**提交**而不是「当时目录里恰好有什么」。
 *
 * 三个边界，写在这里免得以后被当成 bug 修：
 * 1. worktree 有独立 `HEAD` 与 index，但**共享仓库对象**，也不隔离进程与外设；
 *    所以它不能替代团队内单写者（见 `writer.ts`）。
 * 2. 目录放在全局数据目录下，不落进用户的仓库：取消运行不会在 `git status` 里留下东西，
 *    只留下一个分支引用。
 * 3. 创建失败（不是 git 仓库、没有提交、git 不可用）**不阻塞运行**，而是返回原因，
 *    由调用方记录事件 —— 静默降级成「在工作区里跑」才是错的做法。
 */

export type TeamWorktree = {
  directory: string
  branch: string
  base: string
  /** 创建时的提交：证据快照就用它，可复验。 */
  baseSHA: string
}

export type Created = { kind: "created"; worktree: TeamWorktree }
export type Skipped = { kind: "skipped"; reason: string }

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

/** 分支名与目录名用的是同一套 slug：小写、`-` 分隔、限长。 */
export function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "team"
  )
}

/** 仓库根目录；base 可能只是仓库里的某个子目录。 */
async function root_(base: string) {
  const top = await git(base, ["rev-parse", "--show-toplevel"])
  return top.code === 0 ? top.stdout.trim() : undefined
}

export async function head(directory: string) {
  const result = await git(directory, ["rev-parse", "HEAD"])
  return result.code === 0 ? result.stdout.trim() : undefined
}

/** worktree 当前分支。集成要按分支合并，而团队行里只存了目录。 */
export async function branch(directory: string) {
  const result = await git(directory, ["rev-parse", "--abbrev-ref", "HEAD"])
  const name = result.stdout.trim()
  return result.code === 0 && name && name !== "HEAD" ? name : undefined
}

export async function create(input: {
  base: string
  runID: string
  name: string
  /** 测试可覆盖；生产走全局数据目录。 */
  root?: string
}): Promise<Created | Skipped> {
  const repo = await root_(input.base)
  if (!repo) return { kind: "skipped", reason: "不是 git 仓库（或 git 不可用）：" + input.base }

  const sha = await head(repo)
  if (!sha) return { kind: "skipped", reason: "仓库还没有提交，无法建立可复验的快照：" + repo }

  const run = slug(input.runID)
  const name = slug(input.name)
  // 时间后缀避免同一运行里重复建目录时互相踩（重试、重新执行）。
  const candidate = run + "-" + name + "-" + Date.now().toString(36)
  const base = input.root ?? path.join(Global.Path.data, "worktree", "teams")
  const directory = path.join(base, candidate)
  const branch = "novaway/team/" + run + "/" + name

  await fs.mkdir(base, { recursive: true })
  const added = await git(repo, ["worktree", "add", "-b", branch, directory, sha])
  if (added.code !== 0)
    return { kind: "skipped", reason: added.stderr.trim() || added.stdout.trim() || "git worktree add 失败" }
  return { kind: "created", worktree: { directory, branch, base: repo, baseSHA: sha } }
}

export type Integration = {
  kind: "merged" | "conflict" | "skipped"
  reason?: string
  /** 集成分支与它的工作目录（合并后的代码就在这里）。 */
  branch?: string
  directory?: string
  /** 合并后的提交；证据快照用它。 */
  sha?: string
  /** 成功合入的团队分支，按合并顺序。 */
  merged: string[]
  /** 冲突：哪个分支、哪些文件。 */
  conflict?: { branch: string; files: string[] }
}

const exists = async (cwd: string, ref: string) =>
  (await git(cwd, ["rev-parse", "--verify", "--quiet", ref])).code === 0

/**
 * 串行合并团队分支（§10.2）。
 *
 * 一个集成分支、一个集成 worktree、**一次只合一个团队**：并行合并会把冲突变成
 * 「谁先到谁赢」，而冲突本身是需要被看见、被返工的信息。
 *
 * 合并失败时 `git merge --abort` 把集成分支留在上一次成功的状态 —— 半合并的树
 * 比没合并更危险：它会让人以为「已经合过了」。
 */
export async function integrate(input: {
  base: string
  runID: string
  /** 按团队顺序给出分支名；不存在的分支会被跳过并记进 `merged` 之外的说明里。 */
  teams: ReadonlyArray<{ name: string; branch: string }>
  root?: string
}): Promise<Integration> {
  const repo = await root_(input.base)
  if (!repo) return { kind: "skipped", reason: "不是 git 仓库（或 git 不可用）：" + input.base, merged: [] }

  const run = slug(input.runID)
  const base = input.root ?? path.join(Global.Path.data, "worktree", "teams")
  const branch = "novaway/run/" + run
  const directory = path.join(base, run + "-integration")
  await fs.mkdir(base, { recursive: true })

  if (!(await exists(repo, "refs/heads/" + branch))) {
    const headSHA = await head(repo)
    if (!headSHA) return { kind: "skipped", reason: "仓库还没有提交：" + repo, merged: [] }
    const added = await git(repo, ["worktree", "add", "-b", branch, directory, headSHA])
    if (added.code !== 0)
      return { kind: "skipped", reason: added.stderr.trim() || added.stdout.trim(), merged: [], branch, directory }
  }

  const merged: string[] = []
  for (const team of input.teams) {
    if (!(await exists(repo, "refs/heads/" + team.branch))) continue
    const result = await git(directory, [
      "merge",
      "--no-ff",
      "-m",
      "merge " + team.branch + " (" + team.name + ")",
      team.branch,
    ])
    if (result.code === 0) {
      merged.push(team.branch)
      continue
    }
    const conflicted = await git(directory, ["diff", "--name-only", "--diff-filter=U"])
    const files = conflicted.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    // 中止：把集成分支留在最后一次成功合并的状态，别留下半合并的树。
    await git(directory, ["merge", "--abort"])
    return {
      kind: "conflict",
      reason: result.stderr.trim() || result.stdout.trim() || "合并失败",
      branch,
      directory,
      sha: await head(directory),
      merged,
      conflict: { branch: team.branch, files },
    }
  }

  return { kind: "merged", branch, directory, sha: await head(directory), merged }
}

/** 删除 worktree 与分支。只清运行自己建的东西，不碰仓库里的其它引用。 */
export async function remove(input: { base: string; directory: string; branch?: string }) {
  const removed = await git(input.base, ["worktree", "remove", "--force", input.directory])
  if (input.branch) await git(input.base, ["branch", "-D", input.branch])
  await git(input.base, ["worktree", "prune"])
  if (removed.code !== 0) return { ok: false as const, error: removed.stderr.trim() || removed.stdout.trim() }
  return { ok: true as const }
}
