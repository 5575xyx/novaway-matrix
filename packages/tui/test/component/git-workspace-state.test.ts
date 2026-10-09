import { expect, test } from "bun:test"
import { deriveFileRows, deriveStatusRows, pickDefaultRemote } from "../../src/component/git-workspace/state"
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
