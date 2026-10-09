// diff 加载。原来长在 component/git-diff-view.tsx 里,抽出来是因为 GitWorkspace 的右侧
// 差异面板要用同一套逻辑(含未跟踪文件的合成补丁)——两个地方各写一份,迟早漂。
import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { gitExec } from "./git-exec"

// 合成补丁最多带多少行正文:未跟踪的大文件(构建产物)不把界面撑爆。
export const SYNTH_DIFF_MAX_LINES = 400

/**
 * 未跟踪的新文件没有 diff 输出(git diff 只看索引里已有的内容),这里合成一份
 * 「全新文件」补丁,照样能看到内容。
 *
 * 用 try/catch 而不是先 statSync 再 readFileSync:两次系统调用之间文件可能被删,
 * 而这两个操作的失败都只是「看不到内容」,不值得向上抛。
 */
export function untrackedPatch(filePath: string, rootPath: string): string {
  try {
    // 调用方给的是相对仓库根的路径,statSync/readFileSync 却按进程 cwd 解析,这里先落成绝对路径。
    const abs = resolve(rootPath, filePath)
    if (statSync(abs).size > 1024 * 1024) return ""
    const lines = readFileSync(abs, "utf-8").split("\n")
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    const shown = lines.slice(0, SYNTH_DIFF_MAX_LINES)
    return [
      `diff --git a/${filePath} b/${filePath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${filePath}`,
      `@@ -0,0 +1,${shown.length} @@`,
      ...shown.map((line) => `+${line}`),
    ].join("\n")
  } catch {
    return ""
  }
}

/** 单个文件相对 HEAD 的补丁(已暂存 + 未暂存一起看,和「这次提交会带上什么」一致)。 */
export function loadFilePatch(rootPath: string, filePath: string): Promise<string> {
  return gitExec(rootPath, ["diff", "HEAD", "--no-color", "--", filePath]).then(
    (out) => {
      const body = out.stdout.trimEnd()
      // 空 diff 只有两种可能:未跟踪的新文件,或改动已全部提交(内容 == HEAD)。
      return body || untrackedPatch(filePath, rootPath)
    },
    (e: unknown) => {
      // 仓库还没任何提交时不存在 HEAD,git 直接 fatal;此刻文件只可能是未跟踪,照旧合成补丁。
      if (!isMissingHead(e)) throw e
      return untrackedPatch(filePath, rootPath)
    },
  )
}

/** execFile 的失败对象带 stderr,git 对「没有 HEAD」的报错就落在那里面。 */
function isMissingHead(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const stderr = "stderr" in e ? String(e.stderr) : ""
  return stderr.includes("bad revision 'HEAD'") || stderr.includes("unknown revision")
}

/** 一个提交的补丁。`--format=` 让 git 只输出 diff 正文,不带提交说明。 */
export function loadCommitPatch(rootPath: string, hash: string): Promise<string> {
  return gitExec(rootPath, ["show", "--no-color", "--format=", hash]).then((out) => out.stdout.trimEnd())
}
