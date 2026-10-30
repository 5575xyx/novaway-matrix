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

/** 删除 worktree 与分支。只清运行自己建的东西，不碰仓库里的其它引用。 */
export async function remove(input: { base: string; directory: string; branch?: string }) {
  const removed = await git(input.base, ["worktree", "remove", "--force", input.directory])
  if (input.branch) await git(input.base, ["branch", "-D", input.branch])
  await git(input.base, ["worktree", "prune"])
  if (removed.code !== 0) return { ok: false as const, error: removed.stderr.trim() || removed.stdout.trim() }
  return { ok: true as const }
}
