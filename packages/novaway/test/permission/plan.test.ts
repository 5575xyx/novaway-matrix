import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Global } from "@novaway/core/global"
import { isPlanWrite, isReadOnlyShell, planDirectories } from "@/permission/plan"

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
    expect(
      isPlanWrite([path.join(".novaway", "plans", "a.md"), path.join("src", "a.ts")], instance),
    ).toBe(false)
  })
})

describe("plan mode read-only shell", () => {
  test("common read commands are allowed", () => {
    expect(isReadOnlyShell(["ls -la"])).toBe(true)
    expect(isReadOnlyShell(["cat package.json"])).toBe(true)
    expect(isReadOnlyShell(["rg \"TODO\" src"])).toBe(true)
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
