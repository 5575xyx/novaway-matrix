import { describe, expect, test } from "bun:test"
import { decide, fromPlan, REVIEW, WRITE } from "@/team/policy"
import { CAPABILITIES } from "@/tool/registry"

const call = (tool: string, capabilities?: { readOnly?: boolean; destructive?: boolean }, args: unknown = {}) => ({
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
})
