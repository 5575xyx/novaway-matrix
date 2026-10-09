import { afterAll, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "fs"
import os from "os"
import path from "path"
import {
  deriveFileRows,
  deriveStatusRows,
  loadWorkspace,
  pickDefaultRemote,
} from "../../src/component/git-workspace/state"
import type { GitNumstatEntry, GitRemote, GitStatusSummary } from "../../src/util/git-status"

const status: GitStatusSummary = {
  branch: "main",
  upstream: "origin/main",
  ahead: 91,
  behind: 0,
  entries: [
    { file: "a.ts", code: "M ", status: "modified", staged: true, unstaged: false },
    { file: "b.ts", code: " M", status: "modified", staged: false, unstaged: true },
    { file: "c.ts", code: "??", status: "untracked", staged: false, unstaged: true },
  ],
}

const numstat: GitNumstatEntry[] = [
  { file: "a.ts", added: 10, removed: 2, binary: false },
  { file: "b.ts", added: 5, removed: 3, binary: false },
]

test("pickDefaultRemote 优先 origin", () => {
  const remotes: GitRemote[] = [
    { name: "github", url: "https://github.com/x/y.git" },
    { name: "origin", url: "https://gitee.com/x/y.git" },
  ]
  expect(pickDefaultRemote(remotes)?.name).toBe("origin")
})

test("pickDefaultRemote 没有 origin 时取第一个", () => {
  const remotes: GitRemote[] = [
    { name: "github", url: "https://github.com/x/y.git" },
    { name: "gitee", url: "https://gitee.com/x/y.git" },
  ]
  expect(pickDefaultRemote(remotes)?.name).toBe("github")
})

test("pickDefaultRemote 空列表返回 undefined", () => {
  expect(pickDefaultRemote([])).toBeUndefined()
})

test("deriveStatusRows 领先计数拼进分支行", () => {
  const row = deriveStatusRows(status, numstat, []).find((r) => r.kind === "branch")
  expect(row?.count).toBe("↑91")
})

test("deriveStatusRows 落后时显示 ↓", () => {
  const rows = deriveStatusRows({ ...status, ahead: 0, behind: 3 }, [], [])
  expect(rows.find((r) => r.kind === "branch")?.count).toBe("↓3")
})

test("deriveStatusRows 领先和落后都有时两个都显示", () => {
  const rows = deriveStatusRows({ ...status, ahead: 2, behind: 5 }, [], [])
  expect(rows.find((r) => r.kind === "branch")?.count).toBe("↑2 ↓5")
})

test("deriveStatusRows 没有领先/落后时不显示计数", () => {
  const rows = deriveStatusRows({ ...status, ahead: 0, behind: 0 }, [], [])
  expect(rows.find((r) => r.kind === "branch")?.count).toBeUndefined()
})

test("deriveStatusRows 变更行合并 numstat 的加删行数", () => {
  const row = deriveStatusRows(status, numstat, []).find((r) => r.kind === "changes")
  expect(row?.detail).toBe("3 个文件")
  expect(row?.count).toBe("+15 -5")
})

test("deriveStatusRows 远程行用选中的那个远端名", () => {
  const remotes: GitRemote[] = [{ name: "github", url: "https://gitee.com/x/y.git" }]
  const rows = deriveStatusRows(status, numstat, remotes, remotes[0])
  expect(rows.find((r) => r.kind === "remote")?.detail).toBe("github")
})

test("deriveStatusRows 没有远端时显示未配置远端", () => {
  const rows = deriveStatusRows(status, numstat, [])
  expect(rows.find((r) => r.kind === "remote")?.detail).toBe("未配置远端")
})

test("deriveStatusRows 提示行区分干净/有改动/不在仓库", () => {
  expect(deriveStatusRows(status, [], []).find((r) => r.kind === "hint")?.detail).toBe("有未提交的改动")
  expect(deriveStatusRows({ ...status, entries: [] }, [], []).find((r) => r.kind === "hint")?.detail).toBe("工作区干净")
  expect(deriveStatusRows({ ahead: 0, behind: 0, entries: [] }, [], []).find((r) => r.kind === "hint")?.detail).toBe(
    "不是 git 仓库",
  )
})

test("deriveStatusRows git 报错时提示行透出真实原因,不猜成不是仓库", () => {
  const rows = deriveStatusRows(status, [], [], undefined, "git 执行超时")
  expect(rows.find((r) => r.kind === "hint")?.detail).toBe("git 执行超时")
})

test("已暂存但工作区干净的文件也算有改动", () => {
  // 只看 unstaged 位会漏掉 `git add` 之后的文件 —— 那时「变更」行说「1 个文件」,
  // 「提示」行却说「工作区干净」,同一个面板自相矛盾。
  const stagedOnly: GitStatusSummary = {
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [{ file: "a.ts", code: "A ", status: "added", staged: true, unstaged: false }],
  }
  expect(deriveStatusRows(stagedOnly, [], []).find((r) => r.kind === "hint")?.detail).toBe("有未提交的改动")
})

test("分支与远程分叉时提示 diverged,且排在有改动之前", () => {
  // push 会被拒、pull 会冲突 —— 这是阻塞态,比「有未提交改动」更该先被看见。
  const rows = deriveStatusRows({ ...status, entries: [], ahead: 2, behind: 5 }, [], [])
  expect(rows.find((r) => r.kind === "hint")?.detail).toBe("分支与远程 diverged")
})

test("空仓库与 detached 都算不在分支上,不把 git 原文串进中文界面", () => {
  const empty: GitStatusSummary = { branch: "No commits yet on main", ahead: 0, behind: 0, entries: [] }
  expect(deriveStatusRows(empty, [], []).find((r) => r.kind === "branch")?.detail).toBe("(不在分支上)")
  expect(deriveStatusRows(empty, [], []).find((r) => r.kind === "hint")?.detail).toBe("不是 git 仓库")

  const detached: GitStatusSummary = { branch: "(HEAD detached at 9a191fb)", ahead: 0, behind: 0, entries: [] }
  expect(deriveStatusRows(detached, [], []).find((r) => r.kind === "branch")?.detail).toBe("(不在分支上)")
})

test("deriveFileRows 同文件两份 numstat 取工作区侧", () => {
  // 「工作区改了 + 暂存区也改了」的文件在 numstat 里有两份。工作区一文件一行,
  // 只能取一份 —— concat 顺序是暂存区在前、工作区在后,Map 后者覆盖前者,所以取到工作区侧。
  const both: GitStatusSummary = {
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [{ file: "m.ts", code: "MM", status: "modified", staged: true, unstaged: true }],
  }
  const twoNumstat: GitNumstatEntry[] = [
    { file: "m.ts", added: 10, removed: 2, binary: false },
    { file: "m.ts", added: 5, removed: 3, binary: false },
  ]
  expect(deriveFileRows(both, twoNumstat)[0]?.count).toBe("+5 -3")
})

test("deriveFileRows 每个文件一行,带中文状态词与加删行数", () => {
  const a = deriveFileRows(status, numstat).find((r) => r.file === "a.ts")
  expect(a?.label).toBe("已改")
  expect(a?.count).toBe("+10 -2")
})

test("deriveFileRows 未跟踪文件没有 numstat 就不显示行数", () => {
  const c = deriveFileRows(status, numstat).find((r) => r.file === "c.ts")
  expect(c?.label).toBe("未跟踪")
  expect(c?.count).toBeUndefined()
})

test("deriveFileRows 新增/删除/重命名也用中文", () => {
  const s: GitStatusSummary = {
    branch: "main",
    ahead: 0,
    behind: 0,
    entries: [
      { file: "n.ts", code: "A ", status: "added", staged: true, unstaged: false },
      { file: "o.ts", code: " D", status: "deleted", staged: false, unstaged: true },
      { file: "r.ts", code: "R ", status: "renamed", staged: true, unstaged: false },
    ],
  }
  expect(deriveFileRows(s, []).map((r) => r.label)).toEqual(["新增", "删除", "重命名"])
})

// 下面两个起真 git 子进程,所以造真目录 —— 口径照抄 test/component/git-branch-row.test.tsx:
// 「面板自己起真 git 子进程,所以测试直接造一个真仓库 —— 造不出来的那一档就该红」。
// loadWorkspace 是本任务唯一的非纯函数,不钉住它,「status 硬依赖、其余各自降级」
// 这条核心设计声明就只是写在注释里的一句话。

const tmpDirs: string[] = []
function tmpGitDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

const exec = promisify(execFile)
const git = (root: string, args: string[]) =>
  exec("git", ["-c", "user.email=tui@example.com", "-c", "user.name=tui", ...args], { cwd: root })

test("loadWorkspace 非仓库目录:error 透出中文,不露 git 英文原文", async () => {
  const data = await loadWorkspace(tmpGitDir("nw-ws-norepo-"))
  expect(data.error).toBe("不是 git 仓库")
  expect(data.branches).toEqual([])
  expect(data.commits).toEqual([])
  expect(data.remotes).toEqual([])
  // 提示行直接吃这个 error,不该再猜一遍成别的文案。
  const hint = deriveStatusRows(data.status, data.numstat, data.remotes, undefined, data.error).find(
    (r) => r.kind === "hint",
  )
  expect(hint?.detail).toBe("不是 git 仓库")
})

test("loadWorkspace 空仓库:无提交、不报错、分支不当成真分支名", async () => {
  // 新仓库里 `git log` 必失败(还没有任何提交)—— 这正是「status 硬依赖、其余各自降级」
  // 要覆盖的路径:log 挂了不该让整个工作区白屏。
  const dir = tmpGitDir("nw-ws-empty-")
  await git(dir, ["init", "-b", "main"])
  const data = await loadWorkspace(dir)
  expect(data.error).toBeUndefined()
  expect(data.commits).toEqual([])
  expect(data.stash).toEqual([])
  // git 不用 `git branch` 列未出生的分支 —— 空仓库里分支面板就是空的,这是真实行为,
  // 不是解析漏了。状态行的「分支」才是此刻唯一能看到 `main` 的地方(且按上一条落成「不在分支上」)。
  expect(data.branches).toEqual([])
  // git 在空仓库里把分支行报成 `No commits yet on main`,不是 `main`。
  // 原文进中文界面是噪音,派生后应落到「(不在分支上)」。
  expect(data.status.branch).toBe("No commits yet on main")
  const branch = deriveStatusRows(data.status, data.numstat, data.remotes, undefined, data.error).find(
    (r) => r.kind === "branch",
  )
  expect(branch?.detail).toBe("(不在分支上)")
})
