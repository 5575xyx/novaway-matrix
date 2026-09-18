import * as InstanceState from "@/effect/instance-state"
import { Git } from "@/git"
import { Schema, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiGitError, GitSnapshot } from "../groups/git"

type Snapshot = Schema.Schema.Type<typeof GitSnapshot>
type Change = Snapshot["changes"][number]

// Schema 推出来的类型是 readonly,构建阶段得用可变版本。
type BranchParts = { branch?: string; upstream?: string; ahead: number; behind: number }

// 最近提交显示多少条,再多就把侧栏挤出屏幕了。
const LOG_LIMIT = 20
// status 在大仓库里可能很大,给足上限避免截断后解析出脏数据。
const STATUS_MAX_BYTES = 4 * 1024 * 1024
const NUMSTAT_MAX_BYTES = 1 * 1024 * 1024
const LIST_MAX_BYTES = 256 * 1024
// push / pull 走网络,远端慢响应时耗时不可控,单独给一个宽松上限。
const NETWORK_TIMEOUT_MS = 5 * 60 * 1000

// "## main...origin/main [ahead 2, behind 1]" / "## (no branch)" / "## No commits yet on main"
function parseBranchHeader(head: string): BranchParts {
  const info: BranchParts = { ahead: 0, behind: 0 }
  const bracket = head.indexOf("[")
  const body = (bracket === -1 ? head : head.slice(0, bracket)).trim()
  const sep = body.indexOf("...")
  if (sep === -1) {
    info.branch = body
  } else {
    info.branch = body.slice(0, sep).trim()
    const upstream = body.slice(sep + 3).trim()
    if (upstream) info.upstream = upstream
  }
  const ahead = /\bahead (\d+)/.exec(head)
  const behind = /\bbehind (\d+)/.exec(head)
  if (ahead) info.ahead = Number(ahead[1])
  if (behind) info.behind = Number(behind[1])
  return info
}

// 重命名行有 "old => new" 和 "prefix{old => new}suffix" 两种写法,都取新路径。
function renameTarget(raw: string): string {
  const open = raw.indexOf("{")
  if (open !== -1) {
    const close = raw.indexOf("}", open)
    if (close > open) {
      const inner = raw.slice(open + 1, close)
      const sep = inner.indexOf(" => ")
      if (sep !== -1) return raw.slice(0, open) + inner.slice(sep + 4) + raw.slice(close + 1)
    }
  }
  const sep = raw.indexOf(" => ")
  return sep === -1 ? raw : raw.slice(sep + 4)
}

function count(value: string): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : 0
}

// 按文件路径索引 +N/-M。二进制两边都是 "-",记成 binary 让前端别显示成 +0 -0。
function parseNumstat(text: string) {
  const stats = new Map<string, Pick<Change, "additions" | "deletions" | "binary">>()
  for (const item of text.split("\0")) {
    if (item.length === 0) continue
    const a = item.indexOf("\t")
    const b = item.indexOf("\t", a + 1)
    if (a === -1 || b === -1) continue
    const file = renameTarget(item.slice(b + 1))
    if (!file) continue
    const additionsRaw = item.slice(0, a)
    const deletionsRaw = item.slice(a + 1, b)
    stats.set(file, {
      additions: count(additionsRaw),
      deletions: count(deletionsRaw),
      binary: additionsRaw === "-" || deletionsRaw === "-",
    })
  }
  return stats
}

// porcelain 每行 "XY <path>",X 是暂存区、Y 是工作区。
function parseChanges(text: string): Array<Pick<Change, "file" | "code" | "status" | "staged" | "unstaged">> {
  const rows: Array<Pick<Change, "file" | "code" | "status" | "staged" | "unstaged">> = []

  for (const item of text.split("\0")) {
    if (item.startsWith("## ") || item.length < 3) continue
    const code = item.slice(0, 2)
    const raw = item.slice(3)
    // 重命名是 "old -> new",只关心新路径。
    const arrow = raw.indexOf(" -> ")
    const file = arrow === -1 ? raw : raw.slice(arrow + 4)
    if (!file) continue
    const x = code.slice(0, 1)
    const y = code.slice(1, 2)
    rows.push({
      file,
      code,
      status: code.includes("?")
        ? "untracked"
        : code.includes("U")
          ? "unmerged"
          : code.includes("D")
            ? "deleted"
            : code.includes("R")
              ? "renamed"
              : code.includes("A")
                ? "added"
                : "modified",
      // ?? 的第一个 ? 不代表已暂存。
      staged: x !== " " && x !== "?",
      unstaged: y !== " ",
    })
  }

  return rows
}

