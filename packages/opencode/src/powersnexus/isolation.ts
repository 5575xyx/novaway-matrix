import path from "node:path"
import os from "node:os"
import { Schema } from "effect"

export type IsolationMode = "logical" | "os"

/** 动作风险类别：对应交接文档 15.1 自动本地交付边界。 */
export type ActionClass = "local_delivery" | "external" | "destructive" | "privileged"

export const IsolationStatus = Schema.Struct({
  mode: Schema.Literals(["logical", "os"]),
  platform: Schema.String,
  worktreeOnlyWrite: Schema.Boolean,
  networkDefault: Schema.Literals(["deny", "ask", "allow"]),
  autoLocalDeliveryScope: Schema.Literals(["worktree_only", "unrestricted"]),
  note: Schema.String,
})
export type IsolationStatus = Schema.Schema.Type<typeof IsolationStatus>

const LOCAL_DELIVERY_ACTIONS = new Set([
  "configure_delivery",
  "verify",
  "archive",
  "inspect",
  "validate",
  "install_deps",
  "build",
  "test",
  "run",
  "browser_qa",
  "create_worktree",
  "update_artifact",
  "local_archive",
])

const EXTERNAL_ACTIONS = new Set([
  "push",
  "create_pr",
  "merge",
  "deploy",
  "publish",
  "external_publish",
  "remote_write",
])

const DESTRUCTIVE_ACTIONS = new Set(["delete_data", "irreversible_migrate", "rm_rf", "format_disk"])

const PRIVILEGED_ACTIONS = new Set(["elevate_system", "manage_secrets", "billing", "account", "sudo"])

/** 当前实现为逻辑权限模式；OS 级 Job Object/沙箱尚未启用。 */
export function isolationStatus(): IsolationStatus {
  const osEnabled = process.env.POWERSNEXUS_OS_ISOLATION === "1"
  // 显式环境开关也不能谎称 OS 级隔离已就绪；在真正实现前始终降级为 logical。
  const mode: IsolationMode = osEnabled ? "logical" : "logical"
  return {
    mode,
    platform: process.platform,
    worktreeOnlyWrite: true,
    networkDefault: "ask",
    autoLocalDeliveryScope: "worktree_only",
    note:
      process.platform === "win32"
        ? "Windows 尚未启用 Job Object/受限 Token，当前为逻辑权限模式"
        : "当前平台尚未启用 OS 级隔离，当前为逻辑权限模式",
  }
}

export function classifyAction(action: string): ActionClass {
  const normalized = action.trim().toLowerCase()
  if (PRIVILEGED_ACTIONS.has(normalized)) return "privileged"
  if (DESTRUCTIVE_ACTIONS.has(normalized)) return "destructive"
  if (EXTERNAL_ACTIONS.has(normalized)) return "external"
  if (LOCAL_DELIVERY_ACTIONS.has(normalized)) return "local_delivery"
  // 未知动作按外部处理，强制逐次授权
  return "external"
}

/** 逻辑隔离下仅允许自动批准“本地可运行交付”类动作。 */
export function canAutoLocalApprove(action: string, isolation: IsolationStatus = isolationStatus()): boolean {
  if (!isolation.worktreeOnlyWrite) return false
  if (isolation.autoLocalDeliveryScope !== "worktree_only" && isolation.mode === "logical") return false
  return classifyAction(action) === "local_delivery"
}

export function assertAutoLocalApprove(action: string, isolation: IsolationStatus = isolationStatus()) {
  if (canAutoLocalApprove(action, isolation)) return
  const kind = classifyAction(action)
  throw new Error(`逻辑隔离模式下禁止自动批准动作：${action}（类别=${kind}，需逐次授权）`)
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

/** 允许写入：当前 Worktree，以及系统临时目录白名单。 */
export function assertWritablePath(
  worktree: string,
  target: string,
  options?: {
    tempRoots?: readonly string[]
  },
) {
  const absolute = path.resolve(target)
  try {
    return assertInsideWorktree(worktree, absolute)
  } catch {
    const temps = (options?.tempRoots ?? [os.tmpdir(), path.join(os.tmpdir(), "powersnexus")]).map((item) =>
      path.resolve(item),
    )
    for (const root of temps) {
      const relative = path.relative(root, absolute)
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
        return absolute
      }
    }
    throw new Error(`逻辑隔离模式禁止写入 Worktree/临时目录之外：${target}`)
  }
}

/** 自动路径下仅允许本机回环；外网域名必须逐次授权。 */
export function assertNetworkTargetAllowed(
  input: string,
  isolation: IsolationStatus = isolationStatus(),
  options?: { auto?: boolean },
) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`网络目标不是有效 URL：${input}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`仅允许 http/https 网络目标：${input}`)
  }
  const host = url.hostname.toLowerCase()
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
  if (options?.auto !== false && isolation.networkDefault !== "allow" && !loopback) {
    throw new Error(`逻辑隔离模式下禁止自动访问外网：${input}`)
  }
  return url
}

export * as PowersNexusIsolation from "./isolation"
