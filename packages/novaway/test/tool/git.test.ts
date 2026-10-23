import { describe, expect, test } from "bun:test"
import { gitArgs } from "@/tool/git"

describe("git tool arguments", () => {
  test("builds read-only commands", () => {
    expect(gitArgs({ action: "status" })).toEqual(["status", "--short", "--branch"])
    expect(gitArgs({ action: "diff" })).toEqual(["diff", "--no-color"])
    expect(gitArgs({ action: "diff", staged: true })).toEqual(["diff", "--cached", "--no-color"])
    expect(gitArgs({ action: "log", limit: 5 })).toEqual(["log", "--oneline", "--decorate", "-n", "5"])
    expect(gitArgs({ action: "branches" })).toEqual(["branch", "--all", "--verbose", "--no-color"])
  })

  test("defaults log to 20 commits", () => {
    expect(gitArgs({ action: "log" })).toContain("20")
  })

  test("stages everything when no files are given", () => {
    expect(gitArgs({ action: "add" })).toEqual(["add", "-A"])
    expect(gitArgs({ action: "add", files: ["a.ts", "b.ts"] })).toEqual(["add", "a.ts", "b.ts"])
  })

  test("commits with the provided message", () => {
    expect(gitArgs({ action: "commit", message: "feat: x" })).toEqual(["commit", "-m", "feat: x"])
  })

  test("checks out existing and new branches", () => {
    expect(gitArgs({ action: "checkout", branch: "main" })).toEqual(["checkout", "main"])
    expect(gitArgs({ action: "checkout", branch: "feat", create: true })).toEqual(["checkout", "-b", "feat"])
  })

  test("pushes and pulls with an explicit remote and branch", () => {
    expect(gitArgs({ action: "push" })).toEqual(["push", "origin"])
    expect(gitArgs({ action: "push", remote: "upstream", branch: "main" })).toEqual(["push", "upstream", "main"])
    expect(gitArgs({ action: "pull", branch: "dev" })).toEqual(["pull", "origin", "dev"])
  })

  test("stashes including untracked files", () => {
    expect(gitArgs({ action: "stash", message: "wip" })).toEqual(["stash", "push", "-u", "-m", "wip"])
    expect(gitArgs({ action: "stash" })).toContain("-u")
  })

  test("returns no arguments for an unknown action", () => {
    expect(gitArgs({ action: "rebase" })).toEqual([])
  })
})
