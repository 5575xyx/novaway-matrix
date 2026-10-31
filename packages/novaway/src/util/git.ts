/**
 * 本机有没有 git。
 *
 * 没有 git 不是错误：扩展市场会退回仓库归档下载，git 协议的插件也会先落成
 * 归档目录再按 `file:` 安装。结果缓存在进程内，避免每次安装都起子进程探测。
 */
import { run } from "@/util/process"

let cached: Promise<boolean> | undefined

export function hasGit(): Promise<boolean> {
  if (!cached) {
    cached = run(["git", "--version"], { timeout: 15_000 })
      .then((result) => result.code === 0)
      .catch(() => false)
  }
  return cached
}

/** 测试用：清掉缓存。 */
export function resetGitProbe() {
  cached = undefined
}