function parseBranches(text: string): Snapshot["branches"] {
  return text.split(/\r?\n/).flatMap((line) => {
    const idx = line.indexOf("\t")
    if (idx === -1) return []
    const name = line.slice(0, idx).trim()
    if (!name) return []
    return [{ name, current: line.slice(idx + 1).trim() === "*" }]
  })
}

function parseRemotes(text: string, currentRemote: string | undefined): Snapshot["remotes"] {
  const remotes: Array<{ name: string; url: string }> = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\S+)\t(\S+) \(fetch\)$/.exec(line.trim())
    const name = match?.[1]
    const url = match?.[2]
    // 每个远程有 fetch 和 push 两行,取 fetch 那行并按名字去重。
    if (name && url && !remotes.some((item) => item.name === name)) remotes.push({ name, url })
  }
  return remotes.map((item) => ({ ...item, current: currentRemote !== undefined && item.name === currentRemote }))
}

function parseStash(text: string): Snapshot["stash"] {
  return text.split(/\r?\n/).flatMap((line) => {
    const idx = line.indexOf("\t")
    if (idx === -1) return []
    const ref = line.slice(0, idx).trim()
    if (!ref) return []
    return [{ ref, message: line.slice(idx + 1) }]
  })
}

function parseLog(text: string): Snapshot["log"] {
  return text.split(/\r?\n/).flatMap((line) => {
    const parts = line.split("\t")
    const hash = parts[0]
    const subject = parts[1]
    if (!hash || subject === undefined) return []
    return [{ hash, subject, author: parts[2] ?? "", date: parts[3] ?? "" }]
  })
}

// 前置条件不满足时直接失败。用 return 收尾,TypeScript 才知道后面不用再兜 undefined。
const badRequest = (message: string) => new ApiGitError({ name: "GitError", data: { message } })

