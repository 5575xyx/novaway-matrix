import { describe, expect, test } from "bun:test"
import { decide, fromPlan, REVIEW, WRITE } from "@/team/policy"
import { CAPABILITIES } from "@/tool/registry"
import type * as Tool from "@/tool/tool"

const call = (tool: string, capabilities?: Tool.Capabilities, args: unknown = {}) => ({
  tool,
  capabilities,
  args,
})

describe("team policy", () => {
  test("a review run refuses tools that edit the workspace", () => {
    // 与 registry 的声明保持一致：edit/write/patch 都是破坏性的。
    expect(decide(REVIEW, call("edit", { destructive: true })).kind).toBe("deny")
    expect(decide(REVIEW, call("write", { destructive: true })).kind).toBe("deny")
    expect(decide(REVIEW, call("apply_patch", { destructive: true })).kind).toBe("deny")
    // 读工具与只读命令照常放行。
    expect(decide(REVIEW, call("read", { readOnly: true })).kind).toBe("allow")
    expect(decide(REVIEW, call("grep", { readOnly: true })).kind).toBe("allow")
    // shell 不拦：审查要靠跑测试产出证据（见 policy.ts 的边界说明）。
    expect(decide(REVIEW, call("bash", { readOnly: false })).kind).toBe("allow")
  })

  test("debugging cannot be laundered through a nested run or a directory switch", () => {
    // 用一次新的派发绕开策略，或者把会话搬到别处再写，都算借道升级。
    expect(decide(REVIEW, call("team_run")).kind).toBe("deny")
    expect(decide(REVIEW, call("workflow")).kind).toBe("deny")
    expect(decide(REVIEW, call("enter_worktree")).kind).toBe("deny")
    expect(decide(REVIEW, call("exit_worktree")).kind).toBe("deny")
  })

  test("destructive predicates are evaluated against the actual args", () => {
    // database_query 只有带 allowWrite 时才算破坏性。
    const query = { destructive: (_args: unknown) => true }
    expect(decide(REVIEW, call("database_query", query, { allowWrite: true })).kind).toBe("deny")
    const readOnlyQuery = { destructive: (args: unknown) => Boolean((args as { allowWrite?: boolean }).allowWrite) }
    expect(decide(REVIEW, call("database_query", readOnlyQuery, { sql: "select 1" })).kind).toBe("allow")
    // 判定函数抛错按破坏性处理：拿不准就拒绝。
    expect(
      decide(
        REVIEW,
        call("weird", {
          destructive: () => {
            throw new Error("boom")
          },
        }),
      ).kind,
    ).toBe("deny")
  })

  test("a run that explicitly allows writes is not restricted by the review rules", () => {
    expect(decide(WRITE, call("edit", { destructive: true })).kind).toBe("allow")
    expect(decide(WRITE, call("team_run")).kind).toBe("allow")
    // 缺策略按只读处理：放宽必须是显式的。
    expect(fromPlan(undefined)).toEqual(REVIEW)
    expect(fromPlan({})).toEqual(REVIEW)
    expect(fromPlan({ policy: { readOnly: false } })).toEqual(WRITE)
    // 拒绝理由要能告诉模型下一步怎么做。
    const denied = decide(REVIEW, call("edit", { destructive: true }))
    expect(denied.kind === "deny" && denied.reason).toContain("readOnly=false")
  })

  test("the policy rides on the real capability table, not on hand-written guesses", () => {
    // 策略能否挡住写操作，取决于 registry 里的能力声明。声明被改松时这里必须失败。
    for (const tool of ["edit", "write", "patch", "apply_patch", "notebook_edit"]) {
      expect({ tool, kind: decide(REVIEW, { tool, capabilities: CAPABILITIES[tool], args: {} }).kind }).toEqual({
        tool,
        kind: "deny",
      })
    }
    for (const tool of ["read", "glob", "grep", "webfetch", "lsp"]) {
      expect({ tool, kind: decide(REVIEW, { tool, capabilities: CAPABILITIES[tool], args: {} }).kind }).toEqual({
        tool,
        kind: "allow",
      })
    }
    // 数据库查询只有带 allowWrite 才算破坏性：声明是谓词，判定必须按参数走。
    expect(decide(REVIEW, { tool: "database_query", capabilities: CAPABILITIES.database_query, args: {} }).kind).toBe(
      "allow",
    )
    expect(
      decide(REVIEW, {
        tool: "database_query",
        capabilities: CAPABILITIES.database_query,
        args: { allowWrite: true },
      }).kind,
    ).toBe("deny")
  })

  describe("task scope (§11.1)", () => {
    const scoped = (paths: string[]) => ({ readOnly: false, paths, root: "/repo" })

    test("a declared scope only narrows writes, and says which path fell outside", () => {
      const inside = decide(scoped(["src/team"]), call("write", CAPABILITIES.write, { filePath: "/repo/src/team/a.ts" }))
      expect(inside.kind).toBe("allow")
      // 相对路径按团队目录解析：模型写的常常是相对路径。
      expect(decide(scoped(["src/team"]), call("edit", CAPABILITIES.edit, { filePath: "src/team/a.ts" })).kind).toBe(
        "allow",
      )
      const outside = decide(scoped(["src/team"]), call("write", CAPABILITIES.write, { filePath: "src/app/a.ts" }))
      expect(outside.kind).toBe("deny")
      if (outside.kind === "deny") {
        expect(outside.reason).toContain("src/team")
        expect(outside.reason).toContain("/repo/src/app/a.ts")
      }
    })

    test("prefix matching respects path boundaries", () => {
      // `src/teamwork` 不在 `src/team` 里：按字符串前缀判断会放行错的文件。
      expect(
        decide(scoped(["src/team"]), call("write", CAPABILITIES.write, { filePath: "/repo/src/teamwork/a.ts" })).kind,
      ).toBe("deny")
    })

    test("patches are checked by the files they touch", () => {
      const patch = (file: string) =>
        ["*** Begin Patch", "*** Update File: " + file, "@@ -1 +1 @@", "-a", "+b", "*** End Patch"].join(String.fromCharCode(10))
      expect(decide(scoped(["src/team"]), call("apply_patch", CAPABILITIES.apply_patch, { patchText: patch("src/team/a.ts") })).kind).toBe("allow")
      expect(decide(scoped(["src/team"]), call("apply_patch", CAPABILITIES.apply_patch, { patchText: patch("src/app/a.ts") })).kind).toBe("deny")
      // 解析不出来的补丁由工具自己拒绝；这里不额外拦一道。
      expect(decide(scoped(["src/team"]), call("apply_patch", CAPABILITIES.apply_patch, { patchText: "garbage" })).kind).toBe("allow")
    })

    test("reads are not narrowed: a reviewer must see the whole repository", () => {
      expect(decide(scoped(["src/team"]), call("read", CAPABILITIES.read, { filePath: "/repo/src/app/a.ts" })).kind).toBe(
        "allow",
      )
      // 看不到文件目标的工具（shell）不假装拦得住（边界见 policy.ts 文件头）。
      expect(decide(scoped(["src/team"]), call("bash", CAPABILITIES.bash, { command: "rm -rf x" })).kind).toBe("allow")
    })

    test("no declared scope means no narrowing, and a review run keeps its own rules", () => {
      expect(decide({ readOnly: false }, call("write", CAPABILITIES.write, { filePath: "/anywhere" })).kind).toBe("allow")
      // 只读在先：即使范围包含这个文件，只读运行也不许写。
      expect(decide({ readOnly: true, paths: ["src"], root: "/repo" }, call("write", CAPABILITIES.write, { filePath: "src/a.ts" })).kind).toBe(
        "deny",
      )
    })

    test("fromPlan carries the team's scope and the base directory", () => {
      expect(fromPlan({ policy: { readOnly: false } }, { scope: ["src"] }, "/repo")).toEqual({
        readOnly: false,
        paths: ["src"],
        root: "/repo",
      })
      // 没声明范围时不写多余字段：策略对象要能直接和 REVIEW / WRITE 比较。
      expect(fromPlan({ policy: { readOnly: false } }, undefined, "/repo")).toEqual({ readOnly: false })
    })
  })
})
