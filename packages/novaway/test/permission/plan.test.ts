import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Global } from "@novaway/core/global"
import {
  isPlanWrite,
  isReadOnlyShell,
  planDirectories,
  planFile,
  planVerdict,
  planWriteTargets,
} from "@/permission/plan"

const root = path.resolve("/work/project")
const instance = { directory: root, worktree: root }

describe("plan mode write allowlist", () => {
  test("only markdown inside a plan directory counts as a plan write", () => {
    expect(isPlanWrite([path.join(".novaway", "plans", "feature.md")], instance)).toBe(true)
    // Non-markdown or outside the plan directory is still a normal write.
    expect(isPlanWrite([path.join(".novaway", "plans", "feature.txt")], instance)).toBe(false)
    expect(isPlanWrite([path.join("src", "index.ts")], instance)).toBe(false)
    expect(isPlanWrite([], instance)).toBe(false)
  })

  // 工具传的相对 pattern 是按「会话目录」算的，会话跑在子目录/worktree 时基准与
  // 计划目录不一致。`metadata.filepath` 是绝对路径，判定要以它为准。
  test("accepts the absolute plan file the write tools hand over", () => {
    const planPath = path.join(root, ".novaway", "plans", "1700000000000-fix.md")
    expect(isPlanWrite([planPath], instance)).toBe(true)
    // 绝对路径也必须落在计划目录里：边界不放宽。
    expect(isPlanWrite([path.join(root, "src", "index.md")], instance)).toBe(false)
    // 相对基准错位时，相对 pattern 会落到计划目录外 —— 这正是要靠绝对路径兜底的场景。
    const child = path.join(root, "packages", "app")
    expect(isPlanWrite(["plans/x.md"], { directory: child, worktree: root })).toBe(false)
    expect(isPlanWrite([planPath], { directory: child, worktree: root })).toBe(true)
  })

  test("an active session can only update its own plan file", () => {
    const current = path.join(root, ".novaway", "plans", "1700000000000-fix.md")
    expect(isPlanWrite([current], instance, current)).toBe(true)
    expect(isPlanWrite([path.join(root, ".novaway", "plans", "other.md")], instance, current)).toBe(false)
    expect(
      planVerdict({
        permission: "edit",
        patterns: [".novaway/plans/other.md"],
        metadata: {},
        instance,
        planPath: current,
      }).allowed,
    ).toBe(false)
  })

  test("plan file path matches the session plan layout", () => {
    expect(planFile({ slug: "fix-plan", created: 1699 }, instance)).toBe(
      path.join(root, ".novaway", "plans", "1699-fix-plan.md"),
    )
  })

  test("prefers the absolute filepath and ignores joined relative lists", () => {
    const absolute = path.join(root, ".novaway", "plans", "p.md")
    expect(planWriteTargets({ patterns: ["plans/x.md"], metadata: { filepath: absolute } })).toEqual([absolute])
    // apply_patch 把多个相对路径拼成一个字符串，不能当绝对路径用 —— 退回 patterns，
    // 让"每个目标都必须是计划文件"的判定照常生效。
    expect(planWriteTargets({ patterns: ["a.md", "b.md"], metadata: { filepath: "a.md, b.md" } })).toEqual([
      "a.md",
      "b.md",
    ])
    expect(planWriteTargets({ patterns: ["src/a.ts"], metadata: {} })).toEqual(["src/a.ts"])
    expect(
      planWriteTargets({
        patterns: [".novaway/plans/a.md", ".novaway/plans/b.md"],
        metadata: { filepaths: [path.join(root, ".novaway", "plans", "a.md"), path.join(root, "src", "b.ts")] },
      }),
    ).toEqual([path.join(root, ".novaway", "plans", "a.md"), path.join(root, "src", "b.ts")])
  })

  test("resolves the absolute data plan directory", () => {
    const [project, data] = planDirectories(instance)
    expect(project).toBe(path.join(root, ".novaway", "plans"))
    expect(data).toBe(path.join(Global.Path.data, "plans"))
    expect(isPlanWrite([path.join(data, "p.md")], instance)).toBe(true)
  })

  test("every path in a multi-file write must be a plan file", () => {
    expect(
      isPlanWrite([path.join(".novaway", "plans", "a.md"), path.join(".novaway", "plans", "b.md")], instance),
    ).toBe(true)
    expect(isPlanWrite([path.join(".novaway", "plans", "a.md"), path.join("src", "a.ts")], instance)).toBe(false)
  })
})