export const gitHandlers = HttpApiBuilder.group(InstanceHttpApi, "git", (handlers) =>
  Effect.gen(function* () {
    const git = yield* Git.Service

    const gitError = Effect.fnUntraced(function* (args: string[], result: Git.Result) {
      const timedOut = result.timedOut ? `git ${args[0]} 执行超时,已终止` : ""
      return yield* badRequest(result.stderr.toString("utf8").trim() || timedOut || `git ${args[0]} 执行失败`)
    })

    const text = Effect.fnUntraced(function* (cwd: string, args: string[], maxOutputBytes: number, timeoutMs?: number) {
      const result = yield* git.run(args, { cwd, maxOutputBytes, timeoutMs })
      if (result.exitCode !== 0) return yield* gitError(args, result)
      return result.text()
    })

    const run = Effect.fnUntraced(function* (cwd: string, args: string[], timeoutMs?: number) {
      const result = yield* git.run(args, { cwd, maxOutputBytes: LIST_MAX_BYTES, timeoutMs })
      if (result.exitCode !== 0) return yield* gitError(args, result)
      return result
    })

    const snapshot = Effect.fn("GitHttpApi.snapshot")(function* (cwd: string) {
      const [statusOut, unstagedOut, stagedOut, branchOut, remoteOut, stashOut, logOut] = yield* Effect.all(
        [
          text(cwd, ["status", "--porcelain=v1", "--branch", "-z"], STATUS_MAX_BYTES),
          text(cwd, ["diff", "--numstat", "-z"], NUMSTAT_MAX_BYTES),
          text(cwd, ["diff", "--cached", "--numstat", "-z"], NUMSTAT_MAX_BYTES),
          text(cwd, ["branch", "--format=%(refname:short)%09%(HEAD)"], LIST_MAX_BYTES),
          text(cwd, ["remote", "-v"], LIST_MAX_BYTES),
          text(cwd, ["stash", "list", "--format=%(refname)%09%s"], LIST_MAX_BYTES),
          text(
            cwd,
            ["log", "-n", String(LOG_LIMIT), `--format=%h%x09%s%x09%an%x09%ad`, "--date=short"],
            LIST_MAX_BYTES,
          ),
        ],
        { concurrency: "unbounded" },
      )

      const branchInfo = parseBranchHeader(statusOut.split("\0").find((line) => line.startsWith("## ")) ?? "")
      const unstagedStats = parseNumstat(unstagedOut)
      const stagedStats = parseNumstat(stagedOut)
      // 同一个文件两边都有内容时拆成两行返回,每行自带统计,前端可以直接按行渲染。
      const changes: Change[] = []
      for (const item of parseChanges(statusOut)) {
        if (item.unstaged) {
          const stats = unstagedStats.get(item.file)
          changes.push({
            ...item,
            staged: false,
            unstaged: true,
            additions: stats?.additions ?? 0,
            deletions: stats?.deletions ?? 0,
            binary: stats?.binary ?? false,
          })
        }
        if (item.staged) {
          const stats = stagedStats.get(item.file)
          changes.push({
            ...item,
            staged: true,
            unstaged: false,
            additions: stats?.additions ?? 0,
            deletions: stats?.deletions ?? 0,
            binary: stats?.binary ?? false,
          })
        }
      }

      return {
        branch: branchInfo,
        changes,
        branches: parseBranches(branchOut),
        remotes: parseRemotes(remoteOut, branchInfo.upstream?.split("/")[0]),
        stash: parseStash(stashOut),
        log: parseLog(logOut),
      }
    })

    // 只要分支和上游信息:推送/拉取前置判断用,比跑完整快照便宜。
    const branchHeader = Effect.fnUntraced(function* (cwd: string) {
      const result = yield* git.run(["status", "--porcelain=v1", "--branch", "-z"], {
        cwd,
        maxOutputBytes: STATUS_MAX_BYTES,
      })
      if (result.exitCode !== 0) return yield* gitError(["status"], result)
      return parseBranchHeader(
        result
          .text()
          .split("\0")
          .find((line) => line.startsWith("## ")) ?? "",
      )
    })

    const directory = Effect.fnUntraced(function* () {
      return (yield* InstanceState.context).directory
    })

    const snap = Effect.fn("GitHttpApi.get")(function* () {
      return yield* snapshot(yield* directory())
    })

    const add = Effect.fn("GitHttpApi.add")(function* (ctx: { payload: { files: readonly string[] } }) {
      const cwd = yield* directory()
      if (ctx.payload.files.length === 0) return yield* badRequest("请至少选择一个文件")
      yield* run(cwd, ["add", "--", ...ctx.payload.files])
      return yield* snapshot(cwd)
    })

    const unstage = Effect.fn("GitHttpApi.unstage")(function* (ctx: { payload: { files: readonly string[] } }) {
      const cwd = yield* directory()
      if (ctx.payload.files.length === 0) return yield* badRequest("请至少选择一个文件")
      yield* run(cwd, ["reset", "--quiet", "HEAD", "--", ...ctx.payload.files])
      return yield* snapshot(cwd)
    })

    const discard = Effect.fn("GitHttpApi.discard")(function* (ctx: { payload: { files: readonly string[] } }) {
      const cwd = yield* directory()
      const current = yield* snapshot(cwd)
      const byFile = new Map(current.changes.map((item) => [item.file, item]))
      const missing = ctx.payload.files.find((file) => !byFile.has(file))
      if (missing) return yield* badRequest(`文件不在变更列表里: ${missing}`)
      for (const file of ctx.payload.files) {
        // 未跟踪只能删,已跟踪恢复成索引里的版本(只丢未暂存那部分)。
        const args = byFile.get(file)?.status === "untracked" ? ["clean", "-f", "--", file] : ["checkout", "--", file]
        yield* run(cwd, args)
      }
      return yield* snapshot(cwd)
    })

    const commit = Effect.fn("GitHttpApi.commit")(function* (ctx: { payload: { message: string } }) {
      const cwd = yield* directory()
      const message = ctx.payload.message.trim()
      if (!message) return yield* badRequest("提交说明不能为空")
      // 索引是空的就先把全部改动暂存进去,免得用户点了提交却什么都没发生。
      const quiet = yield* git.run(["diff", "--cached", "--quiet"], { cwd })
      if (quiet.exitCode === 1) yield* run(cwd, ["add", "-A"])
      yield* run(cwd, ["commit", "-m", message])
      return yield* snapshot(cwd)
    })

    const push = Effect.fn("GitHttpApi.push")(function* () {
      const cwd = yield* directory()
      const info = yield* branchHeader(cwd)
      const branchName = info.branch
      if (!branchName) return yield* badRequest("当前不在分支上,无法推送")
      if (info.upstream) {
        yield* run(cwd, ["push"], NETWORK_TIMEOUT_MS)
      } else {
        const remotes = yield* text(cwd, ["remote"], LIST_MAX_BYTES)
        const remote = remotes
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
        if (!remote) return yield* badRequest("没有配置远程仓库,先添加一个 remote")
        yield* run(cwd, ["push", "-u", remote, branchName], NETWORK_TIMEOUT_MS)
      }
      return yield* snapshot(cwd)
    })

    const pull = Effect.fn("GitHttpApi.pull")(function* () {
      const cwd = yield* directory()
      const info = yield* branchHeader(cwd)
      const upstream = info.upstream
      if (!upstream) return yield* badRequest("当前分支没有上游,无法拉取")
      yield* run(cwd, ["pull", "--no-edit"], NETWORK_TIMEOUT_MS)
      return yield* snapshot(cwd)
    })

    const stash = Effect.fn("GitHttpApi.stash")(function* (ctx: {
      payload: { ref?: string; includeUntracked?: boolean }
    }) {
      const cwd = yield* directory()
      if (ctx.payload.ref) {
        yield* run(cwd, ["stash", "pop", ctx.payload.ref])
      } else {
        yield* run(cwd, ["stash", "push", ...(ctx.payload.includeUntracked === false ? [] : ["-u"])])
      }
      return yield* snapshot(cwd)
    })

    const branch = Effect.fn("GitHttpApi.branch")(function* (ctx: {
      payload: { name: string; create?: boolean; remove?: boolean }
    }) {
      const cwd = yield* directory()
      const name = ctx.payload.name.trim()
      if (!name) return yield* badRequest("分支名不能为空")
      if (ctx.payload.remove) yield* run(cwd, ["branch", "-d", name])
      else if (ctx.payload.create) yield* run(cwd, ["checkout", "-b", name])
      else yield* run(cwd, ["checkout", name])
      return yield* snapshot(cwd)
    })

    const remote = Effect.fn("GitHttpApi.remote")(function* (ctx: {
      payload: { name: string; url?: string; remove?: boolean }
    }) {
      const cwd = yield* directory()
      const name = ctx.payload.name.trim()
      if (!name) return yield* badRequest("远程名不能为空")
      if (ctx.payload.remove) {
        yield* run(cwd, ["remote", "remove", name])
      } else {
        const url = ctx.payload.url?.trim()
        if (!url) return yield* badRequest("远程地址不能为空")
        yield* run(cwd, ["remote", "add", name, url])
      }
      return yield* snapshot(cwd)
    })

    return handlers
      .handle("snapshot", snap)
      .handle("add", add)
      .handle("unstage", unstage)
      .handle("discard", discard)
      .handle("commit", commit)
      .handle("push", push)
      .handle("pull", pull)
      .handle("stash", stash)
      .handle("branch", branch)
      .handle("remote", remote)
  }),
)
