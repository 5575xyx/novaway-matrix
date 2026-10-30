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

export type Committed =
  | { kind: "committed"; sha: string; files: number }
  | { kind: "clean" }
  | { kind: "failed"; message: string }

/** 团队提交的作者：能指认是「谁」产生的改动，而不是借用户的 git 身份。 */
const TEAM_AUTHOR = { name: "NovaWay Team", email: "team@novaway.local" }

/**
 * 把工作区里**实际存在**的改动落成一个提交（§10.1 / §16 P2）。
 *
 * 为什么必须有这一步：`git merge` 只认提交。成员写完文件却没提交时，
 * 集成合并到的是一个没有这些改动的分支，而验证读到的还是旧 `HEAD` ——
 * 「跑完了」与「代码变了」会同时为真，这是最危险的一种不一致。
 *
 * 三条边界：
 * 1. `git add -A` 尊重 `.gitignore`：被忽略的构建产物不会进提交，但其余改动全部进 ——
 *    宁可提交得多，也不漏掉成员真正写下的东西。
 * 2. 没有改动时返回 `clean`，**不产生空提交**：空提交会让「第几轮改了什么」变得难读。
 * 3. 用 `--no-verify` 跳过用户的钩子：钩子可能要求交互或直接改动工作区，
 *    团队提交只是把改动变成可复验的快照。质量门槛由随后的验证器负责，而不是钩子。
 *    作者身份显式给出，所以用户没配 `user.email` 也能提交。
 */
export async function commit(input: { directory: string; message: string }): Promise<Committed> {
  const added = await git(input.directory, ["add", "-A"])
  if (added.code !== 0) return { kind: "failed", message: added.stderr.trim() || added.stdout.trim() || "git add 失败" }

  const status = await git(input.directory, ["status", "--porcelain"])
  if (status.code !== 0) return { kind: "failed", message: status.stderr.trim() || "无法读取工作区状态" }
  const files = status.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (files.length === 0) return { kind: "clean" }

  const committed = await git(input.directory, [
    "-c",
    "user.name=" + TEAM_AUTHOR.name,
    "-c",
    "user.email=" + TEAM_AUTHOR.email,
    "commit",
    "-q",
    "--no-verify",
    "-m",
    input.message,
  ])
  if (committed.code !== 0)
    return { kind: "failed", message: committed.stderr.trim() || committed.stdout.trim() || "git commit 失败" }

  const sha = await head(input.directory)
  if (!sha) return { kind: "failed", message: "提交后读不到 HEAD" }
  return { kind: "committed", sha, files: files.length }
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

/**
 * Mission 工作区（§3.2）：一个目标一份 worktree、一个固定 `baseSHA`。
 *
 * 与团队 worktree 的区别只有两点，但都关键：
 * 1. 分支是 `novaway/mission/<id>`，生命周期跟着目标走，**不随运行结束被删**；
 * 2. 建不出来时返回原因而不是降级 —— 没有固定起点，累计差异就不成立。
 */
export async function createMission(input: {
  base: string
  missionID: string
  /** 复用已记录的起点；只在第一次准备时省略。 */
  baseSHA?: string
  root?: string
}): Promise<Created | Skipped> {
  const repo = await root_(input.base)
  if (!repo) return { kind: "skipped", reason: "不是 git 仓库（或 git 不可用）：" + input.base }

  const sha = input.baseSHA ?? (await head(repo))
  if (!sha) return { kind: "skipped", reason: "仓库还没有提交，无法建立可复验的快照：" + repo }

  const id = slug(input.missionID)
  const branch = "novaway/mission/" + id
  const base = input.root ?? path.join(Global.Path.data, "worktree", "missions")
  const directory = path.join(base, id)
  await fs.mkdir(base, { recursive: true })
  const added = await git(repo, ["worktree", "add", "-b", branch, directory, sha])
  if (added.code !== 0)
    return { kind: "skipped", reason: added.stderr.trim() || added.stdout.trim() || "git worktree add 失败" }
  return { kind: "created", worktree: { directory, branch, base: repo, baseSHA: sha } }
}

export type ChangedFile = { path: string; added: number; removed: number; binary: boolean }

export type CumulativeDiff = {
  baseSHA: string
  head: string
  /** 已纳入版本的改动（含已提交与已暂存的），按新增行数降序。 */
  files: ChangedFile[]
  /** 还没有被任何提交收录的新文件：它们不是「已交付」，所以单列。 */
  untracked: string[]
  truncated: boolean
}

const MAX_FILES = 200

/**
 * 累计差异：从目标起点到**当前内容**（§3.2）。
 *
 * 用 `git diff <baseSHA>` 而不是 `--stat HEAD`：目标的工作区可能还有没提交的改动，
 * 而用户关心的正是「现在做到哪了」，不只是「上次提交到哪了」。
 * 未跟踪文件不进 `git diff`，所以单独列出来 —— 把它们混进改动统计会让人以为已经交付。
 */
export async function cumulativeDiff(input: {
  directory: string
  baseSHA: string
}): Promise<CumulativeDiff | undefined> {
  const current = await head(input.directory)
  if (!current) return undefined

  const numstat = await git(input.directory, ["diff", "--numstat", input.baseSHA])
  if (numstat.code !== 0) return undefined
  const files: ChangedFile[] = []
  for (const line of numstat.stdout.split("\n")) {
    if (!line.trim()) continue
    const [added, removed, ...rest] = line.split("\t")
    const path = rest.join("\t")
    if (!path) continue
    const binary = added === "-" || removed === "-"
    files.push({
      path,
      added: binary ? 0 : Number(added) || 0,
      removed: binary ? 0 : Number(removed) || 0,
      binary,
    })
  }
  files.sort((a, b) => b.added + b.removed - (a.added + a.removed))

  const status = await git(input.directory, ["status", "--porcelain"])
  const untracked =
    status.code === 0
      ? status.stdout
          .split("\n")
          .filter((line) => line.startsWith("?? "))
          .map((line) => line.slice(3).trim())
          .filter(Boolean)
      : []

  return {
    baseSHA: input.baseSHA,
    head: current,
    files: files.slice(0, MAX_FILES),
    untracked,
    truncated: files.length > MAX_FILES,
  }
}

/** 删除 worktree 与分支。只清运行自己建的东西，不碰仓库里的其它引用。 */
export async function remove(input: { base: string; directory: string; branch?: string }) {
  const removed = await git(input.base, ["worktree", "remove", "--force", input.directory])
  if (input.branch) await git(input.base, ["branch", "-D", input.branch])
  await git(input.base, ["worktree", "prune"])
  if (removed.code !== 0) return { ok: false as const, error: removed.stderr.trim() || removed.stdout.trim() }
  return { ok: true as const }
}
