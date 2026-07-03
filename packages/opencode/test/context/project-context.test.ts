import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, mkdtemp, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { ProjectContext } from "../../src/context/project-context"

const readProjectContext = (input: { directory: string; worktree: string; plan?: string }) =>
  Effect.runPromise(ProjectContext.read(input).pipe(Effect.provide(AppFileSystem.defaultLayer)))

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), "novaway-project-context-"))
}

async function writeProjectFile(root: string, relativePath: string, content: string) {
  await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
  await writeFile(path.join(root, relativePath), content)
}

describe("ProjectContext", () => {
  test("returns empty context when .novaway files do not exist", async () => {
    expect(await readProjectContext({ directory: await tempProject(), worktree: await tempProject() })).toBe("")
  })

  test("reads project context files in a stable order", async () => {
    const root = await tempProject()
    await writeProjectFile(root, ".novaway/context/conventions.md", "使用项目既有风格。")
    await writeProjectFile(root, ".novaway/context/project.md", "这是项目概览。")
    await writeProjectFile(root, ".novaway/memory/project.md", "用户偏好：先规划。")

    const context = await readProjectContext({ directory: root, worktree: root })

    expect(context.indexOf("## 项目概览")).toBeLessThan(context.indexOf("## 工程约定"))
    expect(context.indexOf("## 工程约定")).toBeLessThan(context.indexOf("## 项目记忆"))
    expect(context).toContain("来源：.novaway/context/project.md")
    expect(context).toContain("用户偏好：先规划。")
  })

  test("includes the active plan file when it exists", async () => {
    const root = await tempProject()
    const plan = path.join(root, ".novaway", "plans", "123-test.md")
    await writeProjectFile(root, ".novaway/plans/123-test.md", "1. 先分析\n2. 再执行")

    const context = await readProjectContext({ directory: root, worktree: root, plan })

    expect(context).toContain("## 当前计划")
    expect(context).toMatch(/来源：\.novaway[\\/]plans[\\/]123-test\.md/)
    expect(context).toContain("1. 先分析")
  })

  test("truncates oversized project context", () => {
    const context = ProjectContext.build([
      {
        title: "项目概览",
        source: ".novaway/context/project.md",
        content: "a".repeat(40_000),
      },
    ])

    expect(context.length).toBeLessThan(33_000)
    expect(context).toContain("[内容已截断]")
  })
})
