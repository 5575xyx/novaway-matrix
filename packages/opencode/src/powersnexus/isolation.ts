import path from "node:path"
import { Schema } from "effect"

export type IsolationMode = "logical" | "os"

export const IsolationStatus = Schema.Struct({
  mode: Schema.Literals(["logical", "os"]),
  platform: Schema.String,
  worktreeOnlyWrite: Schema.Boolean,
  networkDefault: Schema.Literals(["deny", "ask", "allow"]),
  note: Schema.String,
})
export type IsolationStatus = Schema.Schema.Type<typeof IsolationStatus>

/** 当前实现为逻辑权限模式；OS 级 Job Object/沙箱尚未启用。 */
export function isolationStatus(): IsolationStatus {
  return {
    mode: "logical",
    platform: process.platform,
    worktreeOnlyWrite: true,
    networkDefault: "ask",
    note:
      process.platform === "win32"
        ? "Windows 尚未启用 Job Object/受限 Token，当前为逻辑权限模式"
        : "当前平台尚未启用 OS 级隔离，当前为逻辑权限模式",
  }
}

export function assertInsideWorktree(worktree: string, target: string) {
  const root = path.resolve(worktree)
  const absolute = path.resolve(target)
  const relative = path.relative(root, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径超出 Worktree：${target}`)
  }
  return absolute
}

export * as PowersNexusIsolation from "./isolation"
