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
// 图谱要看得到分叉和历史：日志取多一些（面板里本来就有滚动）。
const LOG_LIMIT = 200
// 图谱里节点短哈希 + 父哈希都用 %h/%p，配合 tab 分隔解析。
const LOG_FORMAT = "%h%x09%s%x09%an%x09%ad%x09%p%x09%D"
// status 在大仓库里可能很大,给足上限避免截断后解析出脏数据。
const STATUS_MAX_BYTES = 4 * 1024 * 1024
const NUMSTAT_MAX_BYTES = 1 * 1024 * 1024
const LIST_MAX_BYTES = 256 * 1024
// push / pull 走网络,远端慢响应时耗时不可控,单独给一个宽松上限。
const NETWORK_TIMEOUT_MS = 5 * 60 * 1000

// "main...origin/main [ahead 2, behind 1]" / "(no branch)" / "No commits yet on main"
//
// 调用方直接传 `git status --porcelain=v1 --branch` 里那行原始文本（带 "## " 前缀），
// 所以这里自己剥前缀 —— 之前没剥，导致前端显示成 "## main"。
function parseBranchHeader(raw: string): BranchParts {
  const info: BranchParts = { ahead: 0, behind: 0 }
  const head = raw.startsWith("## ") ? raw.slice(3) : raw
  const bracket = head.indexOf("[")
  const body = (bracket === -1 ? head : head.slice(0, bracket)).trim()
  // 空仓库（还没有第一次提交）时 git 给的是 "No commits yet on main" /
  // 老版本 "Initial commit on main"。整串直接当分支名塞给前端的话，
  // 分支行会显示成一句英文句子，新建分支后也看不出切没切过去。
  const unborn = /^(?:No commits yet on|Initial commit on)\s+(.+)$/i.exec(body)
  const normalized = unborn ? unborn[1]!.trim() : body
  const sep = normalized.indexOf("...")
  if (sep === -1) {
    info.branch = normalized || undefined
  } else {
    info.branch = normalized.slice(0, sep).trim() || undefined
    const upstream = normalized.slice(sep + 3).trim()
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
  const items = text.split("\0")
  const put = (file: string, additionsRaw: string, deletionsRaw: string) => {
    if (!file) return
    stats.set(file, {
      additions: count(additionsRaw),
      deletions: count(deletionsRaw),
      binary: additionsRaw === "-" || deletionsRaw === "-",
    })
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (!item) continue
    const a = item.indexOf("\t")
    const b = item.indexOf("\t", a + 1)
    if (a === -1 || b === -1) continue
    const additionsRaw = item.slice(0, a)
    const deletionsRaw = item.slice(a + 1, b)
    const raw = item.slice(b + 1)

    // `-z` 输出里重命名是「add/del + 空路径 + 旧/新路径」：第三段为空，
    // 紧接着两项分别是旧/新路径。不处理会把重命名文件整体丢掉。
    if (raw === "") {
      const next = items[index + 2]
      index += 2
      put(next ?? "", additionsRaw, deletionsRaw)
      continue
    }

    put(renameTarget(raw), additionsRaw, deletionsRaw)
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
    // %p 是空格分隔的父提交；%D 是 ", " 分隔的引用（HEAD -> main、tag: v1、origin/main）。
    const parents = (parts[4] ?? "").trim().split(/\s+/).filter(Boolean)
    const refs = (parts[5] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    return [
      {
        hash,
        subject,
        author: parts[2] ?? "",
        date: parts[3] ?? "",
        ...(parents.length > 0 ? { parents } : {}),
        ...(refs.length > 0 ? { refs } : {}),
      },
    ]
  })
}

// 前置条件不满足时直接失败。用 return 收尾,TypeScript 才知道后面不用再兜 undefined。
const badRequest = (message: string) => new ApiGitError({ name: "GitError", data: { message } })

export const gitHandlers = HttpApiBuilder.group(InstanceHttpApi, "git", (handlers) =>
  Effect.gen(function* () {
    const git = yield* Git.Service

    const gitError = Effect.fnUntraced(function* (args: string[], result: Git.Result) {
      const timedOut = result.timedOut ? `git ${args[0]} 执行超时,已终止` : ""
      // 去掉 "fatal:" 前缀：这句原文会直接进 toast 描述，带前缀像在报错栈。
      const stderr = result.stderr
        .toString("utf8")
        .trim()
        .replace(/^fatal:\s*/i, "")
      return yield* badRequest(stderr || timedOut || `git ${args[0]} 执行失败`)
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
            [
              "log",
              "-n",
              String(LOG_LIMIT),
              `--format=${LOG_FORMAT}`,
              "--date=short",
              // 图谱要能看出分支：只看当前分支会是一条直线。
              // --topo-order 保证同一分支的提交连续出现，画出来的泳道才不跳。
              "--branches",
              "--remotes",
              "--tags",
              "--topo-order",
            ],
            LIST_MAX_BYTES,
          ),
        ],
        { concurrency: "unbounded" },
      )

      const branchInfo = parseBranchHeader(statusOut.split("\0").find((line) => line.startsWith("## ")) ?? "")
      const branches = [...parseBranches(branchOut)]
      // 空仓库里 `git branch` 什么都不返回（引用还没被创建），但当前分支是存在的
      // （HEAD 指向 refs/heads/<name>，只是还没有提交）。不补这一条，前端的切换分支
      // 菜单就是空的 —— 刚新建完分支看着像"没反应"。
      if (branchInfo.branch && !branches.some((item) => item.name === branchInfo.branch)) {
        branches.push({ name: branchInfo.branch, current: true })
      }
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
        branches,
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
      // 空仓库没有 HEAD，`reset HEAD --` 会报 "ambiguous argument 'HEAD'"。
      // 这种情况下把文件从索引里摘掉即可（等价于取消暂存）。
      const head = yield* git.run(["rev-parse", "--verify", "HEAD"], { cwd })
      if (head.exitCode === 0) {
        yield* run(cwd, ["reset", "--quiet", "HEAD", "--", ...ctx.payload.files])
      } else {
        yield* run(cwd, ["rm", "--cached", "--quiet", "-r", "--", ...ctx.payload.files])
      }
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
      //
      // `diff --cached --quiet`: 0 = 索引里没有暂存内容, 1 = 有暂存内容。
      // 之前的判断写反了（`=== 1` 时才 add），于是"改了文件直接点提交"永远
      // 得到 "nothing added to commit" —— 面板只会弹一句模糊的失败。
      const quiet = yield* git.run(["diff", "--cached", "--quiet"], { cwd })
      if (quiet.exitCode !== 1) yield* run(cwd, ["add", "-A"])
      const result = yield* git.run(["commit", "-m", message], { cwd, maxOutputBytes: LIST_MAX_BYTES })
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString("utf8") + result.text()
        // 没配提交身份是首次提交最常见的失败：git 只会甩一段英文，用户完全不知道
        // 该做什么。翻译成一句可操作的提示。
        if (/Please tell me who you are|empty ident name|unable to auto-detect email|not configured/i.test(stderr)) {
          return yield* badRequest(
            '还没有配置 Git 提交身份：请先执行 git config --global user.name "你的名字" 和 git config --global user.email "you@example.com"',
          )
        }
        if (/nothing (?:added )?to commit|no changes added to commit|no changes added/i.test(stderr)) {
          return yield* badRequest("没有可提交的更改")
        }
        return yield* gitError(["commit"], result)
      }
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

    const fetch = Effect.fn("GitHttpApi.fetch")(function* () {
      const cwd = yield* directory()
      const remotes = (yield* text(cwd, ["remote"], LIST_MAX_BYTES))
        .split(String.fromCharCode(10))
        .map((line) => line.split(String.fromCharCode(13)).join("").trim())
        .filter(Boolean)
      if (remotes.length === 0) return yield* badRequest("没有配置远程仓库,先添加一个 remote")
      yield* run(cwd, ["fetch", "--all", "--prune"], NETWORK_TIMEOUT_MS)
      return yield* snapshot(cwd)
    })

    const merge = Effect.fn("GitHttpApi.merge")(function* (ctx: { payload: { ref: string; noFastForward?: boolean } }) {
      const cwd = yield* directory()
      const ref = ctx.payload.ref.trim()
      if (!ref) return yield* badRequest("要合并的分支不能为空")
      // --no-edit 让 merge 在需要时复用默认提交说明，避免卡在编辑器里。
      yield* run(
        cwd,
        ["merge", "--no-edit", ...(ctx.payload.noFastForward ? ["--no-ff"] : []), ref],
        NETWORK_TIMEOUT_MS,
      )
      return yield* snapshot(cwd)
    })

    const commitDetail = Effect.fn("GitHttpApi.commitDetail")(function* (ctx: { params: { hash: string } }) {
      const cwd = yield* directory()
      const hash = ctx.params.hash.trim()
      if (!/^[0-9a-fA-F]{4,40}$/.test(hash)) return yield* badRequest("提交哈希不合法")
      const NUL = String.fromCharCode(0)
      const meta = yield* text(
        cwd,
        ["show", "-s", "--format=%H%x00%s%x00%b%x00%an%x00%ae%x00%ad%x00%p%x00%D", "--date=short", hash],
        LIST_MAX_BYTES,
      )
      const [full, subject, body, author, authorEmail, date, parents, refs] = meta
        .split(NUL)
        .map((item: string) => item.trim())
      // 改动文件用 `--numstat -z` 取：`parseNumstat` 按 NUL 分隔解析，
      // 之前少了 `-z`，多行输出会被当成一个"文件"，表现为「改动文件 (1)」
      // 且文件名把好几个路径连在一起。
      // 合并提交对第一个父提交做 diff —— 这才是「这次合并带进来了什么」，
      // 否则 git show 对 merge 什么都不输出。
      const list = (parents ?? "").split(" ").filter(Boolean)
      const numstat = yield* text(
        cwd,
        list.length > 1
          ? ["diff", "--numstat", "-z", list[0], hash]
          : ["show", "--numstat", "--format=", "--root", "-z", hash],
        NUMSTAT_MAX_BYTES,
      )
      const stats = parseNumstat(numstat)
      return {
        hash: full || hash,
        subject: subject ?? "",
        body: body ?? "",
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        date: date ?? "",
        parents: (parents ?? "").split(" ").filter(Boolean),
        refs: (refs ?? "")
          .split(",")
          .map((item: string) => item.trim())
          .filter(Boolean),
        files: Array.from(stats.entries()).map(([file, value]) => ({ file, ...value })),
      }
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
      if (ctx.payload.remove) {
        yield* run(cwd, ["branch", "-d", name])
      } else if (ctx.payload.create) {
        // 只有「确实存在同名 remote」时才当成远端跟踪分支来建（origin/feature → 本地 feature）。
        // 以前只看到名字里有 "/" 就按远端处理，于是普通的多级分支名（feature/hello）会被拆成
        // `checkout -b hello --track feature/hello`，在空仓库里报
        // "not a commit and a branch 'hello' cannot be created from it" —— 用户点了新建毫无反应。
        const remoteNames = (yield* text(cwd, ["remote"], LIST_MAX_BYTES))
          .split(String.fromCharCode(10))
          .map((line) => line.split(String.fromCharCode(13)).join("").trim())
          .filter(Boolean)
        const slash = name.indexOf("/")
        const remoteName = slash > 0 ? name.slice(0, slash) : ""
        const trackingRemote = remoteName !== "" && remoteNames.includes(remoteName)
        if (trackingRemote && slash < name.length - 1) {
          yield* run(cwd, ["checkout", "-b", name.slice(slash + 1), "--track", name])
        } else {
          // 空仓库（还没有第一次提交）里 `git branch <name>` 会失败，但 `checkout -b` 可用：
          // 它把 HEAD 指到新的 ref 上，第一次提交就落在新分支。这也正是用户点「新建」时期望的结果。
          yield* run(cwd, ["checkout", "-b", name])
        }
      } else {
        yield* run(cwd, ["checkout", name])
      }
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
      .handle("fetch", fetch)
      .handle("merge", merge)
      .handle("commitDetail", commitDetail)
      .handle("stash", stash)
      .handle("branch", branch)
      .handle("remote", remote)
  }),
)
