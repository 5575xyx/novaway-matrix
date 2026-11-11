import { describe, expect, test } from "bun:test"
import {
  findRevealRowIndex,
  resolveWorkspaceTreeDirectory,
  workspaceTreeArrowAction,
  workspaceDirectoryAncestors,
  workspaceTreeName,
} from "./workspace-file-tree-helpers"

describe("workspace file tree helpers", () => {
  test("routed workspace wins over its project root, including sandbox paths", () => {
    expect(resolveWorkspaceTreeDirectory("/repo/.sandboxes/task", "/repo")).toBe("/repo/.sandboxes/task")
    expect(resolveWorkspaceTreeDirectory("", "/repo")).toBe("/repo")
    expect(resolveWorkspaceTreeDirectory("", undefined)).toBe("")
  })

  test("ancestors include every parent directory, excluding the target", () => {
    expect(workspaceDirectoryAncestors("packages/app/src/index.ts")).toEqual([
      "packages",
      "packages/app",
      "packages/app/src",
    ])
    expect(workspaceDirectoryAncestors("AGENTS.md")).toEqual([])
    expect(workspaceDirectoryAncestors("a\\b\\c.ts")).toEqual(["a", "a/b"])
  })

  test("reveal index matches normal and compacted rows", () => {
    const rows = [
      { entry: { path: "docs" } },
      { entry: { path: "packages/app" }, compactedPaths: ["packages", "packages/app", "packages/app/src"] },
      { entry: { path: "AGENTS.md" } },
    ]
    expect(findRevealRowIndex(rows, "AGENTS.md")).toBe(2)
    expect(findRevealRowIndex(rows, "packages/app/src")).toBe(1)
    expect(findRevealRowIndex(rows, "packages/app/src/deep.ts")).toBe(-1)
    expect(findRevealRowIndex(rows, "missing.ts")).toBe(-1)
  })

  test("arrow keys follow tree expansion and parent-child navigation", () => {
    expect(workspaceTreeArrowAction({ key: "ArrowRight", isDirectory: true, expanded: false })).toBe("expand")
    expect(workspaceTreeArrowAction({ key: "ArrowRight", isDirectory: true, expanded: true })).toBe("focus-child")
    expect(workspaceTreeArrowAction({ key: "ArrowRight", isDirectory: false, expanded: false })).toBe("none")
    expect(workspaceTreeArrowAction({ key: "ArrowLeft", isDirectory: true, expanded: true })).toBe("collapse")
    expect(workspaceTreeArrowAction({ key: "ArrowLeft", isDirectory: true, expanded: false })).toBe("focus-parent")
    expect(workspaceTreeArrowAction({ key: "ArrowLeft", isDirectory: false, expanded: false })).toBe("focus-parent")
  })

  test("workspace name falls back when the directory is empty", () => {
    expect(workspaceTreeName("E:\\repo\\novaway-coder", "Files")).toBe("novaway-coder")
    expect(workspaceTreeName("/home/repo/", "Files")).toBe("repo")
    expect(workspaceTreeName("", "Files")).toBe("Files")
  })
})
