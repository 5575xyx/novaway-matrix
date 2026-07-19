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
  // 延迟引用，避免与 os-isolation 循环依赖在模块初始化阶段炸裂
  if (process.platform === "win32" && process.env.POWERSNEXUS_OS_ISOLATION !== "0") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("./os-isolation") as typeof import("./os-isolation")
      if (mod.isOsIsolationAvailable()) return mod.processIsolationStatus()
    } catch {
      // fall through to logical
    }
  }
  return {
    mode: "logical",
    platform: process.platform,
    worktreeOnlyWrite: true,
    networkDefault: "ask",
    autoLocalDeliveryScope: "worktree_only",
    note:
      process.platform === "win32"
        ? "Windows Job Object 未启用或不可用，当前为逻辑权限模式"
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


/** 工作区隔离临时目录（强制子进程 TEMP 落在 Worktree 内）。 */
export function sandboxTempRoot(worktree: string, runID = "shared") {
  const safeRun = runID.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "shared"
  return path.join(path.resolve(worktree), ".novaway", "powersnexus", "tmp", safeRun)
}

function looksLikeFilesystemPath(arg: string): boolean {
  if (!arg) return false
  if (arg.startsWith("-")) {
    const eq = arg.indexOf("=")
    if (eq > 0) return looksLikeFilesystemPath(arg.slice(eq + 1))
    return false
  }
  if (path.isAbsolute(arg)) return true
  if (/^[A-Za-z]:[\\/]/.test(arg)) return true
  if (arg.startsWith("\\\\") || arg.startsWith("//")) return true
  return false
}

/** 拒绝 argv 中指向 Worktree/临时白名单之外的绝对路径参数。 */
export function assertArgvWithinWriteRoots(
  worktree: string,
  argv: readonly string[],
  options?: { tempRoots?: readonly string[] },
) {
  const roots = options?.tempRoots ?? [sandboxTempRoot(worktree)]
  // argv[0] 是可执行文件本身，允许位于系统目录；只审查参数中的路径。
  for (const raw of argv.slice(1)) {
    const arg = raw.startsWith("-") && raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : raw
    if (!looksLikeFilesystemPath(arg)) continue
    assertWritablePath(worktree, arg, { tempRoots: roots })
  }
}

/** 构造隔离子进程环境：强制 TEMP/TMP 进入 Worktree 沙箱。 */
export function buildIsolatedProcessEnv(input: {
  worktree: string
  runID: string
  base?: NodeJS.ProcessEnv
}): { env: NodeJS.ProcessEnv; tempRoot: string } {
  const worktree = path.resolve(input.worktree)
  const tempRoot = sandboxTempRoot(worktree, input.runID)
  const base = { ...(input.base ?? process.env) }
  // 去掉可能把写入引到外部的变量，再强制覆盖
  delete base.TMP
  delete base.TEMP
  delete base.TMPDIR
  const env: NodeJS.ProcessEnv = {
    ...base,
    TEMP: tempRoot,
    TMP: tempRoot,
    TMPDIR: tempRoot,
    POWERSNEXUS_WORKTREE: worktree,
    POWERSNEXUS_WRITE_ROOTS: [worktree, tempRoot].join(path.delimiter),
    POWERSNEXUS_ISOLATION: "1",
  }
  return { env, tempRoot }
}

export * as PowersNexusIsolation from "./isolation"
