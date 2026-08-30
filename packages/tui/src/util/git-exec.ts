// 共享的 git 子进程跑法:超时 8 秒、4MB 输出上限、关闭路径转义。
// 面板/差异视图都从这里起进程;纯解析逻辑在 git-status.ts,别混进来。
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

export const GIT_TIMEOUT = 8000

export function gitExec(rootPath: string, args: string[]): Promise<{ stdout: string }> {
  return exec("git", ["-c", "core.quotepath=false", ...args], {
    cwd: rootPath,
    maxBuffer: 4 * 1024 * 1024,
    timeout: GIT_TIMEOUT,
  })
}