describe("plan mode read-only shell", () => {
  test("common read commands are allowed", () => {
    expect(isReadOnlyShell(["ls -la"])).toBe(true)
    expect(isReadOnlyShell(["cat package.json"])).toBe(true)
    expect(isReadOnlyShell(['rg "TODO" src'])).toBe(true)
    expect(isReadOnlyShell(["git status"])).toBe(true)
    expect(isReadOnlyShell(["git diff HEAD~1"])).toBe(true)
    expect(isReadOnlyShell(["node -v"])).toBe(true)
    expect(isReadOnlyShell(["npm ls"])).toBe(true)
    // A pipeline is split into one pattern per command.
    expect(isReadOnlyShell(["cat a.txt", "grep hello"])).toBe(true)
  })

  test("write commands are refused", () => {
    expect(isReadOnlyShell(["rm -rf node_modules"])).toBe(false)
    expect(isReadOnlyShell(["git commit -m x"])).toBe(false)
    expect(isReadOnlyShell(["git push"])).toBe(false)
    expect(isReadOnlyShell(["npm install"])).toBe(false)
    expect(isReadOnlyShell(["mkdir build"])).toBe(false)
    expect(isReadOnlyShell(["sed -i s/a/b/ file"])).toBe(false)
  })

  // `git config` 能写 `.git/config`：`core.hooksPath` 指到攻击者路径后，
  // 后续任何 git 命令都会执行任意代码。这是"只读命令"升级成"任意代码执行"的
  // 最短路径，所以 `config` 不在 SAFE_GIT 里。
  test("git config is not treated as read-only", () => {
    expect(isReadOnlyShell(["git config core.hooksPath /tmp/evil"])).toBe(false)
    expect(isReadOnlyShell(["git config --global core.hooksPath /tmp/evil"])).toBe(false)
    // 防过度收紧：真正的只读子命令照常放行。
    expect(isReadOnlyShell(["git status"])).toBe(true)
  })

  test("redirection and command substitution are refused", () => {
    expect(isReadOnlyShell(["echo hi > file.txt"])).toBe(false)
    expect(isReadOnlyShell(["cat a >> b"])).toBe(false)
    expect(isReadOnlyShell(["echo $(rm -rf /)"])).toBe(false)
    expect(isReadOnlyShell(["echo `whoami`"])).toBe(false)
  })

  test("arbitrary code execution is refused", () => {
    expect(isReadOnlyShell(["node -e \"require('fs').writeFileSync('x','y')\""])).toBe(false)
    expect(isReadOnlyShell(["python script.py"])).toBe(false)
    expect(isReadOnlyShell(["curl -o out.json https://example.com"])).toBe(false)
    expect(isReadOnlyShell(["curl https://example.com"])).toBe(true)
  })

  test("mixed pipelines require every command to be read-only", () => {
    expect(isReadOnlyShell(["cat a.txt", "tee b.txt"])).toBe(false)
  })
})

/**
 * 计划模式的裁决必须在规则集之前单独发生（`Permission.ask` 里 `mode === "plan"`
 * 分支）。这里钉住裁决本身：真实权限名一个都不能漏 —— 漏掉的名字在
 * `"*": "allow"` 的默认规则集下就是**静默执行**。
 */
describe("plan mode verdict", () => {
  const ask = (permission: string, patterns: readonly string[]) =>
    planVerdict({ permission, patterns, metadata: {}, instance })

  test("real shell permission names are gated by the read-only check", () => {
    // shell 工具对外的权限名是 bash（Windows 分支是 powershell），不是历史上的 shell。
    for (const permission of ["bash", "powershell", "shell"]) {
      expect(ask(permission, ["rm -rf src"]).allowed).toBe(false)
      expect(ask(permission, ["git status"]).allowed).toBe(true)
    }
  })

  test("writes outside the plan directory are refused with the plan file hint", () => {
    const denied = ask("edit", ["src/index.ts"])
    expect(denied.allowed).toBe(false)
    if (denied.allowed) return
    expect(denied.kind).toBe("write")
    expect(denied.reason).toContain("Plan mode is read-only")
    expect(ask("edit", [path.join(".novaway", "plans", "p.md")]).allowed).toBe(true)
  })

  test("read-only permissions stay in the normal flow", () => {
    for (const permission of [
      "read",
      "glob",
      "grep",
      "websearch",
      "webfetch",
      "todowrite",
      "question",
      "plan_exit",
    ]) {
      expect(ask(permission, ["*"]).allowed).toBe(true)
    }
  })

  /**
   * 计划目录有两个：`<planRoot>/.novaway/plans` 与 `Global.Path.data/plans`，
   * 后者在**工作区之外**。写全局计划时 `edit` / `apply_patch` / `glob` / `shell`
   * 会先 `ctx.ask({ permission: "external_directory" })`（如 `tool/edit.ts:89`）：
   * 如果计划模式在这一层就拒，合法的全局计划目录照样写不进去 —— 又变成
   * "要求写计划却写不了"。所以它必须交给规则集（默认 `"*": "ask"`，用户仍能把关）。
   */
  test("external_directory is not decided by plan mode", () => {
    expect(ask("external_directory", ["*"]).allowed).toBe(true)
  })

  test("research browser reads are allowed but interactions are refused", () => {
    for (const action of ["snapshot", "tabs", "status", "console", "network", "accessibility", "screenshot"]) {
      expect(ask("browser", [action]).allowed).toBe(true)
    }
    expect(ask("browser", ["https://competitor.example"]).allowed).toBe(true)
    expect(ask("browser", ["button-ref"]).allowed).toBe(false)
    expect(ask("browser", ["Enter"]).allowed).toBe(false)
  })

  test("permissions without a read-only form are refused as a whole", () => {
    // `tool/git.ts:126` 只对**写动作** ask `"git"`，只读动作根本不过权限层 ——
    // 所以 `"git"` 不能进 `PLAN_READ_ONLY_PERMISSIONS`（那等于放行 `git push`）。
    for (const permission of ["computer", "cron", "database", "monitor"]) {
      const denied = ask(permission, ["*"])
      expect(denied.allowed).toBe(false)
      if (denied.allowed) continue
      expect(denied.kind).toBe("tool")
      expect(denied.reason).toContain("read-only tools only")
    }
  })

  // `git` 走按动作分级（防御性：生产路径到不了，见 planVerdict 注释）。
  test("git asks are judged per action", () => {
    for (const action of ["status", "diff", "log", "show", "rev-parse"]) {
      expect(ask("git", [action]).allowed).toBe(true)
    }
    for (const action of ["push", "commit", "checkout", "pull", "stash", "add", "config"]) {
      const denied = ask("git", [action])
      expect(denied.allowed).toBe(false)
      if (denied.allowed) continue
      expect(denied.kind).toBe("tool")
    }
    // 没有动作信息时保守拒绝：拿不准就不放行。
    expect(ask("git", []).allowed).toBe(false)
    expect(ask("git", ["*"]).allowed).toBe(false)
  })
})
