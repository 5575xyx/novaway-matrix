import { describe, expect, test } from "bun:test"
import {
  parseGitBranches,
  parseGitCommit,
  parseGitRemotes,
  parseGitStatus,
  parseGitStashList,
} from "../../src/util/git-status"

describe("git status 解析", () => {
  test("分支行:分支名 + 上游 + 领先/落后", () => {
    const result = parseGitStatus("## main...origin/main [ahead 2, behind 1]\n")
    expect(result.branch).toBe("main")
    expect(result.upstream).toBe("origin/main")
    expect(result.ahead).toBe(2)
    expect(result.behind).toBe(1)
    expect(result.entries).toHaveLength(0)
  })

  test("本地分支没有上游时只取名字", () => {
    const result = parseGitStatus("## feat/x\n")
    expect(result.branch).toBe("feat/x")
    expect(result.upstream).toBeUndefined()
    expect(result.ahead).toBe(0)
    expect(result.behind).toBe(0)
  })

  test("标准变更行:状态码 + 路径 + 暂存分组", () => {
    const result = parseGitStatus("## main\n M src/a.ts\nA  src/b.ts\n?? src/c.ts\n D src/d.ts\nMM src/e.ts\n")
    expect(result.entries).toEqual([
      { file: "src/a.ts", code: " M", status: "modified", staged: false, unstaged: true },
      { file: "src/b.ts", code: "A ", status: "added", staged: true, unstaged: false },
      { file: "src/c.ts", code: "??", status: "untracked", staged: false, unstaged: true },
      { file: "src/d.ts", code: " D", status: "deleted", staged: false, unstaged: true },
      // 两位都有内容:同一路径同时出现在两组里,和 lazygit 的分法一致
      { file: "src/e.ts", code: "MM", status: "modified", staged: true, unstaged: true },
    ])
  })

  test("带空格的路径不会被截断", () => {
    const result = parseGitStatus("## main\n M my docs/file name.md\n")
    expect(result.entries[0]!.file).toBe("my docs/file name.md")
  })

  test("重命名取新路径", () => {
    const result = parseGitStatus("## main\nR  old.ts -> new.ts\n")
    expect(result.entries[0]!.file).toBe("new.ts")
    expect(result.entries[0]!.status).toBe("renamed")
    expect(result.entries[0]!.staged).toBe(true)
  })

  test("空仓库的 No commits yet 分支行", () => {
    const result = parseGitStatus("## No commits yet on main\n")
    expect(result.branch).toBe("No commits yet on main")
  })

  test("提交行拆出 hash 和标题", () => {
    expect(parseGitCommit("abc1234 修复侧栏")).toEqual({ hash: "abc1234", subject: "修复侧栏" })
    expect(parseGitCommit("")).toBeUndefined()
  })
})

describe("git branch 解析", () => {
  test("当前分支带星号,其余是普通行", () => {
    const result = parseGitBranches("* main\n  dev\n  feat/git-panel\n")
    expect(result).toEqual([
      { name: "main", current: true },
      { name: "dev", current: false },
      { name: "feat/git-panel", current: false },
    ])
  })

  test("空输出和 detached 状态不炸", () => {
    expect(parseGitBranches("")).toEqual([])
    expect(parseGitBranches("* (HEAD detached at abc1234)\n")[0]!.current).toBe(true)
  })
})

describe("git stash list 解析", () => {
  test("拆出引用和说明", () => {
    const result = parseGitStashList("stash@{0}: WIP on main: abc1234 临时改动\nstash@{1}: On dev: xxx\n")
    expect(result).toEqual([
      { ref: "stash@{0}", message: "WIP on main: abc1234 临时改动" },
      { ref: "stash@{1}", message: "On dev: xxx" },
    ])
  })

  test("空输出返回空数组", () => {
    expect(parseGitStashList("")).toEqual([])
  })
})

describe("git remote 解析", () => {
  test("fetch/push 两行取一行,按名字去重", () => {
    const result = parseGitRemotes(
      "origin\thttps://github.com/x/y.git (fetch)\norigin\thttps://github.com/x/y.git (push)\ngithub\tgit@github.com:a/b.git (fetch)\n",
    )
    expect(result).toEqual([
      { name: "origin", url: "https://github.com/x/y.git" },
      { name: "github", url: "git@github.com:a/b.git" },
    ])
  })

  test("空输出返回空数组", () => {
    expect(parseGitRemotes("")).toEqual([])
  })
})
