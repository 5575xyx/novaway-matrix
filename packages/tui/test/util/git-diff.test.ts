import { afterAll, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "fs"
import os from "os"
import path from "path"
import { loadCommitPatch, loadFilePatch, untrackedPatch } from "../../src/util/git-diff"

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
  for (const dir of tmpDirs) {
    // Windows 上 git 子进程刚退出时目录句柄可能还没释放完,rm 会 EBUSY。
    // 临时目录,清不掉也无妨,别让它把测试结果带红。
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
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

test("loadFilePatch 非 HEAD 错误照样上抛,不静默降级成合成补丁", async () => {
  // loadFilePatch 只该吞「仓库还没有 HEAD」这一种失败。别的错误(不在仓库里、超时、
  // 权限)必须往上抛,否则组件永远显示不出错误,用户看到的是一份凭空合成的补丁。
  // 这条钉住的是两回调写法里的 `throw e` —— 改成 `.catch(() => untrackedPatch(...))` 就会红。
  //
  // 注意非仓库目录里 git 报的是 `Could not access 'HEAD'`(不是 `not a git repository`),
  // 正因为它不含 isMissingHead 认的那两个串,错误才会被正确上抛。
  const dir = tmpGitDir("nw-diff-norepo-")
  await expect(loadFilePatch(dir, "any.txt")).rejects.toThrow(/Could not access 'HEAD'/)
})

test("loadCommitPatch 只输出 diff 正文,不带提交说明", async () => {
  // git show 默认会把提交信息也打出来。`--format=` 是为了让差异面板只拿到补丁。
  const dir = tmpGitDir("nw-diff-commit-")
  await git(dir, ["init", "-b", "main"])
  fs.writeFileSync(path.join(dir, "a.txt"), "第一版\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "这是提交说明,不该出现在补丁里"])
  const log = await exec("git", ["log", "-1", "--format=%H"], { cwd: dir })
  const patch = await loadCommitPatch(dir, log.stdout.trim())
  expect(patch).toContain("+第一版")
  expect(patch).not.toContain("这是提交说明")
  expect(patch).not.toContain("commit ")
})
