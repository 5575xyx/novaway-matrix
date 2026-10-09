import { afterAll, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "fs"
import os from "os"
import path from "path"
import { loadFilePatch, untrackedPatch } from "../../src/util/git-diff"

test("untrackedPatch 对不存在的文件返回空串", () => {
  expect(untrackedPatch("nonexistent-file-for-test.ts", process.cwd())).toBe("")
})

test("untrackedPatch 对空路径返回空串", () => {
  expect(untrackedPatch("", "")).toBe("")
})

// 下面起真 git 子进程 —— 口径照抄 test/component/git-workspace-state.test.ts:
// loadFilePatch 的「空 diff 就合成补丁」是本任务的核心行为,不钉住它,抽不抽出来没人看得出区别。

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

test("loadFilePatch 未跟踪的新文件合成「全新文件」补丁", async () => {
  const dir = tmpGitDir("nw-diff-untracked-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "new.txt"), "第一行\n第二行\n")
  const patch = await loadFilePatch(dir, "new.txt")
  expect(patch).toContain("new file mode 100644")
  expect(patch).toContain("--- /dev/null")
  expect(patch).toContain("@@ -0,0 +1,2 @@")
  expect(patch).toContain("+第一行")
  expect(patch).toContain("+第二行")
})

test("loadFilePatch 已跟踪文件走真 git diff", async () => {
  const dir = tmpGitDir("nw-diff-tracked-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "原样\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "init"])
  fs.writeFileSync(path.join(dir, "a.txt"), "改过\n")
  const patch = await loadFilePatch(dir, "a.txt")
  expect(patch).toContain("-原样")
  expect(patch).toContain("+改过")
  expect(patch).not.toContain("new file mode")
})
